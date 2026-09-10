import { nanoid } from "nanoid";
import { store } from "../data/store.js";
import { placeCall } from "./plivoService.js";

// Shared by the manual "call selected candidates" flow (routes/calls.js) and the automatic
// callback scheduler (services/callbackScheduler.js) — both just need "place a call for this
// candidate and record the outcome," so this is the one place that logic lives.
export async function triggerCallForCandidate(candidate) {
  if (!candidate) return { ok: false, error: "Candidate not found" };
  if (!candidate.phone) return { ok: false, error: "No phone number on file" };

  const call = store.createCall({
    id: nanoid(),
    candidateId: candidate.id,
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
    return { ok: true, callId: call.id };
  } catch (err) {
    // Plivo's SDK doesn't always throw a plain Error with a useful .message — log the whole
    // thing server-side so the real cause shows up in your hosting platform's logs, and fall
    // back through the shapes it commonly uses so the caller doesn't just get "Failed: " with
    // nothing after it.
    console.error(`[callTrigger] placeCall failed for candidate ${candidate.id}:`, err);
    const reason =
      err?.message ||
      err?.response?.data?.error ||
      err?.response?.data?.message ||
      (typeof err === "string" ? err : null) ||
      "Unknown error — check the backend logs";
    store.updateCall(call.id, { status: "failed" });
    return { ok: false, callId: call.id, error: reason };
  }
}
