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

// 503 (model overloaded) and 429 (rate limited) are both conditions Google's own error text
// describes as temporary — retry a couple of times with backoff before giving up, instead of
// failing the candidate on the first busy moment.
const RETRYABLE_STATUSES = new Set([429, 503]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function generateWithRetry(model, prompt, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await model.generateContent(prompt);
    } catch (err) {
      const retryable = RETRYABLE_STATUSES.has(err?.status);
      if (!retryable || attempt === attempts) throw err;
      await sleep(1000 * 2 ** (attempt - 1)); // 1s, 2s, ...
    }
  }
}

/**
 * Expands a short role description (a title plus a few free-form notes) into a full,
 * structured job description, so HR doesn't have to write one from scratch for every role.
 * Returns plain text, ready to drop straight into the job description field.
 */
export async function generateJobDescription(notes) {
  const model = client.getGenerativeModel({ model: config.gemini.textModel });

  const prompt = `You are an experienced technical recruiter writing a job description for an internal
hiring tool. Turn the role notes below into a complete, well-structured job description.

Respond with ONLY the job description as plain text — no markdown fences, no preamble, no
commentary before or after.

Structure it like this:
- A one-line title
- A short 2-3 sentence intro to the role and team
- "Responsibilities:" — 4-6 bullet points (use "- " for bullets)
- "Required skills:" — 4-6 bullet points, concrete and specific (years of experience, named
  technologies, not vague qualities)
- "Nice to have:" — 2-4 bullet points

Infer seniority, tech stack, and responsibilities from whatever the notes below actually say —
don't pad with generic boilerplate unrelated to what was asked for.

Role notes:
${notes}`;

  const result = await generateWithRetry(model, prompt);
  return result.response.text().trim();
}

/**
 * Scores a single resume against a job description.
 * Returns { score, verdict, pros, cons }.
 */
export async function scoreResume(jobDescription, resumeText, candidateName) {
  const model = client.getGenerativeModel({ model: config.gemini.textModel });

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

  const result = await generateWithRetry(model, prompt);
  const text = result.response.text();
  return parseJsonResponse(text);
}

/**
 * Scores a completed interview transcript against a rubric derived from the job description.
 * Returns { score, recommendation, summary, strengths, concerns }.
 * recommendation is one of "advance" | "hold" | "reject".
 */
export async function scoreInterviewTranscript(jobDescription, transcript, candidateName) {
  const model = client.getGenerativeModel({ model: config.gemini.textModel });

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

  const result = await generateWithRetry(model, prompt);
  const text = result.response.text();
  return parseJsonResponse(text);
}
