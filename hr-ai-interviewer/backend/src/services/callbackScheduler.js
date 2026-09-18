import { nanoid } from "nanoid";
import { store } from "../data/store.js";
import { triggerCallForCandidate } from "./callTrigger.js";
import { listPendingCallbacks, clearPendingCallback } from "./sheetsService.js";

// Checks every minute for candidates who asked (via the request_callback tool the interview
// agent calls — see ws/callBridge.js) to be called back at a specific time, and automatically
// re-places the call once that time arrives. Without this, "call me back at 5pm" would just sit
// recorded in the candidate's record forever — HR would have to notice it and manually retrigger
// every single one.
const CHECK_INTERVAL_MS = 60 * 1000;

// Cloud Run (or any scale-to-zero / "CPU only while handling a request" platform) is why a
// requested callback can go unanswered on the default settings, in two separate ways:
//   1. By default Cloud Run only gives a container CPU time while it's actively handling an
//      HTTP/WS request. The moment a request finishes and nothing else is in flight, the whole
//      event loop — including this setInterval — is frozen, not just slowed down. A callback due
//      at 5pm with nobody hitting the app between 4pm and 5pm simply never fires at 5pm on its
//      own; it only fires whenever the next request happens to wake the container back up.
//      checkDueCallbacksSoon() is called from index.js on every incoming request specifically to
//      cover this — it catches a due callback the instant ANYTHING wakes the container, instead
//      of waiting on 60s of actual running time that might not happen.
//   2. Worse, Cloud Run can scale the instance down to zero entirely after a period with no
//      traffic, and store.js is a plain in-memory Map (see its own top-of-file comment) — that
//      kills every candidate, role, and pending callback this instance knew about. Paying to keep
//      an instance always warm ("Minimum instances" >= 1 + "CPU is always allocated") would dodge
//      this, but isn't worth it just for occasional callbacks. Instead, savePendingCallback (see
//      ws/callBridge.js and sheetsService.js) parks every requested callback in a "Pending
//      Callbacks" tab of the same Google Sheet already used for logging — free, and it survives
//      restarts. reconcileFromSheet() below polls that tab and, for anything due that this
//      instance has no in-memory record of, reconstructs just enough (role, candidate, resume) to
//      actually place the call, then clears the row. The in-memory path above still handles the
//      common case (same instance is still alive when the callback comes due) without ever
//      touching the network.
let checking = false;

async function runOnce() {
  if (checking) return; // a check is already in flight (e.g. the interval and a request-triggered check overlapped) — skip, not queue
  checking = true;
  try {
    const due = store.listCandidates().filter((c) => {
      if (c.callbackStatus !== "pending" || !c.callbackScheduledFor) return false;
      const scheduledFor = new Date(c.callbackScheduledFor);
      return !isNaN(scheduledFor) && scheduledFor.getTime() <= Date.now();
    });

    for (const candidate of due) {
      // Flip to "triggered" BEFORE placing the call, not after — this is what stops the same
      // candidate being re-dialed by the next tick while this call is still ringing, and what lets
      // webhooks.js tell "a fresh callback request came in during this call" (callbackStatus back
      // to "pending") apart from "this is just the callback call that's already in flight."
      store.updateCandidate(candidate.id, { callbackStatus: "triggered" });
      console.log(`[callbackScheduler] Callback due for candidate ${candidate.id} (${candidate.name}) — placing call now.`);
      const result = await triggerCallForCandidate(candidate);
      if (!result.ok) {
        console.error(`[callbackScheduler] Failed to auto-trigger callback for candidate ${candidate.id}:`, result.error);
      }
      // The row in Sheets (if any — savePendingCallback might not be configured, or this instance
      // never restarted and there was never a need for it) has done its job now that the call has
      // actually been placed; clear it so a later restart doesn't try to recover it all over again.
      clearPendingCallback(candidate.id).catch((err) =>
        console.error(`[callbackScheduler] Failed to clear pending callback ${candidate.id} from Sheets:`, err.message)
      );
    }
  } finally {
    checking = false;
  }
}

