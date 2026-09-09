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
    // Live API voice — see docs/apps-script or README for the list of available prebuilt voices.
    voiceName: process.env.GEMINI_VOICE_NAME || "Aoede",
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
