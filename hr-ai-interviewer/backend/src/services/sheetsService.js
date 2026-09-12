import { config } from "../config.js";

// Logs call results by POSTing to a Google Apps Script Web App bound to the HR
// spreadsheet, instead of talking to the Sheets API directly — no service
// account or key file needed. See docs/apps-script/Code.gs for the script to
// paste into the sheet, and the README for the deploy steps.

async function postToAppsScript(body) {
  const response = await fetch(config.appsScript.webAppUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: config.appsScript.secret, ...body }),
  });

  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`Apps Script returned a non-JSON response (check the deployment is "Anyone" access): ${text.slice(0, 200)}`);
  }

  if (!result.ok) {
    throw new Error(`Apps Script call failed: ${result.error || "unknown error"}`);
  }
  return result;
}

export async function appendCallResultRow(row) {
  if (!config.appsScript.webAppUrl) {
    console.warn("[sheetsService] APPS_SCRIPT_WEB_APP_URL not set — skipping Sheets logging.");
    return;
  }
  await postToAppsScript({ row });
}

// The three functions below turn the "Pending Callbacks" sheet tab into a free, durable queue for
// requested callbacks — see the matching comment in docs/apps-script/Code.gs for why: the backend's
// own in-memory store is wiped on every Cloud Run restart, and keeping an instance always warm
// just to avoid that costs real money the candidate-callback feature alone doesn't justify. These
// let callbackScheduler.js notice and re-place a due callback even after losing its own record of
// it, at no extra infrastructure cost.

// Called the moment the interview agent requests a callback (see the request_callback handling in
// ws/callBridge.js), in addition to the existing in-memory store.updateCandidate call — this is
// what survives a restart between now and when the callback is actually due. Silently no-ops (like
// appendCallResultRow above) if Sheets logging isn't configured; the in-memory path still covers
// same-instance-lifetime callbacks either way.
export async function savePendingCallback(callback) {
  if (!config.appsScript.webAppUrl) {
    console.warn("[sheetsService] APPS_SCRIPT_WEB_APP_URL not set — pending callback won't survive a restart.");
    return;
  }
  await postToAppsScript({ action: "saveCallback", callback });
}

// Called once a pending callback has actually been placed (or otherwise no longer needs
// recovering) so the same row doesn't get redialed on the next poll.
export async function clearPendingCallback(callbackId) {
  if (!config.appsScript.webAppUrl) return;
  await postToAppsScript({ action: "clearCallback", callbackId });
}

// Polled by callbackScheduler.js. Uses GET (not the POST path above) since it's a read, and Apps
// Script Web Apps support both off the same deployment.
export async function listPendingCallbacks() {
  if (!config.appsScript.webAppUrl) return [];

  const url = new URL(config.appsScript.webAppUrl);
  url.searchParams.set("action", "listCallbacks");
  url.searchParams.set("secret", config.appsScript.secret);

  const response = await fetch(url, { cache: "no-store" });
  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`Apps Script returned a non-JSON response listing callbacks: ${text.slice(0, 200)}`);
  }
  if (!result.ok) {
    throw new Error(`Apps Script call failed listing callbacks: ${result.error || "unknown error"}`);
  }
  return result.callbacks || [];
}
