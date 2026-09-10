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
//
// This script also saves each candidate's resume as a file in your Google Drive
// (in a folder named DRIVE_FOLDER_NAME below, created automatically the first
// time) and links it from the row. That needs Drive access in addition to
// Sheets access — if you're updating an existing deployment rather than
// creating a fresh one, redeploy (Deploy -> Manage deployments -> Edit ->
// New version) and Google will prompt you to re-authorize with the added
// Drive scope. No new credentials or service account needed either way —
// this runs as your own Google account, the same as the Sheets access already
// granted.

const SHEET_TAB = "Round 1"; // change if you want a different tab name
const SECRET = "REPLACE_WITH_A_LONG_RANDOM_STRING";
const DRIVE_FOLDER_NAME = "HR AI Interviewer — Resumes";

const HEADERS = [
  "Candidate",
  "Phone",
  "Resume score",
  "Resume verdict",
  "Resume pros",
  "Resume cons",
  "Resume (Drive link)",
  "Call status",
  "Call duration",
  "Interview score",
  "Recommendation",
  "Interview strengths",
  "Interview concerns",
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
    const resumeUrl = saveResumeToDrive(row);

    sheet.appendRow([
      row.candidateName || "",
      row.phone || "",
      row.resumeScore ?? "",
      row.resumeVerdict || "",
      joinList(row.resumePros),
      joinList(row.resumeCons),
      resumeUrl,
      row.callStatus || "",
      formatDuration(row.callDurationSeconds),
      row.interviewScore ?? "",
      row.recommendation || "",
      joinList(row.interviewStrengths),
      joinList(row.interviewConcerns),
      row.recordingUrl || "",
      row.interviewSummary || "",
      new Date().toISOString(),
    ]);

    return jsonResponse({ ok: true, resumeUrl });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// Saves the candidate's resume to Drive (in a dedicated folder, created on first use) and
// returns its URL, so a manager can open the actual resume straight from the sheet — same
// account as the sheet itself, no separate storage or credentials to set up.
//
// Prefers the exact original file HR uploaded (row.resumeFileBase64/resumeFileName/
// resumeMimeType) over reconstructing a .txt file from extracted text — a PDF/DOCX saved as
// plain text loses all formatting, and isn't literally the file HR uploaded. Falls back to
// saving row.resumeText as a plain-text file only for candidates added by pasting resume text
// directly into the app, who never had an original file to begin with. Returns "" if neither is
// present (e.g. Sheets logging for a call whose candidate record is gone).
function saveResumeToDrive(row) {
  const hasFile = row.resumeFileBase64 && row.resumeFileBase64.trim();
  const hasText = row.resumeText && row.resumeText.trim();
  if (!hasFile && !hasText) return "";

  const folders = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(DRIVE_FOLDER_NAME);
  const safeName = (row.candidateName || "candidate").replace(/[^\w\- ]/g, "").trim() || "candidate";

  let file;
  if (hasFile) {
    const bytes = Utilities.base64Decode(row.resumeFileBase64);
    const mimeType = row.resumeMimeType || MimeType.PDF;
    const ext = (row.resumeFileName || "").match(/\.[^.]+$/);
    const blob = Utilities.newBlob(bytes, mimeType, `${safeName} — resume${ext ? ext[0] : ""}`);
    file = folder.createFile(blob);
  } else {
    file = folder.createFile(`${safeName} — resume.txt`, row.resumeText, MimeType.PLAIN_TEXT);
  }
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function joinList(list) {
  return Array.isArray(list) ? list.join("; ") : list || "";
}

function formatDuration(seconds) {
  if (seconds == null || isNaN(seconds)) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Lets you open the Web app URL directly in a browser to sanity-check it's deployed.
function doGet() {
  return jsonResponse({ ok: true, message: "HR interviewer logging endpoint is live." });
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
