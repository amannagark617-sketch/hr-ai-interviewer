import express from "express";
import cors from "cors";
import http from "node:http";
import { config } from "./config.js";
import { candidatesRouter } from "./routes/candidates.js";
import { rolesRouter } from "./routes/roles.js";
import { rankingRouter } from "./routes/ranking.js";
import { callsRouter } from "./routes/calls.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { documentsRouter } from "./routes/documents.js";
import { attachCallBridge } from "./ws/callBridge.js";
import { startCallbackScheduler, checkDueCallbacksSoon } from "./services/callbackScheduler.js";
import { closeBrowser } from "./services/docxToPdf.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true })); // Plivo posts webhook bodies as form-encoded

// On a platform like Cloud Run that freezes the event loop between requests (see the big
// comment in callbackScheduler.js), the scheduler's own setInterval can't be trusted to fire
// exactly on time — it only really runs while something is keeping the container awake. Piggy-
// backing a check on every request means a due callback gets caught the moment anything wakes
// the container, not just once every 60s of actual CPU time.
app.use((req, res, next) => {
  checkDueCallbacksSoon();
  next();
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/candidates", candidatesRouter);
app.use("/api/roles", rolesRouter);
app.use("/api/rank", rankingRouter);
app.use("/api/calls", callsRouter);
app.use("/api/webhooks", webhooksRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/documents", documentsRouter);

const server = http.createServer(app);
attachCallBridge(server);
startCallbackScheduler();

// The Chromium instance docxToPdf.js keeps alive for document generation (see its own comment
// for why) is a real child process — let it go cleanly on shutdown/redeploy instead of leaking a
// zombie process in the container.
process.on("SIGTERM", () => closeBrowser().finally(() => process.exit(0)));

server.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
  if (!config.gemini.apiKey) {
    console.warn("GEMINI_API_KEY is not set — resume ranking and interview calls won't work yet. See README.");
  }
  if (!config.publicBaseUrl) {
    console.warn("PUBLIC_BASE_URL is not set — Plivo webhooks and the audio stream won't be reachable. See README.");
  }
  if (!config.plivo.authId || !config.plivo.authToken || !config.plivo.fromNumber) {
    console.warn("Plivo credentials are not fully set — candidate calls won't work yet. See README.");
  }
  if (!config.appsScript.webAppUrl) {
    console.warn(
      "[startup] APPS_SCRIPT_WEB_APP_URL is not set — requested callbacks only survive as long as " +
        "this container instance stays alive. On Cloud Run's default (scale-to-zero) settings, a " +
        "restart between now and when a callback is due will lose it. Set APPS_SCRIPT_WEB_APP_URL " +
        "(see docs/apps-script/Code.gs) so callbacks are parked in the Sheet and recovered after a " +
        "restart — no need to pay for an always-on instance just for this. See the comment at the " +
        "top of services/callbackScheduler.js."
    );
  }
  console.warn(
    "[startup] Note: candidates, roles, and calls still live only in memory (store.js) and are lost " +
      "on any restart — only requested callbacks are now recovered from Sheets. If Cloud Run scales " +
      "this to zero mid-hiring-round, HR will need to re-upload the JD/resumes for that round."
  );
  console.warn(
    "[startup] The Documents tab renders PDFs with a headless Chromium (Puppeteer) kept running " +
      "in the background — give this Cloud Run service at least 1GiB memory (Edit & deploy new " +
      "revision -> Container -> Memory), or PDF generation can fail/OOM on a smaller instance " +
      "alongside everything else this app already does."
  );
});
