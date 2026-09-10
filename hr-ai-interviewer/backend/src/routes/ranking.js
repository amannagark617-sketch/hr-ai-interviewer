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

  const activeRoleId = store.getActiveRoleId();
  const pending = store
    .listCandidates()
    .filter((c) => c.roleId === activeRoleId && (c.status === "pending" || c.status === "error"));
  if (pending.length === 0) return res.json({ scored: [] });

  pending.forEach((c) => store.updateCandidate(c.id, { status: "scoring" }));

  // Score a few at a time instead of firing every candidate at Gemini simultaneously — a burst
  // of parallel requests is what tips a shared model over into "high demand" 503s in the first
  // place, especially for a HR team ranking a whole batch of resumes at once.
  const CONCURRENCY = 3;
  const scored = [];
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const batch = pending.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((c) => scoreResume(jobDescription, c.resumeText, c.name))
    );
    batch.forEach((c, j) => {
      const r = results[j];
      if (r.status === "fulfilled") {
        scored.push(store.updateCandidate(c.id, { status: "done", errorMessage: null, ...r.value }));
        return;
      }
      // Gemini's SDK errors normally carry a useful .message (bad key, quota, blocked prompt,
      // overload), but log the whole thing server-side too in case a given failure doesn't.
      console.error(`[rank] scoreResume failed for candidate ${c.id} (${c.name}):`, r.reason);
      const reason = r.reason?.message || String(r.reason) || "Unknown error — check the backend logs";
      scored.push(store.updateCandidate(c.id, { status: "error", errorMessage: reason }));
    });
  }

  res.json({ scored });
});
