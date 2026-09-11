// Minimal in-memory store so the app is runnable without standing up a database.
// Everything resets on server restart. Swap this module for a real DB (Postgres, etc.)
// once you're past prototyping — the interface (the exported functions) is what matters,
// keep it stable and the rest of the app doesn't need to change.

import { nanoid } from "nanoid";
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
  // This is the ENTIRE "role" mechanism now — there's no UI for it at all (no picker, no "new
  // role" button). Two things happen automatically, from the job description text alone:
  //
  // 1. Naming: the first time a role gets a job description, its title is derived from that JD
  //    (see roleTitle.js) and locked in — never overwritten by a later edit, so it stays a stable
  //    label for whichever round of candidates ends up under it.
  //
  // 2. Auto-splitting into a new round: HR has no explicit way to say "I'm starting a new
  //    position" anymore, so this infers it — comparing the ROLE TITLE line (not the whole JD
  //    text) of what's already stored against the incoming text. If they differ AND the current
  //    role already has real candidates attached, this is treated as a genuinely different
  //    position and gets its own fresh role instead of overwriting the in-progress one (which
  //    would otherwise silently orphan those candidates' resume/call history from the JD they
  //    were actually screened against). Title-only comparison (not whole-text) is deliberate: a
  //    typo fix or a reworded paragraph deep in the same JD must never be mistaken for a new
  //    role — only the title actually changing means a new role — and requiring existing
  //    candidates first means normal incremental typing of a role's first-ever JD (nothing added
  //    yet) never triggers a split either.
  setJobDescription(text) {
    let role = roles.get(activeRoleId);
    if (!role) return;

    const hasCandidates = Array.from(candidates.values()).some((c) => c.roleId === role.id);
    const oldTitle = deriveRoleTitleFromJobDescription(role.jobDescription).toLowerCase();
    const newTitle = deriveRoleTitleFromJobDescription(text).toLowerCase();
    const isNewPosition = hasCandidates && oldTitle && newTitle && oldTitle !== newTitle;

    if (isNewPosition) {
      role = {
        id: nanoid(),
        title: DEFAULT_ROLE_TITLE,
        jobDescription: "",
        customQuestions: "",
        createdAt: new Date().toISOString(),
      };
      roles.set(role.id, role);
      activeRoleId = role.id;
    }

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
