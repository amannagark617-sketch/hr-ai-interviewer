import mammoth from "mammoth";
import pdfParse from "pdf-parse";

// Extracts plain text from an uploaded resume file buffer.
// Supported: .pdf, .docx, .txt/.md
export async function extractResumeText(buffer, filename) {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".pdf")) {
    const result = await pdfParse(buffer);
    return result.text.trim();
  }

  if (lower.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  }

  if (lower.endsWith(".txt") || lower.endsWith(".md")) {
    return buffer.toString("utf-8").trim();
  }

  throw new Error(`Unsupported file type for "${filename}". Use .pdf, .docx, or .txt.`);
}

export function guessNameFromFilename(filename) {
  return filename
    .replace(/\.(pdf|docx|txt|md)$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
}

// Matches an Indian mobile number specifically: exactly 10 digits starting with 6-9, optionally
// preceded by a +91/91 country code or a 0 trunk prefix. This is deliberately narrower than
// "any 7-15 digit run" (the previous version) — that looser match was why calls were failing as
// "out of region": it was just as likely to grab a bare 10-digit number with no country code (so
// Plivo had nothing to dial against) or an unrelated digit run from the resume (a year range like
// "2019-2023", a PIN code, etc.) as it was to find the real phone number.
const INDIA_MOBILE_REGEX = /(?:\+?91[\s-]?|0)?([6-9]\d{9})\b/;
// Fallback for a non-Indian number: only trust it if it has an explicit "+" country code, so
// there's no ambiguity about which country to dial — an unprefixed foreign number is exactly the
// kind of false match the India-specific pattern above is meant to avoid.
const INTL_PHONE_REGEX = /\+\d[\d\-.\s()]{6,}\d/;

function findPhone(source) {
  const india = source.match(INDIA_MOBILE_REGEX);
  // Resumes almost never write out the +91 themselves — always normalize to it. Handing Plivo a
  // bare domestic-looking number with no country code is exactly what caused "out of region".
  if (india) return `+91${india[1]}`;

  const intl = source.match(INTL_PHONE_REGEX);
  if (intl) return `+${intl[0].replace(/\D/g, "")}`;

  return null;
}

function extractPhone(text) {
  // A line that actually looks like a phone/contact field is a much more reliable source than
  // scanning the whole resume — far less likely to land on a year range or PIN code instead.
  const labeledLine = text.split(/\r?\n/).find((line) => /\b(phone|mobile|contact|tel|cell|whatsapp)\b/i.test(line));
  return (labeledLine && findPhone(labeledLine)) || findPhone(text) || "";
}

// Resume headings/job-titles/degrees that are shaped just like a plausible name (1-4 capitalized
// words) but obviously aren't one — "HRM GRADUATE" title-cases to "Hrm Graduate" and would
// otherwise win over the real name if it appears in the first few lines as an objective line.
const NON_NAME_WORDS = new Set([
  "resume", "curriculum", "vitae", "cv", "profile", "summary", "objective", "contact",
  "details", "information", "address", "email", "phone", "mobile",
  "graduate", "undergraduate", "postgraduate", "fresher", "trainee", "intern", "internship",
  "student", "candidate", "applicant", "professional", "career", "aspirant",
  "engineer", "developer", "manager", "analyst", "executive", "associate", "consultant",
  "designer", "administrator", "specialist", "coordinator", "officer", "director",
  "lead", "head", "senior", "junior", "assistant", "intern",
  "hr", "hrm", "it", "mba", "bba", "bca", "mca", "bsc", "msc", "btech", "mtech", "diploma",
]);

const titleCase = (s) =>
  s === s.toUpperCase() ? s.toLowerCase().replace(/(^|\s|-)[a-z]/g, (c) => c.toUpperCase()) : s;

// A resume's own header (first non-empty line, or "Name: ..." on any of the first few lines) is
// a much more reliable name source than an uploaded filename like "resume_final_v3.pdf".
function extractNameFromText(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 6);

  // Pass 1: an explicit "Name: ..." label is the strongest signal, so it wins even if it isn't
  // the very first plausible-looking line.
  for (const line of lines) {
    const labeled = line.match(/^name\s*[:\-]\s*(.+)$/i);
    if (labeled) return titleCase(labeled[1].trim());
  }

  // Pass 2: fall back to a bare line that reads like a person's name — 1-4 capitalized words,
  // letters only (plus hyphens/apostrophes) — while rejecting common headings/job-titles/degrees
  // that fit the same shape.
  for (const line of lines) {
    if (!/^[A-Z][a-zA-Z'-]*(\s+[A-Z][a-zA-Z'-]*){0,3}$/.test(line)) continue;
    const words = line.toLowerCase().split(/\s+/);
    if (words.some((w) => NON_NAME_WORDS.has(w))) continue;
    return titleCase(line);
  }

  return "";
}

// Best-effort extraction of a candidate's name/phone straight from resume text, so uploading a
// resume doesn't leave HR typing in details the document already has. Falls back to the filename
// for name, and an empty string for phone, when nothing confident is found — both are still
// editable afterwards.
export function extractCandidateDetails(text, filename) {
  return {
    name: extractNameFromText(text) || guessNameFromFilename(filename),
    phone: extractPhone(text),
  };
}
