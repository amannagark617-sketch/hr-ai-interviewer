import express from "express";
import cors from "cors";
import http from "node:http";
import { config } from "./config.js";
import { candidatesRouter } from "./routes/candidates.js";
import { rankingRouter } from "./routes/ranking.js";
import { callsRouter } from "./routes/calls.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { attachCallBridge } from "./ws/callBridge.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true })); // Plivo posts webhook bodies as form-encoded

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/candidates", candidatesRouter);
app.use("/api/rank", rankingRouter);
app.use("/api/calls", callsRouter);
app.use("/api/webhooks", webhooksRouter);

const server = http.createServer(app);
attachCallBridge(server);

server.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
  if (!config.publicBaseUrl) {
    console.warn("PUBLIC_BASE_URL is not set — Plivo webhooks and the audio stream won't be reachable. See README.");
  }
});