// Only actually hit the Apps Script Sheet at most this often — this is called from index.js's
// per-request middleware, and a full request/response round trip to Apps Script on every single
// API call (including the dashboard's 1.5s scoring poll) would be wasteful and slow, for a check
// that only ever matters after a restart wiped this instance's memory.
const SHEET_RECONCILE_INTERVAL_MS = 60 * 1000;
let lastSheetCheck = 0;

async function reconcileFromSheet() {
  const now = Date.now();
  if (now - lastSheetCheck < SHEET_RECONCILE_INTERVAL_MS) return;
  lastSheetCheck = now;

  let pending;
  try {
    pending = await listPendingCallbacks();
  } catch (err) {
    console.error("[callbackScheduler] Failed to list pending callbacks from Sheets:", err.message);
    return;
  }

  for (const cb of pending) {
    if (!cb.id || !cb.scheduledFor) continue;
    const scheduledFor = new Date(cb.scheduledFor);
    if (isNaN(scheduledFor) || scheduledFor.getTime() > now) continue; // not due yet

    // Already tracked locally — this instance never lost it, so the plain in-memory check above
    // owns it (and will clear the Sheets row itself once it places the call). Recovering it here
    // too would double-dial the candidate.
    if (store.getCandidate(cb.id)) continue;

    console.log(
      `[callbackScheduler] Recovering pending callback for ${cb.candidateName || cb.id} from Sheets — ` +
        `this instance has no in-memory record of it, most likely after a Cloud Run restart.`
    );

    // Rebuild just enough state for this one call to run properly: a role carrying the original
    // job description/custom questions (so the interview still asks the right things and scores
    // against the right rubric), and the candidate record itself (so webhooks.js/callBridge.js can
    // resolve name, phone, and resume the same way they would have if nothing had restarted).
    const role = store.createRole({
      id: nanoid(),
      title: cb.roleTitle || "Recovered role (callback)",
      jobDescription: cb.jobDescription || "",
      customQuestions: cb.customQuestions || "",
      createdAt: new Date().toISOString(),
    });
    const candidate = store.addCandidate({
      id: cb.id,
      roleId: role.id,
      name: cb.candidateName || "Candidate",
      phone: cb.phone || "",
      resumeText: cb.resumeText || "",
      status: "pending",
      score: null,
      verdict: null,
      pros: [],
      cons: [],
      errorMessage: null,
      selected: false,
      // Already "triggered" (not "pending") — we're placing it right now, so there's nothing left
      // for this same pass to (re-)trigger a second time.
      callbackStatus: "triggered",
      callbackScheduledFor: cb.scheduledFor,
      callbackNote: cb.note || "",
    });

    const result = await triggerCallForCandidate(candidate);
    if (!result.ok) {
      console.error(`[callbackScheduler] Failed to place recovered callback for candidate ${candidate.id}:`, result.error);
    }
    clearPendingCallback(cb.id).catch((err) =>
      console.error(`[callbackScheduler] Failed to clear recovered pending callback ${cb.id} from Sheets:`, err.message)
    );
  }
}

// Fire-and-forget: called from index.js middleware on every incoming request, so a due callback
// gets picked up the instant the container has CPU again instead of waiting for the next 60s
// interval tick, which may not run at all while idle — see the big comment above.
export function checkDueCallbacksSoon() {
  runOnce().catch((err) => console.error("[callbackScheduler] Unexpected error checking for due callbacks:", err));
  reconcileFromSheet().catch((err) => console.error("[callbackScheduler] Unexpected error reconciling callbacks from Sheets:", err));
}

export function startCallbackScheduler() {
  setInterval(checkDueCallbacksSoon, CHECK_INTERVAL_MS);
  console.log(`[callbackScheduler] Watching for due callbacks every ${CHECK_INTERVAL_MS / 1000}s.`);
}
