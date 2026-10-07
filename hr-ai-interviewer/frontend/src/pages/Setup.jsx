import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { IconDocument, IconHelpCircle, IconUpload, IconUsers, IconWand } from "../icons.jsx";

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
  padding: "9px 16px",
  fontSize: 13.5,
  fontWeight: 500,
  background: "var(--surface)",
  color: "var(--ink)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-pill)",
  cursor: "pointer",
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

export default function Setup({ jd, setJd, candidates, refreshCandidates, onRank }) {
  const [nameField, setNameField] = useState("");
  const [phoneField, setPhoneField] = useState("");
  const [resumeField, setResumeField] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [jdUploading, setJdUploading] = useState(false);
  const [showJdGenerator, setShowJdGenerator] = useState(false);
  const [jdNotes, setJdNotes] = useState("");
  const [jdGenerating, setJdGenerating] = useState(false);
  const [editingPhoneId, setEditingPhoneId] = useState(null);
  const [phoneEditValue, setPhoneEditValue] = useState("");
  const [customQuestions, setCustomQuestions] = useState("");
  const [customQuestionsUploading, setCustomQuestionsUploading] = useState(false);
  const fileInputRef = useRef(null);
  const jdFileInputRef = useRef(null);
  const customQuestionsFileInputRef = useRef(null);

  useEffect(() => {
    api.getCustomQuestions().then((r) => setCustomQuestions(r.customQuestions || "")).catch(() => {});
  }, []);

  const saveJd = async (value) => {
    setJd(value);
    try {
      await api.setJobDescription(value);
    } catch (e) {
      setError(e.message);
    }
  };

  const handleGenerateJd = async () => {
    if (!jdNotes.trim()) return;
    setError("");
    setJdGenerating(true);
    try {
      const { jobDescription } = await api.generateJobDescription(jdNotes.trim());
      setJd(jobDescription);
      setShowJdGenerator(false);
      setJdNotes("");
      refreshCandidates();
    } catch (e) {
      setError(e.message);
    } finally {
      setJdGenerating(false);
    }
  };

  const handleJdFile = async (file) => {
    if (!file) return;
    setError("");
    setJdUploading(true);
    try {
      const { jobDescription } = await api.uploadJobDescription(file);
      setJd(jobDescription);
      refreshCandidates();
    } catch (e) {
      setError(e.message);
    } finally {
      setJdUploading(false);
    }
  };

  const saveCustomQuestions = async (value) => {
    setCustomQuestions(value);
    try {
      await api.setCustomQuestions(value);
    } catch (e) {
      setError(e.message);
    }
  };

  const handleCustomQuestionsFile = async (file) => {
    if (!file) return;
    setError("");
    setCustomQuestionsUploading(true);
    try {
      const { customQuestions } = await api.uploadCustomQuestions(file);
      setCustomQuestions(customQuestions);
    } catch (e) {
      setError(e.message);
    } finally {
      setCustomQuestionsUploading(false);
    }
  };

  const addCandidate = async () => {
    if (!nameField.trim() || !resumeField.trim()) return;
    try {
      await api.addCandidate(nameField.trim(), resumeField.trim(), phoneField.trim());
      setNameField("");
      setPhoneField("");
      setResumeField("");
      refreshCandidates();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleFiles = async (files) => {
    setError("");
    try {
      const { results } = await api.uploadResumes(files);
      const failed = results.filter((r) => !r.ok);
      if (failed.length) {
        setError(failed.map((f) => `"${f.file}": ${f.error}`).join(" — "));
      }
      refreshCandidates();
    } catch (e) {
      setError(e.message);
    }
  };

  const removeCandidate = async (id) => {
    await api.removeCandidate(id);
    refreshCandidates();
  };

  const startEditingPhone = (c) => {
    setEditingPhoneId(c.id);
    setPhoneEditValue(c.phone || "");
  };

  const savePhone = async (id) => {
    try {
      await api.updateCandidate(id, { phone: phoneEditValue.trim() });
      refreshCandidates();
    } catch (e) {
      setError(e.message);
    } finally {
      setEditingPhoneId(null);
    }
  };

  const canRank = jd.trim().length > 0 && candidates.length > 0;

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
          Set up this hiring round
        </div>
        <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6 }}>
          Add a job description and candidates below — Gemini screens every resume against it automatically,
          and the round is named for you from the title on the job description.
        </div>
      </div>

      <section className="fade-in lift-on-hover" style={{ marginBottom: 24, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <span className="icon-badge" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
            <IconDocument />
          </span>
          <label style={{ ...labelStyle, marginBottom: 0 }}>Job description</label>
        </div>
        <textarea
          value={jd}
          onChange={(e) => saveJd(e.target.value)}
          onBlur={refreshCandidates}
          placeholder="Paste the full job description — responsibilities, required skills, seniority level..."
          style={{ ...inputStyle, minHeight: 140, resize: "vertical", marginBottom: 10 }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => jdFileInputRef.current?.click()} disabled={jdUploading} style={secondaryBtnStyle}>
            <IconUpload style={{ marginRight: 7 }} />
            {jdUploading ? "Reading file..." : "Upload job description (.pdf, .docx, .txt)"}
          </button>
          <input
            ref={jdFileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            style={{ display: "none" }}
            onChange={(e) => {
              handleJdFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <span style={{ fontSize: 13, color: "var(--faint)" }}>or</span>
          <button onClick={() => setShowJdGenerator((v) => !v)} style={secondaryBtnStyle}>
            <IconWand style={{ marginRight: 7 }} />
            Generate with AI
          </button>
        </div>

        {showJdGenerator && (
          <div className="fade-in" style={{ marginTop: 12, background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 16 }}>
            <label style={labelStyle}>Describe the role — title, seniority, tech stack, anything specific</label>
            <textarea
              value={jdNotes}
              onChange={(e) => setJdNotes(e.target.value)}
              placeholder="e.g. Senior backend engineer, 5+ years, Node.js and Postgres, remote-friendly, leads a small team..."
              style={{ ...inputStyle, minHeight: 80, resize: "vertical", marginBottom: 10 }}
            />
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={handleGenerateJd} disabled={!jdNotes.trim() || jdGenerating} style={secondaryBtnStyle}>
                {jdGenerating ? "Generating..." : "Generate job description"}
              </button>
              <button onClick={() => setShowJdGenerator(false)} style={{ ...secondaryBtnStyle, background: "transparent", border: "none" }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="fade-in lift-on-hover" style={{ marginBottom: 24, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <span className="icon-badge" style={{ background: "var(--amber-soft)", color: "var(--amber)" }}>
            <IconHelpCircle />
          </span>
          <label style={{ ...labelStyle, marginBottom: 0 }}>
            Custom interview questions <span style={{ fontWeight: 400, color: "var(--faint)" }}>(optional)</span>
          </label>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10, lineHeight: 1.6 }}>
          The AI always asks questions grounded in the job description and each candidate's resume. Add
          questions here — paste them or upload a file — and it will ask every one of them too, on every
          call for this role, and factor the answers into the interview score.
        </div>
        <textarea
          value={customQuestions}
          onChange={(e) => saveCustomQuestions(e.target.value)}
          placeholder={"e.g.\n1. Are you comfortable working rotational shifts?\n2. Why are you interested in the furniture/recliner industry specifically?"}
          style={{ ...inputStyle, minHeight: 90, resize: "vertical", marginBottom: 10 }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => customQuestionsFileInputRef.current?.click()} disabled={customQuestionsUploading} style={secondaryBtnStyle}>
            <IconUpload style={{ marginRight: 7 }} />
            {customQuestionsUploading ? "Reading file..." : "Upload questions (.pdf, .docx, .txt)"}
          </button>
          <input
            ref={customQuestionsFileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            style={{ display: "none" }}
            onChange={(e) => {
              handleCustomQuestionsFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {customQuestions.trim() && (
            <button onClick={() => saveCustomQuestions("")} style={{ ...secondaryBtnStyle, background: "transparent", border: "none", color: "var(--faint)" }}>
              Clear
            </button>
          )}
        </div>
      </section>

      <section className="fade-in lift-on-hover" style={{ marginBottom: 24, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <span className="icon-badge" style={{ background: "var(--success-soft)", color: "var(--success)" }}>
            <IconUsers />
          </span>
          <label style={{ ...labelStyle, marginBottom: 0 }}>Add a candidate</label>
        </div>
        <div>
          <input
            value={nameField}
            onChange={(e) => setNameField(e.target.value)}
            placeholder="Candidate name"
            style={{ ...inputStyle, marginBottom: 10 }}
          />
          <input
            value={phoneField}
            onChange={(e) => setPhoneField(e.target.value)}
            placeholder="Phone number (needed to call them later), e.g. +91XXXXXXXXXX"
            style={{ ...inputStyle, marginBottom: 10 }}
          />
          <textarea
            value={resumeField}
            onChange={(e) => setResumeField(e.target.value)}
            placeholder="Paste resume text here..."
            style={{ ...inputStyle, minHeight: 90, resize: "vertical", marginBottom: 10 }}
          />
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={addCandidate} disabled={!nameField.trim() || !resumeField.trim()} style={secondaryBtnStyle}>
              Add candidate
            </button>
            <span style={{ fontSize: 13, color: "var(--faint)" }}>or</span>
            <button onClick={() => fileInputRef.current?.click()} style={secondaryBtnStyle}>
              <IconUpload style={{ marginRight: 7 }} />
              Upload files (.pdf, .docx, .txt)
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.txt,.md"
              style={{ display: "none" }}
              onChange={(e) => {
                handleFiles(Array.from(e.target.files || []));
                e.target.value = "";
              }}
            />
          </div>
        </div>
      </section>

      {error && (
        <div
          className="fade-in"
          style={{
            fontSize: 13,
            color: "var(--rust)",
            background: "var(--rust-soft)",
            borderRadius: "var(--radius-md)",
            padding: "10px 14px",
            marginBottom: 20,
          }}
        >
          {error}
        </div>
      )}

      {candidates.length > 0 && (
        <section className="fade-in" style={{ marginBottom: 32 }}>
          <label style={labelStyle}>
            {candidates.length} candidate{candidates.length !== 1 ? "s" : ""} added
          </label>
          <div className="fade-in-group" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {candidates.map((c) => (
              <div
                key={c.id}
                className="lift-on-hover"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  padding: "10px 14px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
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
                    {(c.name || "?").trim().slice(0, 1).toUpperCase()}
                  </span>
                  <div style={{ fontSize: 14, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                </div>
                {editingPhoneId === c.id ? (
                  <input
                    autoFocus
                    value={phoneEditValue}
                    onChange={(e) => setPhoneEditValue(e.target.value)}
                    onBlur={() => savePhone(c.id)}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    placeholder="+91XXXXXXXXXX"
                    style={{ ...inputStyle, width: 170, padding: "6px 10px", fontSize: 13 }}
                  />
                ) : (
                  <button
                    onClick={() => startEditingPhone(c)}
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      fontSize: 13,
                      padding: "4px 6px",
                      borderRadius: "var(--radius-pill)",
                      color: c.phone ? "var(--muted)" : "var(--rust)",
                      whiteSpace: "nowrap",
                    }}
                    title="Click to edit phone number"
                  >
                    {c.phone || "no phone — click to add"}
                  </button>
                )}
                <button onClick={() => removeCandidate(c.id)} aria-label={`Remove ${c.name}`} style={iconBtnStyle}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <button
        onClick={onRank}
        disabled={!canRank}
        className={canRank ? "glow-ring" : undefined}
        style={{
          ...primaryBtnStyle,
          background: canRank ? "linear-gradient(135deg, var(--accent), var(--accent-hover))" : "var(--accent)",
          boxShadow: canRank ? "0 10px 26px rgba(0,113,227,0.28)" : "none",
        }}
      >
        Rank {candidates.length || ""} candidate{candidates.length !== 1 ? "s" : ""} against this role
      </button>
    </div>
  );
}
