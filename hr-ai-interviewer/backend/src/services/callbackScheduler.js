import { store } from "../data/store.js";
import { triggerCallForCandidate } from "./callTrigger.js";

// Checks every minute for candidates who asked (via the request_callback tool the interview
// agent calls — see ws/callBridge.js) to be called back at a specific time, and automatically
// re-places the call once that time arrives. Without this, "call me back at 5pm" would just sit
// recorded in the candidate's record forever — HR would have to notice it and manually retrigger
// every single one.
const CHECK_INTERVAL_MS = 60 * 1000;

async function runOnce() {
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
}

export function startCallbackScheduler() {
  setInterval(() => {
    runOnce().catch((err) => console.error("[callbackScheduler] Unexpected error checking for due callbacks:", err));
  }, CHECK_INTERVAL_MS);
  console.log(`[callbackScheduler] Watching for due callbacks every ${CHECK_INTERVAL_MS / 1000}s.`);
}
