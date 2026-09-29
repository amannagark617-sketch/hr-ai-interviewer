import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { parseCsv, rowsToObjects } from "../csv.js";
import { IconChat, IconRefresh, IconSearch, IconTicket } from "../icons.jsx";

// The chatbot logs a new row every turn, each carrying the WHOLE transcript so far (see the
// column layout below) rather than one row per message — so the sheet is full of duplicates,
// one growing copy per Session ID. The row with the latest "Date & Time" for a given session is
// the only one worth keeping; every earlier row for that same session is a strict prefix of it.
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
function parseSheetDateTime(value) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/.exec((value || "").trim());
  if (!m) return null;
  const month = MONTHS[m[2]];
  if (month == null) return null;
  return new Date(Number(m[3]), month, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6])).getTime();
}

// Collapses the raw rows down to one (the latest) per Session ID. Ties or an unparseable date
// fall back to "last one in sheet order wins" — rows are appended in chronological order by the
// chatbot itself, so that's equivalent to the real latest turn anyway.
function latestPerSession(rows) {
  const bySession = new Map();
  for (const row of rows) {
    const id = row["Session ID"];
    if (!id) continue;
    const ts = parseSheetDateTime(row["Date & Time"]);
    const existing = bySession.get(id);
    if (!existing || ts == null || ts >= existing.ts) {
      bySession.set(id, { ts: ts ?? existing?.ts ?? 0, row });
    }
  }
  return Array.from(bySession.values())
    .sort((a, b) => b.ts - a.ts)
    .map(({ row, ts }) => ({ ...row, __ts: ts }));
}

// The transcript is a flat "[USER]: ...\n\n[AGENT]: ...\n\n[USER]: ..." string. Turns are always
// separated by a blank line directly before the next "[USER]:"/"[AGENT]:" marker — a paragraph
// break INSIDE one agent reply (the referral policy answer, for instance) is also a blank line,
// but never immediately followed by one of those two markers, so the lookahead keeps multi-
// paragraph replies intact as one message instead of splitting them apart.
function parseTranscript(text) {
  if (!text) return [];
  const normalized = text.replace(/\r\n/g, "\n");
  const blocks = normalized.split(/\n{2,}(?=\[(?:USER|AGENT)\]:)/);
  const messages = [];
  for (const block of blocks) {
    const m = /^\[(USER|AGENT)\]:\s*([\s\S]*)$/.exec(block.trim());
    if (!m) continue;
    let body = m[2].trim();
    let suggestions = [];
    const sm = /\[SUGGESTIONS:\s*([\s\S]*?)\]\s*$/.exec(body);
    if (sm) {
      suggestions = sm[1].split("|").map((s) => s.trim()).filter(Boolean);
      body = body.slice(0, sm.index).trim();
    }
    messages.push({ role: m[1], text: body, suggestions });
  }
  return messages;
}

const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/;
// A line that's nothing BUT a bare URL — the shape the bot drops an image link in as plain text
// (see the transcript examples). Deliberately not limited to a file-extension allowlist: plenty of
// real image hosts (Drive share links, most CDNs, picsum.photos in testing) serve images from
// extensionless URLs, so trying to recognize "looks like an image URL" up front is a losing game.
// AutoImage below just tries loading it and falls back to a plain link if it wasn't actually one.
const BARE_URL_ONLY_RE = /^(https?:\/\/\S+)$/;

// Tries the URL as an image; a real photo renders, anything else (a policy PDF link, say) quietly
// downgrades to a normal clickable link once the browser reports it couldn't load as an image —
// no need to guess from the URL shape alone which case a given link actually is.
function AutoImage({ src, alt }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <a href={src} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
        {src}
      </a>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      style={{ maxWidth: "100%", borderRadius: "var(--radius-md)", display: "block", margin: "6px 0" }}
    />
  );
}

// A line starting with "*   " (the agent's own export convention — see the Referral Policy
// example) or "- "/"* " is a bullet; its leading whitespace tells apart a top-level bullet from a
// nested one (the Incentives breakdown nests Category A/B one level under "Incentives:").
const BULLET_LINE_RE = /^(\s*)(?:\*\s{2,}|[-*]\s+)(.*)$/;

