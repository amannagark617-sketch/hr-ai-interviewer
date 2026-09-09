import { WebSocketServer, WebSocket } from "ws";
import { config } from "../config.js";
import { store } from "../data/store.js";

// ---------------------------------------------------------------------------
// IMPORTANT: this file has NOT been run against live Plivo/Gemini traffic.
// It's written against the documented shape of both APIs as of early 2026:
//   - Plivo Audio Streaming sends/receives JSON frames over a WebSocket
//     ({event:"start"|"media"|"stop", media:{payload:<base64 PCM>}}).
//   - Gemini Live (BidiGenerateContent) is a separate WebSocket that speaks
//     its own JSON protocol for realtime audio in/out.
// Before pointing this at real candidates: place one test call, log every
// frame from both sides, and fix any protocol-shape mismatches against the
// current docs at https://ai.google.dev/gemini-api/docs/live and
// https://www.plivo.com/docs/voice/media-streams/.
// ---------------------------------------------------------------------------

const GEMINI_LIVE_URL =
  `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${config.gemini.apiKey}`;

const AGENT_SYSTEM_PROMPT = `You are Maya, a friendly, efficient recruiter conducting a first-round phone screen.
Sound like a real person: brief acknowledgements ("got it", "makes sense"), natural pacing, no long
monologues. Keep each turn to 1-3 sentences. Ask about the candidate's relevant experience, one or two
role-specific questions, and their availability/notice period. Let the candidate finish speaking before
responding. If interrupted, stop talking and listen. Open with a warm greeting, confirm you're speaking
with the right person, and mention the call is recorded for hiring purposes before continuing.`;

function openGeminiLiveSession(jobDescription) {
  const ws = new WebSocket(GEMINI_LIVE_URL);

  ws.on("open", () => {
    ws.send(
      JSON.stringify({
        setup: {
          model: "models/gemini-2.0-flash-live-001",
          generationConfig: { responseModalities: ["AUDIO"] },
          systemInstruction: {
            parts: [{ text: `${AGENT_SYSTEM_PROMPT}\n\nRole context:\n${jobDescription}` }],
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
    const geminiSocket = openGeminiLiveSession(jobDescription);
    let transcript = "";

    geminiSocket.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      // Audio the model generated -> relay to Plivo as a media frame.
      const audioPart = msg?.serverContent?.modelTurn?.parts?.find((p) => p.inlineData?.mimeType?.startsWith("audio/"));
      if (audioPart && plivoSocket.readyState === WebSocket.OPEN) {
        plivoSocket.send(
          JSON.stringify({
            event: "playAudio",
            media: {
              contentType: "audio/x-l16;rate=16000",
              sampleRate: 16000,
              payload: audioPart.inlineData.data,
            },
          })
        );
      }

      // Text transcript pieces, if the model/config surfaces them - accumulate for scoring later.
      const textPart = msg?.serverContent?.modelTurn?.parts?.find((p) => p.text);
      if (textPart) transcript += `Agent: ${textPart.text}\n`;

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
