import { store } from "../data/store.js";
import { triggerCallForCandidate } from "./callTrigger.js";

// Checks every minute for candidates who asked (via the request_callback tool the interview
// agent calls — see ws/callBridge.js) to be called back at a specific time, and automatically
// re-places the call once that time arrives. Without this, "call me back at 5pm" would just sit
// recorded in the candidate's record forever — HR would have to notice it and manually retrigger
// every single one.
const CHECK_INTERVAL_MS = 60 * 1000;

// IMPORTANT — if this is deployed on Cloud Run (or any other scale-to-zero / "CPU only while
// handling a request" platform) with the default settings, this setInterval alone is NOT enough,
// and is almost certainly why a requested callback never actually rang:
//   1. By default Cloud Run only gives a container CPU time while it's actively handling an
//      HTTP/WS request. The moment a request finishes and nothing else is in flight, the whole
//      event loop — including this timer — is frozen, not just slowed down. A callback due at
//      5pm with nobody hitting the app between 4pm and 5pm simply never fires at 5pm; it only
//      fires whenever the NEXT request happens to wake the container back up.
//   2. Worse, Cloud Run can scale the instance down to zero entirely after a period with no
//      traffic. Since store.js is a plain in-memory Map (see its own top-of-file comment), that
//      kills every candidate, role, and pending callback outright — there's nothing left to fire
//      when a later request does wake a (fresh) container.
// checkDueCallbacksSoon() below is called from index.js on every incoming request as a mitigation
// for (1) — it makes sure a due callback gets caught the moment ANYTHING wakes the container, not
// just once every 60s of actual running time. It cannot do anything about (2); the only real fix
// for that is on the Cloud Run service itself: set "Minimum number of instances" to at least 1 and
// turn on "CPU is always allocated" (Cloud Run console -> service -> Edit & deploy new revision ->
// General/Resources). Without those two settings, background scheduling and in-memory state on
// this app cannot be relied on to survive idle periods, no matter what the code does.
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
    }
  } finally {
    checking = false;
  }
}

// Fire-and-forget: called from index.js middleware on every incoming request, so a due callback
// gets picked up the instant the container has CPU again instead of waiting for the next 60s
// interval tick, which may not run at all while idle — see the big comment above.
export function checkDueCallbacksSoon() {
  runOnce().catch((err) => console.error("[callbackScheduler] Unexpected error checking for due callbacks:", err));
}

export function startCallbackScheduler() {
  setInterval(checkDueCallbacksSoon, CHECK_INTERVAL_MS);
  console.log(`[callbackScheduler] Watching for due callbacks every ${CHECK_INTERVAL_MS / 1000}s.`);
}
