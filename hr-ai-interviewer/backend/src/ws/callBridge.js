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

// The <Stream> tag below declares one shared contentType (16kHz) for this connection, but
// Gemini Live's audio output is fixed at 24kHz — it's not something we can request at a
// different rate. Relaying that 24kHz PCM to Plivo unconverted, just relabeled, is what made a
// real test call sound "very slow, like a snail": whatever rate Plivo actually plays audio back
// at, the real data doesn't match it. Actually resampling down to 16kHz — instead of just
// changing a label — is correct regardless of which rate Plivo turns out to honor.
function resamplePcm16(base64Data, fromRate, toRate) {
  if (fromRate === toRate) return base64Data;
  const input = Buffer.from(base64Data, "base64");
  const inputSamples = input.length / 2; // 16-bit PCM = 2 bytes/sample
  const outputSamples = Math.floor((inputSamples * toRate) / fromRate);
  const output = Buffer.alloc(outputSamples * 2);
  const ratio = fromRate / toRate;

  for (let i = 0; i < outputSamples; i++) {
    const srcPos = i * ratio;
    const lo = Math.floor(srcPos);
    const hi = Math.min(lo + 1, inputSamples - 1);
    const frac = srcPos - lo;
    const sampleLo = input.readInt16LE(lo * 2);
    const sampleHi = input.readInt16LE(hi * 2);
    output.writeInt16LE(Math.round(sampleLo + (sampleHi - sampleLo) * frac), i * 2);
  }
  return output.toString("base64");
}

const PLIVO_STREAM_RATE = 16000; // must match the <Stream> contentType rate attribute below

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

function openGeminiLiveSession(jobDescription, candidate, callId) {
  const ws = new WebSocket(GEMINI_LIVE_URL);

  ws.on("open", () => {
    console.log(`[callBridge] Gemini Live socket open for call ${callId}, sending setup (model=${config.gemini.liveModel})`);
    ws.send(
      JSON.stringify({
        setup: {
          model: config.gemini.liveModel,
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
      // Every prior silent failure in this app (ranking, scoring) turned out to be a swallowed
      // error with no trace anywhere — log everything needed to diagnose this one instead of
      // repeating that. If this fires on a real call, the call IDs won't match at all (a fresh
      // deploy/restart wiped the in-memory store between placing the call and Plivo connecting,
      // or multiple server instances don't share memory) — both are real possibilities worth
      // ruling out from these logs rather than guessing.
      console.error(
        `[callBridge] Rejecting WS connection: no call found for callId=${JSON.stringify(callId)}. ` +
          `Known call IDs right now: ${JSON.stringify(store.listCalls().map((c) => c.id))}`
      );
      plivoSocket.close(1008, "Unknown call");
      return;
    }

    console.log(`[callBridge] Plivo media stream connected for call ${callId}`);

    const candidate = store.getCandidate(call.candidateId);
    const jobDescription = store.getJobDescription();
    const geminiSocket = openGeminiLiveSession(jobDescription, candidate, callId);
    let transcript = "";
    let setupComplete = false;

    geminiSocket.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (err) {
        console.error(`[callBridge] Non-JSON message from Gemini for call ${callId}:`, err.message);
        return;
      }

      try {
        // Gemini Live reports a rejected setup (bad model name, invalid key, quota, etc.) as a
        // normal JSON message with an "error" field, not a socket-level error — miss this and
        // the call just goes dead silent with zero indication why.
        if (msg?.error) {
          console.error(`[callBridge] Gemini Live setup/session error for call ${callId}:`, JSON.stringify(msg.error));
          return;
        }

        if (msg?.setupComplete && !setupComplete) {
          setupComplete = true;
          console.log(`[callBridge] Gemini Live setup complete for call ${callId} — agent is live`);
        }

        // Model was interrupted (candidate started talking over it) — Gemini stops generating on
        // its own, but Plivo may still be playing out audio frames we already sent. There's no
        // documented "clear the playback queue" event for Plivo streams, so the best we can do here
        // is stop forwarding further audio for this turn; verify against a live test call whether
        // any perceptible overlap remains.
        if (msg?.serverContent?.interrupted) return;

        // Audio the model generated -> relay to Plivo as a media frame. Gemini's native audio output
        // is 24kHz — read the real rate out of the mimeType instead of assuming, then resample down
        // to PLIVO_STREAM_RATE to actually match the rate this call declared, not just relabel it.
        const audioPart = msg?.serverContent?.modelTurn?.parts?.find((p) => p.inlineData?.mimeType?.startsWith("audio/"));
        if (audioPart && plivoSocket.readyState === WebSocket.OPEN) {
          const rateMatch = audioPart.inlineData.mimeType.match(/rate=(\d+)/);
          const sourceRate = rateMatch ? Number(rateMatch[1]) : 24000;
          const resampled = resamplePcm16(audioPart.inlineData.data, sourceRate, PLIVO_STREAM_RATE);
          // Per Plivo's Audio Streaming docs, the playAudio media object's contentType is the
          // bare codec ("audio/x-l16") — the ";rate=" suffix belongs on the <Stream> tag's own
          // contentType attribute, not here — and sampleRate is a string, not a number.
          plivoSocket.send(
            JSON.stringify({
              event: "playAudio",
              media: {
                contentType: "audio/x-l16",
                sampleRate: String(PLIVO_STREAM_RATE),
                payload: resampled,
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
      } catch (err) {
        console.error(`[callBridge] Error handling Gemini message for call ${callId}:`, err);
      }
    });

    geminiSocket.on("error", (err) => {
      console.error(`[callBridge] Gemini socket error for call ${callId}:`, err.message);
    });

    geminiSocket.on("close", (code, reason) => {
      console.log(`[callBridge] Gemini socket closed for call ${callId}: code=${code} reason=${reason?.toString() || "(none)"}`);
      if (!setupComplete) {
        console.error(
          `[callBridge] Gemini Live socket closed for call ${callId} before setup completed — the agent never came on the line.`
        );
      }
    });

    plivoSocket.on("message", (raw) => {
      let frame;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (frame.event === "start") {
        console.log(`[callBridge] Plivo stream started for call ${callId}`);
      }

      if (frame.event === "media" && geminiSocket.readyState === WebSocket.OPEN) {
        // realtimeInput.mediaChunks (an array) is deprecated — confirmed via a real call, where
        // Gemini closed the socket (code 1007) within 14ms of setup completing, citing exactly
        // this: "realtime_input.media_chunks is deprecated. Use audio, video, or text instead."
        // That killed the session before the agent could say a word. `audio` takes a single
        // chunk directly instead of an array.
        geminiSocket.send(
          JSON.stringify({
            realtimeInput: {
              audio: { mimeType: "audio/pcm;rate=16000", data: frame.media.payload },
            },
          })
        );
      }

      if (frame.event === "stop") {
        console.log(`[callBridge] Plivo stream stopped for call ${callId}`);
        store.updateCall(callId, { transcript });
        geminiSocket.close();
      }
    });

    plivoSocket.on("error", (err) => {
      console.error(`[callBridge] Plivo socket error for call ${callId}:`, err.message);
    });

    plivoSocket.on("close", (code, reason) => {
      console.log(`[callBridge] Plivo socket closed for call ${callId}: code=${code} reason=${reason?.toString() || "(none)"}`);
      store.updateCall(callId, { transcript });
      if (geminiSocket.readyState === WebSocket.OPEN) geminiSocket.close();
    });
  });

  return wss;
}
