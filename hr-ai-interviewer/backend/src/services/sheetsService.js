import { config } from "../config.js";

// Logs call results by POSTing to a Google Apps Script Web App bound to the HR
// spreadsheet, instead of talking to the Sheets API directly — no service
// account or key file needed. See docs/apps-script/Code.gs for the script to
// paste into the sheet, and the README for the deploy steps.

export async function appendCallResultRow(row) {
  if (!config.appsScript.webAppUrl) {
    console.warn("[sheetsService] APPS_SCRIPT_WEB_APP_URL not set — skipping Sheets logging.");
    return;
  }

  const response = await fetch(config.appsScript.webAppUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: config.appsScript.secret, row }),
  });

  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`Apps Script returned a non-JSON response (check the deployment is "Anyone" access): ${text.slice(0, 200)}`);
  }

  if (!result.ok) {
    throw new Error(`Apps Script logging failed: ${result.error || "unknown error"}`);
  }
}
