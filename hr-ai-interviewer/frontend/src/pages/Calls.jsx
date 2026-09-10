import React, { useEffect, useState } from "react";
import { api } from "../api.js";

const cardStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: "14px 16px",
};

function statusBadge(call) {
  if (call.status === "failed") return { label: "Failed", color: "var(--rust)", bg: "var(--rust-soft)" };
  if (call.status === "dialing") return { label: "Dialing...", color: "var(--faint)", bg: "var(--border-soft)" };
  if (call.status === "in-progress") return { label: "In progress", color: "var(--call)", bg: "var(--amber-soft)" };
  if (call.status === "completed") {
    if (call.recommendation === "advance") return { label: "Advance", color: "var(--accent)", bg: "var(--accent-soft)" };
    if (call.recommendation === "reject") return { label: "Reject", color: "var(--rust)", bg: "var(--rust-soft)" };
    if (call.recommendation === "hold") return { label: "Hold", color: "var(--amber)", bg: "var(--amber-soft)" };
    return { label: "Completed", color: "var(--muted)", bg: "var(--border-soft)" };
  }
  return { label: call.status, color: "var(--faint)", bg: "var(--border-soft)" };
}

export default function Calls() {
  const [calls, setCalls] = useState([]);
  const [error, setError] = useState("");

  const refresh = async () => {
    try {
      const { calls } = await api.listCalls();
      setCalls(calls);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    const anyActive = calls.some((c) => c.status === "dialing" || c.status === "in-progress");
    if (!anyActive) return;
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [calls]);

  const sorted = [...calls].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "24px 24px 80px" }}>
      {error && <div style={{ fontSize: 13, color: "var(--rust)", marginBottom: 16 }}>{error}</div>}

      {sorted.length === 0 ? (
        <div style={{ fontSize: 14, color: "var(--faint)", textAlign: "center", padding: "60px 0" }}>
          No calls triggered yet. Go back to Rank &amp; select and hit "Call selected candidates".
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sorted.map((call) => {
            const badge = statusBadge(call);
            const name = call.candidate?.name || "Unknown candidate";
            return (
              <div key={call.id} style={cardStyle}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 500 }}>{name}</div>
                    <div style={{ fontSize: 12.5, color: "var(--faint)" }}>{call.candidate?.phone}</div>
                  </div>
                  {call.interviewScore != null && (
                    <div className="serif" style={{ fontSize: 18, fontWeight: 600, color: badge.color }}>
                      {call.interviewScore}
                    </div>
                  )}
                  <span style={{ fontSize: 12, fontWeight: 500, color: badge.color, background: badge.bg, borderRadius: "var(--radius-pill)", padding: "4px 10px", whiteSpace: "nowrap" }}>
                    {badge.label}
                  </span>
                </div>
                {call.summary && (
                  <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 10, lineHeight: 1.6 }}>{call.summary}</div>
                )}
                {call.recordingUrl && (
                  <div style={{ marginTop: 10 }}>
                    <audio controls src={call.recordingUrl} style={{ width: "100%", height: 32 }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
