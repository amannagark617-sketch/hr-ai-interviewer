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
export function buildAnswerXml({ callId, wsUrl }) {
  // recordSession (not startOnDialAnswer!) is what "record the whole call in the background,
  // starting immediately" — per Plivo's own docs, startOnDialAnswer waits for a <Dial> leg to
  // answer before it starts, and this Response has no <Dial> at all (we bridge audio via
  // <Stream> to Gemini, not by dialing another party). With startOnDialAnswer, <Record> sits
  // waiting on an event that can never fire, which — being the first verb in the Response —
  // may block <Stream> from ever starting at all: the call connects, nothing ever happens, and
  // it looks to the candidate like the call just dropped. recordSession starts recording
  // immediately and falls straight through to the next verb.
  //
  // <Stream> is NOT guaranteed to block for the whole call — if it exits for any reason
  // (briefly dropped connection, a hiccup on either side), Plivo just falls through to
  // whatever's next in the Response. With nothing next, Plivo hangs up immediately with cause
  // "End Of XML Instructions" — confirmed against a real call: answered, then hung up ~1.5s
  // later with exactly that cause, meaning the Response ran out of verbs, not that anything
  // crashed. keepCallAlive="true" only stops that from being reported as a hard Stream error —
  // it does not keep the call connected once the XML has nothing left to do. A long <Wait>
  // after <Stream> keeps the Response "occupied" for the call's duration so a transient Stream
  // hiccup can't end the call outright; matches streamTimeout so nothing here is the limiting
  // factor before the stream's own timeout would be.
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Record recordSession="true" redirect="false" fileFormat="mp3"/>
  <Stream bidirectional="true" keepCallAlive="true" audioTrack="both" streamTimeout="1800" contentType="audio/x-l16;rate=16000">
    ${wsUrl}?callId=${encodeURIComponent(callId)}
  </Stream>
  <Wait length="1800"/>
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
