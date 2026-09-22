import { Router } from "express";
import { nanoid } from "nanoid";
import { store } from "../data/store.js";
import { DOCUMENT_TEMPLATES, getTemplateMeta, getTemplateFields, renderTemplateDocx } from "../services/documentTemplates.js";
import { docxToPdf } from "../services/docxToPdf.js";
import { saveGeneratedDocument } from "../services/sheetsService.js";

export const documentsRouter = Router();

// Buffers never leave the server as JSON — see download routes below, which stream them directly.
// Same reasoning as candidates.js's sanitizeCandidate: this list gets polled/re-fetched, and a
// multi-hundred-KB docx+pdf pair per row would make that expensive for no reason.
function sanitizeDocument(doc) {
  const { docxBuffer, pdfBuffer, ...rest } = doc;
  return rest;
}

// Best-effort guess at "whose letter is this" for the Drive filename/sheet row and the documents
// list — every template's fields are different, so rather than hard-coding "Employee Name" vs
// "Intern Full Name" per template, just take the first field whose label mentions "name" at all.
function derivePrimaryName(fields, values) {
  const nameField = fields.find((f) => /name/i.test(f.label));
  const value = nameField && values[nameField.key];
  return (value || "").trim() || "Untitled";
}

documentsRouter.get("/templates", (req, res) => {
  const templates = DOCUMENT_TEMPLATES.map((t) => getTemplateFields(t.id));
  res.json({ templates });
});

documentsRouter.get("/", (req, res) => {
  res.json({ documents: store.listDocuments().map(sanitizeDocument) });
});

// Generates a filled .docx + .pdf from a template and the given field values, and tries to save
// both to Drive/the Sheet. The generated document is kept either way (see store.createDocument
// below) — a Drive/Sheets hiccup only means HR needs to download it manually instead of finding
// it archived there, not that the letter itself is lost.
documentsRouter.post("/", async (req, res) => {
  const { templateId, values } = req.body;
  const meta = getTemplateMeta(templateId);
  if (!meta) return res.status(400).json({ error: `Unknown template "${templateId}"` });
  if (typeof values !== "object" || values === null) {
    return res.status(400).json({ error: "values (an object of field -> text) is required" });
  }

  try {
    const { fields } = getTemplateFields(templateId);
    const docxBuffer = renderTemplateDocx(templateId, values);
    const { pdf: pdfBuffer } = await docxToPdf(docxBuffer, { templateId });
    const name = derivePrimaryName(fields, values);

    const document = store.createDocument({
      id: nanoid(),
      templateId,
      templateName: meta.name,
      name,
      values,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      docxBuffer,
      pdfBuffer,
      driveDocxUrl: null,
      drivePdfUrl: null,
      driveError: null,
    });

    // trySaveToDrive updates the stored record in place (driveDocxUrl/drivePdfUrl/driveError) —
    // re-fetch rather than reusing the local `document` reference, which is now stale.
    await trySaveToDrive(document);
    res.status(201).json({ document: sanitizeDocument(store.getDocument(document.id)) });
  } catch (err) {
    console.error("[documents] Failed to generate document:", err);
    res.status(500).json({ error: err.message });
  }
});

// Lets HR fix a typo or fill in something they skipped, without starting the whole letter over —
// re-renders from the same template with the merged field values and re-saves to Drive as a fresh
// version (see the matching comment on saveGeneratedDocument in Code.gs: each save is logged as
// its own row, an audit trail of what changed and when, rather than silently overwriting).
documentsRouter.patch("/:id", async (req, res) => {
  const existing = store.getDocument(req.params.id);
  if (!existing) return res.status(404).json({ error: "Document not found" });

  const { values } = req.body;
  if (typeof values !== "object" || values === null) {
    return res.status(400).json({ error: "values (an object of field -> text) is required" });
  }

  try {
    const mergedValues = { ...existing.values, ...values };
    const { fields } = getTemplateFields(existing.templateId);
    const docxBuffer = renderTemplateDocx(existing.templateId, mergedValues);
    const { pdf: pdfBuffer } = await docxToPdf(docxBuffer, { templateId: existing.templateId });
    const name = derivePrimaryName(fields, mergedValues);

    const document = store.updateDocument(existing.id, {
      values: mergedValues,
      name,
      updatedAt: new Date().toISOString(),
      docxBuffer,
      pdfBuffer,
      driveDocxUrl: null,
      drivePdfUrl: null,
      driveError: null,
    });

    await trySaveToDrive(document);
    res.json({ document: sanitizeDocument(store.getDocument(document.id)) });
  } catch (err) {
    console.error("[documents] Failed to update document:", err);
    res.status(500).json({ error: err.message });
  }
});

documentsRouter.delete("/:id", (req, res) => {
  store.removeDocument(req.params.id);
  res.status(204).end();
});

documentsRouter.get("/:id/download.docx", (req, res) => {
  const doc = store.getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: "Document not found" });
  res.set({
    "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Content-Disposition": `attachment; filename="${sanitizeFilename(doc.name)} - ${sanitizeFilename(doc.templateName)}.docx"`,
  });
  res.send(doc.docxBuffer);
});

documentsRouter.get("/:id/download.pdf", (req, res) => {
  const doc = store.getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: "Document not found" });
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${sanitizeFilename(doc.name)} - ${sanitizeFilename(doc.templateName)}.pdf"`,
  });
  res.send(doc.pdfBuffer);
});

function sanitizeFilename(s) {
  return (s || "document").replace(/[^\w\- ]/g, "").trim() || "document";
}

async function trySaveToDrive(document) {
  try {
    const result = await saveGeneratedDocument({
      id: document.id,
      templateName: document.templateName,
      name: document.name,
      values: document.values,
      docxBase64: document.docxBuffer.toString("base64"),
      pdfBase64: document.pdfBuffer.toString("base64"),
    });
    if (result) {
      store.updateDocument(document.id, { driveDocxUrl: result.docxUrl, drivePdfUrl: result.pdfUrl });
    }
  } catch (err) {
    console.error(`[documents] Failed to save document ${document.id} to Drive/Sheets:`, err.message);
    store.updateDocument(document.id, { driveError: err.message });
  }
}
