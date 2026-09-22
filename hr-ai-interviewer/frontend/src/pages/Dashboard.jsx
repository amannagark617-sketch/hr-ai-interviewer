import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import {
  IconCheckCircle,
  IconClock,
  IconGrid,
  IconPhoneCall,
  IconRefresh,
  IconSparkChart,
  IconTrendUp,
} from "../icons.jsx";

// Minimal RFC4180-ish CSV parser (quoted fields, embedded commas/newlines, "" escaping) — no
// dependency needed for a sheet this small, and Google Sheets' own CSV export follows this
// quoting convention exactly.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function rowsToObjects(rows) {
  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows.slice(1).filter((r) => r.some((cell) => cell.trim() !== "")).map((r) => {
    const obj = {};
    headers.forEach((h, i) => (obj[h.trim()] = (r[i] || "").trim()));
    return obj;
  });
}

// Reverses Code.gs's joinList(arr) => arr.join("; ") so bullet-list columns (pros/cons/
// strengths/concerns) render as lists instead of one run-on sentence.
function splitList(value) {
  return (value || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

function average(values) {
  const nums = values.map(Number).filter((n) => !isNaN(n));
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

// "Call duration" is stored as "m:ss" (see Code.gs formatDuration) — parse back to seconds so it
// can be averaged, then reformat the same way.
function parseDuration(value) {
  const m = (value || "").match(/^(\d+):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
function formatDuration(seconds) {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const STATUS_COLORS = {
  advance: { color: "var(--success)", bg: "var(--success-soft)", label: "Advance" },
  hold: { color: "var(--amber)", bg: "var(--amber-soft)", label: "Hold" },
  reject: { color: "var(--rust)", bg: "var(--rust-soft)", label: "Reject" },
};

const tileStyle = {
  position: "relative",
  overflow: "hidden",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: "16px 18px",
  flex: 1,
  minWidth: 150,
};

// One accent color per stat tile — purely decorative, keeps each tile visually distinct at a
// glance instead of five identical white boxes in a row.
const STAT_TILES = [
  { key: "total", label: "Candidates logged", icon: IconGrid, color: "var(--accent)", bg: "var(--accent-soft)" },
  { key: "completed", label: "Calls completed", icon: IconPhoneCall, color: "var(--call)", bg: "#FBF0DE" },
  { key: "avgResume", label: "Avg resume score", icon: IconSparkChart, color: "var(--success)", bg: "var(--success-soft)" },
  { key: "avgInterview", label: "Avg interview score", icon: IconTrendUp, color: "var(--amber)", bg: "var(--amber-soft)" },
  { key: "avgDuration", label: "Avg call duration", icon: IconClock, color: "var(--rust)", bg: "var(--rust-soft)" },
];

// Small reusable section heading: an icon badge + label, used above every card/table on this page
// so each section reads as its own distinct block instead of a plain bold line.
function SectionLabel({ icon: Icon, color, bg, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
      <span className="icon-badge" style={{ width: 26, height: 26, background: bg, color }}>
        <Icon width={14} height={14} />
      </span>
      <label style={{ ...labelStyle, marginBottom: 0 }}>{children}</label>
    </div>
  );
}

function StatusPill({ label, color, bg }) {
  if (!label) return null;
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 12,
        fontWeight: 500,
        color,
        background: bg,
        borderRadius: "var(--radius-pill)",
        padding: "3px 10px",
        textTransform: "capitalize",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

const columns = [
  { key: "Candidate", label: "Candidate" },
  { key: "Role", label: "Role" },
  { key: "Phone", label: "Phone" },
  { key: "Resume score", label: "Resume" },
  { key: "Call status", label: "Call status" },
  { key: "Call duration", label: "Duration" },
  { key: "Interview score", label: "Interview" },
  { key: "Recommendation", label: "Recommendation" },
  { key: "Logged at", label: "Logged at" },
];

// Per-role funnel: candidates logged, calls completed, and the advance/hold/reject split for
// each role, so you can see e.g. "Data Analyst: 20 logged, 10 advanced" at a glance instead of
// only the lumped-together overall numbers.
function summarizeByRole(rows) {
  const byRole = new Map();
  for (const r of rows) {
    const role = r["Role"] || "(no role)";
    if (!byRole.has(role)) byRole.set(role, { role, total: 0, completed: 0, advance: 0, hold: 0, reject: 0 });
    const s = byRole.get(role);
    s.total++;
    if (r["Call status"] === "completed") s.completed++;
    const rec = (r["Recommendation"] || "").toLowerCase();
    if (s[rec] != null) s[rec]++;
  }
  return Array.from(byRole.values()).sort((a, b) => b.total - a.total);
}

export default function Dashboard() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [notConfigured, setNotConfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [roleFilter, setRoleFilter] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    setNotConfigured(false);
    try {
      const text = await api.getSheetCsv();
      setRows(rowsToObjects(parseCsv(text)));
    } catch (e) {
      if (e.message.includes("SHEET_CSV_URL")) setNotConfigured(true);
      else setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (notConfigured) {
    return (
      <div style={{ maxWidth: 780, margin: "0 auto", padding: "32px 24px 80px" }}>
        <div
          className="fade-in"
          style={{
            background: "linear-gradient(135deg, var(--accent-soft), var(--surface) 65%)",
            border: "1px dashed var(--border)",
            borderRadius: "var(--radius-lg)",
            padding: 22,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <span className="icon-badge" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
              <IconSparkChart />
            </span>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Connect your Google Sheet</div>
          </div>
          <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.7 }}>
            In your Google Sheet: <strong>File → Share → Publish to web</strong>, pick the <strong>"Round 1"</strong> tab,
            choose <strong>CSV</strong> as the format, and publish. Copy the URL it gives you, then set it as{" "}
            <code>SHEET_CSV_URL</code> in the <strong>backend's</strong> environment variables and redeploy. The
            backend fetches it server-side and hands it to this page — no repeated Apps Script deploys, no CORS
            issues from fetching Google directly in the browser, and no 403/303 redirects from hitting the script
            endpoint itself.
          </div>
        </div>
      </div>
    );
  }

  const roleSummaries = rows ? summarizeByRole(rows) : [];
  const filteredRows = roleFilter ? rows?.filter((r) => (r["Role"] || "(no role)") === roleFilter) : rows;

  const total = filteredRows?.length || 0;
  const completed = filteredRows?.filter((r) => r["Call status"] === "completed").length || 0;
  const counts = { advance: 0, hold: 0, reject: 0 };
  filteredRows?.forEach((r) => {
    const rec = (r["Recommendation"] || "").toLowerCase();
    if (counts[rec] != null) counts[rec]++;
  });
  const maxCount = Math.max(1, ...Object.values(counts));
  const avgResumeScore = filteredRows ? average(filteredRows.map((r) => r["Resume score"])) : null;
  const avgInterviewScore = filteredRows ? average(filteredRows.map((r) => r["Interview score"])) : null;
  const avgCallDurationSeconds = filteredRows
    ? average(filteredRows.map((r) => parseDuration(r["Call duration"])).filter((s) => s != null))
    : null;

  const statValues = {
    total,
    completed,
    avgResume: avgResumeScore ?? "—",
    avgInterview: avgInterviewScore ?? "—",
    avgDuration: avgCallDurationSeconds != null ? formatDuration(Math.round(avgCallDurationSeconds)) : "—",
  };

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "32px 24px 80px" }}>
      <div className="fade-in" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" }}>Dashboard</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Live from your Google Sheet</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {roleSummaries.length > 1 && (
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              style={{ fontSize: 13, padding: "6px 12px", borderRadius: "var(--radius-pill)", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink)" }}
            >
              <option value="">All roles</option>
              {roleSummaries.map((s) => (
                <option key={s.role} value={s.role}>{s.role}</option>
              ))}
            </select>
          )}
          <button
            onClick={load}
            disabled={loading}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-pill)",
              padding: "6px 14px",
              color: "var(--ink)",
              fontSize: 13,
              fontWeight: 500,
              cursor: loading ? "default" : "pointer",
            }}
          >
            <IconRefresh className={loading ? "spin" : undefined} />
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div className="fade-in" style={{ fontSize: 13, color: "var(--rust)", background: "var(--rust-soft)", borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 20 }}>
          {error}
        </div>
      )}

      {rows && (
        <>
          <div className="fade-in-group" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
            {STAT_TILES.map(({ key, label, icon: Icon, color, bg }) => (
              <div key={key} className="lift-on-hover" style={tileStyle}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontSize: 12, color: "var(--faint)" }}>{label}</div>
                  <span className="icon-badge" style={{ width: 26, height: 26, background: bg, color }}>
                    <Icon width={14} height={14} />
                  </span>
                </div>
                <div className="serif" style={{ fontSize: 26, fontWeight: 600 }}>{statValues[key]}</div>
              </div>
            ))}
          </div>

          <section className="fade-in" style={{ marginBottom: 32 }}>
            <SectionLabel icon={IconTrendUp} color="var(--accent)" bg="var(--accent-soft)">Recommendation breakdown</SectionLabel>
            <div className="lift-on-hover" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
              {Object.entries(STATUS_COLORS).map(([key, { color, bg, label }]) => {
                const pct = total > 0 ? Math.round((counts[key] / total) * 100) : 0;
                return (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ width: 64, fontSize: 12.5, fontWeight: 500, color: "var(--muted)" }}>{label}</span>
                    <div style={{ flex: 1, background: bg, borderRadius: "var(--radius-pill)", height: 24, position: "relative", overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${(counts[key] / maxCount) * 100}%`,
                          minWidth: counts[key] > 0 ? 10 : 0,
                          height: "100%",
                          background: `linear-gradient(90deg, ${color}, ${color})`,
                          borderRadius: "var(--radius-pill)",
                          transition: "width 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
                        }}
                      />
                    </div>
                    <span style={{ width: 20, textAlign: "right", fontSize: 13, fontWeight: 600 }}>{counts[key]}</span>
                    <span style={{ width: 36, textAlign: "right", fontSize: 12, color: "var(--faint)" }}>{pct}%</span>
                  </div>
                );
              })}
            </div>
          </section>

          {roleSummaries.length > 1 && (
            <section className="fade-in" style={{ marginBottom: 32 }}>
              <SectionLabel icon={IconGrid} color="var(--amber)" bg="var(--amber-soft)">By role</SectionLabel>
              <div className="lift-on-hover" style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", background: "var(--surface)" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      {["Role", "Logged", "Completed", "Advance", "Hold", "Reject", ""].map((h) => (
                        <th key={h} style={{ textAlign: "left", padding: "10px 12px", color: "var(--faint)", fontWeight: 500, whiteSpace: "nowrap" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {roleSummaries.map((s) => (
                      <tr
                        key={s.role}
                        onClick={() => setRoleFilter(roleFilter === s.role ? "" : s.role)}
                        style={{ borderBottom: "1px solid var(--border-soft)", cursor: "pointer", background: roleFilter === s.role ? "var(--surface-raised)" : "transparent", transition: "background var(--motion-fast)" }}
                      >
                        <td style={{ padding: "10px 12px", fontWeight: 500 }}>{s.role}</td>
                        <td style={{ padding: "10px 12px" }}>{s.total}</td>
                        <td style={{ padding: "10px 12px" }}>{s.completed}</td>
                        <td style={{ padding: "10px 12px", color: "var(--success)", fontWeight: 500 }}>{s.advance}</td>
                        <td style={{ padding: "10px 12px", color: "var(--amber)", fontWeight: 500 }}>{s.hold}</td>
                        <td style={{ padding: "10px 12px", color: "var(--rust)", fontWeight: 500 }}>{s.reject}</td>
                        <td style={{ padding: "10px 12px", width: 90 }}>
                          <div style={{ display: "flex", height: 6, borderRadius: "var(--radius-pill)", overflow: "hidden", background: "var(--surface-raised)" }}>
                            {s.total > 0 && (
                              <>
                                <div style={{ width: `${(s.advance / s.total) * 100}%`, background: "var(--success)" }} />
                                <div style={{ width: `${(s.hold / s.total) * 100}%`, background: "var(--amber)" }} />
                                <div style={{ width: `${(s.reject / s.total) * 100}%`, background: "var(--rust)" }} />
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="fade-in">
            <SectionLabel icon={IconCheckCircle} color="var(--success)" bg="var(--success-soft)">
              All logged candidates <span style={{ fontWeight: 400, color: "var(--faint)" }}>— click a row for the full detail</span>
            </SectionLabel>
            <div className="lift-on-hover" style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", background: "var(--surface)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {columns.map((c) => (
                      <th key={c.key} style={{ textAlign: "left", padding: "10px 12px", color: "var(--faint)", fontWeight: 500, whiteSpace: "nowrap" }}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r, i) => {
                    const isOpen = expanded === i;
                    const recKey = (r["Recommendation"] || "").toLowerCase();
                    const rec = STATUS_COLORS[recKey];
                    return (
                      <React.Fragment key={i}>
                        <tr
                          onClick={() => setExpanded(isOpen ? null : i)}
                          style={{
                            borderBottom: isOpen ? "none" : "1px solid var(--border-soft)",
                            cursor: "pointer",
                            background: isOpen ? "var(--surface-raised)" : "transparent",
                            transition: "background var(--motion-fast)",
                          }}
                          onMouseEnter={(e) => { if (!isOpen) e.currentTarget.style.background = "var(--border-soft)"; }}
                          onMouseLeave={(e) => { if (!isOpen) e.currentTarget.style.background = "transparent"; }}
                        >
                          <td style={{ padding: "10px 12px", fontWeight: 500 }}>{r["Candidate"]}</td>
                          <td style={{ padding: "10px 12px", whiteSpace: "nowrap", color: "var(--muted)" }}>{r["Role"]}</td>
                          <td style={{ padding: "10px 12px", whiteSpace: "nowrap", color: "var(--muted)" }}>{r["Phone"]}</td>
                          <td style={{ padding: "10px 12px" }}>{r["Resume score"]}</td>
                          <td style={{ padding: "10px 12px" }}>
                            <StatusPill
                              label={r["Call status"]}
                              color={r["Call status"] === "completed" ? "var(--success)" : "var(--muted)"}
                              bg={r["Call status"] === "completed" ? "var(--success-soft)" : "var(--surface-raised)"}
                            />
                          </td>
                          <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{r["Call duration"] || "—"}</td>
                          <td style={{ padding: "10px 12px" }}>{r["Interview score"]}</td>
                          <td style={{ padding: "10px 12px" }}>
                            {r["Recommendation"] ? <StatusPill label={r["Recommendation"]} color={rec?.color || "var(--muted)"} bg={rec?.bg || "var(--surface-raised)"} /> : null}
                          </td>
                          <td style={{ padding: "10px 12px", whiteSpace: "nowrap", color: "var(--faint)" }}>{r["Logged at"]}</td>
                        </tr>
                        {isOpen && (
                          <tr style={{ borderBottom: "1px solid var(--border-soft)", background: "var(--surface-raised)" }}>
                            <td colSpan={columns.length} style={{ padding: "4px 16px 20px" }}>
                              <DetailPanel row={r} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={columns.length} style={{ padding: "24px 12px", textAlign: "center", color: "var(--faint)" }}>
                        No rows logged yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function DetailPanel({ row }) {
  const resumePros = splitList(row["Resume pros"]);
  const resumeCons = splitList(row["Resume cons"]);
  const strengths = splitList(row["Interview strengths"]);
  const concerns = splitList(row["Interview concerns"]);
  const resumeLink = row["Resume (Drive link)"];
  const recordingUrl = row["Recording URL"];
  const callbackFor = row["Callback requested for"];

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 760 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {resumeLink && (
          <a href={resumeLink} target="_blank" rel="noreferrer" className="lift-on-hover" style={linkPillStyle}>
            Open resume
          </a>
        )}
      </div>

      {callbackFor && (
        <div>
          <div style={{ ...detailLabelStyle, color: "var(--amber)" }}>Callback requested</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
            Asked to be called back on <strong>{callbackFor}</strong>
            {row["Callback note"] ? ` — ${row["Callback note"]}` : ""}
          </div>
        </div>
      )}

      {row["Resume verdict"] && (
        <div>
          <div style={detailLabelStyle}>Resume verdict</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>{row["Resume verdict"]}</div>
        </div>
      )}

      {(resumePros.length > 0 || resumeCons.length > 0) && (
        <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
          {resumePros.length > 0 && (
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ ...detailLabelStyle, color: "var(--success)" }}>Resume pros</div>
              <ul style={bulletListStyle}>
                {resumePros.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          )}
          {resumeCons.length > 0 && (
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ ...detailLabelStyle, color: "var(--rust)" }}>Resume cons</div>
              <ul style={bulletListStyle}>
                {resumeCons.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {row["Interview summary"] && (
        <div>
          <div style={detailLabelStyle}>Interview summary</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>{row["Interview summary"]}</div>
        </div>
      )}

      {(strengths.length > 0 || concerns.length > 0) && (
        <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
          {strengths.length > 0 && (
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ ...detailLabelStyle, color: "var(--success)" }}>Interview strengths</div>
              <ul style={bulletListStyle}>
                {strengths.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          )}
          {concerns.length > 0 && (
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ ...detailLabelStyle, color: "var(--rust)" }}>Interview concerns</div>
              <ul style={bulletListStyle}>
                {concerns.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {recordingUrl && (
        <div>
          <div style={detailLabelStyle}>Call recording</div>
          <audio controls src={recordingUrl} style={{ width: "100%", maxWidth: 420, height: 32 }} />
        </div>
      )}

      {!callbackFor &&
        !row["Resume verdict"] &&
        resumePros.length === 0 &&
        resumeCons.length === 0 &&
        !row["Interview summary"] &&
        strengths.length === 0 &&
        concerns.length === 0 &&
        !recordingUrl &&
        !resumeLink && <div style={{ fontSize: 13, color: "var(--faint)" }}>No further detail logged for this row.</div>}
    </div>
  );
}

const labelStyle = { display: "block", fontSize: 13, fontWeight: 500, color: "var(--muted)", marginBottom: 8 };
const detailLabelStyle = { fontSize: 12, fontWeight: 500, color: "var(--muted)", marginBottom: 6, marginTop: 4 };
const bulletListStyle = { margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.7 };
const linkPillStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 14px",
  fontSize: 12.5,
  fontWeight: 500,
  color: "var(--accent)",
  background: "var(--accent-soft)",
  borderRadius: "var(--radius-pill)",
  textDecoration: "none",
};
