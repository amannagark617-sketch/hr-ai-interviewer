import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { IconDocument, IconGrid, IconPhoneCall, IconTrendUp, IconUpload, IconUsers } from "../icons.jsx";

const CARDS = [
  { step: "setup", label: "Setup", desc: "Paste a job description and add candidates", icon: IconUsers, tint: "success" },
  { step: "results", label: "Rank & select", desc: "See AI-ranked candidates and choose who to call", icon: IconTrendUp, tint: "accent" },
  { step: "calls", label: "Calls", desc: "Trigger and track AI screening calls", icon: IconPhoneCall, tint: "call" },
  { step: "dashboard", label: "Dashboard", desc: "Review call results and scores", icon: IconGrid, tint: "amber" },
  { step: "documents", label: "Documents", desc: "Generate offer, appointment and experience letters", icon: IconDocument, tint: "rust" },
];

export default function Home({ candidates, onNavigate }) {
  const [bannerImage, setBannerImage] = useState(null);
  const [loadingBanner, setLoadingBanner] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  useEffect(() => {
    api
      .getBranding()
      .then((r) => setBannerImage(r.bannerImage))
      .catch(() => {})
      .finally(() => setLoadingBanner(false));
  }, []);

  const onPickFile = () => fileInputRef.current?.click();

  const onFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const { bannerImage: uploaded } = await api.uploadBanner(file);
      setBannerImage(uploaded);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px 80px" }}>
      <input ref={fileInputRef} type="file" accept="image/*" onChange={onFileChange} style={{ display: "none" }} />

      <div
        className="fade-in"
        style={{
          position: "relative",
          borderRadius: "var(--radius-lg)",
          overflow: "hidden",
          minHeight: 260,
          marginBottom: 36,
          border: "1px solid var(--border-soft)",
          background: bannerImage
            ? `center / cover no-repeat url(${bannerImage})`
            : "var(--surface-raised)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {bannerImage ? (
          <>
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "linear-gradient(0deg, rgba(43,36,32,0.72) 0%, rgba(43,36,32,0.15) 55%, rgba(43,36,32,0) 100%)",
              }}
            />
            <div style={{ position: "relative", marginTop: "auto", padding: "28px 32px", width: "100%" }}>
              <div className="serif" style={{ fontSize: 30, fontWeight: 600, color: "#FFFFFF", marginBottom: 6 }}>
                Welcome back
              </div>
              <div style={{ fontSize: 14.5, color: "rgba(255,255,255,0.85)", maxWidth: 520 }}>
                Everything you need to hire, screen and onboard — in one place.
              </div>
              <button
                onClick={onPickFile}
                disabled={uploading}
                style={{
                  marginTop: 16,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "fit-content",
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  background: "rgba(255,255,255,0.92)",
                  color: "var(--ink)",
                  border: "none",
                  borderRadius: "var(--radius-pill)",
                  cursor: uploading ? "wait" : "pointer",
                }}
              >
                <IconUpload width={15} height={15} />
                {uploading ? "Uploading…" : "Change banner"}
              </button>
            </div>
          </>
        ) : (
          <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", flex: 1 }}>
            <div className="serif" style={{ fontSize: 30, fontWeight: 600, color: "var(--ink)", marginBottom: 6 }}>
              Welcome back
            </div>
            <div style={{ fontSize: 14.5, color: "var(--muted)", maxWidth: 520, marginBottom: 20 }}>
              Everything you need to hire, screen and onboard — in one place.
            </div>
            {!loadingBanner && (
              <button
                onClick={onPickFile}
                disabled={uploading}
                style={{
                  flex: 1,
                  minHeight: 120,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  background: "transparent",
                  border: "2px dashed var(--border)",
                  borderRadius: "var(--radius-md)",
                  color: "var(--muted)",
                  cursor: uploading ? "wait" : "pointer",
                }}
              >
                <span className="icon-badge" style={{ width: 40, height: 40, background: "var(--accent-soft)", color: "var(--accent)" }}>
                  <IconUpload width={20} height={20} />
                </span>
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>
                  {uploading ? "Uploading…" : "Add a banner image"}
                </span>
                <span style={{ fontSize: 12.5 }}>Make this page yours — a team photo, office shot, or your own banner</span>
              </button>
            )}
          </div>
        )}
      </div>

      {error && (
        <div style={{ marginBottom: 20, fontSize: 13, color: "var(--rust)" }}>{error}</div>
      )}

      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 14 }}>
        Quick access
      </div>
      <div className="fade-in-group" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
        {CARDS.map(({ step, label, desc, icon: Icon, tint }) => {
          const disabled = step === "results" && candidates.length === 0;
          return (
            <button
              key={step}
              onClick={() => !disabled && onNavigate(step)}
              disabled={disabled}
              className="lift-on-hover"
              style={{
                textAlign: "left",
                display: "flex",
                flexDirection: "column",
                gap: 12,
                padding: 20,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-lg)",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.5 : 1,
              }}
            >
              <span className="icon-badge" style={{ background: `var(--${tint}-soft)`, color: `var(--${tint})` }}>
                <Icon />
              </span>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.4 }}>{desc}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
