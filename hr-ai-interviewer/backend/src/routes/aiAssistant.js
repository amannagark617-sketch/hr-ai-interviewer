import { Router } from "express";
import { config } from "../config.js";

export const aiAssistantRouter = Router();

// Same proxy-fetch reasoning as routes/dashboard.js's /sheet-csv: fetched server-side so the
// browser never has to hit Google's published-CSV URL directly (which can fail CORS with no
// useful error even though the URL works fine on its own).
async function proxyCsv(req, res, url, envVarName) {
  if (!url) {
    return res.status(400).json({ error: `${envVarName} is not set. See the AI Assistant tab for setup steps.` });
  }
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return res.status(502).json({ error: `Sheet fetch failed: ${response.status}. Check the sheet is still published to the web.` });
    }
    const text = await response.text();
    res.type("text/csv").send(text);
  } catch (err) {
    console.error("[ai-assistant] Failed to fetch published sheet:", err);
    res.status(502).json({ error: `Failed to fetch the sheet: ${err.message}` });
  }
}

aiAssistantRouter.get("/tickets-csv", (req, res) =>
  proxyCsv(req, res, config.aiAssistant.hrTicketsCsvUrl, "HR_TICKETS_CSV_URL")
);

aiAssistantRouter.get("/chat-history-csv", (req, res) =>
  proxyCsv(req, res, config.aiAssistant.chatHistoryCsvUrl, "CHAT_HISTORY_CSV_URL")
);
