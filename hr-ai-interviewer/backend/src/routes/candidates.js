import { Router } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { store } from "../data/store.js";
import { extractResumeText, guessNameFromFilename } from "../services/resumeParser.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
export const candidatesRouter = Router();

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

candidatesRouter.get("/", (req, res) => {
  res.json({ candidates: store.listCandidates() });
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
      const candidate = store.addCandidate({
        id: nanoid(),
        name: guessNameFromFilename(file.originalname),
        phone: "",
        resumeText: text,
        status: "pending",
        score: null,
        verdict: null,
        pros: [],
        cons: [],
        selected: false,
      });
      results.push({ file: file.originalname, ok: true, candidate });
    } catch (err) {
      results.push({ file: file.originalname, ok: false, error: err.message });
    }
  }
  res.json({ results });
});

candidatesRouter.patch("/:id", (req, res) => {
  const updated = store.updateCandidate(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: "Candidate not found" });
  res.json({ candidate: updated });
});

candidatesRouter.delete("/:id", (req, res) => {
  store.removeCandidate(req.params.id);
  res.status(204).end();
});
