// Job descriptions conventionally open with the role title on their own line (see the sample JD
// in Setup.jsx: "Senior Full-Stack Engineer" on line 1, blank line, then the body) — pulling that
// first line is a reliable, free way to name a role after its job description, instead of asking
// HR to type a name that just duplicates what's already sitting right there in the JD.
export function deriveRoleTitleFromJobDescription(jobDescription) {
  const firstLine = (jobDescription || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return "";

  const cleaned = firstLine.replace(/^(job title|position|role)\s*[:\-]\s*/i, "").trim();
  if (!cleaned) return "";
  return cleaned.length > 70 ? `${cleaned.slice(0, 67).trimEnd()}…` : cleaned;
}
