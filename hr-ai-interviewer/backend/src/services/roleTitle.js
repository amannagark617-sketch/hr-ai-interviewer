// Job descriptions conventionally open with the role title on their own line (see the sample JD
// in Setup.jsx: "Senior Full-Stack Engineer" on line 1, blank line, then the body) — pulling that
// first line is a reliable, free way to name a role after its job description, instead of asking
// HR to type a name that just duplicates what's already sitting right there in the JD.
//
// A line like "1", "- 1 -", or "Page 1 of 3" is never a real title — it's almost always a stray
// page number or footer that a PDF text extractor (pdf-parse) happened to pull out before the
// actual heading, since extraction order doesn't always match visual reading order. Uploading a
// JD PDF whose title was "Data Analyst" was ending up named "1" for exactly this reason: the
// page-number line, not the heading, was the first non-empty line pdf-parse returned. Skip any
// leading line that's just digits/punctuation, or an explicit "page N" marker, and keep looking.
function looksLikeTitle(line) {
  if (!/[a-zA-Z]/.test(line)) return false;
  if (/^page\s+\d+(\s+of\s+\d+)?$/i.test(line)) return false;
  return true;
}

export function deriveRoleTitleFromJobDescription(jobDescription) {
  const firstLine = (jobDescription || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && looksLikeTitle(line));
  if (!firstLine) return "";

  const cleaned = firstLine.replace(/^(job title|position|role)\s*[:\-]\s*/i, "").trim();
  if (!cleaned) return "";
  return cleaned.length > 70 ? `${cleaned.slice(0, 67).trimEnd()}…` : cleaned;
}
