import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "..", "templates");

// The five HR letter templates HR actually handed over, each a real Word doc with bracketed
// placeholders like "[Employee Name]" scattered through the body and any tables (see each
// .docx's own content — this registry only needs to know the display name and filename; the
// fields themselves are discovered directly from the document, not hand-typed here, so editing
// the .docx file in src/templates/ is the only thing needed to add/rename/remove a field).
// To add a new template (e.g. the Appointment Letter mentioned but not yet provided): drop the
// .docx into src/templates/ using the same "[Placeholder]" bracket style as the others, then add
// one entry here.
export const DOCUMENT_TEMPLATES = [
  { id: "offer-letter", name: "Offer Letter", file: "offer-letter.docx" },
  { id: "experience-letter", name: "Experience Letter", file: "experience-letter.docx" },
  { id: "increment-letter", name: "Increment Letter", file: "increment-letter.docx" },
  { id: "internship-joining-letter", name: "Internship Joining Letter", file: "internship-joining-letter.docx" },
  { id: "internship-experience-letter", name: "Internship Experience Letter", file: "internship-experience-letter.docx" },
];

export function getTemplateMeta(templateId) {
  return DOCUMENT_TEMPLATES.find((t) => t.id === templateId);
}

function loadZip(templateId) {
  const meta = getTemplateMeta(templateId);
  if (!meta) throw new Error(`Unknown document template "${templateId}"`);
  const filePath = path.join(TEMPLATES_DIR, meta.file);
  const content = fs.readFileSync(filePath, "binary");
  return { meta, zip: new PizZip(content) };
}

function openTemplate(templateId) {
  const { meta, zip } = loadZip(templateId);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    // The templates use plain square brackets ("[Employee Name]") rather than docxtemplater's
    // default {curly} syntax, since that's the convention whoever wrote these letters already
    // used — matching it means the original .docx files don't need to be touched at all.
    delimiters: { start: "[", end: "]" },
  });
  return { meta, doc };
}

// A field's raw bracket text is sometimes an authoring note rather than a clean label — e.g.
// "[Responsibility 1 – factual, role-based]" in the Experience Letter. Keep the full original
// text as the field's key (docxtemplater needs the exact match to fill it back in), but show HR
// a shorter, cleaner label by dropping anything after a " - "/" – " dash.
function displayLabel(key) {
  return key.split(/\s+[-–]\s+/)[0].trim();
}

// Discovers every distinct "[Bracket]" placeholder in a template, in the order it first appears,
// so the frontend can build a form from it without either side hand-maintaining a field list.
// docxtemplater's getFullText() is used (rather than reading document.xml directly) specifically
// because Word frequently splits a single bracketed placeholder across multiple XML runs (e.g.
// when spellcheck/grammar squiggles touch part of it) — docxtemplater already has to solve that
// exact problem to do tag substitution at all, so reusing it here means field discovery sees
// precisely the same tags that rendering will actually fill.
export function getTemplateFields(templateId) {
  const { meta, doc } = openTemplate(templateId);
  const fullText = doc.getFullText();
  const seen = new Set();
  const fields = [];
  for (const m of fullText.matchAll(/\[([^[\]]{1,120}?)\]/g)) {
    const key = m[1].trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    fields.push({ key, label: displayLabel(key) });
  }
  return { id: meta.id, name: meta.name, fields };
}

// Fills a template with the given values (an object keyed by each field's exact bracket text —
// see getTemplateFields above) and returns the rendered .docx as a Buffer, formatting fully
// intact (fonts, tables, the letterhead/signature images embedded in the original file).
// A value missing from `values` renders as an empty string rather than leaving the bracket
// behind, so a half-filled form never leaks "[Employee Name]" into a document HR downloads.
export function renderTemplateDocx(templateId, values) {
  const { doc } = openTemplate(templateId);
  const fields = getTemplateFields(templateId).fields;
  const data = {};
  for (const { key } of fields) data[key] = values?.[key] ?? "";
  doc.render(data);
  return doc.getZip().generate({ type: "nodebuffer" });
}
