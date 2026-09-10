import { Router } from "express";
import { config } from "../config.js";
import { store } from "../data/store.js";
import { buildAnswerXml, getRecordingUrl } from "../services/plivoService.js";
import { scoreInterviewTranscript } from "../services/geminiService.js";
import { appendCallResultRow } from "../services/sheetsService.js";

export const webhooksRouter = Router();

webhooksRouter.post("/answer", (req, res) => {
  const callId = req.query.callId;
  const call = store.getCall(callId);
  if (!call) {
    console.error(`[webhooks/answer] Unknown callId=${JSON.stringify(callId)} — candidate picked up but we have no record of this call.`);
    return res.status(404).send("Unknown call");
  }

  store.updateCall(callId, {
    status: "in-progress",
    plivoCallUuid: req.body.CallUUID,
  });

  const wsUrl = `${config.publicBaseUrl.replace(/^http/, "ws")}/ws/media`;
  const statusCallbackUrl = `${config.publicBaseUrl}/api/webhooks/stream-status?callId=${encodeURIComponent(callId)}`;
  console.log(`[webhooks/answer] Call ${callId} answered (CallUUID=${req.body.CallUUID}), pointing Stream at ${wsUrl}`);
  if (!config.publicBaseUrl) {
    console.error(`[webhooks/answer] PUBLIC_BASE_URL is not set — the Stream URL above is malformed and Plivo cannot connect to it.`);
  }
  res.type("text/xml").send(buildAnswerXml({ callId, wsUrl, statusCallbackUrl }));
});

// Plivo posts here when the <Stream> connects, stops, or fails — direct ground truth about
// whether the audio bridge ever actually engaged, instead of inferring it from silence.
webhooksRouter.post("/stream-status", (req, res) => {
  const callId = req.query.callId;
  console.log(`[webhooks/stream-status] Call ${callId}:`, JSON.stringify(req.body));
  res.status(200).end();
});

webhooksRouter.post("/hangup", async (req, res) => {
  const callId = req.query.callId;
  const call = store.getCall(callId);
  res.status(200).end(); // ack Plivo immediately, do the rest async

  if (!call) return;
  const candidate = store.getCandidate(call.candidateId);
  const jobDescription = store.getJobDescription();

  store.updateCall(callId, { status: "completed" });

  try {
    const recordingUrl = call.plivoCallUuid ? await getRecordingUrl(call.plivoCallUuid) : null;

    // The /hangup webhook and the media WebSocket's own close event are two separate,
    // independently-timed callbacks from Plivo — there's no guarantee this webhook fires after
    // the WS side has finished writing the final transcript into the store (callBridge.js does
    // that in its plivoSocket "close" handler). Using the `call` snapshot captured at the top of
    // this handler risks reading transcript before it's been persisted, silently skipping
    // scoring — a call finishes, the page shows "Completed" with nothing else, and there's no
    // error anywhere to explain why. Re-fetch and give it a moment, the same pattern already used
    // for getRecordingUrl above.
    let latestCall = call;
    for (let attempt = 0; attempt < 4 && !latestCall.transcript?.trim(); attempt++) {
      await new Promise((r) => setTimeout(r, 1000));
      latestCall = store.getCall(callId) || latestCall;
    }

    let interviewScore = null;
    let recommendation = null;
    let summary = "";

    if (latestCall.transcript?.trim()) {
      const scored = await scoreInterviewTranscript(jobDescription, latestCall.transcript, candidate?.name || "Candidate");
      interviewScore = scored.score;
      recommendation = scored.recommendation;
      summary = scored.summary;
    } else {
      console.error(`[webhooks/hangup] Call ${callId} has no transcript after retrying — skipping post-call scoring. Either the call had no audible speech, or the WS bridge never persisted one.`);
    }

    store.updateCall(callId, { recordingUrl, interviewScore, recommendation, summary });

    if (config.appsScript.webAppUrl) {
      await appendCallResultRow({
        candidateName: candidate?.name || "Unknown",
        phone: candidate?.phone || "",
        resumeScore: candidate?.score,
        resumeVerdict: candidate?.verdict,
        callStatus: "completed",
        interviewScore,
        recommendation,
        recordingUrl,
        interviewSummary: summary,
      });
    }
  } catch (err) {
    console.error(`[webhooks/hangup] Failed to finalize call ${callId}:`, err);
  }
});
