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

// Used to durably park a candidate's "call me back later" request. The backend's own in-memory
// store forgets everything on restart (see backend/src/data/store.js) — deliberately, since this
// app runs on Cloud Run and paying to keep an instance always warm just to hold a few pending
// callbacks in RAM isn't worth it. This sheet tab is the free alternative: the backend writes a
// pending callback here the moment the candidate asks for one (see saveCallback below), and polls
// it back (listCallbacks) to notice when one is due — surviving however many restarts happen in
// between, at no extra cost. A row here carries everything needed to actually run that interview
// again from scratch (resume text, job description, custom questions) since, after a restart, the
// backend has no other record of what role or resume this candidate was even calling about.
const CALLBACKS_TAB = "Pending Callbacks";
const CALLBACK_HEADERS = [
  "ID",
  "Candidate",
  "Phone",
  "Role",
  "Resume",
  "Job description",
  "Custom questions",
  "Scheduled for",
  "Note",
  "Created at",
];

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
  // Added after the app gained multi-role support — appended at the END rather than inserted
  // next to "Candidate" so existing rows in an already-deployed sheet keep every column they
  // already have correctly aligned (appendRow always appends a NEW row; it never rewrites the
  // header row of a sheet that already has one, so an existing sheet's header row won't pick up
  // this label automatically). If you already have data in this sheet, add "Role" yourself as
  // the header of the next empty column, so it lines up with the value this column now writes.
  "Role",
  // Same append-at-the-end rule as "Role" above. Filled in only when the candidate asked to be
  // called back later instead of doing the interview (Call status reads "callback requested" on
  // that row) — the app auto-places the follow-up call once this time arrives.
  "Callback requested for",
  "Callback note",
];

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (body.secret !== SECRET) {
      return jsonResponse({ ok: false, error: "Unauthorized" });
    }

    // "action" is new — older backend deploys never send it and only ever meant "log a call
    // result row", so that stays the default rather than requiring every caller to pass it.
    const action = body.action || "logCall";
    if (action === "saveCallback") return saveCallback(body.callback || {});
    if (action === "clearCallback") return clearCallback(body.callbackId);
    return logCall(body.row || {});
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function logCall(row) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_TAB);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
  }

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
    nowInIst(),
    row.role || "",
    row.callbackScheduledFor || "",
    row.callbackNote || "",
  ]);

  return jsonResponse({ ok: true, resumeUrl });
}

function getCallbacksSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CALLBACKS_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(CALLBACKS_TAB);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(CALLBACK_HEADERS);
  }
  return sheet;
}

// Upsert-by-ID rather than a plain append — the interview agent can call request_callback more
// than once for the same candidate (they re-schedule mid-call, or a later call re-requests one),
// and each of those reuses the same call/candidate ID from the backend rather than minting a new
// row every time.
function saveCallback(cb) {
  if (!cb.id) return jsonResponse({ ok: false, error: "callback.id is required" });

  const sheet = getCallbacksSheet();
  const existingRow = findCallbackRow(sheet, cb.id);
  const values = [
    cb.id,
    cb.candidateName || "",
    cb.phone || "",
    cb.roleTitle || "",
    cb.resumeText || "",
    cb.jobDescription || "",
    cb.customQuestions || "",
    cb.scheduledFor || "",
    cb.note || "",
    nowInIst(),
  ];

  if (existingRow) {
    sheet.getRange(existingRow, 1, 1, values.length).setValues([values]);
  } else {
    sheet.appendRow(values);
  }
  return jsonResponse({ ok: true });
}

// Called once the backend has actually placed the callback (or the candidate's record already
// covers it locally and there's nothing left to recover) — without this, the same row would keep
// coming back from listCallbacks and get redialed on every future poll.
function clearCallback(id) {
  if (!id) return jsonResponse({ ok: false, error: "callbackId is required" });
  const sheet = getCallbacksSheet();
  const row = findCallbackRow(sheet, id);
  if (row) sheet.deleteRow(row);
  return jsonResponse({ ok: true });
}

function findCallbackRow(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) return i + 2; // +1 for header row, +1 for 0-index
  }
  return null;
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

// new Date().toISOString() is always UTC — that's what was showing up as e.g.
// "2026-09-11T13:37:58.576Z" in the sheet instead of the actual India time the call happened at
// (13:37 UTC is 19:07 IST — 5 hours 30 minutes later, easy to misread as "wrong by hours" if you
// don't do the offset math). Format explicitly in the India time zone instead, human-readable,
// so "Logged at" matches what a HR person actually experienced on the clock.
function nowInIst() {
  return Utilities.formatDate(new Date(), "Asia/Kolkata", "dd MMM yyyy, HH:mm:ss 'IST'");
}

function formatDuration(seconds) {
  if (seconds == null || isNaN(seconds)) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// With no query params, this just lets you open the Web app URL directly in a browser to
// sanity-check it's deployed. ?action=listCallbacks&secret=... (used by callbackScheduler.js on
// the backend) returns every still-pending callback row instead, so the backend can notice one is
// due even after losing its own in-memory record of it.
function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.action === "listCallbacks") {
    if (params.secret !== SECRET) {
      return jsonResponse({ ok: false, error: "Unauthorized" });
    }
    const sheet = getCallbacksSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return jsonResponse({ ok: true, callbacks: [] });

    const rows = sheet.getRange(2, 1, lastRow - 1, CALLBACK_HEADERS.length).getValues();
    const callbacks = rows.map((r) => ({
      id: r[0],
      candidateName: r[1],
      phone: r[2],
      roleTitle: r[3],
      resumeText: r[4],
      jobDescription: r[5],
      customQuestions: r[6],
      scheduledFor: r[7],
      note: r[8],
      createdAt: r[9],
    }));
    return jsonResponse({ ok: true, callbacks });
  }

  return jsonResponse({ ok: true, message: "HR interviewer logging endpoint is live." });
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
