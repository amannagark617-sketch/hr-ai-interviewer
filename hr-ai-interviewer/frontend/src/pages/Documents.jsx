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

// A rupee amount ("Annual CTC", the internship stipend's "Amount", every cell of a salary
// breakdown table) needs a completely different input than free text — see the "money" case in
// FieldInput below. Standalone fields are matched by label; the fields inside a compensation
// breakdown table (Basic/HRA/Conveyance/...) are matched separately by forceMoney (see
// buildFormEntries/groupEntriesIntoTables) since their labels are just the component name, with
// no word here to match against.
const MONEY_FIELD_PATTERN = /ctc|salary|stipend|amount/i;

// "Office Hours" (Appointment Letter) / "Time" i.e. Working Hours (Internship Joining Letter) —
// a free-text field here is exactly how someone ends up with "172397" as their office hours. Two
// native time pickers instead, joined into "09:00 AM to 06:00 PM" at submit time — see
// formatTimeRangeForDoc/toSubmitValues.
const TIME_RANGE_FIELD_PATTERN = /\bhours?\b|\btime\b/i;

function fieldKind(field, forceMoney) {
  if (forceMoney) return "money";
  if (DATE_FIELD_PATTERN.test(field.label)) return "date";
  if (TIME_RANGE_FIELD_PATTERN.test(field.label)) return "timerange";
  if (MONEY_FIELD_PATTERN.test(field.label)) return "money";
  if (TITLE_CASE_FIELD_PATTERN.test(field.label)) return "titlecase";
  return "text";
}

