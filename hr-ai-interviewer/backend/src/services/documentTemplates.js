import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "..", "templates");

// The six HR letter templates HR actually handed over, each a real Word doc with bracketed
// placeholders like "[Employee Name]" scattered through the body and any tables (see each
// .docx's own content — this registry only needs to know the display name and filename; the
// fields themselves are discovered directly from the document, not hand-typed here, so editing
// the .docx file in src/templates/ is the only thing needed to add/rename/remove a field).
// To add another template: drop the .docx into src/templates/ using the same "[Placeholder]"
// bracket style as the others, then add one entry here.
export const DOCUMENT_TEMPLATES = [
  { id: "offer-letter", name: "Offer Letter", file: "offer-letter.docx" },
  { id: "appointment-letter", name: "Appointment Letter", file: "appointment-letter.docx" },
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

// Most fields (names, dates, single numbers) are naturally short — HR isn't going to type a
// paragraph into "Employee Name". A handful of fields are genuinely open-ended free text, though,
// and without a cap a long entry there can push the whole letter's page count past whatever the
// template's letterhead artwork was designed for. Each limit here comes from that field's actual
// home in its template (checked directly against the .docx's own XML), not a flat guess:
//   - experience-letter's four "Responsibility" fields are each ONE bullet line in a ~171mm-wide
//     single-column table cell at 10.5pt — 160 characters is roughly 2 lines, room for a real
//     sentence without the bullet list threatening to run past a page.
//   - internship-experience-letter's "area / project" sits mid-sentence in a flowing paragraph
//     ("...projects relating to [area / project], and gained...") — it reads as a short phrase or
//     a short list of project names, not a multi-sentence block, so 220 characters keeps it a
//     clause rather than a paragraph.
//   - internship-joining-letter's "Address" is a postal address — 180 characters covers any real
//     address with room to spare.
const FIELD_CHAR_LIMITS = {
  "experience-letter": {
    "Responsibility 1 – factual, role-based": 160,
    "Responsibility 2 – factual, role-based": 160,
    "Responsibility 3 – factual, role-based": 160,
    "Responsibility 4 – factual, role-based": 160,
  },
  "internship-experience-letter": {
    "area / project": 220,
  },
  "internship-joining-letter": {
    Address: 180,
  },
};

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
    fields.push({ key, label: displayLabel(key), maxLength: FIELD_CHAR_LIMITS[meta.id]?.[key] });
  }
  return { id: meta.id, name: meta.name, fields };
}

// Fills a template with the given values (an object keyed by each field's exact bracket text —
// see getTemplateFields above) and returns the rendered .docx as a Buffer, formatting fully
// intact (fonts, tables, the letterhead/signature images embedded in the original file).
// A value missing from `values` renders as an empty string rather than leaving the bracket
// behind, so a half-filled form never leaks "[Employee Name]" into a document HR downloads.
//
// Values are clamped to each field's maxLength (see FIELD_CHAR_LIMITS above) here too, not just in
// the form — the frontend's own limit only stops someone typing past it there; this is what
// actually protects the rendered letter's layout if this is ever called some other way (a direct
// API request, a future integration) that skips the form entirely.
export function renderTemplateDocx(templateId, values) {
  const { doc } = openTemplate(templateId);
  const fields = getTemplateFields(templateId).fields;
  const data = {};
  for (const { key, maxLength } of fields) {
    const value = values?.[key] ?? "";
    data[key] = maxLength ? value.slice(0, maxLength) : value;
  }
  doc.render(data);
  return doc.getZip().generate({ type: "nodebuffer" });
}
