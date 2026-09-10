import React, { useEffect, useState } from "react";
import { api } from "../api.js";

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

function average(values) {
  const nums = values.map(Number).filter((n) => !isNaN(n));
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

const STATUS_COLORS = {
  advance: { color: "var(--accent)", bg: "var(--accent-soft)", label: "Advance" },
  hold: { color: "var(--amber)", bg: "var(--amber-soft)", label: "Hold" },
  reject: { color: "var(--rust)", bg: "var(--rust-soft)", label: "Reject" },
};

const tileStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "16px 18px",
  flex: 1,
  minWidth: 140,
};

export default function Dashboard() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [notConfigured, setNotConfigured] = useState(false);
  const [loading, setLoading] = useState(false);

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
        <div style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 10, padding: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Connect your Google Sheet</div>
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

  const total = rows?.length || 0;
  const completed = rows?.filter((r) => r["Call status"] === "completed").length || 0;
  const counts = { advance: 0, hold: 0, reject: 0 };
  rows?.forEach((r) => {
    const rec = (r["Recommendation"] || "").toLowerCase();
    if (counts[rec] != null) counts[rec]++;
  });
  const maxCount = Math.max(1, ...Object.values(counts));
  const avgResumeScore = rows ? average(rows.map((r) => r["Resume score"])) : null;
  const avgInterviewScore = rows ? average(rows.map((r) => r["Interview score"])) : null;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px 80px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <label style={labelStyle}>Overview</label>
        <button onClick={load} disabled={loading} style={{ background: "transparent", border: "none", color: "var(--muted)", fontSize: 13, cursor: "pointer" }}>
          {loading ? "Refreshing..." : "↻ Refresh"}
        </button>
      </div>

      {error && <div style={{ fontSize: 13, color: "var(--rust)", marginBottom: 20 }}>{error}</div>}

      {rows && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
            <div style={tileStyle}>
              <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 6 }}>Candidates logged</div>
              <div className="serif" style={{ fontSize: 26, fontWeight: 600 }}>{total}</div>
            </div>
            <div style={tileStyle}>
              <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 6 }}>Calls completed</div>
              <div className="serif" style={{ fontSize: 26, fontWeight: 600 }}>{completed}</div>
            </div>
            <div style={tileStyle}>
              <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 6 }}>Avg resume score</div>
              <div className="serif" style={{ fontSize: 26, fontWeight: 600 }}>{avgResumeScore ?? "—"}</div>
            </div>
            <div style={tileStyle}>
              <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 6 }}>Avg interview score</div>
              <div className="serif" style={{ fontSize: 26, fontWeight: 600 }}>{avgInterviewScore ?? "—"}</div>
            </div>
          </div>

          <section style={{ marginBottom: 32 }}>
            <label style={labelStyle}>Recommendation breakdown</label>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
              {Object.entries(STATUS_COLORS).map(([key, { color, bg, label }]) => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ width: 64, fontSize: 12.5, fontWeight: 500, color: "var(--muted)" }}>{label}</span>
                  <div style={{ flex: 1, background: bg, borderRadius: 6, height: 22, position: "relative" }}>
                    <div
                      style={{
                        width: `${(counts[key] / maxCount) * 100}%`,
                        minWidth: counts[key] > 0 ? 6 : 0,
                        height: "100%",
                        background: color,
                        borderRadius: 6,
                        transition: "width 0.3s",
                      }}
                    />
                  </div>
                  <span style={{ width: 24, textAlign: "right", fontSize: 13, fontWeight: 500 }}>{counts[key]}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <label style={labelStyle}>All logged candidates</label>
            <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["Candidate", "Resume score", "Call status", "Interview score", "Recommendation", "Logged at"].map((h) => (
                      <th key={h} style={{ textAlign: "left", padding: "10px 12px", color: "var(--faint)", fontWeight: 500, whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border-soft)" }}>
                      <td style={{ padding: "10px 12px" }}>{r["Candidate"]}</td>
                      <td style={{ padding: "10px 12px" }}>{r["Resume score"]}</td>
                      <td style={{ padding: "10px 12px" }}>{r["Call status"]}</td>
                      <td style={{ padding: "10px 12px" }}>{r["Interview score"]}</td>
                      <td style={{ padding: "10px 12px", textTransform: "capitalize" }}>{r["Recommendation"]}</td>
                      <td style={{ padding: "10px 12px", whiteSpace: "nowrap", color: "var(--faint)" }}>{r["Logged at"]?.slice(0, 16).replace("T", " ")}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ padding: "24px 12px", textAlign: "center", color: "var(--faint)" }}>
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

const labelStyle = { display: "block", fontSize: 13, fontWeight: 500, color: "var(--muted)", marginBottom: 8 };
