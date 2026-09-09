import React, { useEffect, useState, useCallback } from "react";
import { api } from "./api.js";
import Setup from "./pages/Setup.jsx";
import Results from "./pages/Results.jsx";
import Calls from "./pages/Calls.jsx";

const iconBtnStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 30,
  height: 30,
  background: "transparent",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  color: "var(--ink)",
  fontSize: 16,
};

const tabStyle = (active) => ({
  padding: "6px 14px",
  fontSize: 13.5,
  fontWeight: 500,
  borderRadius: 7,
  border: "none",
  cursor: "pointer",
  background: active ? "var(--accent-soft)" : "transparent",
  color: active ? "var(--accent)" : "var(--muted)",
});

export default function App() {
  const [step, setStep] = useState("setup"); // "setup" | "results" | "calls"
  const [jd, setJd] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [rankError, setRankError] = useState("");

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
      <header style={{ borderBottom: "1px solid var(--border)", padding: "20px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {step !== "setup" && (
            <button onClick={() => setStep("setup")} aria-label="Back to setup" style={iconBtnStyle}>
              ←
            </button>
          )}
          <div>
            <div className="serif" style={{ fontSize: 20, fontWeight: 600 }}>Candidate screening</div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Rank resumes against a role, then decide who to call.</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button style={tabStyle(step === "setup")} onClick={() => setStep("setup")}>Setup</button>
          <button style={tabStyle(step === "results")} onClick={() => setStep("results")} disabled={candidates.length === 0}>
            Rank &amp; select
          </button>
          <button style={tabStyle(step === "calls")} onClick={() => setStep("calls")}>Calls</button>
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
    </div>
  );
}
