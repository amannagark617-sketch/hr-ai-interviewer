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
