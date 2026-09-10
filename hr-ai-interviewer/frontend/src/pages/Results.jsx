import React, { useState } from "react";
import { api } from "../api.js";

function tierFor(score) {
  if (score >= 75) return { label: "Strong fit", color: "var(--success)", bg: "var(--success-soft)" };
  if (score >= 50) return { label: "Possible fit", color: "var(--amber)", bg: "var(--amber-soft)" };
  return { label: "Weak fit", color: "var(--rust)", bg: "var(--rust-soft)" };
}

export default function Results({ candidates, refreshCandidates, onCallsTriggered }) {
  const [expanded, setExpanded] = useState(null);
  const [triggering, setTriggering] = useState(false);
  const [callMessage, setCallMessage] = useState("");

  const sorted = [...candidates].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const selected = candidates.filter((c) => c.selected);
  const scored = candidates.filter((c) => c.status === "done");
  const tierCounts = { strong: 0, possible: 0, weak: 0 };
  scored.forEach((c) => {
    if (c.score >= 75) tierCounts.strong++;
    else if (c.score >= 50) tierCounts.possible++;
    else tierCounts.weak++;
  });

  const toggleSelect = async (c) => {
    await api.updateCandidate(c.id, { selected: !c.selected });
    refreshCandidates();
  };

  const triggerCalls = async () => {
    const missingPhone = selected.filter((c) => !c.phone);
    if (missingPhone.length) {
      setCallMessage(`Add a phone number for ${missingPhone.map((c) => c.name).join(", ")} before calling.`);
      return;
    }
    setTriggering(true);
    setCallMessage("");
    try {
      const { outcomes } = await api.triggerCalls(selected.map((c) => c.id));
      const failed = outcomes.filter((o) => !o.ok);
      setCallMessage(
        failed.length
          ? `${outcomes.length - failed.length} call(s) started. Failed: ${failed.map((f) => f.error).join(", ")}`
          : `${outcomes.length} call(s) started — see the Calls tab for live status.`
      );
      if (outcomes.some((o) => o.ok)) onCallsTriggered?.();
    } catch (e) {
      setCallMessage(e.message);
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "24px 24px 120px" }}>
      {scored.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 18, padding: "12px 16px", background: "var(--surface-raised)", borderRadius: "var(--radius-lg)", fontSize: 13 }}>
          <span style={{ fontWeight: 500 }}>
            {scored.length} of {candidates.length} candidate{candidates.length !== 1 ? "s" : ""} ranked
          </span>
          <span style={{ color: "var(--success)" }}>{tierCounts.strong} strong fit</span>
          <span style={{ color: "var(--amber)" }}>{tierCounts.possible} possible fit</span>
          <span style={{ color: "var(--rust)" }}>{tierCounts.weak} weak fit</span>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {sorted.map((c) => {
          const tier = c.status === "done" ? tierFor(c.score) : null;
          const isOpen = expanded === c.id;
          return (
            <div key={c.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
              <div
                onClick={() => c.status === "done" && setExpanded(isOpen ? null : c.id)}
                style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", cursor: c.status === "done" ? "pointer" : "default" }}
              >
                <input
                  type="checkbox"
                  checked={!!c.selected}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleSelect(c)}
                  disabled={c.status !== "done"}
                  style={{ width: 17, height: 17, accentColor: "var(--accent)" }}
                />
                <div
                  className="serif"
                  style={{ width: 40, textAlign: "center", fontSize: 18, fontWeight: 600, color: tier ? tier.color : "var(--faint)" }}
                >
                  {c.status === "done" ? c.score : c.status === "error" ? "—" : ""}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>{c.name}</div>
                  {c.status === "scoring" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--faint)" }}>
                      <span className="spin" style={{ display: "inline-block" }}>↻</span>
                      Scoring against job description...
                    </div>
                  )}
                  {c.status === "error" && (
                    <div style={{ fontSize: 13, color: "var(--rust)" }}>
                      Couldn't score this one{c.errorMessage ? `: ${c.errorMessage}` : " — try ranking again."}
                    </div>
                  )}
                  {c.status === "done" && <div style={{ fontSize: 13, color: "var(--muted)" }}>{c.verdict}</div>}
                </div>
                {tier && (
                  <span style={{ fontSize: 12, fontWeight: 500, color: tier.color, background: tier.bg, borderRadius: "var(--radius-pill)", padding: "4px 10px", whiteSpace: "nowrap" }}>
                    {tier.label}
                  </span>
                )}
              </div>
              {isOpen && c.status === "done" && (
                <div style={{ padding: "0 16px 18px 70px", display: "flex", gap: 32, borderTop: "1px solid var(--border-soft)" }}>
                  <div style={{ flex: 1, paddingTop: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: "var(--success)", marginBottom: 6 }}>Pros</div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.7 }}>
                      {(c.pros || []).map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  </div>
                  <div style={{ flex: 1, paddingTop: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: "var(--rust)", marginBottom: 6 }}>Cons</div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.7 }}>
                      {(c.cons || []).map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ position: "sticky", bottom: 20, marginTop: 28, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        {callMessage && (
          <div style={{ fontSize: 13, color: "var(--muted)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-pill)", padding: "8px 14px", maxWidth: 500, textAlign: "center" }}>
            {callMessage}
          </div>
        )}
        <div style={{ background: "var(--ink)", color: "var(--bg)", borderRadius: "var(--radius-pill)", padding: "14px 22px", display: "flex", alignItems: "center", gap: 16, boxShadow: "0 8px 24px rgba(0,0,0,0.15)" }}>
          <span style={{ fontSize: 14 }}>{selected.length} selected for interview</span>
          <button
            onClick={triggerCalls}
            disabled={selected.length === 0 || triggering}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 14,
              fontWeight: 500,
              padding: "9px 18px",
              borderRadius: "var(--radius-pill)",
              border: "none",
              background: selected.length === 0 ? "#3A3A3C" : "var(--call)",
              color: selected.length === 0 ? "#8E8E93" : "var(--ink)",
              cursor: selected.length === 0 || triggering ? "not-allowed" : "pointer",
            }}
          >
            {triggering ? "Starting calls..." : "Call selected candidates"}
          </button>
        </div>
      </div>
    </div>
  );
}
