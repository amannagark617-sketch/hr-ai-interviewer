// Minimal in-memory store so the app is runnable without standing up a database.
// Everything resets on server restart. Swap this module for a real DB (Postgres, etc.)
// once you're past prototyping — the interface (the exported functions) is what matters,
// keep it stable and the rest of the app doesn't need to change.

const candidates = new Map(); // id -> candidate
const calls = new Map(); // callId -> call job

let jobDescription = "";
// Optional, applies to every candidate in this round — mandatory questions HR wants asked on top
// of the usual JD/resume-grounded ones (e.g. a role-specific screening question that isn't
// inferable from the JD or any one resume). Empty string means "none set".
let customQuestions = "";

export const store = {
  setJobDescription(text) {
    jobDescription = text;
  },
  getJobDescription() {
    return jobDescription;
  },

  setCustomQuestions(text) {
    customQuestions = text;
  },
  getCustomQuestions() {
    return customQuestions;
  },

  addCandidate(candidate) {
    candidates.set(candidate.id, candidate);
    return candidate;
  },
  getCandidate(id) {
    return candidates.get(id);
  },
  updateCandidate(id, patch) {
    const existing = candidates.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    candidates.set(id, updated);
    return updated;
  },
  listCandidates() {
    return Array.from(candidates.values());
  },
  removeCandidate(id) {
    candidates.delete(id);
  },

  createCall(call) {
    calls.set(call.id, call);
    return call;
  },
  getCall(id) {
    return calls.get(id);
  },
  updateCall(id, patch) {
    const existing = calls.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    calls.set(id, updated);
    return updated;
  },
  findCallByPlivoUuid(uuid) {
    return Array.from(calls.values()).find((c) => c.plivoCallUuid === uuid);
  },
  listCalls() {
    return Array.from(calls.values());
  },
};
