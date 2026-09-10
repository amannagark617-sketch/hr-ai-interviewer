import { Router } from "express";
import { config } from "../config.js";

export const dashboardRouter = Router();

// Proxies the published-CSV Sheet fetch server-side instead of letting the browser fetch it
// directly — Google's CSV export doesn't reliably send CORS headers for a cross-origin request
// from the app's own domain, so a direct browser fetch can fail with no useful error even
// though the URL works fine on its own.
dashboardRouter.get("/sheet-csv", async (req, res) => {
  if (!config.sheetCsvUrl) {
    return res.status(400).json({ error: "SHEET_CSV_URL is not set. See the Dashboard tab for setup steps." });
  }
  try {
    const response = await fetch(config.sheetCsvUrl, { cache: "no-store" });
    if (!response.ok) {
      return res.status(502).json({ error: `Sheet fetch failed: ${response.status}. Check the sheet is still published to the web.` });
    }
    const text = await response.text();
    res.type("text/csv").send(text);
  } catch (err) {
    console.error("[dashboard/sheet-csv] Failed to fetch published sheet:", err);
    res.status(502).json({ error: `Failed to fetch the sheet: ${err.message}` });
  }
});
