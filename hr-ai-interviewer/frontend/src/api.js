const BASE = "/api";

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
  getJobDescription: () => request("/candidates/job-description"),
  setJobDescription: (jobDescription) =>
    request("/candidates/job-description", { method: "PUT", body: JSON.stringify({ jobDescription }) }),

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
};
