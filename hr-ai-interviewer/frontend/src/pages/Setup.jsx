import React, { useRef, useState } from "react";
import { api } from "../api.js";

const labelStyle = { display: "block", fontSize: 13, fontWeight: 500, color: "var(--muted)", marginBottom: 8 };
const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
  fontSize: 14,
  padding: "10px 12px",
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--surface)",
  color: "var(--ink)",
};
const primaryBtnStyle = {
  width: "100%",
  padding: "13px 20px",
  fontSize: 15,
  fontWeight: 500,
  background: "var(--accent)",
  color: "var(--bg)",
  border: "none",
  borderRadius: 9,
  cursor: "pointer",
};
const secondaryBtnStyle = {
  display: "flex",
  alignItems: "center",
  padding: "8px 14px",
  fontSize: 13.5,
  fontWeight: 500,
  background: "var(--surface)",
  color: "var(--ink)",
  border: "1px solid #D8D2C2",
  borderRadius: 7,
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
  borderRadius: 6,
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
  const fileInputRef = useRef(null);
  const jdFileInputRef = useRef(null);

  const saveJd = async (value) => {
    setJd(value);
    try {
      await api.setJobDescription(value);
    } catch (e) {
      setError(e.message);
    }
  };

  const handleJdFile = async (file) => {
    if (!file) return;
    setError("");
    setJdUploading(true);
    try {
      const { jobDescription } = await api.uploadJobDescription(file);
      setJd(jobDescription);
    } catch (e) {
      setError(e.message);
    } finally {
      setJdUploading(false);
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

  const canRank = jd.trim().length > 0 && candidates.length > 0;

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "32px 24px 80px" }}>
      <section style={{ marginBottom: 32 }}>
        <label style={labelStyle}>Job description</label>
        <textarea
          value={jd}
          onChange={(e) => saveJd(e.target.value)}
          placeholder="Paste the full job description — responsibilities, required skills, seniority level..."
          style={{ ...inputStyle, minHeight: 140, resize: "vertical", marginBottom: 10 }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => jdFileInputRef.current?.click()} disabled={jdUploading} style={secondaryBtnStyle}>
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
        </div>
      </section>

      <section style={{ marginBottom: 24 }}>
        <label style={labelStyle}>Add a candidate</label>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
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
        <div style={{ fontSize: 13, color: "var(--rust)", marginBottom: 20 }}>{error}</div>
      )}

      {candidates.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <label style={labelStyle}>
            {candidates.length} candidate{candidates.length !== 1 ? "s" : ""} added
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {candidates.map((c) => (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "10px 14px",
                }}
              >
                <div style={{ fontSize: 14 }}>
                  {c.name}
                  {!c.phone && <span style={{ color: "var(--faint)", fontSize: 12 }}> — no phone number yet</span>}
                </div>
                <button onClick={() => removeCandidate(c.id)} aria-label={`Remove ${c.name}`} style={iconBtnStyle}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <button onClick={onRank} disabled={!canRank} style={primaryBtnStyle}>
        Rank {candidates.length || ""} candidate{candidates.length !== 1 ? "s" : ""} against this role
      </button>
    </div>
  );
}
