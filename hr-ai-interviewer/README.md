# HR AI Interviewer

An internal tool for HR teams to:

1. Upload a job description and a batch of resumes
2. Get each candidate scored, ranked, and summarized (pros/cons) against the role, using Gemini
3. Select who to call for a first-round screen
4. Automatically place AI-conducted phone interviews over Plivo, with Gemini Live driving the conversation
5. Log everything — recording link, transcript, scores, next-round decision — to a Google Sheet

This repo is a working scaffold, not a finished product. Resume ranking and the web dashboard are fully implemented. The calling pipeline (Plivo ⇄ Gemini Live bridge) is implemented against the documented APIs but **has not been tested against live Plivo/Gemini credentials** — budget time to debug the real-time audio path before trusting it with real candidates.

## Project layout

```
hr-ai-interviewer/
├── backend/         Express API: resume parsing, Gemini ranking, Plivo call orchestration,
│                     Plivo↔Gemini Live audio bridge, Google Sheets logging
├── frontend/         React (Vite) dashboard for HR
└── docs/
    └── ARCHITECTURE.md
```

## Prerequisites

- Node.js 20+
- A Gemini API key ([ai.google.dev](https://ai.google.dev)) with access to a Live/audio model
- A Plivo account with a purchased number and Auth ID/Token, and a public HTTPS URL for webhooks (use `ngrok` in development)
- A Google Sheet with the Apps Script from `docs/apps-script/Code.gs` deployed as a Web App (no service account needed — see that file's header comment for the exact steps)

## Setup

```bash
# from the repo root
cd backend && npm install && cd ..
cd frontend && npm install && cd ..

cp backend/.env.example backend/.env
# fill in backend/.env with your real keys — see comments in the file
```

## Running it

```bash
# terminal 1
cd backend && npm run dev

# terminal 2
cd frontend && npm run dev
```

The dashboard runs at `http://localhost:5173` and talks to the API at `http://localhost:8080`.

For calling to work, Plivo needs a public URL to reach your backend's webhook and audio-stream endpoints. In development, run:

```bash
ngrok http 8080
```

and set `PUBLIC_BASE_URL` in `backend/.env` to the `https://...ngrok...` URL it gives you.

## What's real vs. what's a stub

| Piece | Status |
|---|---|
| Resume upload (.pdf/.docx/.txt) + parsing | Working |
| Gemini resume ranking (score, verdict, pros/cons) | Working |
| HR dashboard (rank, review, select) | Working |
| Candidate selection → call trigger | Working (queues jobs) |
| Plivo outbound call + Answer XML | Working, needs your Plivo credentials to test |
| Plivo Audio Streaming ⇄ Gemini Live bridge | Implemented per docs, **untested against live traffic** — this is the part to validate first |
| Post-call transcript scoring | Working once a transcript exists |
| Google Sheets logging | Working, needs the Apps Script deployed (see `docs/apps-script/Code.gs`) |

See `docs/ARCHITECTURE.md` for the full data flow and where to focus testing.
