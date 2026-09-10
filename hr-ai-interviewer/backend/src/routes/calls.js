import { Router } from "express";
import { assertConfigured } from "../config.js";
import { store } from "../data/store.js";
import { triggerCallForCandidate } from "../services/callTrigger.js";

export const callsRouter = Router();

// See the matching helper in routes/candidates.js — the embedded candidate record carries the
// original resume file (base64) server-side for Sheets/Drive logging, and this endpoint gets
// polled every few seconds while a call is active, so it must never ship that back to the browser.
function sanitizeCandidate(candidate) {
  if (!candidate) return null;
  const { resumeFile, ...rest } = candidate;
  return rest;
}

// Scoped to the active role, same as GET /candidates — a call belongs to whichever role its
// candidate was added under, which doesn't change even if the active role is switched later.
callsRouter.get("/", (req, res) => {
  const activeRoleId = store.getActiveRoleId();
  const calls = store
    .listCalls()
    .map((call) => ({ ...call, candidate: sanitizeCandidate(store.getCandidate(call.candidateId)) }))
    .filter((call) => call.candidate?.roleId === activeRoleId);
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
    const result = await triggerCallForCandidate(candidate);
    outcomes.push({ candidateId, ...result });
  }

  res.json({ outcomes });
});
