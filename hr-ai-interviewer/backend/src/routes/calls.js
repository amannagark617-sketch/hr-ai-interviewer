import { Router } from "express";
import { nanoid } from "nanoid";
import { assertConfigured } from "../config.js";
import { store } from "../data/store.js";
import { placeCall } from "../services/plivoService.js";

export const callsRouter = Router();

callsRouter.get("/", (req, res) => {
  const calls = store.listCalls().map((call) => ({
    ...call,
    candidate: store.getCandidate(call.candidateId) || null,
  }));
  res.json({ calls });
});

// Triggers first-round calls for the given candidate IDs. Candidates must have a phone number.
callsRouter.post("/trigger", async (req, res) => {
  try {
    assertConfigured(["gemini.apiKey", "plivo.authId", "plivo.authToken", "plivo.fromNumber", "publicBaseUrl"]);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const { candidateIds } = req.body;
  if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
    return res.status(400).json({ error: "candidateIds must be a non-empty array" });
  }

  const outcomes = [];
  for (const candidateId of candidateIds) {
    const candidate = store.getCandidate(candidateId);
    if (!candidate) {
      outcomes.push({ candidateId, ok: false, error: "Candidate not found" });
      continue;
    }
    if (!candidate.phone) {
      outcomes.push({ candidateId, ok: false, error: "No phone number on file" });
      continue;
    }

    const call = store.createCall({
      id: nanoid(),
      candidateId,
      status: "dialing",
      plivoCallUuid: null,
      transcript: "",
      recordingUrl: null,
      interviewScore: null,
      recommendation: null,
      createdAt: new Date().toISOString(),
    });

    try {
      const plivoResponse = await placeCall({ toNumber: candidate.phone, callId: call.id });
      store.updateCall(call.id, { plivoRequestUuid: plivoResponse.requestUuid });
      outcomes.push({ candidateId, ok: true, callId: call.id });
    } catch (err) {
      store.updateCall(call.id, { status: "failed" });
      outcomes.push({ candidateId, ok: false, error: err.message });
    }
  }

  res.json({ outcomes });
});
