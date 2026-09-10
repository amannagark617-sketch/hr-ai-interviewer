import plivo from "plivo";
import { config } from "../config.js";

const client = new plivo.Client(config.plivo.authId, config.plivo.authToken);

/**
 * Places an outbound call to a candidate. Plivo will hit our answer_url once
 * the call connects, which is where we return XML that starts the media stream.
 */
export async function placeCall({ toNumber, callId }) {
  const answerUrl = `${config.publicBaseUrl}/api/webhooks/answer?callId=${encodeURIComponent(callId)}`;
  const hangupUrl = `${config.publicBaseUrl}/api/webhooks/hangup?callId=${encodeURIComponent(callId)}`;

  const response = await client.calls.create(
    config.plivo.fromNumber,
    toNumber,
    answerUrl,
    {
      answerMethod: "POST",
      hangupUrl,
      hangupMethod: "POST",
    }
  );

  return response; // includes requestUuid
}

/**
 * Builds the Plivo XML returned from the answer webhook: background call recording,
 * then a bidirectional audio Stream pointing at our WebSocket bridge.
 */
export function buildAnswerXml({ callId, wsUrl, statusCallbackUrl }) {
  // recordSession (not startOnDialAnswer!) is what "record the whole call in the background,
  // starting immediately" — per Plivo's own docs, startOnDialAnswer waits for a <Dial> leg to
  // answer before it starts, and this Response has no <Dial> at all (we bridge audio via
  // <Stream> to Gemini, not by dialing another party). With startOnDialAnswer, <Record> sits
  // waiting on an event that can never fire, which — being the first verb in the Response —
  // may block <Stream> from ever starting at all. recordSession starts recording immediately
  // and falls straight through to the next verb.
  //
  // Per Plivo's Audio Streaming docs: keepCallAlive="true" makes <Stream> run *exclusively* —
  // subsequent verbs only execute after the stream disconnects. The trailing <Wait> is a
  // second-layer safety net for that "subsequent verb" once the stream does end, so the call
  // doesn't drop the instant it does.
  //
  // The actual bug that was silently killing every call: bidirectional="true" was combined with
  // audioTrack="both" — Plivo's own docs say explicitly "When bidirectional is true, audioTrack
  // cannot be outbound or both." That invalid combination is almost certainly why Plivo never
  // even attempted the WebSocket connection in three separate real test calls (confirmed via
  // Cloud Run logs — zero trace of any connection attempt reaching our backend). Dropped
  // audioTrack entirely; bidirectional alone covers both directions.
  //
  // statusCallbackUrl gets Plivo to directly tell us when the stream connects, stops, or fails —
  // actual ground truth instead of inferring failure from absence of logs.
  //
  // The rate=16000 below must match PLIVO_STREAM_RATE in ws/callBridge.js — that's the rate
  // Gemini's 24kHz native audio output gets resampled down to before being sent back to Plivo.
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Record recordSession="true" redirect="false" fileFormat="mp3"/>
  <Stream bidirectional="true" keepCallAlive="true" streamTimeout="1800" contentType="audio/x-l16;rate=16000" statusCallbackUrl="${statusCallbackUrl}" statusCallbackMethod="POST">
    ${wsUrl}?callId=${encodeURIComponent(callId)}
  </Stream>
  <Wait length="1800"/>
</Response>`;
}

/**
 * Actively ends a call. Used when the AI agent decides the conversation is over (via the
 * end_call tool) — without this, the <Wait length="1800"/> safety net that stops the call from
 * dropping mid-conversation also means nothing ever hangs it up once the agent is actually done.
 */
export async function hangupCall(plivoCallUuid) {
  await client.calls.hangup(plivoCallUuid);
}

/**
 * Fetches a call's recording URL after it has ended. Plivo needs a moment after
 * hangup before the recording is processed and listed, so this retries a few
 * times with a short delay instead of giving up on the first empty result.
 */
export async function getRecordingUrl(plivoCallUuid, { retries = 4, delayMs = 3000 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const recordings = await client.recordings.list({ call_uuid: plivoCallUuid });
    if (recordings && recordings.length > 0) {
      return recordings[0].recordingUrl || recordings[0].recording_url || null;
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}