// Walks the message line by line rather than requiring a whole blank-line-separated paragraph to
// be uniformly bulleted — a reply routinely opens with a plain intro line ("Here is how it
// works:") directly followed by its bullet list with no blank line between them, which an
// all-or-nothing per-paragraph check would misclassify as an unformatted, run-on paragraph. Plain
// lines run together (as one wrapped paragraph); bullet lines close whatever paragraph was open
// and start (or continue) a list, splitting into a nested sub-list on a deeper-indented bullet.
function messageBlocks(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let currentP = null;
  let currentList = null;
  let lastTopItem = null;

  const flushP = () => {
    if (currentP) blocks.push({ type: "p", text: currentP.trim() });
    currentP = null;
  };
  const flushList = () => {
    if (currentList) blocks.push(currentList);
    currentList = null;
    lastTopItem = null;
  };

  for (const rawLine of lines) {
    if (rawLine.trim() === "") {
      flushP();
      flushList();
      continue;
    }
    const bm = BULLET_LINE_RE.exec(rawLine);
    if (bm) {
      flushP();
      const indent = bm[1].length;
      if (!currentList) currentList = { type: "ul", items: [] };
      if (indent >= 4 && lastTopItem) {
        lastTopItem.sub.push(bm[2]);
      } else {
        lastTopItem = { text: bm[2], sub: [] };
        currentList.items.push(lastTopItem);
      }
    } else {
      flushList();
      currentP = (currentP ? currentP + " " : "") + rawLine.trim();
    }
  }
  flushP();
  flushList();
  return blocks;
}