function titleCase(str) {
  return str.replace(/\S+/g, (word) => {
    // A word that's already ALL CAPS (2+ letters) is almost always a deliberate acronym — "AI",
    // "MDO", "HR" — not someone who forgot to release Caps Lock. Collapsing it to "Ai"/"Mdo" was
    // actively wrong, not just a style choice, so those are left exactly as typed. Anything else
    // (lowercase, Mixed Case, a single capitalized initial) still gets the normal fix.
    if (word.length > 1 && word === word.toUpperCase() && word !== word.toLowerCase()) return word;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
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

// Indian digit grouping (lakh/crore style): the last 3 digits stand alone, everything before that
// groups in pairs — 2189379 -> "21,89,379", not the Western "2,189,379". Takes/returns a plain
// digit string; punctuation is the caller's job (see the money case in FieldInput and
// handleMoneyBlur, which strip it back out before re-deriving this on every edit).
function formatIndianAmount(digits) {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

function formatTime12h(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${period}`;
}

// The two native <input type="time"> pickers (see FieldInput's "timerange" case) live in state as
// separate 24h "HH:MM" sub-values under "<field.key>__from"/"__to" — only combined into the one
// real field value ("09:00 AM to 06:00 PM") at submit time, mirroring how a date field stays ISO
// in state and only becomes "15-Sep-2026" here too (see toSubmitValues below).
function formatTimeRangeForDoc(fromHHMM, toHHMM) {
  return `${formatTime12h(fromHHMM)} to ${formatTime12h(toHHMM)}`;
}

// The reverse, for re-opening a previously generated document — same reasoning as
// parseDocDateToIso. Returns blank sub-values (not the original string) when it can't parse.
function parseTimeRangeToSubvalues(value) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)\s+to\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec((value || "").trim());
  if (!m) return { from: "", to: "" };
  const to24 = (h, mm, period) => {
    let hh = Number(h) % 12;
    if (period.toUpperCase() === "PM") hh += 12;
    return `${String(hh).padStart(2, "0")}:${mm}`;
  };
  return { from: to24(m[1], m[2], m[3]), to: to24(m[4], m[5], m[6]) };
}

function toSubmitValues(fields, values) {
  const out = { ...values };
  for (const field of fields) {
    const kind = fieldKind(field);
    if (kind === "date" && out[field.key]) {
      out[field.key] = formatDateForDoc(out[field.key]);
    } else if (kind === "timerange") {
      const from = out[`${field.key}__from`];
      const to = out[`${field.key}__to`];
      if (from && to) out[field.key] = formatTimeRangeForDoc(from, to);
      delete out[`${field.key}__from`];
      delete out[`${field.key}__to`];
    }
  }
  return out;
}

// Starts exactly one line tall — same visual height as a plain <input> — and grows to fit
// whatever's typed or pasted, instead of clipping long content or leaving short content in an
// oversized fixed box the way a guessed textarea size does either way.
//
// Enter is blocked outright: every field across every template is meant to render as one
// continuous line/phrase (even a "Responsibility" bullet or "area / project" is a single bullet
// or clause in the source .docx, not a multi-line block) — a manual line break typed into the form
// would insert a literal hard break into that spot instead of just the ordinary text-wrapping the
// auto-grow above already handles.
function AutoTextarea({ value, style, onKeyDown, ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  const handleKeyDown = (e) => {
    if (e.key === "Enter") e.preventDefault();
    onKeyDown?.(e);
  };
  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      onKeyDown={handleKeyDown}
      style={{ ...style, resize: "none", overflow: "hidden" }}
      {...rest}
    />
  );
}

// The salary/compensation tables (Increment Letter's Existing/New/Annual breakdown, Appointment
// Letter's Salary Annexure) show up in the form as 13+ fields in a flat one-per-line list — exactly
// the "one by one... it is confusion" complaint. Each template names these fields with its own
// prefix convention ("Existing Basic"/"New Basic"/"Annual Basic", or plain "Basic"/"Annual Basic"),
// but the shape is the same underneath: several fields that are really one row of one real salary
// table, split apart only because docxtemplater fields are flat. This regroups them back into rows
// and renders those rows as an actual <table> instead — same data, same maxLength/date/title-case
// handling per cell, just laid out the way the printed table already looks.
const ROLE_PREFIX_PATTERN = /^(Existing|New|Annual)\s+(.+)$/;
const ROLE_LABELS = { existing: "Existing", new: "New", value: "Amount", annual: "Annual" };
const ROLE_ORDER = ["existing", "new", "value", "annual"];

// A run of grouped rows only renders as a table once it's long enough to actually look like one —
// short of that, a coincidental pair (Increment Letter's own "Existing Annual CTC"/"New Annual CTC"
// summary line, unrelated to its per-row breakdown table just below it) would otherwise get pulled
// out into a stray one-row "table" instead of just reading as the two ordinary fields it is.
const MIN_TABLE_ROWS = 4;

// Splits a template's flat field list into a sequence of either standalone fields or grouped
// table rows. Two fields are the same row if one is bare "<Component>" and the very next one is
// exactly "Annual <Component>" (Appointment Letter's shape), or if consecutive fields share an
// Existing/New/Annual prefix over the same component name (Increment Letter's shape) — in both
// templates the pieces of one row are always adjacent in field order, so no lookahead beyond "the
// next field" is needed.
function buildFormEntries(fields) {
  const entries = [];
  let i = 0;
  while (i < fields.length) {
    const field = fields[i];
    const prefixMatch = ROLE_PREFIX_PATTERN.exec(field.key);
    if (prefixMatch) {
      const component = prefixMatch[2];
      const roles = { [prefixMatch[1].toLowerCase()]: field };
      let j = i + 1;
      while (j < fields.length) {
        const nextMatch = ROLE_PREFIX_PATTERN.exec(fields[j].key);
        if (nextMatch && nextMatch[2] === component && !roles[nextMatch[1].toLowerCase()]) {
          roles[nextMatch[1].toLowerCase()] = fields[j];
          j++;
        } else break;
      }
      entries.push({ type: "row", component, roles });
      i = j;
    } else if (fields[i + 1]?.key === `Annual ${field.key}`) {
      entries.push({ type: "row", component: field.key, roles: { value: field, annual: fields[i + 1] } });
      i += 2;
    } else {
      entries.push({ type: "field", field });
      i += 1;
    }
  }
  return entries;
}

// Collapses long-enough consecutive runs of "row" entries into one "table" entry each; a run
// shorter than MIN_TABLE_ROWS is flattened back into its individual fields, exactly as if it had
// never been grouped (see the Existing/New Annual CTC example above).
function groupEntriesIntoTables(entries) {
  const out = [];
  let i = 0;
  while (i < entries.length) {
    if (entries[i].type !== "row") {
      out.push(entries[i]);
      i++;
      continue;
    }
    let j = i;
    while (j < entries.length && entries[j].type === "row") j++;
    const run = entries.slice(i, j);
    if (run.length >= MIN_TABLE_ROWS) {
      const columns = ROLE_ORDER.filter((role) => run.some((row) => row.roles[role]));
      out.push({ type: "table", rows: run, columns });
    } else {
      for (const row of run) {
        for (const role of ROLE_ORDER) {
          if (row.roles[role]) out.push({ type: "field", field: row.roles[role] });
        }
      }
    }
    i = j;
  }
  return out;
}

const salaryTableStyle = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const salaryThStyle = {
  textAlign: "left",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--muted)",
  padding: "6px 8px",
  borderBottom: "1px solid var(--border)",
};
const salaryTdStyle = { padding: "4px 6px", borderBottom: "1px solid var(--border-soft)", verticalAlign: "middle" };
const salaryLabelTdStyle = { ...salaryTdStyle, fontSize: 13, color: "var(--ink)", whiteSpace: "nowrap" };
const salaryInputStyle = { ...inputStyle, padding: "6px 8px", fontSize: 13, minWidth: 90 };

const timeInputStyle = { flex: 1, minWidth: 0 };

// Shared between a standalone field and one table cell — same date/money/time-range/title-case/
// length-cap handling either way, just a different wrapping style. forceMoney is set by the
// salary-table cell caller, since a breakdown table's cells ("Basic", "HRA", ...) are always
// monetary but don't have a label MONEY_FIELD_PATTERN can match on its own.
function FieldInput({ field, values, setField, onFieldBlur, forceMoney, style }) {
  const kind = fieldKind(field, forceMoney);
  const value = values[field.key];

  if (kind === "date") {
    return <input type="date" value={value || ""} onChange={(e) => setField(field.key, e.target.value)} style={style} />;
  }

  if (kind === "timerange") {
    const fromKey = `${field.key}__from`;
    const toKey = `${field.key}__to`;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input type="time" value={values[fromKey] || ""} onChange={(e) => setField(fromKey, e.target.value)} style={{ ...style, ...timeInputStyle }} />
        <span style={{ fontSize: 12.5, color: "var(--muted)", flexShrink: 0 }}>to</span>
        <input type="time" value={values[toKey] || ""} onChange={(e) => setField(toKey, e.target.value)} style={{ ...style, ...timeInputStyle }} />
      </div>
    );
  }

  if (kind === "money") {
    // Digits only in state while editing (no commas) — reformatting on every keystroke risks
    // fighting the cursor mid-edit, same reason title-case only fires on blur. onFocus also
    // strips back to digits, so re-editing an already-formatted value ("21,89,379") doesn't start
    // by inserting into the middle of punctuation.
    return (
      <input
        type="text"
        inputMode="numeric"
        value={value || ""}
        onFocus={() => setField(field.key, (value || "").replace(/\D/g, ""))}
        onChange={(e) => setField(field.key, e.target.value.replace(/\D/g, ""))}
        onBlur={() => onFieldBlur(field, forceMoney)}
        maxLength={field.maxLength}
        style={style}
      />
    );
  }

  return (
    <AutoTextarea
      value={value || ""}
      onChange={(e) => setField(field.key, e.target.value)}
      onBlur={() => onFieldBlur(field, forceMoney)}
      maxLength={field.maxLength}
      style={style}
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
      const kind = fieldKind(field);
      if (kind === "date" && initialValues[field.key]) {
        initialValues[field.key] = parseDocDateToIso(initialValues[field.key]);
      } else if (kind === "timerange" && initialValues[field.key]) {
        const { from, to } = parseTimeRangeToSubvalues(initialValues[field.key]);
        initialValues[`${field.key}__from`] = from;
        initialValues[`${field.key}__to`] = to;
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

  const onFieldBlur = (field, forceMoney) => {
    const kind = fieldKind(field, forceMoney);
    if (kind === "titlecase") {
      setValues((prev) => (prev[field.key] ? { ...prev, [field.key]: titleCase(prev[field.key]) } : prev));
    } else if (kind === "money") {
      setValues((prev) => {
        const digits = (prev[field.key] || "").replace(/\D/g, "");
        return digits ? { ...prev, [field.key]: formatIndianAmount(digits) } : prev;
      });
    }
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
              {groupEntriesIntoTables(buildFormEntries(selectedTemplate.fields)).map((entry, idx) => {
                if (entry.type === "table") {
                  return (
                    <div key={`table-${idx}`} style={{ overflowX: "auto" }}>
                      <table style={salaryTableStyle}>
                        <thead>
                          <tr>
                            <th style={salaryThStyle}>Component</th>
                            {entry.columns.map((role) => (
                              <th key={role} style={salaryThStyle}>{ROLE_LABELS[role]}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {entry.rows.map((row) => (
                            <tr key={row.component}>
                              <td style={salaryLabelTdStyle}>{row.component}</td>
                              {entry.columns.map((role) => {
                                const field = row.roles[role];
                                return (
                                  <td key={role} style={salaryTdStyle}>
                                    {field && (
                                      <FieldInput
                                        field={field}
                                        values={values}
                                        setField={setField}
                                        onFieldBlur={onFieldBlur}
                                        forceMoney
                                        style={salaryInputStyle}
                                      />
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                }
                const { field } = entry;
                return (
                  <div key={field.key}>
                    <label style={labelStyle}>{field.label}</label>
                    <FieldInput
                      field={field}
                      values={values}
                      setField={setField}
                      onFieldBlur={onFieldBlur}
                      style={inputStyle}
                    />
                    {/* Every field has a maxLength now (see documentTemplates.js), but showing a
                        counter under every single one — most of which no real value will ever get
                        near — would just be clutter. Only surface it once a value is actually
                        closing in on its limit, when the countdown is genuinely useful to see. */}
                    {field.maxLength && (values[field.key]?.length || 0) >= field.maxLength * 0.6 && (
                      <div style={{ fontSize: 11, color: "var(--faint)", textAlign: "right", marginTop: 4 }}>
                        {(values[field.key] || "").length}/{field.maxLength}
                      </div>
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
