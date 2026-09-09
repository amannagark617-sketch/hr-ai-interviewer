# Architecture

```
HR dashboard (React)
   │  upload JD + resumes
   ▼
POST /api/candidates            → parses resume files, stores candidates in memory/JSON store
POST /api/rank                  → sends JD + each resume to Gemini, stores score/verdict/pros/cons
   │  HR reviews ranked list, selects candidates
   ▼
POST /api/calls/trigger         → for each selected candidate, creates a call job and calls Plivo's
                                   outbound call API, pointing Plivo at our Answer XML webhook
   │
   ▼
Plivo dials the candidate
   │  on answer, Plivo requests:
   ▼
GET/POST /api/webhooks/answer   → returns Plivo XML with a <Stream> element pointing at our
                                   WebSocket endpoint, and enables call recording
   │
   ▼
WS /ws/media/:callId            → backend/src/ws/callBridge.js
                                   - receives base64 audio frames from Plivo
                                   - forwards them to the Gemini Live session for this call
                                   - receives generated audio from Gemini, sends it back to Plivo
                                   - accumulates the transcript as the call proceeds
   │  call ends
   ▼
POST /api/webhooks/hangup       → marks the call finished, kicks off scoring of the transcript,
                                   fetches the recording URL from Plivo, writes a row to Google Sheets
```

## Where to focus testing

The riskiest part of this system is the live audio bridge (`backend/src/ws/callBridge.js`). Plivo's
Audio Streaming and Gemini's Live API both expect specific audio encodings and framing — do a single
manual test call end-to-end before wiring it into the bulk-call queue. Log every frame size and any
errors from both sides while you do.

## Scaling considerations (not implemented yet)

- Swap the in-memory candidate store (`backend/src/data/store.js`) for a real database once you're past
  prototyping — it currently resets on server restart.
- Add a job queue (e.g. BullMQ + Redis) in front of `POST /api/calls/trigger` so bulk calling batches are
  rate-limited and retryable instead of firing all at once.
- Add auth in front of the whole API — right now anyone who can reach the backend can trigger calls.