// Renders one agent/user message body as React nodes — bold runs, nested bullet lists, and
// inline images (either real markdown image syntax or a bare image URL the bot dropped into
// plain text) instead of a flat, unreadable wall of asterisks and raw links.
function formatMessageText(text) {
  return messageBlocks(text).map((block, bi) => {
    if (block.type === "ul") {
      return (
        <ul key={bi} style={{ margin: "4px 0", paddingLeft: 18 }}>
          {block.items.map((item, ii) => (
            <li key={ii} style={{ marginBottom: 2 }}>
              {formatInline(item.text)}
              {item.sub.length > 0 && (
                <ul style={{ margin: "2px 0", paddingLeft: 18 }}>
                  {item.sub.map((s, si) => (
                    <li key={si}>{formatInline(s)}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      );
    }
    const bareUrlMatch = BARE_URL_ONLY_RE.exec(block.text.trim());
    if (bareUrlMatch) {
      return <AutoImage key={bi} src={bareUrlMatch[1]} alt="HR activity photo" />;
    }
    return (
      <p key={bi} style={{ margin: bi === 0 ? "0 0 6px" : "6px 0" }}>
        {formatInline(block.text)}
      </p>
    );
  });
}

// Only real markdown image syntax gets an inline <AutoImage> here — a bare URL embedded mid-
// sentence ("see this link: https://...") reads as a reference, not a photo, so it becomes a
// plain clickable link instead; a bare URL that IS meant as a photo is virtually always dropped
// on its own line, which formatMessageText's paragraph check above already catches.
const INLINE_URL_RE = /(https?:\/\/\S+)/;
function formatInline(text) {
  const nodes = [];
  let rest = text;
  let key = 0;
  while (rest.length > 0) {
    const md = MARKDOWN_IMAGE_RE.exec(rest);
    const link = INLINE_URL_RE.exec(rest);
    const match = md && (!link || md.index <= link.index) ? { m: md, isMd: true } : link ? { m: link, isMd: false } : null;
    if (!match) {
      nodes.push(formatBold(rest, key++));
      break;
    }
    const before = rest.slice(0, match.m.index);
    if (before) nodes.push(formatBold(before, key++));
    if (match.isMd) {
      nodes.push(<AutoImage key={key++} src={match.m[2]} alt={match.m[1] || "HR activity photo"} />);
    } else {
      nodes.push(
        <a key={key++} href={match.m[1]} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
          {match.m[1]}
        </a>
      );
    }
    rest = rest.slice(match.m.index + match.m[0].length);
  }
  return nodes;
}

function formatBold(text, key) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <React.Fragment key={key}>
      {parts.map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p))}
    </React.Fragment>
  );
}

function sessionTitle(session) {
  const messages = parseTranscript(session["Full Transcript"]);
  const firstUser = messages.find((m) => m.role === "USER");
  return firstUser?.text || session["Query Summary"] || "(no message)";
}

const labelStyle = { display: "block", fontSize: 13, fontWeight: 500, color: "var(--muted)", marginBottom: 8 };

function NotConfiguredBanner({ tabName, envVar }) {
  return (
    <div
      className="fade-in"
      style={{
        background: "linear-gradient(135deg, var(--accent-soft), var(--surface) 65%)",
        border: "1px dashed var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: 22,
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>Connect the {tabName} sheet</div>
      <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.7 }}>
        In the chatbot's logging Google Sheet: <strong>File → Share → Publish to web</strong>, pick the{" "}
        <strong>"{tabName}"</strong> tab, choose <strong>CSV</strong> as the format, and publish. Copy the URL it
        gives you, then set it as <code>{envVar}</code> in the <strong>backend's</strong> environment variables and
        redeploy.
      </div>
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <div style={{ position: "relative", flex: 1, minWidth: 200, maxWidth: 340 }}>
      <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--faint)" }}>
        <IconSearch width={15} height={15} />
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%",
          fontSize: 13,
          padding: "8px 12px 8px 34px",
          borderRadius: "var(--radius-pill)",
          border: "1px solid var(--border)",
          background: "var(--surface)",
          color: "var(--ink)",
        }}
      />
    </div>
  );
}

function ChatHistoryPanel({ rows, error, notConfigured, loading, onRefresh }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  const sessions = useMemo(() => (rows ? latestPerSession(rows) : []), [rows]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        (s["Session ID"] || "").toLowerCase().includes(q) ||
        (s["Query Summary"] || "").toLowerCase().includes(q) ||
        (s["Full Transcript"] || "").toLowerCase().includes(q)
    );
  }, [sessions, query]);

  const selected = filtered.find((s) => s["Session ID"] === selectedId) || filtered[0] || null;
  const selectedMessages = selected ? parseTranscript(selected["Full Transcript"]) : [];

  if (notConfigured) return <NotConfiguredBanner tabName="Chat Histories" envVar="CHAT_HISTORY_CSV_URL" />;
  if (error) {
    return <div style={{ fontSize: 13, color: "var(--rust)", background: "var(--rust-soft)", borderRadius: "var(--radius-md)", padding: "10px 14px" }}>{error}</div>;
  }
  if (!rows) return <div style={{ fontSize: 13, color: "var(--faint)" }}>Loading conversations...</div>;

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <SearchBox value={query} onChange={setQuery} placeholder="Search conversations..." />
        <span style={{ fontSize: 13, color: "var(--faint)" }}>{sessions.length} conversation{sessions.length === 1 ? "" : "s"}</span>
        <button onClick={onRefresh} disabled={loading} style={refreshButtonStyle}>
          <IconRefresh className={loading ? "spin" : undefined} width={14} height={14} />
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div style={{ width: 320, flexShrink: 0, border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", background: "var(--surface)", maxHeight: 640, overflowY: "auto" }}>
          {filtered.length === 0 && <div style={{ padding: 18, fontSize: 13, color: "var(--faint)" }}>No conversations found.</div>}
          {filtered.map((s) => {
            const isActive = selected && s["Session ID"] === selected["Session ID"];
            return (
              <button
                key={s["Session ID"]}
                onClick={() => setSelectedId(s["Session ID"])}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "12px 14px",
                  border: "none",
                  borderBottom: "1px solid var(--border-soft)",
                  background: isActive ? "var(--accent-soft)" : "transparent",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {sessionTitle(s)}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--faint)", display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <span>{s["Date & Time"] || "—"}</span>
                  {s["Duration"] && <span>· {s["Duration"]}</span>}
                  {s["Chat Mode"] && <span>· {s["Chat Mode"]}</span>}
                </div>
              </button>
            );
          })}
        </div>

        <div style={{ flex: 1, minWidth: 0, border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", background: "var(--surface)", padding: 20, maxHeight: 640, overflowY: "auto" }}>
          {!selected && <div style={{ fontSize: 13, color: "var(--faint)" }}>Select a conversation to view it.</div>}
          {selected && (
            <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 4 }}>
                Session <code>{selected["Session ID"]}</code> · {selected["Date & Time"]}
              </div>
              {selectedMessages.map((m, i) => (
                <div key={i} style={{ display: "flex", justifyContent: m.role === "USER" ? "flex-end" : "flex-start" }}>
                  <div
                    style={{
                      maxWidth: "78%",
                      padding: "10px 14px",
                      borderRadius: "var(--radius-md)",
                      fontSize: 13.5,
                      lineHeight: 1.55,
                      background: m.role === "USER" ? "var(--accent)" : "var(--surface-raised)",
                      color: m.role === "USER" ? "#FFFFFF" : "var(--ink)",
                    }}
                  >
                    {formatMessageText(m.text)}
                    {m.suggestions.length > 0 && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                        {m.suggestions.map((sug, si) => (
                          <span
                            key={si}
                            style={{
                              fontSize: 11.5,
                              padding: "3px 10px",
                              borderRadius: "var(--radius-pill)",
                              background: "var(--surface)",
                              color: "var(--muted)",
                              border: "1px solid var(--border)",
                            }}
                          >
                            {sug}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {selectedMessages.length === 0 && <div style={{ fontSize: 13, color: "var(--faint)" }}>No transcript logged for this conversation.</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// A status-ish column ("Status", "Priority", ...) gets colored by matching its value against a
// small set of common words rather than needing to know the ticket sheet's exact vocabulary up
// front — genuinely unknown until HR's real sheet is connected, so this stays a best-effort
// heuristic instead of a hardcoded value list.
const STATUS_WORDS = {
  open: { color: "var(--rust)", bg: "var(--rust-soft)" },
  new: { color: "var(--rust)", bg: "var(--rust-soft)" },
  urgent: { color: "var(--rust)", bg: "var(--rust-soft)" },
  pending: { color: "var(--amber)", bg: "var(--amber-soft)" },
  progress: { color: "var(--amber)", bg: "var(--amber-soft)" },
  review: { color: "var(--amber)", bg: "var(--amber-soft)" },
  resolved: { color: "var(--success)", bg: "var(--success-soft)" },
  closed: { color: "var(--success)", bg: "var(--success-soft)" },
  done: { color: "var(--success)", bg: "var(--success-soft)" },
};
function statusColorsFor(value) {
  const v = (value || "").toLowerCase();
  for (const [word, colors] of Object.entries(STATUS_WORDS)) {
    if (v.includes(word)) return colors;
  }
  return { color: "var(--muted)", bg: "var(--surface-raised)" };
}

function TicketsPanel({ rows, error, notConfigured, loading, onRefresh }) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(null);

  const columns = rows && rows.length > 0 ? Object.keys(rows[0]) : [];
  const statusColumn = columns.find((c) => /status|priority/i.test(c));

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => Object.values(r).some((v) => (v || "").toLowerCase().includes(q)));
  }, [rows, query]);

  if (notConfigured) return <NotConfiguredBanner tabName="HR_Tickets" envVar="HR_TICKETS_CSV_URL" />;
  if (error) {
    return <div style={{ fontSize: 13, color: "var(--rust)", background: "var(--rust-soft)", borderRadius: "var(--radius-md)", padding: "10px 14px" }}>{error}</div>;
  }
  if (!rows) return <div style={{ fontSize: 13, color: "var(--faint)" }}>Loading tickets...</div>;

  // Keep the table to a handful of the most useful columns; the rest still shows in the expanded
  // detail row — a real ticket sheet can easily have a dozen+ columns, more than fit as a table.
  const previewColumns = columns.slice(0, 5);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <SearchBox value={query} onChange={setQuery} placeholder="Search tickets..." />
        <span style={{ fontSize: 13, color: "var(--faint)" }}>{filtered.length} of {rows.length} ticket{rows.length === 1 ? "" : "s"}</span>
        <button onClick={onRefresh} disabled={loading} style={refreshButtonStyle}>
          <IconRefresh className={loading ? "spin" : undefined} width={14} height={14} />
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", background: "var(--surface)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {previewColumns.map((c) => (
                <th key={c} style={{ textAlign: "left", padding: "10px 12px", color: "var(--faint)", fontWeight: 500, whiteSpace: "nowrap" }}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => {
              const isOpen = expanded === i;
              return (
                <React.Fragment key={i}>
                  <tr
                    onClick={() => setExpanded(isOpen ? null : i)}
                    style={{ borderBottom: isOpen ? "none" : "1px solid var(--border-soft)", cursor: "pointer", background: isOpen ? "var(--surface-raised)" : "transparent" }}
                  >
                    {previewColumns.map((c) => (
                      <td key={c} style={{ padding: "10px 12px", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c === statusColumn && r[c] ? (
                          <span
                            style={{
                              display: "inline-block",
                              fontSize: 12,
                              fontWeight: 500,
                              padding: "3px 10px",
                              borderRadius: "var(--radius-pill)",
                              ...statusColorsFor(r[c]),
                            }}
                          >
                            {r[c]}
                          </span>
                        ) : (
                          r[c]
                        )}
                      </td>
                    ))}
                  </tr>
                  {isOpen && (
                    <tr style={{ borderBottom: "1px solid var(--border-soft)", background: "var(--surface-raised)" }}>
                      <td colSpan={previewColumns.length} style={{ padding: "4px 16px 20px" }}>
                        <div className="fade-in" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "10px 24px" }}>
                          {columns.map((c) => (
                            <div key={c}>
                              <div style={{ fontSize: 11.5, fontWeight: 500, color: "var(--muted)", marginBottom: 2 }}>{c}</div>
                              <div style={{ fontSize: 13, lineHeight: 1.5 }}>{r[c] || "—"}</div>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={previewColumns.length || 1} style={{ padding: "24px 12px", textAlign: "center", color: "var(--faint)" }}>
                  No tickets logged yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const refreshButtonStyle = {
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
  cursor: "pointer",
  marginLeft: "auto",
};

const tabPillStyle = (active) => ({
  display: "flex",
  alignItems: "center",
  gap: 6,
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

export default function AiAssistant() {
  const [tab, setTab] = useState("chats");

  const [chatRows, setChatRows] = useState(null);
  const [chatError, setChatError] = useState("");
  const [chatNotConfigured, setChatNotConfigured] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);

  const [ticketRows, setTicketRows] = useState(null);
  const [ticketError, setTicketError] = useState("");
  const [ticketNotConfigured, setTicketNotConfigured] = useState(false);
  const [ticketLoading, setTicketLoading] = useState(false);

  const loadChats = async () => {
    setChatLoading(true);
    setChatError("");
    setChatNotConfigured(false);
    try {
      const text = await api.getChatHistoryCsv();
      setChatRows(rowsToObjects(parseCsv(text)));
    } catch (e) {
      if (e.message.includes("CHAT_HISTORY_CSV_URL")) setChatNotConfigured(true);
      else setChatError(e.message);
    } finally {
      setChatLoading(false);
    }
  };

  const loadTickets = async () => {
    setTicketLoading(true);
    setTicketError("");
    setTicketNotConfigured(false);
    try {
      const text = await api.getHrTicketsCsv();
      setTicketRows(rowsToObjects(parseCsv(text)));
    } catch (e) {
      if (e.message.includes("HR_TICKETS_CSV_URL")) setTicketNotConfigured(true);
      else setTicketError(e.message);
    } finally {
      setTicketLoading(false);
    }
  };

  useEffect(() => {
    loadChats();
    loadTickets();
  }, []);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px 80px" }}>
      <div className="fade-in" style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em", marginBottom: 4 }}>AI Assistant</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>Conversations and tickets logged by the HR chatbot</div>
        <div style={{ display: "inline-flex", gap: 4, background: "var(--surface-raised)", borderRadius: "var(--radius-pill)", padding: 4 }}>
          <button style={tabPillStyle(tab === "chats")} onClick={() => setTab("chats")}>
            <IconChat width={15} height={15} /> Chat History
          </button>
          <button style={tabPillStyle(tab === "tickets")} onClick={() => setTab("tickets")}>
            <IconTicket width={15} height={15} /> Tickets
          </button>
        </div>
      </div>

      {tab === "chats" ? (
        <ChatHistoryPanel rows={chatRows} error={chatError} notConfigured={chatNotConfigured} loading={chatLoading} onRefresh={loadChats} />
      ) : (
        <TicketsPanel rows={ticketRows} error={ticketError} notConfigured={ticketNotConfigured} loading={ticketLoading} onRefresh={loadTickets} />
      )}
    </div>
  );
}
