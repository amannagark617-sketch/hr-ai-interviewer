import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../config.js";

const client = new GoogleGenerativeAI(config.gemini.apiKey);

function parseJsonResponse(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`Gemini didn't return valid JSON: ${cleaned.slice(0, 200)}`);
  }
}

/**
 * Scores a single resume against a job description.
 * Returns { score, verdict, pros, cons }.
 */
export async function scoreResume(jobDescription, resumeText, candidateName) {
  const model = client.getGenerativeModel({ model: "gemini-2.0-flash" });

  const prompt = `You are an expert technical recruiter screening a resume against a single job description.
Respond with ONLY a JSON object — no markdown fences, no preamble.

Shape:
{
  "score": <integer 0-100, how well this candidate fits the role>,
  "verdict": "<one plain-language sentence>",
  "pros": ["<short phrase>", "..."],
  "cons": ["<short phrase>", "..."]
}

Give 2-4 pros and 1-3 cons, each under 12 words, grounded only in what the resume actually says.

Job description:
${jobDescription}

Resume (${candidateName}):
${resumeText}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  return parseJsonResponse(text);
}

/**
 * Scores a completed interview transcript against a rubric derived from the job description.
 * Returns { score, recommendation, summary, strengths, concerns }.
 * recommendation is one of "advance" | "hold" | "reject".
 */
export async function scoreInterviewTranscript(jobDescription, transcript, candidateName) {
  const model = client.getGenerativeModel({ model: "gemini-2.0-flash" });

  const prompt = `You are an experienced interviewer reviewing a first-round phone screen transcript.
Respond with ONLY a JSON object — no markdown fences, no preamble.

Shape:
{
  "score": <integer 0-100>,
  "recommendation": "advance" | "hold" | "reject",
  "summary": "<2-3 sentence summary of how the call went>",
  "strengths": ["<short phrase>", "..."],
  "concerns": ["<short phrase>", "..."]
}

Base this only on what the candidate actually said in the transcript below — do not invent details.

Job description:
${jobDescription}

Interview transcript (${candidateName}):
${transcript}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  return parseJsonResponse(text);
}
