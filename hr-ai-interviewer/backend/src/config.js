import "dotenv/config";

// Every env var is read as a literal `process.env.NAME` expression (not through a helper
// that takes the name as a string) on purpose — hosting tools that auto-detect required
// secrets (Google AI Studio's deploy flow included) do it by scanning source code for that
// exact literal pattern. Hiding the name behind a variable makes those secrets invisible to
// the scanner, so resist the urge to "clean this up" into a loop or helper function.
export const config = {
  port: Number(process.env.PORT || 8080),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "",

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || "",
    // Google retires/renames Gemini model IDs fairly often. Overridable so a model swap is an
    // env var change (redeploy, no code edit) instead of a full fix-and-push cycle.
    textModel: process.env.GEMINI_TEXT_MODEL || "gemini-3.6-flash",
    // Same deal for the Live API (phone call) model — separate lineage/rotation schedule from
    // the text model above, so it gets its own override.
    liveModel: process.env.GEMINI_LIVE_MODEL || "models/gemini-3.1-flash-live-preview",
    // Live API voice — see docs/apps-script or README for the list of available prebuilt voices.
    voiceName: process.env.GEMINI_VOICE_NAME || "Aoede",
    // BCP-47 language code for the Live API's spoken output — this is what actually controls
    // accent/pronunciation (the prebuilt voice above only picks the voice's timbre). Defaults to
    // Indian English since candidates and phone numbers here are India-focused; the voice was
    // defaulting to a US/UK-sounding accent with this unset.
    voiceLanguage: process.env.GEMINI_VOICE_LANGUAGE || "en-IN",
  },

  plivo: {
    authId: process.env.PLIVO_AUTH_ID || "",
    authToken: process.env.PLIVO_AUTH_TOKEN || "",
    fromNumber: process.env.PLIVO_FROM_NUMBER || "",
  },

  appsScript: {
    webAppUrl: process.env.APPS_SCRIPT_WEB_APP_URL || "",
    secret: process.env.APPS_SCRIPT_SECRET || "",
  },

  // The published-CSV URL from Sheet -> File -> Share -> Publish to web -> CSV. Fetched
  // server-side (see routes/dashboard.js) rather than directly from the browser — Google's CSV
  // export doesn't reliably send CORS headers permitting a cross-origin fetch from the app's own
  // domain, so a direct browser fetch can fail even though the URL itself works fine.
  sheetCsvUrl: process.env.SHEET_CSV_URL || "",
};

export function assertConfigured(keys) {
  const missing = keys.filter((k) => {
    const parts = k.split(".");
    let v = config;
    for (const p of parts) v = v?.[p];
    return !v;
  });
  if (missing.length) {
    throw new Error(`Missing required config: ${missing.join(", ")}. Check backend/.env`);
  }
}
