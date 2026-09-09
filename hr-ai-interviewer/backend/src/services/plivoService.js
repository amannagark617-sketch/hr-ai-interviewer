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
 * Builds the Plivo XML returned from the answer webhook: a short spoken disclosure,
 * then a bidirectional audio Stream pointing at our WebSocket bridge.
 */
export function buildAnswerXml({ callId, wsUrl }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Record startOnDialAnswer="true" redirect="false" fileFormat="mp3"/>
  <Stream bidirectional="true" keepCallAlive="true" audioTrack="both" streamTimeout="1800" contentType="audio/x-l16;rate=16000">
    ${wsUrl}?callId=${encodeURIComponent(callId)}
  </Stream>
</Response>`;
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
