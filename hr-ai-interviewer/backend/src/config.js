import "dotenv/config";

function required(name, fallback = undefined) {
  const value = process.env[name] ?? fallback;
  return value;
}

export const config = {
  port: Number(process.env.PORT || 8080),
  publicBaseUrl: required("PUBLIC_BASE_URL", ""),

  gemini: {
    apiKey: required("GEMINI_API_KEY", ""),
  },

  plivo: {
    authId: required("PLIVO_AUTH_ID", ""),
    authToken: required("PLIVO_AUTH_TOKEN", ""),
    fromNumber: required("PLIVO_FROM_NUMBER", ""),
  },

  appsScript: {
    webAppUrl: required("APPS_SCRIPT_WEB_APP_URL", ""),
    secret: required("APPS_SCRIPT_SECRET", ""),
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
