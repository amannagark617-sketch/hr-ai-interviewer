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
  border: "1px solid #D8D2C2",
  borderRadius: "var(--radius-pill)",
  cursor: "pointer",
};
const sampleBtnStyle = {
  display: "inline-flex",
  alignItems: "center",
  padding: "10px 20px",
  fontSize: 14,
  fontWeight: 500,
  background: "var(--accent)",
  color: "var(--bg)",
  border: "none",
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

const SAMPLE_JD = `Senior Full-Stack Engineer

We're looking for a Senior Full-Stack Engineer to join our product team. You'll own features end-to-end across a React/TypeScript frontend and a Node.js backend, mentor junior engineers, and help shape our technical roadmap.

Responsibilities:
- Design, build, and ship full-stack features from database to UI
- Review code and mentor other engineers on the team
- Collaborate with product and design to scope and estimate work
- Improve system performance, reliability, and test coverage

Required skills:
- 5+ years of professional software engineering experience
- Strong proficiency in JavaScript/TypeScript, React, and Node.js
- Experience designing REST or GraphQL APIs and relational databases (PostgreSQL/MySQL)
- Comfortable with cloud infrastructure (AWS or GCP) and CI/CD pipelines

Nice to have:
- Experience with real-time systems (WebSockets, streaming)
- Prior experience mentoring or leading a small team`;

const SAMPLE_CANDIDATES = [
  {
    name: "Priya Sharma",
    phone: "+91 98765 43210",
    resumeText:
      "Priya Sharma — Senior Software Engineer, 7 years experience. Led full-stack development of a React/Node.js SaaS platform serving 200k+ users. Designed REST APIs, PostgreSQL schemas, and AWS deployment pipelines. Mentored 3 junior engineers. Previously built real-time collaboration features using WebSockets. B.Tech in Computer Science, IIT Delhi.",
  },
  {
    name: "Marcus Chen",
    phone: "+91 91234 56789",
    resumeText:
      "Marcus Chen — Full-Stack Developer, 3 years experience. Built and maintained React frontends and Express APIs for an e-commerce startup. Comfortable with TypeScript and MySQL, some exposure to AWS via Elastic Beanstalk. Has not led a team or worked on large-scale systems yet. B.S. in Information Technology.",
  },
  {
    name: "Ananya Iyer",
    phone: "+91 99887 66554",
    resumeText:
      "Ananya Iyer — Staff Engineer, 9 years experience. Architected microservices in Node.js and TypeScript, GraphQL APIs, and CI/CD pipelines on GCP. Led a team of 5 engineers, drove adoption of automated testing across the org. Deep experience with distributed systems and streaming data pipelines. M.S. in Computer Science, Stanford.",
  },
];

export default function Setup({ jd, setJd, candidates, refreshCandidates, onRank }) {
  const [nameField, setNameField] = useState("");
  const [phoneField, setPhoneField] = useState("");
  const [resumeField, setResumeField] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [jdUploading, setJdUploading] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);
  const [showJdGenerator, setShowJdGenerator] = useState(false);
  const [jdNotes, setJdNotes] = useState("");
  const [jdGenerating, setJdGenerating] = useState(false);
  const [editingPhoneId, setEditingPhoneId] = useState(null);
  const [phoneEditValue, setPhoneEditValue] = useState("");
  const fileInputRef = useRef(null);
  const jdFileInputRef = useRef(null);

  const loadSampleData = async () => {
    setError("");
    setLoadingSample(true);
    try {
      await saveJd(SAMPLE_JD);
      for (const c of SAMPLE_CANDIDATES) {
        await api.addCandidate(c.name, c.resumeText, c.phone);
      }
      refreshCandidates();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingSample(false);
    }
  };

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
      {!jd.trim() && candidates.length === 0 && (
        <section
          style={{
            marginBottom: 32,
            padding: 20,
            border: "1px dashed var(--border)",
            borderRadius: "var(--radius-lg)",
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
            🚀 Quick Start: Try with Sample Data
          </div>
          <div style={{ fontSize: 13.5, color: "var(--muted)", marginBottom: 14 }}>
            Populate a Senior Full-Stack role with 3 diverse resumes to see Gemini AI screening in action.
          </div>
          <button onClick={loadSampleData} disabled={loadingSample} style={sampleBtnStyle}>
            {loadingSample ? "Loading..." : "⚡ Load Sample Role & Candidates"}
          </button>
        </section>
      )}

      <section style={{ marginBottom: 32 }}>
        <label style={labelStyle}>Job description</label>
        <textarea
          value={jd}
          onChange={(e) => saveJd(e.target.value)}
          placeholder="Paste the full job description — responsibilities, required skills, seniority level..."
          style={{ ...inputStyle, minHeight: 140, resize: "vertical", marginBottom: 10 }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
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
          <span style={{ fontSize: 13, color: "var(--faint)" }}>or</span>
          <button onClick={() => setShowJdGenerator((v) => !v)} style={secondaryBtnStyle}>
            ✨ Generate with AI
          </button>
        </div>

        {showJdGenerator && (
          <div style={{ marginTop: 12, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 16 }}>
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

      <section style={{ marginBottom: 24 }}>
        <label style={labelStyle}>Add a candidate</label>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 16 }}>
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
                  gap: 12,
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  padding: "10px 14px",
                }}
              >
                <div style={{ fontSize: 14, flex: 1, minWidth: 0 }}>{c.name}</div>
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

      <button onClick={onRank} disabled={!canRank} style={primaryBtnStyle}>
        Rank {candidates.length || ""} candidate{candidates.length !== 1 ? "s" : ""} against this role
      </button>
    </div>
  );
}
