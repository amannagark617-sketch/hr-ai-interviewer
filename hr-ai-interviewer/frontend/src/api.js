// In dev, Vite proxies "/api" to the local backend (see vite.config.js). In production
// (e.g. deployed on Vercel), there's no proxy, so point this at your deployed backend's
// public URL via the VITE_API_URL environment variable (no trailing slash), e.g.
// VITE_API_URL=https://your-backend.onrender.com
const BASE = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : "/api";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: options.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  // No "roles" API here on purpose — hiring rounds are tracked entirely server-side now, with no
  // UI to pick or name one (see backend/src/data/store.js's setJobDescription). Every endpoint
  // below implicitly operates on whichever round the job description text puts you in.
  getJobDescription: () => request("/candidates/job-description"),
  setJobDescription: (jobDescription) =>
    request("/candidates/job-description", { method: "PUT", body: JSON.stringify({ jobDescription }) }),
  uploadJobDescription: (file) => {
    const form = new FormData();
    form.append("jobDescription", file);
    return request("/candidates/job-description/upload", { method: "POST", body: form });
  },
  generateJobDescription: (notes) =>
    request("/candidates/job-description/generate", { method: "POST", body: JSON.stringify({ notes }) }),

  // Optional, mandatory-to-ask questions on top of the usual resume/JD-grounded ones — applies to
  // every candidate in the round, same shape as the job description endpoints above.
  getCustomQuestions: () => request("/candidates/custom-questions"),
  setCustomQuestions: (customQuestions) =>
    request("/candidates/custom-questions", { method: "PUT", body: JSON.stringify({ customQuestions }) }),
  uploadCustomQuestions: (file) => {
    const form = new FormData();
    form.append("customQuestions", file);
    return request("/candidates/custom-questions/upload", { method: "POST", body: form });
  },

  listCandidates: () => request("/candidates"),
  addCandidate: (name, resumeText, phone) =>
    request("/candidates", { method: "POST", body: JSON.stringify({ name, resumeText, phone }) }),
  uploadResumes: (files) => {
    const form = new FormData();
    files.forEach((f) => form.append("resumes", f));
    return request("/candidates/upload", { method: "POST", body: form });
  },
  updateCandidate: (id, patch) =>
    request(`/candidates/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  removeCandidate: (id) => request(`/candidates/${id}`, { method: "DELETE" }),

  rankCandidates: () => request("/rank", { method: "POST" }),

  triggerCalls: (candidateIds) =>
    request("/calls/trigger", { method: "POST", body: JSON.stringify({ candidateIds }) }),
  listCalls: () => request("/calls"),

  // Raw text, not JSON — proxied server-side by the backend (see routes/dashboard.js) so the
  // browser never has to fetch Google's published-CSV URL directly, which can hit CORS.
  getSheetCsv: async () => {
    const res = await fetch(`${BASE}/dashboard/sheet-csv`, { cache: "no-store" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed: ${res.status}`);
    }
    return res.text();
  },
};
