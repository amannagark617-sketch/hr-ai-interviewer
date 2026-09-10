// Minimal in-memory store so the app is runnable without standing up a database.
// Everything resets on server restart. Swap this module for a real DB (Postgres, etc.)
// once you're past prototyping — the interface (the exported functions) is what matters,
// keep it stable and the rest of the app doesn't need to change.

import { deriveRoleTitleFromJobDescription } from "../services/roleTitle.js";

const roles = new Map(); // id -> { id, title, jobDescription, customQuestions, createdAt }
const candidates = new Map(); // id -> candidate (each carries roleId — which role it was added under)
const calls = new Map(); // callId -> call job

// Sentinel for "this role has never had a title set" — see setJobDescription below, which is what
// actually names a role (auto-derived from the job description itself, never typed by hand).
export const DEFAULT_ROLE_TITLE = "Untitled role";

// Bootstrap one role so the app is immediately usable exactly like before roles existed — HR
// isn't forced to "create a role" as an extra first step before pasting a job description.
const DEFAULT_ROLE_ID = "default";
roles.set(DEFAULT_ROLE_ID, {
  id: DEFAULT_ROLE_ID,
  title: DEFAULT_ROLE_TITLE,
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
  // Also names the role the first time it gets a job description — HR should never have to type a
  // role name that's just going to duplicate the title already sitting on line 1 of the JD. Only
  // fires while the role is still untitled, so it never silently renames a role HR is actively
  // reworking the JD for later on (that'd be surprising — the name is how they find it again in
  // the role picker, so it needs to stay stable once set).
  setJobDescription(text) {
    const role = roles.get(activeRoleId);
    if (!role) return;
    role.jobDescription = text;
    if (role.title === DEFAULT_ROLE_TITLE) {
      const derived = deriveRoleTitleFromJobDescription(text);
      if (derived) role.title = derived;
    }
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
