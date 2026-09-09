// Paste this into the Apps Script editor attached to your Google Sheet:
// Extensions -> Apps Script, replace the default Code.gs contents with this file,
// then Deploy -> New deployment -> type "Web app" -> Execute as "Me" ->
// Who has access "Anyone" -> Deploy. Copy the Web app URL it gives you into
// backend/.env as APPS_SCRIPT_WEB_APP_URL.
//
// SECRET below is a shared password between this script and your backend so
// random people who guess the URL can't write junk into your sheet. Set it to
// any long random string, and put the same value in backend/.env as
// APPS_SCRIPT_SECRET.

const SHEET_TAB = "Round 1"; // change if you want a different tab name
const SECRET = "REPLACE_WITH_A_LONG_RANDOM_STRING";

const HEADERS = [
  "Candidate",
  "Phone",
  "Resume score",
  "Resume verdict",
  "Call status",
  "Interview score",
  "Recommendation",
  "Recording URL",
  "Interview summary",
  "Logged at",
];

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (body.secret !== SECRET) {
      return jsonResponse({ ok: false, error: "Unauthorized" });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_TAB);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_TAB);
    }
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
    }

    const row = body.row || {};
    sheet.appendRow([
      row.candidateName || "",
      row.phone || "",
      row.resumeScore ?? "",
      row.resumeVerdict || "",
      row.callStatus || "",
      row.interviewScore ?? "",
      row.recommendation || "",
      row.recordingUrl || "",
      row.interviewSummary || "",
      new Date().toISOString(),
    ]);

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// Lets you open the Web app URL directly in a browser to sanity-check it's deployed.
function doGet() {
  return jsonResponse({ ok: true, message: "HR interviewer logging endpoint is live." });
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
