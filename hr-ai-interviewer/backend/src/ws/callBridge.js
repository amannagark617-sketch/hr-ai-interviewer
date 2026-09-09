import { WebSocketServer, WebSocket } from "ws";
import { config } from "../config.js";
import { store } from "../data/store.js";

// ---------------------------------------------------------------------------
// IMPORTANT: this file has NOT been run against live Plivo/Gemini traffic.
// It's written against the documented shape of both APIs as of Sept 2026:
//   - Plivo Audio Streaming sends/receives JSON frames over a WebSocket
//     ({event:"start"|"media"|"stop", media:{payload:<base64 PCM>}}), using
//     16-bit linear PCM at 16kHz (contentType "audio/x-l16;rate=16000").
//   - Gemini Live (BidiGenerateContent) is a separate WebSocket that speaks
//     its own JSON protocol for realtime audio in/out. It accepts 16kHz PCM16
//     input and produces 24kHz PCM16 output — the two rates are NOT the same,
//     which is why the outgoing sample rate below is read from Gemini's own
//     response instead of being hardcoded.
// Before pointing this at real candidates: place one test call, log every
// frame from both sides, and fix any protocol-shape mismatches against the
// current docs at https://ai.google.dev/gemini-api/docs/live-api and
// https://www.plivo.com/docs/voice/xml/audio-streaming.
// ---------------------------------------------------------------------------

const GEMINI_LIVE_URL =
  `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${config.gemini.apiKey}`;

// gemini-3.1-flash-live-preview is the current Live API model as of this writing (it superseded
// gemini-2.5-flash-native-audio-preview-*, which itself superseded the now-retired
// gemini-2.0-flash-live-001). Live API model names change fairly often — if setup fails with a
// "model not found" error, check https://ai.google.dev/gemini-api/docs/live-api for the current name.
const GEMINI_LIVE_MODEL = "models/gemini-3.1-flash-live-preview";

function buildAgentSystemPrompt({ jobDescription, candidateName, resumeText }) {
  return `You are Maya, a warm, sharp recruiter doing a quick first-round phone screen. You are on a live
phone call right now — talk like a real person on the phone, never like you're reading a script or
giving a lecture.

How to sound human, not like an AI:
- Keep every turn SHORT — one or two sentences, sometimes just a few words ("Got it.", "Nice, tell me
  more about that."). Never deliver a paragraph in one breath.
- Ask ONE question at a time and actually wait for the answer. Don't stack multiple questions together.
- React to what they just said before moving on — a quick "that makes sense" or "oh interesting" beats
  jumping straight to the next question.
- Talk the way people actually talk: contractions, the occasional "okay" / "gotcha", natural pacing.
  No corporate buzzwords, no reading their resume back to them like a checklist.
- If they give a short or hesitant answer, gently follow up instead of filling the silence yourself.
- If they start talking while you're mid-sentence, stop immediately and listen. Never talk over them.
- Don't narrate what you're about to do ("Now I'll ask you about...") — just ask it.
- Keep the whole call tight, roughly 6-8 minutes.

Call structure:
1. Open warmly, confirm you're speaking with ${candidateName || "the candidate"}, and mention — in one
   natural breath, not as a formal disclaimer — that the call is being recorded for hiring purposes.
2. Ask 2-3 questions about the experience most relevant to this role, grounded in specifics from their
   resume below (not generic questions you could ask anyone).
3. Ask about their availability / notice period.
4. Give them a chance to ask one quick question, thank them genuinely, and close warmly — let them know
   the team will follow up soon.

Role this candidate is interviewing for:
${jobDescription}

What we know about this candidate from their resume:
${(resumeText || "No resume on file.").slice(0, 4000)}`;
}

function openGeminiLiveSession(jobDescription, candidate) {
  const ws = new WebSocket(GEMINI_LIVE_URL);

  ws.on("open", () => {
    ws.send(
      JSON.stringify({
        setup: {
          model: GEMINI_LIVE_MODEL,
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: config.gemini.voiceName } },
            },
          },
          // Without these, serverContent never carries transcription text for either side,
          // and we'd have no transcript to score or log after the call.
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: {
            parts: [
              {
                text: buildAgentSystemPrompt({
                  jobDescription,
                  candidateName: candidate?.name,
                  resumeText: candidate?.resumeText,
                }),
              },
            ],
          },
        },
      })
    );
  });

  return ws;
}

export function attachCallBridge(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws/media" });

  wss.on("connection", (plivoSocket, req) => {
    const url = new URL(req.url, "http://localhost");
    const callId = url.searchParams.get("callId");
    const call = callId && store.getCall(callId);

    if (!call) {
      plivoSocket.close(1008, "Unknown call");
      return;
    }

    const candidate = store.getCandidate(call.candidateId);
    const jobDescription = store.getJobDescription();
    const geminiSocket = openGeminiLiveSession(jobDescription, candidate);
    let transcript = "";

    geminiSocket.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      // Model was interrupted (candidate started talking over it) — Gemini stops generating on
      // its own, but Plivo may still be playing out audio frames we already sent. There's no
      // documented "clear the playback queue" event for Plivo streams, so the best we can do here
      // is stop forwarding further audio for this turn; verify against a live test call whether
      // any perceptible overlap remains.
      if (msg?.serverContent?.interrupted) return;

      // Audio the model generated -> relay to Plivo as a media frame. Gemini's native audio output
      // is 24kHz, not the 16kHz we send it — read the real rate out of the mimeType instead of
      // assuming, or Plivo will play it back at the wrong speed/pitch.
      const audioPart = msg?.serverContent?.modelTurn?.parts?.find((p) => p.inlineData?.mimeType?.startsWith("audio/"));
      if (audioPart && plivoSocket.readyState === WebSocket.OPEN) {
        const rateMatch = audioPart.inlineData.mimeType.match(/rate=(\d+)/);
        const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
        plivoSocket.send(
          JSON.stringify({
            event: "playAudio",
            media: {
              contentType: `audio/x-l16;rate=${sampleRate}`,
              sampleRate,
              payload: audioPart.inlineData.data,
            },
          })
        );
      }

      // Transcription text, surfaced because inputAudioTranscription/outputAudioTranscription are
      // enabled in the setup message above — accumulate for post-call scoring and the Sheets log.
      const outputTranscription = msg?.serverContent?.outputTranscription?.text;
      if (outputTranscription) transcript += `Agent: ${outputTranscription}\n`;

      const inputTranscription = msg?.serverContent?.inputTranscription?.text;
      if (inputTranscription) transcript += `Candidate: ${inputTranscription}\n`;
    });

    geminiSocket.on("error", (err) => {
      console.error(`[callBridge] Gemini socket error for call ${callId}:`, err.message);
    });

    plivoSocket.on("message", (raw) => {
      let frame;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (frame.event === "media" && geminiSocket.readyState === WebSocket.OPEN) {
        geminiSocket.send(
          JSON.stringify({
            realtimeInput: {
              mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: frame.media.payload }],
            },
          })
        );
      }

      if (frame.event === "stop") {
        store.updateCall(callId, { transcript });
        geminiSocket.close();
      }
    });

    plivoSocket.on("close", () => {
      store.updateCall(callId, { transcript });
      if (geminiSocket.readyState === WebSocket.OPEN) geminiSocket.close();
    });
  });

  return wss;
}
