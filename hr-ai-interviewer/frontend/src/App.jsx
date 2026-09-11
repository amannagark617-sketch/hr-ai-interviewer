import React, { useEffect, useState, useCallback } from "react";
import { api } from "./api.js";
import Setup from "./pages/Setup.jsx";
import Results from "./pages/Results.jsx";
import Calls from "./pages/Calls.jsx";
import Dashboard from "./pages/Dashboard.jsx";

const iconBtnStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 30,
  height: 30,
  background: "transparent",
  border: "none",
  borderRadius: "var(--radius-pill)",
  cursor: "pointer",
  color: "var(--ink)",
  fontSize: 16,
};

const tabStyle = (active) => ({
  padding: "7px 16px",
  fontSize: 13.5,
  fontWeight: 500,
  borderRadius: "var(--radius-pill)",
  border: "none",
  cursor: "pointer",
  background: active ? "var(--surface)" : "transparent",
  color: active ? "var(--accent)" : "var(--muted)",
  boxShadow: active ? "0 1px 3px rgba(33,31,28,0.08)" : "none",
});

export default function App() {
  const [step, setStep] = useState("setup"); // "setup" | "results" | "calls" | "dashboard"
  const [jd, setJd] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [rankError, setRankError] = useState("");

  // There's no role picker anymore — the backend tracks "hiring rounds" entirely on its own,
  // auto-naming and auto-splitting them from the job description text alone (see
  // store.setJobDescription). The frontend just always asks for "whatever's currently active."
  const refreshCandidates = useCallback(async () => {
    try {
      const { candidates } = await api.listCandidates();
      setCandidates(candidates);
    } catch {
      // backend not reachable yet — surfaced elsewhere
    }
  }, []);

  useEffect(() => {
    api.getJobDescription().then((r) => setJd(r.jobDescription || "")).catch(() => {});
    refreshCandidates();
  }, [refreshCandidates]);

  // Poll while anything is still being scored, so the results view updates live.
  useEffect(() => {
    if (step !== "results") return;
    const anyScoring = candidates.some((c) => c.status === "scoring");
    if (!anyScoring) return;
    const id = setInterval(refreshCandidates, 1500);
    return () => clearInterval(id);
  }, [step, candidates, refreshCandidates]);

  const onRank = async () => {
    setRankError("");
    setStep("results");
    try {
      await api.rankCandidates();
      refreshCandidates();
    } catch (e) {
      setRankError(e.message);
    }
  };

  return (
    <div style={{ minHeight: "100vh" }}>
      <header style={{ borderBottom: "1px solid var(--border)", padding: "18px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {step !== "setup" && (
            <button onClick={() => setStep("setup")} aria-label="Back to setup" style={iconBtnStyle}>
              ←
            </button>
          )}
          <img
            src="/logo.png"
            alt="Little Nap Recliners"
            width={34}
            height={34}
            style={{ borderRadius: "var(--radius-sm)", objectFit: "contain", flexShrink: 0 }}
          />
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em" }}>
              Little Nap Recliners
            </div>
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Smart Hiring Assistant</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--surface-raised)", borderRadius: "var(--radius-pill)", padding: 4 }}>
          <button style={tabStyle(step === "setup")} onClick={() => setStep("setup")}>Setup</button>
          <button style={tabStyle(step === "results")} onClick={() => setStep("results")} disabled={candidates.length === 0}>
            Rank &amp; select
          </button>
          <button style={tabStyle(step === "calls")} onClick={() => setStep("calls")}>Calls</button>
          <button style={tabStyle(step === "dashboard")} onClick={() => setStep("dashboard")}>Dashboard</button>
        </div>
      </header>

      {rankError && (
        <div style={{ maxWidth: 780, margin: "16px auto 0", padding: "0 24px", fontSize: 13, color: "var(--rust)" }}>
          {rankError}
        </div>
      )}

      {step === "setup" && (
        <Setup jd={jd} setJd={setJd} candidates={candidates} refreshCandidates={refreshCandidates} onRank={onRank} />
      )}
      {step === "results" && (
        <Results candidates={candidates} refreshCandidates={refreshCandidates} onCallsTriggered={() => setStep("calls")} />
      )}
      {step === "calls" && <Calls />}
      {step === "dashboard" && <Dashboard />}
    </div>
  );
}
