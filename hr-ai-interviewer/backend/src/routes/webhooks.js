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
    answeredAt: new Date().toISOString(),
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
  const customQuestions = store.getCustomQuestions();

  // Duration was previously computed as Date.now() - answeredAt at the BOTTOM of this handler —
  // after the recording fetch, the transcript-wait retry loop, and the Gemini scoring call had
  // all already run, so "now" was however long those took (seconds to tens of seconds) after the
  // call actually ended, not at hangup. Plivo's own hangup callback carries the real duration it
  // measured (Duration, seconds, falling back to BillDuration) — that's ground truth from the
  // call itself, immune to any lag or bug in our own answeredAt bookkeeping, so prefer it and only
  // fall back to our own estimate — captured right here, before any of those delays — if Plivo
  // didn't send one.
  const plivoDuration = Number(req.body.Duration ?? req.body.BillDuration ?? req.body.duration ?? req.body.bill_duration);
  const selfEstimatedDuration = call.answeredAt ? Math.round((Date.now() - new Date(call.answeredAt).getTime()) / 1000) : null;
  const durationSeconds = Number.isFinite(plivoDuration) && plivoDuration >= 0 ? plivoDuration : selfEstimatedDuration;
  console.log(
    `[webhooks/hangup] Call ${callId} duration: Plivo reported Duration=${req.body.Duration} BillDuration=${req.body.BillDuration}, our own estimate=${selfEstimatedDuration}s, using ${durationSeconds}s`
  );

  store.updateCall(callId, { status: "completed" });

  // Recording fetch, interview scoring, and Sheets logging are three independent outcomes —
  // each used to be chained in one try block, so a failure in an earlier step (Gemini scoring
  // hitting a transient error, say) silently skipped every step after it, including Sheets
  // logging, with only a single generic error logged for the whole chain. Each now runs in its
  // own try/catch and logs its own clear outcome, so a failure in one is never mistaken for a
  // failure in (or silently taken out) the others.

  let recordingUrl = null;
  try {
    recordingUrl = call.plivoCallUuid ? await getRecordingUrl(call.plivoCallUuid) : null;
  } catch (err) {
    console.error(`[webhooks/hangup] Failed to fetch recording URL for call ${callId}:`, err);
  }

  // The /hangup webhook and the media WebSocket's own close event are two separate,
  // independently-timed callbacks from Plivo — there's no guarantee this webhook fires after
  // the WS side has finished writing the final transcript into the store (callBridge.js does
  // that in its plivoSocket "close" handler). Using the `call` snapshot captured at the top of
  // this handler risks reading transcript before it's been persisted, silently skipping
  // scoring — a call finishes, the page shows "Completed" with nothing else. Re-fetch and give
  // it a moment, the same pattern already used for getRecordingUrl above.
  let latestCall = call;
  for (let attempt = 0; attempt < 4 && !latestCall.transcript?.trim(); attempt++) {
    await new Promise((r) => setTimeout(r, 1000));
    latestCall = store.getCall(callId) || latestCall;
  }

  let interviewScore = null;
  let recommendation = null;
  let summary = "";
  let interviewStrengths = [];
  let interviewConcerns = [];

  if (latestCall.transcript?.trim()) {
    try {
      const scored = await scoreInterviewTranscript(jobDescription, latestCall.transcript, candidate?.name || "Candidate", customQuestions);
      interviewScore = scored.score;
      recommendation = scored.recommendation;
      summary = scored.summary;
      interviewStrengths = scored.strengths || [];
      interviewConcerns = scored.concerns || [];
      console.log(`[webhooks/hangup] Call ${callId} scored: ${interviewScore} (${recommendation})`);
    } catch (err) {
      console.error(`[webhooks/hangup] Failed to score interview transcript for call ${callId}:`, err);
    }
  } else {
    console.error(`[webhooks/hangup] Call ${callId} has no transcript after retrying — skipping post-call scoring. Either the call had no audible speech, or the WS bridge never persisted one.`);
  }

  store.updateCall(callId, {
    recordingUrl,
    interviewScore,
    recommendation,
    summary,
    strengths: interviewStrengths,
    concerns: interviewConcerns,
    durationSeconds,
  });

  if (config.appsScript.webAppUrl) {
    try {
      await appendCallResultRow({
        candidateName: candidate?.name || "Unknown",
        phone: candidate?.phone || "",
        resumeScore: candidate?.score,
        resumeVerdict: candidate?.verdict,
        resumePros: candidate?.pros || [],
        resumeCons: candidate?.cons || [],
        // Sent raw so Code.gs can save it as a Drive file and link it from the row — keeps this
        // app's "no service account" design (Apps Script already runs as the sheet owner's own
        // Google identity, so it can write to that same account's Drive with no new credentials).
        // resumeFile (the exact original upload) is preferred when present; Code.gs falls back to
        // saving resumeText as a plain-text file for candidates added by pasting text directly,
        // which never had an original file to begin with.
        resumeText: candidate?.resumeText || "",
        resumeFileBase64: candidate?.resumeFile?.base64 || "",
        resumeFileName: candidate?.resumeFile?.filename || "",
        resumeMimeType: candidate?.resumeFile?.mimeType || "",
        callStatus: "completed",
        callDurationSeconds: durationSeconds,
        interviewScore,
        recommendation,
        interviewStrengths,
        interviewConcerns,
        recordingUrl,
        interviewSummary: summary,
      });
      console.log(`[webhooks/hangup] Call ${callId} logged to Google Sheets.`);
    } catch (err) {
      // Most common causes: the SECRET in Code.gs doesn't match APPS_SCRIPT_SECRET (a very easy
      // thing to update in one place and forget the other), or the deployment's access level
      // isn't set to "Anyone" (sheetsService.js reports that case with its own clearer message).
      console.error(`[webhooks/hangup] Failed to log call ${callId} to Google Sheets:`, err.message);
    }
  } else {
    console.warn(`[webhooks/hangup] APPS_SCRIPT_WEB_APP_URL is not set — call ${callId} was not logged to Sheets.`);
  }
});
