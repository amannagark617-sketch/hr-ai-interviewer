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
  if (!call) return res.status(404).send("Unknown call");

  store.updateCall(callId, {
    status: "in-progress",
    plivoCallUuid: req.body.CallUUID,
  });

  const wsUrl = `${config.publicBaseUrl.replace(/^http/, "ws")}/ws/media`;
  res.type("text/xml").send(buildAnswerXml({ callId, wsUrl }));
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

    let interviewScore = null;
    let recommendation = null;
    let summary = "";

    if (call.transcript?.trim()) {
      const scored = await scoreInterviewTranscript(jobDescription, call.transcript, candidate?.name || "Candidate");
      interviewScore = scored.score;
      recommendation = scored.recommendation;
      summary = scored.summary;
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
