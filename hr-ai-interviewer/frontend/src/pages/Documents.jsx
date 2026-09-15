import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { IconCheckCircle, IconDocument, IconDownload, IconPencil, IconUsers } from "../icons.jsx";

const labelStyle = { display: "block", fontSize: 13, fontWeight: 500, color: "var(--muted)", marginBottom: 8 };
const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
  fontSize: 14,
  padding: "10px 12px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  background: "var(--surface)",
  color: "var(--ink)",
};
const primaryBtnStyle = {
  width: "100%",
  padding: "14px 20px",
  fontSize: 15,
  fontWeight: 500,
  background: "var(--accent)",
  color: "var(--bg)",
  border: "none",
  borderRadius: "var(--radius-pill)",
  cursor: "pointer",
};
const secondaryBtnStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "9px 16px",
  fontSize: 13.5,
  fontWeight: 500,
  background: "var(--surface)",
  color: "var(--ink)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-pill)",
  cursor: "pointer",
  textDecoration: "none",
};
const iconBtnStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  background: "transparent",
  border: "none",
  borderRadius: "var(--radius-pill)",
  cursor: "pointer",
  color: "var(--faint)",
};

// A color per template card, purely so five cards in a row read as distinct at a glance instead
// of five identical white boxes — same trick used for Dashboard's stat tiles.
const CARD_COLORS = [
  { color: "var(--accent)", bg: "var(--accent-soft)" },
  { color: "var(--success)", bg: "var(--success-soft)" },
  { color: "var(--amber)", bg: "var(--amber-soft)" },
  { color: "var(--rust)", bg: "var(--rust-soft)" },
  { color: "var(--call)", bg: "#FBF0DE" },
];

// Every field used to be hand-classified as "short" (a plain <input>) or "long" (a fixed-height
// textarea) by guessing from its label text — that broke the moment a template had a field like
// "area / project" that's short-sounding but HR actually fills with a multi-paragraph list: it
// rendered as a cramped single-line input with no way to see or add more than one line. Rather
// than keep expanding that guesswork, every non-date field below is an AutoTextarea (see below) —
// it starts one line tall (indistinguishable from a plain input for a short value) and grows with
// whatever HR actually types or pastes, so "how much room does this need" is answered by the
// content itself instead of a label heuristic that can't see it coming.
//
// Date fields are the one real exception, since a browser's native date picker is worth having —
// see the DATE_FIELD_PATTERN below for how those are detected instead.
const DATE_FIELD_PATTERN = /date|\bdd\s*[\/\- ]?\s*mon(th)?\s*[\/\- ]?\s*yyyy\b/i;

// A field whose label names an identity/role/place is one HR is likely to type in all-lowercase
// or all-caps out of haste ("aman", "AI INTERN") — auto-fixing it to proper case on blur (not on
// every keystroke, so it doesn't fight typing mid-word) matches how these read on every other
// generated letter's own body text.
const TITLE_CASE_FIELD_PATTERN = /name|designation|department|location|manager|position|role/i;

function fieldKind(field) {
  if (DATE_FIELD_PATTERN.test(field.label)) return "date";
  if (TITLE_CASE_FIELD_PATTERN.test(field.label)) return "titlecase";
  return "text";
}

