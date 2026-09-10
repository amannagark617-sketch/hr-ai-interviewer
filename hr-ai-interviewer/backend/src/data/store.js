// Minimal in-memory store so the app is runnable without standing up a database.
// Everything resets on server restart. Swap this module for a real DB (Postgres, etc.)
// once you're past prototyping — the interface (the exported functions) is what matters,
// keep it stable and the rest of the app doesn't need to change.

const roles = new Map(); // id -> { id, title, jobDescription, customQuestions, createdAt }
const candidates = new Map(); // id -> candidate (each carries roleId — which role it was added under)
const calls = new Map(); // callId -> call job

// Bootstrap one role so the app is immediately usable exactly like before roles existed — HR
// isn't forced to "create a role" as an extra first step before pasting a job description.
const DEFAULT_ROLE_ID = "default";
roles.set(DEFAULT_ROLE_ID, {
  id: DEFAULT_ROLE_ID,
  title: "Untitled role",
  jobDescription: "",
  customQuestions: "",
  createdAt: new Date().toISOString(),
});
let activeRoleId = DEFAULT_ROLE_ID;

export const store = {
  listRoles() {
    return Array.from(roles.values());
  },
  getRole(id) {
    return roles.get(id);
  },
  createRole(role) {
    roles.set(role.id, role);
    return role;
  },
  updateRole(id, patch) {
    const existing = roles.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    roles.set(id, updated);
    return updated;
  },
  // Cascades to every candidate under this role — a role is a self-contained hiring round, so an
  // orphaned candidate with no role wouldn't show up anywhere in the "one active role at a time"
  // UI anyway. Calls already placed are left alone (same as removeCandidate never touching calls)
  // since they're a historical record, not live state.
  deleteRole(id) {
    roles.delete(id);
    for (const c of candidates.values()) {
      if (c.roleId === id) candidates.delete(c.id);
    }
  },
  getActiveRoleId() {
    return activeRoleId;
  },
  setActiveRoleId(id) {
    activeRoleId = id;
  },

  // Convenience wrappers scoped to whichever role is currently active — used by the Setup/Rank
  // pages' endpoints, which always operate on "the role you're currently working on". Interview
  // calls must NOT use these (see webhooks.js/callBridge.js) — a call can still be ringing after
  // HR has switched the active role to something else, so those resolve a candidate's job
  // description/questions via store.getRole(candidate.roleId) directly instead.
  getJobDescription() {
    return roles.get(activeRoleId)?.jobDescription || "";
  },
  setJobDescription(text) {
    const role = roles.get(activeRoleId);
    if (role) role.jobDescription = text;
  },
  getCustomQuestions() {
    return roles.get(activeRoleId)?.customQuestions || "";
  },
  setCustomQuestions(text) {
    const role = roles.get(activeRoleId);
    if (role) role.customQuestions = text;
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
