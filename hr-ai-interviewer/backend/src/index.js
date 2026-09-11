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
import { attachCallBridge } from "./ws/callBridge.js";
import { startCallbackScheduler, checkDueCallbacksSoon } from "./services/callbackScheduler.js";

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

const server = http.createServer(app);
attachCallBridge(server);
startCallbackScheduler();

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
  console.warn(
    "[startup] If this is running on Cloud Run: set 'Minimum number of instances' to at least 1 " +
      "and turn on 'CPU is always allocated' for this service. Without both, requested callbacks " +
      "(and all other in-memory state) can silently be lost whenever the container idles out " +
      "between requests — see the comment at the top of services/callbackScheduler.js."
  );
});
