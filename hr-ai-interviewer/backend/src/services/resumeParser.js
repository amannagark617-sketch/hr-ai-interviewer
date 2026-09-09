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

// Matches phone-number-shaped runs of digits (optionally with a leading +, and separated by
// spaces/dots/dashes/parens) — e.g. "+91 98765 43210", "(555) 123-4567", "555.123.4567".
const PHONE_CANDIDATE_REGEX = /\+?\d[\d\-.\s()]{6,}\d/g;

function extractPhone(text) {
  const candidates = text.match(PHONE_CANDIDATE_REGEX) || [];
  let best = null;
  for (const raw of candidates) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) continue;
    // Prefer the first candidate with a country code (a leading "+") over a plain digit run —
    // resumes often have a bare number elsewhere (e.g. a year range) that isn't the phone.
    if (!best || (raw.trim().startsWith("+") && !best.startsWith("+"))) {
      best = raw.trim().startsWith("+") ? `+${digits}` : digits;
    }
  }
  return best || "";
}

// A resume's own header (first non-empty line, or "Name: ..." on any of the first few lines) is
// a much more reliable name source than an uploaded filename like "resume_final_v3.pdf".
function extractNameFromText(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 5);
  for (const line of lines) {
    const labeled = line.match(/^name\s*[:\-]\s*(.+)$/i);
    const candidate = labeled ? labeled[1].trim() : line;
    // A plausible person name: 2-4 words, each starting with a capital letter, letters only
    // (plus hyphens/apostrophes) — filters out headings like "RESUME" or "Senior Engineer, 5 yrs".
    if (/^[A-Z][a-zA-Z'-]+(\s+[A-Z][a-zA-Z'-]+){1,3}$/.test(candidate)) {
      // Title-case an all-caps header ("JOHN DOE" -> "John Doe") for nicer display.
      if (candidate === candidate.toUpperCase()) {
        return candidate
          .toLowerCase()
          .replace(/(^|\s|-)[a-z]/g, (c) => c.toUpperCase());
      }
      return candidate;
    }
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
