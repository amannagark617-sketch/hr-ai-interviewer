import { Router } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { store } from "../data/store.js";
import { extractResumeText, extractCandidateDetails } from "../services/resumeParser.js";
import { generateJobDescription } from "../services/geminiService.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
export const candidatesRouter = Router();

// The candidate record keeps the original resume file (base64) server-side so Sheets logging can
// upload the exact file to Drive — but that's easily hundreds of KB per candidate, and the
// frontend polls GET / every 1.5s while candidates are scoring. Never let resumeFile reach the
// browser, or every poll re-downloads every resume file all over again.
function sanitizeCandidate(candidate) {
  const { resumeFile, ...rest } = candidate;
  return rest;
}

candidatesRouter.get("/job-description", (req, res) => {
  res.json({ jobDescription: store.getJobDescription() });
});

candidatesRouter.put("/job-description", (req, res) => {
  const { jobDescription } = req.body;
  if (typeof jobDescription !== "string" || !jobDescription.trim()) {
    return res.status(400).json({ error: "jobDescription is required" });
  }
  store.setJobDescription(jobDescription.trim());
  res.json({ ok: true });
});

// Generates a full job description from a role title + a few free-form notes, so HR doesn't
// have to write one from scratch for every role.
candidatesRouter.post("/job-description/generate", async (req, res) => {
  const { notes } = req.body;
  if (typeof notes !== "string" || !notes.trim()) {
    return res.status(400).json({ error: "notes is required — a role title and a few details" });
  }
  try {
    const jobDescription = await generateJobDescription(notes.trim());
    store.setJobDescription(jobDescription);
    res.json({ jobDescription });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Upload the job description as a file instead of pasting it (.pdf, .docx, .txt).
candidatesRouter.post("/job-description/upload", upload.single("jobDescription"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  try {
    const text = await extractResumeText(req.file.buffer, req.file.originalname);
    if (!text.trim()) return res.status(400).json({ error: "Couldn't find any text in that file" });
    store.setJobDescription(text.trim());
    res.json({ jobDescription: text.trim() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

candidatesRouter.get("/", (req, res) => {
  res.json({ candidates: store.listCandidates().map(sanitizeCandidate) });
});

// Add a candidate from pasted text (name + resume + optional phone).
candidatesRouter.post("/", (req, res) => {
  const { name, resumeText, phone } = req.body;
  if (!name?.trim() || !resumeText?.trim()) {
    return res.status(400).json({ error: "name and resumeText are required" });
  }
  const candidate = store.addCandidate({
    id: nanoid(),
    name: name.trim(),
    phone: phone?.trim() || "",
    resumeText: resumeText.trim(),
    status: "pending", // pending -> scored
    score: null,
    verdict: null,
    pros: [],
    cons: [],
    errorMessage: null,
    selected: false,
  });
  res.status(201).json({ candidate });
});

// Upload one or more resume files (.pdf, .docx, .txt).
candidatesRouter.post("/upload", upload.array("resumes", 50), async (req, res) => {
  const files = req.files || [];
  if (files.length === 0) return res.status(400).json({ error: "No files uploaded" });

  const results = [];
  for (const file of files) {
    try {
      const text = await extractResumeText(file.buffer, file.originalname);
      const details = extractCandidateDetails(text, file.originalname);
      const candidate = store.addCandidate({
        id: nanoid(),
        name: details.name,
        phone: details.phone,
        resumeText: text,
        // Keep the exact original file (not just its extracted text) so Sheets logging can save
        // the actual resume HR uploaded to Drive, instead of a plain-text reconstruction of it.
        resumeFile: { base64: file.buffer.toString("base64"), filename: file.originalname, mimeType: file.mimetype },
        status: "pending",
        score: null,
        verdict: null,
        pros: [],
        cons: [],
        errorMessage: null,
        selected: false,
      });
      results.push({ file: file.originalname, ok: true, candidate: sanitizeCandidate(candidate) });
    } catch (err) {
      results.push({ file: file.originalname, ok: false, error: err.message });
    }
  }
  res.json({ results });
});

candidatesRouter.patch("/:id", (req, res) => {
  const updated = store.updateCandidate(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: "Candidate not found" });
  res.json({ candidate: sanitizeCandidate(updated) });
});

candidatesRouter.delete("/:id", (req, res) => {
  store.removeCandidate(req.params.id);
  res.status(204).end();
});