function titleCase(str) {
  return str.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

const MONTH_ABBRS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// <input type="date"> only speaks/shows ISO (yyyy-mm-dd) — that's what lives in `values` state
// while HR is editing. The letter itself should read like a letter, not a database column, so this
// converts to "15-Sep-2026" only at the moment a value is actually sent to the backend for
// generation (see toSubmitValues below).
function formatDateForDoc(isoDate) {
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return `${String(d.getDate()).padStart(2, "0")}-${MONTH_ABBRS[d.getMonth()]}-${d.getFullYear()}`;
}

// The reverse of the above, for re-opening a previously generated document: its stored values are
// already in "15-Sep-2026" form (see formatDateForDoc), but the date input needs ISO to show a
// pre-filled date rather than a blank picker. Returns "" (not the original string) when it can't
// parse — safer than feeding a date input a value it'll silently refuse to display.
function parseDocDateToIso(value) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec((value || "").trim());
  if (!m) return "";
  const monthIndex = MONTH_ABBRS.findIndex((abbr) => abbr.toLowerCase() === m[2].toLowerCase());
  if (monthIndex === -1) return "";
  return `${m[3]}-${String(monthIndex + 1).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
}

function toSubmitValues(fields, values) {
  const out = { ...values };
  for (const field of fields) {
    if (fieldKind(field) === "date" && out[field.key]) {
      out[field.key] = formatDateForDoc(out[field.key]);
    }
  }
  return out;
}

// Starts exactly one line tall — same visual height as a plain <input> — and grows to fit
// whatever's typed or pasted, instead of clipping long content or leaving short content in an
// oversized fixed box the way a guessed textarea size does either way.
function AutoTextarea({ value, style, ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      style={{ ...style, resize: "none", overflow: "hidden" }}
      {...rest}
    />
  );
}

export default function Documents() {
  const [templates, setTemplates] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);
  const [values, setValues] = useState({});
  const [editingDocId, setEditingDocId] = useState(null);
  const [result, setResult] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const loadTemplates = () =>
    api.listDocumentTemplates().then((r) => setTemplates(r.templates)).catch((e) => setError(e.message));
  const loadDocuments = () => api.listDocuments().then((r) => setDocuments(r.documents)).catch(() => {});

  useEffect(() => {
    loadTemplates();
    loadDocuments();
  }, []);

  const selectedTemplate = templates?.find((t) => t.id === selectedTemplateId);

  const startTemplate = (templateId) => {
    setSelectedTemplateId(templateId);
    setValues({});
    setEditingDocId(null);
    setResult(null);
    setError("");
  };

  const openExisting = (doc) => {
    setSelectedTemplateId(doc.templateId);
    const template = templates?.find((t) => t.id === doc.templateId);
    const initialValues = { ...(doc.values || {}) };
    for (const field of template?.fields || []) {
      if (fieldKind(field) === "date" && initialValues[field.key]) {
        initialValues[field.key] = parseDocDateToIso(initialValues[field.key]);
      }
    }
    setValues(initialValues);
    setEditingDocId(doc.id);
    setResult(doc);
    setError("");
  };

  const backToTemplates = () => {
    setSelectedTemplateId(null);
    setValues({});
    setEditingDocId(null);
    setResult(null);
    setError("");
  };

  const setField = (key, v) => setValues((prev) => ({ ...prev, [key]: v }));

  const handleTitleCaseBlur = (field) => {
    if (fieldKind(field) !== "titlecase") return;
    setValues((prev) => (prev[field.key] ? { ...prev, [field.key]: titleCase(prev[field.key]) } : prev));
  };

  const generate = async () => {
    setGenerating(true);
    setError("");
    try {
      const submitValues = toSubmitValues(selectedTemplate.fields, values);
      const res = editingDocId
        ? await api.updateDocument(editingDocId, submitValues)
        : await api.generateDocument(selectedTemplateId, submitValues);
      setResult(res.document);
      setEditingDocId(res.document.id);
      loadDocuments();
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const removeDoc = async (id) => {
    await api.removeDocument(id);
    loadDocuments();
    if (result?.id === id) backToTemplates();
  };

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "32px 24px 80px" }}>
      <div
        className="fade-in"
        style={{
          marginBottom: 32,
          padding: "22px 24px",
          borderRadius: "var(--radius-lg)",
          background: "linear-gradient(135deg, var(--accent-soft), var(--surface) 65%)",
          border: "1px solid var(--border-soft)",
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em", marginBottom: 4 }}>
          HR letter templates
        </div>
        <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6 }}>
          Fill in a short form and get back a matching Word doc and PDF, formatted exactly like the
          template — letterhead, tables, and signature included. Every generated letter is saved to your
          Google Drive and logged in the Sheet automatically.
        </div>
      </div>

      {error && (
        <div
          className="fade-in"
          style={{ fontSize: 13, color: "var(--rust)", background: "var(--rust-soft)", borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 20 }}
        >
          {error}
        </div>
      )}

      {!selectedTemplateId && (
        <>
          <section style={{ marginBottom: 32 }}>
            <label style={labelStyle}>Choose a template</label>
            <div className="fade-in-group" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
              {(templates || []).map((t, i) => {
                const { color, bg } = CARD_COLORS[i % CARD_COLORS.length];
                return (
                  <button
                    key={t.id}
                    onClick={() => startTemplate(t.id)}
                    className="lift-on-hover"
                    style={{
                      textAlign: "left",
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-lg)",
                      padding: 18,
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    <span className="icon-badge" style={{ background: bg, color }}>
                      <IconDocument />
                    </span>
                    <div style={{ fontSize: 14.5, fontWeight: 600 }}>{t.name}</div>
                    <div style={{ fontSize: 12.5, color: "var(--faint)" }}>{t.fields.length} fields to fill</div>
                  </button>
                );
              })}
              {templates == null && <div style={{ fontSize: 13, color: "var(--faint)" }}>Loading templates...</div>}
            </div>
          </section>

          {documents.length > 0 && (
            <section className="fade-in">
              <label style={labelStyle}>Recently generated</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="lift-on-hover"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-md)",
                      padding: "10px 14px",
                    }}
                  >
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 30,
                        height: 30,
                        borderRadius: "var(--radius-pill)",
                        background: "var(--accent-soft)",
                        color: "var(--accent)",
                        fontSize: 12.5,
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      {(doc.name || "?").trim().slice(0, 1).toUpperCase()}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</div>
                      <div style={{ fontSize: 12, color: "var(--faint)" }}>
                        {doc.templateName} · {new Date(doc.updatedAt).toLocaleString()}
                        {!doc.driveDocxUrl && !doc.driveError ? "" : doc.driveDocxUrl ? " · saved to Drive" : " · not saved to Drive"}
                      </div>
                    </div>
                    <a href={api.documentDownloadUrl(doc.id, "pdf")} style={iconBtnStyle} title="Download PDF">
                      <IconDownload />
                    </a>
                    <button onClick={() => openExisting(doc)} style={iconBtnStyle} title="Edit">
                      <IconPencil />
                    </button>
                    <button onClick={() => removeDoc(doc.id)} aria-label={`Remove ${doc.name}`} style={iconBtnStyle}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {selectedTemplateId && selectedTemplate && (
        <div className="fade-in">
          <button onClick={backToTemplates} style={{ ...secondaryBtnStyle, marginBottom: 20 }}>
            ← All templates
          </button>

          {result && (
            <div
              className="fade-in"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                marginBottom: 24,
                padding: "16px 18px",
                borderRadius: "var(--radius-lg)",
                background: "var(--success-soft)",
                border: "1px solid var(--border-soft)",
              }}
            >
              <span className="icon-badge" style={{ background: "var(--surface)", color: "var(--success)" }}>
                <IconCheckCircle />
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{selectedTemplate.name} generated</div>
                <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
                  {result.driveDocxUrl
                    ? "Saved to Google Drive and logged in the Sheet."
                    : result.driveError
                      ? `Couldn't save to Drive/Sheets: ${result.driveError}`
                      : "Not saved to Drive — set up Google Sheets logging to archive letters automatically."}
                </div>
              </div>
              <a href={api.documentDownloadUrl(result.id, "pdf")} style={secondaryBtnStyle}>
                <IconDownload style={{ marginRight: 7 }} />
                PDF
              </a>
              <a href={api.documentDownloadUrl(result.id, "docx")} style={secondaryBtnStyle}>
                <IconDownload style={{ marginRight: 7 }} />
                Word
              </a>
            </div>
          )}

          <section className="lift-on-hover" style={{ marginBottom: 24, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <span className="icon-badge" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                <IconUsers />
              </span>
              <label style={{ ...labelStyle, marginBottom: 0 }}>{selectedTemplate.name}</label>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {selectedTemplate.fields.map((field) => {
                const kind = fieldKind(field);
                return (
                  <div key={field.key}>
                    <label style={labelStyle}>{field.label}</label>
                    {kind === "date" ? (
                      <input
                        type="date"
                        value={values[field.key] || ""}
                        onChange={(e) => setField(field.key, e.target.value)}
                        style={inputStyle}
                      />
                    ) : (
                      <AutoTextarea
                        value={values[field.key] || ""}
                        onChange={(e) => setField(field.key, e.target.value)}
                        onBlur={() => handleTitleCaseBlur(field)}
                        style={inputStyle}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <button onClick={generate} disabled={generating} style={primaryBtnStyle}>
            {generating ? "Generating..." : result ? "Save changes & regenerate" : "Generate document"}
          </button>
        </div>
      )}
    </div>
  );
}
