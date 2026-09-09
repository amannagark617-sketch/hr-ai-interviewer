import { Router } from "express";
import { assertConfigured } from "../config.js";
import { store } from "../data/store.js";
import { scoreResume } from "../services/geminiService.js";

export const rankingRouter = Router();

// Scores every candidate currently in "pending" status against the stored job description.
rankingRouter.post("/", async (req, res) => {
  try {
    assertConfigured(["gemini.apiKey"]);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const jobDescription = store.getJobDescription();
  if (!jobDescription) return res.status(400).json({ error: "Set a job description first" });

  const pending = store.listCandidates().filter((c) => c.status === "pending" || c.status === "error");
  if (pending.length === 0) return res.json({ scored: [] });

  pending.forEach((c) => store.updateCandidate(c.id, { status: "scoring" }));

  const results = await Promise.allSettled(
    pending.map((c) => scoreResume(jobDescription, c.resumeText, c.name))
  );

  const scored = pending.map((c, i) => {
    const r = results[i];
    if (r.status === "fulfilled") {
      return store.updateCandidate(c.id, { status: "done", errorMessage: null, ...r.value });
    }
    // Gemini's SDK errors normally carry a useful .message (bad key, quota, blocked prompt),
    // but log the whole thing server-side too in case a given failure doesn't.
    console.error(`[rank] scoreResume failed for candidate ${c.id} (${c.name}):`, r.reason);
    const reason = r.reason?.message || String(r.reason) || "Unknown error — check the backend logs";
    return store.updateCandidate(c.id, { status: "error", errorMessage: reason });
  });

  res.json({ scored });
});
