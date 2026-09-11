import { WebSocketServer, WebSocket } from "ws";
import { config } from "../config.js";
import { store } from "../data/store.js";
import { hangupCall } from "../services/plivoService.js";
import { savePendingCallback } from "../services/sheetsService.js";

// ---------------------------------------------------------------------------
// IMPORTANT: this file has NOT been run against live Plivo/Gemini traffic.
// It's written against the documented shape of both APIs as of Sept 2026:
//   - Plivo Audio Streaming sends/receives JSON frames over a WebSocket
//     ({event:"start"|"media"|"stop", media:{payload:<base64 PCM>}}), using
//     16-bit linear PCM at 16kHz (contentType "audio/x-l16;rate=16000").
//   - Gemini Live (BidiGenerateContent) is a separate WebSocket that speaks
//     its own JSON protocol for realtime audio in/out. It accepts 16kHz PCM16
//     input and produces 24kHz PCM16 output — the two rates are NOT the same,
//     which is why the outgoing sample rate below is read from Gemini's own
//     response instead of being hardcoded.
// Before pointing this at real candidates: place one test call, log every
// frame from both sides, and fix any protocol-shape mismatches against the
// current docs at https://ai.google.dev/gemini-api/docs/live-api and
// https://www.plivo.com/docs/voice/xml/audio-streaming.
// ---------------------------------------------------------------------------

const GEMINI_LIVE_URL =
  `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${config.gemini.apiKey}`;

// The <Stream> tag below declares one shared contentType (16kHz) for this connection, but
// Gemini Live's audio output is fixed at 24kHz — it's not something we can request at a
// different rate. Relaying that 24kHz PCM to Plivo unconverted, just relabeled, is what made a
// real test call sound "very slow, like a snail": whatever rate Plivo actually plays audio back
// at, the real data doesn't match it. Actually resampling down to 16kHz — instead of just
// changing a label — is correct regardless of which rate Plivo turns out to honor.
function resamplePcm16(base64Data, fromRate, toRate) {
  if (fromRate === toRate) return base64Data;
  const input = Buffer.from(base64Data, "base64");
  const inputSamples = input.length / 2; // 16-bit PCM = 2 bytes/sample
  const outputSamples = Math.floor((inputSamples * toRate) / fromRate);
  const output = Buffer.alloc(outputSamples * 2);
  const ratio = fromRate / toRate;

  for (let i = 0; i < outputSamples; i++) {
    const srcPos = i * ratio;
    const lo = Math.floor(srcPos);
    const hi = Math.min(lo + 1, inputSamples - 1);
    const frac = srcPos - lo;
    const sampleLo = input.readInt16LE(lo * 2);
    const sampleHi = input.readInt16LE(hi * 2);
    output.writeInt16LE(Math.round(sampleLo + (sampleHi - sampleLo) * frac), i * 2);
  }
  return output.toString("base64");
}

const PLIVO_STREAM_RATE = 16000; // must match the <Stream> contentType rate attribute below

// Sending audio genuinely resampled to match PLIVO_STREAM_RATE (16000, correctly labeled, no
// pacing artifacts) was still reported as slow and pitch-dropped on a real call — ruling out
// "Plivo plays back at its own declared Stream rate" as the mechanism. The one documented value
// not yet tried: 8000Hz is Plivo's own stated *default* contentType rate, matching the native
// bandwidth of a real phone line — worth testing directly that Plivo's playAudio path is
// hardwired to it regardless of what rate we declare. Only the outgoing (agent voice) leg uses
// this; the incoming leg (candidate audio -> Gemini) is untouched since it hasn't been reported
// broken and Gemini's Live API documents a hard 16kHz input requirement.
const PLIVO_PLAYBACK_RATE = 8000;

function buildAgentSystemPrompt({ jobDescription, candidateName, resumeText, customQuestions }) {
  const hasCustomQuestions = !!customQuestions?.trim();
  // Lets the model resolve a relative time the candidate gives ("tomorrow evening", "Monday at
  // 5") into an absolute ISO datetime for the request_callback tool — without today's actual
  // date/time it has no way to know what "tomorrow" even means.
  const nowIst = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return `You are Nidra, an HR Assistant at Little Nap Recliners, doing a quick first-round phone screen.
You are on a live phone call right now — talk like a real person on the phone, never like you're
reading a script or giving a lecture.

Right now it is ${nowIst} IST — use this if the candidate gives you a relative time (e.g. "tomorrow
evening", "call me after 6", "Monday morning") and you need to resolve it to an actual date/time.

How to sound human, not like an AI:
- Keep every turn SHORT — one or two sentences, sometimes just a few words ("Got it.", "Nice, tell me
  more about that."). Never deliver a paragraph in one breath.
- ONE question per turn, always — this applies everywhere in this call, not just the resume questions.
  Never ask two things in the same breath ("what's your current salary, and what are you expecting?" is
  TWO questions — ask the first, wait for the answer, only then ask the second). If a step below lists
  several things to find out, that means several separate turns, one question each, never a combined
  list read out at once.
- Actually wait for a real answer before moving on — silence is NOT an answer. If you ask something and
  there's a pause with no real response, do NOT just move on to a different question as if they'd
  answered or didn't want to. Give them a moment, then check in gently ("take your time" / "you still
  there?" / a soft repeat of the question), and keep waiting for an actual answer to THAT question
  before continuing. The only time you move on without an answer is if they explicitly say they'd
  rather skip it or can't talk right now (see step 2's callback flow).
- React to what they just said before moving on — a quick "that makes sense" or "oh interesting" beats
  jumping straight to the next question.
- Talk the way people actually talk: contractions, the occasional "okay" / "gotcha", natural pacing.
  No corporate buzzwords, no reading their resume back to them like a checklist.
- If they give a short or hesitant answer, gently follow up instead of filling the silence yourself.
- If they start talking while you're mid-sentence, stop immediately and listen. Never talk over them.
- Don't narrate what you're about to do ("Now I'll ask you about...") — just ask it.
- Keep the whole call tight — roughly 8-10 minutes, a bit longer if needed to fit in every step of the
  call structure below (language, background, compensation, location${hasCustomQuestions ? ", the mandatory questions" : ""}) without rushing any of them.

You are female — always refer to yourself with "she/her" in English, and never switch to "he/him" for
yourself under any circumstance. This matters just as much in Hindi and every other language you speak
in on this call: always use feminine grammatical forms for yourself. For example, in Hindi say "maine
samajh gayi", "main bol rahi hoon", "main bata doongi" — never the masculine "samajh gaya", "bol raha
hoon", or "bata doonga". Keep this consistent everywhere you switch languages, not just in English.

Language: open the call in Indian-accented English, and ask their language preference explicitly as
step 3 below. Separately from that explicit question — at ANY point in the call, the moment the
candidate speaks or answers in a different language — Hindi, Tamil, Telugu, Marathi, Bengali,
Punjabi, Kannada, Malayalam, Gujarati, or any other regional language — immediately continue the
rest of the call in that same language, without waiting for them to ask you to switch and without
asking permission first. Match their code-switching naturally too (e.g. Hinglish stays Hinglish,
don't force pure English or pure Hindi). If they switch languages again mid-call, follow them there
too. The goal: a candidate should never have to ask you twice to speak their language — you pick it
up from how they're already talking, on top of having asked once upfront.

Never invent anything about this candidate. Only reference skills, employers, projects, or
experience that are literally written in the resume text below. If the resume is missing, blank,
or too thin to ask specific questions from, say so plainly ("I don't have much detail on your
resume") and ask them to walk you through their background instead of guessing or making up
details to sound informed — a candidate correcting a false claim about their own resume is far
worse than admitting you don't have much to go on.

Call structure:
1. Open warmly: give your name, that you're an HR Assistant at Little Nap Recliners, and confirm
   you're speaking with ${candidateName || "the candidate"}. Mention — in one natural breath, not as a
   formal disclaimer — that the call is being recorded for hiring purposes.
2. Then ask if now is a good time for a quick chat — and this is a REAL question, not a pleasantry.
   Stop talking and actually listen for their answer before doing anything else. This is the single
   most common way this call goes wrong: do not ask "is now a good time?" and then immediately barrel
   into interview questions regardless of what they say — that is never acceptable. Treat it exactly
   like every other question in this call: ask it, then wait.
   - If they say yes (or anything that clearly means "go ahead") -> continue to step 3.
   - If they say no, sound busy, ask to talk later, or hesitate in a way that signals now isn't good ->
     do NOT ask any interview questions. Go straight to the callback flow below instead, then end the
     call — skip the rest of this structure entirely.
   - If what they said is unclear, cut off, or you're not confident you actually heard a real answer
     (dead air, a garbled word, a transcription that doesn't make sense) — that is NOT a "no". Say
     something like "sorry, you cut out there — is now an okay time?" and ask again. NEVER end the call,
     request a callback, or treat it as a decline based on silence or a guess. A candidate who never
     got a real chance to answer must never end up rejected because of a bad connection or a bug on our
     end — when in doubt, keep listening.

   Callback flow (only when they can't talk now): ask what day and time would work better for them.
   Once they give you something — even vague ("tomorrow evening", "after 6pm") — resolve it into an
   actual date and time using the current date/time given above, call the request_callback function
   with that resolved date/time, thank them for their patience, close warmly, and call end_call. If
   they don't give a specific time even after you ask, pick a sensible one yourself (e.g. the next
   business day, same time as this call) and tell them what you picked before calling request_callback
   — don't leave it unset.
3. Ask which language they'd be more comfortable continuing this call in — English or Hindi — as a
   real, direct question ("would you like to continue in English, or would Hindi work better for
   you?"), not an assumption. Then continue in whichever they pick (see the Language section above
   for how to keep following them if they switch again later, or into a different regional language
   entirely).
4. Ask 2-3 questions about the experience most relevant to this role, grounded in specifics from their
   resume below (not generic questions you could ask anyone). Name the actual project, employer, or
   technology from their resume in the question itself ("Tell me about the payments system you built at
   X" beats "Tell me about your backend experience"). Once they answer, go one level deeper on
   whichever answer was most relevant to this role before moving on — ask what their specific part was,
   what was hard about it, or a number (team size, scale, timeline) — the way a real interviewer probes,
   instead of collecting a surface-level answer and moving straight to the next topic.
5. Employment background and compensation — each bullet below is its OWN separate turn: ask it, wait
   for the actual answer, react briefly, then move to the next bullet. Never combine two of these into
   one question.
   - If the resume (or their own answers so far) shows they're currently working somewhere, ask why
     they're looking to make a change right now. Wait for the answer.
   - If they're not currently working (resume shows a gap, they say they're between jobs, a fresher,
     etc.), ask why they left their last job instead (skip this if they've never been employed at all,
     e.g. a fresher with no prior job). Wait for the answer.
   - Ask their current salary (or last-drawn salary if not currently employed) — just that, on its own.
     Wait for the answer.
   - Then, as a separate follow-up question, ask what they're expecting for this role. Wait for the
     answer.
   - Whatever number they give — even if it sounds high for this role — thank them for sharing it and
     move on naturally. NEVER react negatively, push back, sound surprised, imply it's too much, or
     end/wind down the call because of their salary expectation. Compensation fit is something HR
     decides afterward, not something you screen for or reject a candidate over on this call.
6. Location and commute — only if the job description below actually states a work location/city/area.
   If it doesn't mention one, skip this step entirely.
   - If the resume already mentions where the candidate is currently based, ask them directly whether
     they'd be able to travel to the job location for this role if they join. Wait for the answer.
   - If the resume doesn't mention their location, ask where they're currently based first, as its own
     question, and wait for the answer. Then, using your own knowledge of the geography, reason about
     roughly how far that is from the job location and ask — as a separate follow-up turn — whether a
     daily commute between the two would be workable for them. Don't just ask "can you travel here"
     without having gauged the actual distance first, and don't ask both of these in one breath.
7. ${hasCustomQuestions
    ? `Ask every question listed under "Mandatory questions" below. These were specifically chosen by
   the hiring team for this role, on top of the resume-grounded questions above — don't skip, merge, or
   water any of them down into a generic version, even if a similar topic already came up earlier.
   Ask them one at a time, in your own natural phrasing (don't read them robotically), and actually
   listen to each answer before moving to the next — you'll need to recall how they answered these
   specifically, since they matter for the hiring decision just as much as the resume-based questions.`
    : `(No additional mandatory questions were provided for this role — skip straight to the next step.)`
}
8. Ask about their availability / notice period.
9. Always — every single call, no exceptions, even if time is tight — give them a real chance to ask
   you questions before wrapping up ("do you have any questions for me?"), actually answer whatever
   they ask using the job description below, thank them genuinely, and close warmly, letting them know
   the team will follow up soon.
10. Immediately after you say goodbye, call the end_call function to hang up. Don't call it before
   you've actually said your closing line, and don't announce that you're about to call it — just call it.

The call has just connected as you receive this — there is no small talk before you; begin immediately
with step 1. A message may arrive telling you the call has connected and to begin — that message is a
system trigger, not something the candidate said.

Role this candidate is interviewing for:
${jobDescription}

What we know about this candidate from their resume:
${(resumeText || "No resume on file.").slice(0, 4000)}
${hasCustomQuestions
  ? `\nMandatory questions (set by the hiring team for this role — ask every one of these, see step 7):\n${customQuestions.trim()}`
  : ""
}`;
}

function openGeminiLiveSession(jobDescription, candidate, callId, customQuestions) {
  const ws = new WebSocket(GEMINI_LIVE_URL);

  ws.on("open", () => {
    console.log(`[callBridge] Gemini Live socket open for call ${callId}, sending setup (model=${config.gemini.liveModel})`);
    ws.send(
      JSON.stringify({
        setup: {
          model: config.gemini.liveModel,
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: config.gemini.voiceName } },
              // Controls the actual accent/pronunciation — languageCode is what was missing
              // before, so the voice defaulted to sounding US/UK rather than Indian English.
              languageCode: config.gemini.voiceLanguage,
            },
          },
          // Gemini Live's default voice-activity detection is tuned for quick back-and-forth
          // text-chat-style turns, not a phone call where a candidate might pause mid-thought or
          // there's line noise/latency. With the default (more sensitive) end-of-speech setting
          // it was declaring the candidate's turn over after a short pause — mid-sentence — and
          // generating the agent's next line over whatever they were about to say, which is what
          // a candidate experiences as "the AI didn't listen to me and just moved on." Lowering
          // end-of-speech sensitivity and raising the silence window they need before the turn
          // is considered finished gives real phone-call pauses room to happen.
          realtimeInputConfig: {
            automaticActivityDetection: {
              startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
              endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
              prefixPaddingMs: 200,
              silenceDurationMs: 800,
            },
          },
          // Without these, serverContent never carries transcription text for either side,
          // and we'd have no transcript to score or log after the call.
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: {
            parts: [
              {
                text: buildAgentSystemPrompt({
                  jobDescription,
                  candidateName: candidate?.name,
                  resumeText: candidate?.resumeText,
                  customQuestions,
                }),
              },
            ],
          },
          // Lets the model actually end the call once it's done, instead of the conversation
          // being over while the phone stays connected indefinitely (the <Wait length="1800"/>
          // in the answer XML exists specifically to stop the call dropping mid-conversation,
          // but that means nothing else ever hangs it up either — this closes that gap).
          tools: [
            {
              functionDeclarations: [
                {
                  name: "end_call",
                  description:
                    "Hang up the phone call. Call this immediately after saying your closing goodbye, once the interview is complete.",
                  parameters: { type: "OBJECT", properties: {} },
                },
                {
                  name: "request_callback",
                  description:
                    "Call this when the candidate says now isn't a good time and needs to be called back later, INSTEAD of asking any interview questions. Records the callback time so the call gets automatically re-placed then. Call end_call right after this, once you've said your closing line.",
                  parameters: {
                    type: "OBJECT",
                    properties: {
                      preferredDateTime: {
                        type: "STRING",
                        description:
                          "The candidate's preferred callback date and time, resolved to an absolute ISO 8601 datetime with the +05:30 offset (e.g. 2026-09-12T17:00:00+05:30) using the current IST date/time given earlier in these instructions plus whatever they said. If they gave no specific time, pick a sensible one yourself and say it back to them before calling this.",
                      },
                      note: {
                        type: "STRING",
                        description: "One short phrase on why/what they said, e.g. \"asked to call back after their current meeting\".",
                      },
                    },
                    required: ["preferredDateTime"],
                  },
                },
              ],
            },
          ],
        },
      })
    );
  });

  return ws;
}

export function attachCallBridge(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws/media" });

  wss.on("connection", (plivoSocket, req) => {
    const url = new URL(req.url, "http://localhost");
    const callId = url.searchParams.get("callId");
    const call = callId && store.getCall(callId);

    if (!call) {
      // Every prior silent failure in this app (ranking, scoring) turned out to be a swallowed
      // error with no trace anywhere — log everything needed to diagnose this one instead of
      // repeating that. If this fires on a real call, the call IDs won't match at all (a fresh
      // deploy/restart wiped the in-memory store between placing the call and Plivo connecting,
      // or multiple server instances don't share memory) — both are real possibilities worth
      // ruling out from these logs rather than guessing.
      console.error(
        `[callBridge] Rejecting WS connection: no call found for callId=${JSON.stringify(callId)}. ` +
          `Known call IDs right now: ${JSON.stringify(store.listCalls().map((c) => c.id))}`
      );
      plivoSocket.close(1008, "Unknown call");
      return;
    }

    console.log(`[callBridge] Plivo media stream connected for call ${callId}`);

    const candidate = store.getCandidate(call.candidateId);
    // Resolved via the candidate's own role, NOT store.getJobDescription()/getCustomQuestions()
    // (which track whichever role is currently active in the UI) — a call can still be ringing
    // after HR has switched to a different role, and it must keep using the role it was actually
    // placed for.
    const role = store.getRole(candidate?.roleId);
    const jobDescription = role?.jobDescription || "";
    const customQuestions = role?.customQuestions || "";
    const geminiSocket = openGeminiLiveSession(jobDescription, candidate, callId, customQuestions);
    let transcript = "";
    let setupComplete = false;
    let loggedAudioFormat = false;
    let audioChunkIndex = 0;
    const bridgeStartedAt = Date.now();
    geminiSocket.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (err) {
        console.error(`[callBridge] Non-JSON message from Gemini for call ${callId}:`, err.message);
        return;
      }

      try {
        // Gemini Live reports a rejected setup (bad model name, invalid key, quota, etc.) as a
        // normal JSON message with an "error" field, not a socket-level error — miss this and
        // the call just goes dead silent with zero indication why.
        if (msg?.error) {
          console.error(`[callBridge] Gemini Live setup/session error for call ${callId}:`, JSON.stringify(msg.error));
          return;
        }

        if (msg?.setupComplete && !setupComplete) {
          setupComplete = true;
          console.log(`[callBridge] Gemini Live setup complete for call ${callId} — agent is live`);
          // Gemini only generates audio in response to input it receives — with nothing ever
          // sent, it just sits in silence waiting for the candidate to speak first, which on a
          // real call meant ~20s of dead air with the candidate saying "hello?" into nothing.
          // This synthetic turn is what actually gets the agent to open the conversation.
          geminiSocket.send(
            JSON.stringify({
              clientContent: {
                turns: [{ role: "user", parts: [{ text: "(The call has just connected. Begin the conversation now.)" }] }],
                turnComplete: true,
              },
            })
          );
        }

        const functionCalls = msg?.toolCall?.functionCalls;

        // The candidate can't talk now and gave (or was given) a callback time — save it on the
        // candidate record so the callback scheduler (see services/callbackScheduler.js) picks it
        // up and automatically re-places this call later, instead of it falling through the
        // cracks. Doesn't `return` — a request_callback call is always immediately followed by
        // end_call, which may arrive in the same toolCall message.
        const callbackCall = functionCalls?.find((fc) => fc.name === "request_callback");
        if (callbackCall) {
          const { preferredDateTime, note } = callbackCall.args || {};
          console.log(
            `[callBridge] Agent requested callback for call ${callId} at ${preferredDateTime}${note ? ` (${note})` : ""}`
          );
          if (candidate && preferredDateTime) {
            store.updateCandidate(candidate.id, {
              callbackScheduledFor: preferredDateTime,
              callbackNote: note || "",
              callbackStatus: "pending",
            });
            // Also park it in the Sheet (see sheetsService.js) so it survives a Cloud Run restart
            // between now and when it's due — the in-memory update above alone does not. Fire and
            // forget: this must never block or fail the live call over a logging-sheet hiccup, and
            // the 60s scheduler tick / request-triggered check already covers the case where this
            // same instance is still alive when the callback comes due.
            savePendingCallback({
              id: candidate.id,
              candidateName: candidate.name,
              phone: candidate.phone,
              roleTitle: role?.title || "",
              resumeText: candidate.resumeText,
              jobDescription,
              customQuestions,
              scheduledFor: preferredDateTime,
              note: note || "",
            }).catch((err) =>
              console.error(`[callBridge] Failed to persist pending callback for candidate ${candidate.id} to Sheets:`, err.message)
            );
          } else {
            console.error(
              `[callBridge] request_callback fired for call ${callId} but candidate or preferredDateTime missing — cannot schedule.`
            );
          }
          // Gemini Live's function-calling protocol pauses generation until it gets a matching
          // toolResponse — unlike end_call (which just ends the whole session right after),
          // this call needs to keep going afterward (thank them, close, then end_call), so a
          // missing response here would leave the agent silently stuck mid-call.
          if (geminiSocket.readyState === WebSocket.OPEN) {
            geminiSocket.send(
              JSON.stringify({
                toolResponse: {
                  functionResponses: [{ id: callbackCall.id, name: "request_callback", response: { result: "ok" } }],
                },
              })
            );
          }
        }

        // The model decided the interview is over and is hanging up (see the end_call tool
        // declared in the setup message above). Actually end the call instead of leaving the
        // phone connected after the agent has already said goodbye — this is also what lets
        // /hangup ever fire so the post-call score/recommendation get computed and stored.
        if (functionCalls?.some((fc) => fc.name === "end_call")) {
          console.log(`[callBridge] Agent called end_call for call ${callId} — hanging up`);
          if (call.plivoCallUuid) {
            hangupCall(call.plivoCallUuid).catch((err) =>
              console.error(`[callBridge] Failed to hang up call ${callId} via Plivo API:`, err.message)
            );
          } else {
            console.error(`[callBridge] end_call fired for call ${callId} but no plivoCallUuid on record — cannot hang up.`);
          }
          return;
        }

        // Model was interrupted (candidate started talking over it) — Gemini stops generating on
        // its own, but Plivo may still be playing out audio frames we already sent. There's no
        // documented "clear the playback queue" event for Plivo streams, so the best we can do here
        // is stop forwarding further audio for this turn; verify against a live test call whether
        // any perceptible overlap remains.
        if (msg?.serverContent?.interrupted) return;

        // Audio the model generated -> relay to Plivo as a media frame. Gemini's native audio output
        // is 24kHz — read the real rate out of the mimeType instead of assuming, then resample down
        // to PLIVO_PLAYBACK_RATE (see that constant's comment for why it's 8000, not 16000).
        const audioPart = msg?.serverContent?.modelTurn?.parts?.find((p) => p.inlineData?.mimeType?.startsWith("audio/"));
        if (audioPart && plivoSocket.readyState === WebSocket.OPEN) {
          if (!loggedAudioFormat) {
            loggedAudioFormat = true;
            console.log(`[callBridge] First Gemini audio chunk for call ${callId}, raw mimeType: ${audioPart.inlineData.mimeType}`);
          }
          const rateMatch = audioPart.inlineData.mimeType.match(/rate=(\d+)/);
          const sourceRate = rateMatch ? Number(rateMatch[1]) : 24000;
          const inputSamples = Buffer.byteLength(audioPart.inlineData.data, "base64") / 2;
          const durationMs = (inputSamples / sourceRate) * 1000;
          const resampled = resamplePcm16(audioPart.inlineData.data, sourceRate, PLIVO_PLAYBACK_RATE);
          const outputSamples = Buffer.byteLength(resampled, "base64") / 2;

          // Sent immediately, no artificial pacing — an earlier pacing attempt was proven (via
          // these same diagnostics) to build an unbounded backlog and was removed.
          if (audioChunkIndex < 40) {
            console.log(
              `[callBridge] audio chunk #${audioChunkIndex} call=${callId} t=${Date.now() - bridgeStartedAt}ms ` +
                `inputBytes=${Buffer.byteLength(audioPart.inlineData.data, "base64")} inputSamples=${inputSamples} sourceRate=${sourceRate} ` +
                `outputSamples=${outputSamples} durationMs=${durationMs.toFixed(1)}`
            );
          }
          audioChunkIndex++;

          // Per Plivo's Audio Streaming docs, the playAudio media object's contentType is the
          // bare codec ("audio/x-l16") — the ";rate=" suffix belongs on the <Stream> tag's own
          // contentType attribute, not here — and sampleRate is a string, not a number.
          plivoSocket.send(
            JSON.stringify({
              event: "playAudio",
              media: {
                contentType: "audio/x-l16",
                sampleRate: String(PLIVO_PLAYBACK_RATE),
                payload: resampled,
              },
            })
          );
        }

        // Transcription text, surfaced because inputAudioTranscription/outputAudioTranscription are
        // enabled in the setup message above — accumulate for post-call scoring and the Sheets log.
        const outputTranscription = msg?.serverContent?.outputTranscription?.text;
        if (outputTranscription) transcript += `Agent: ${outputTranscription}\n`;

        const inputTranscription = msg?.serverContent?.inputTranscription?.text;
        if (inputTranscription) transcript += `Candidate: ${inputTranscription}\n`;
      } catch (err) {
        console.error(`[callBridge] Error handling Gemini message for call ${callId}:`, err);
      }
    });

    geminiSocket.on("error", (err) => {
      console.error(`[callBridge] Gemini socket error for call ${callId}:`, err.message);
    });

    geminiSocket.on("close", (code, reason) => {
      console.log(`[callBridge] Gemini socket closed for call ${callId}: code=${code} reason=${reason?.toString() || "(none)"}`);
      if (!setupComplete) {
        console.error(
          `[callBridge] Gemini Live socket closed for call ${callId} before setup completed — the agent never came on the line.`
        );
      }
    });

    plivoSocket.on("message", (raw) => {
      let frame;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (frame.event === "start") {
        console.log(`[callBridge] Plivo stream started for call ${callId}`);
      }

      if (frame.event === "media" && geminiSocket.readyState === WebSocket.OPEN) {
        // realtimeInput.mediaChunks (an array) is deprecated — confirmed via a real call, where
        // Gemini closed the socket (code 1007) within 14ms of setup completing, citing exactly
        // this: "realtime_input.media_chunks is deprecated. Use audio, video, or text instead."
        // That killed the session before the agent could say a word. `audio` takes a single
        // chunk directly instead of an array.
        geminiSocket.send(
          JSON.stringify({
            realtimeInput: {
              audio: { mimeType: "audio/pcm;rate=16000", data: frame.media.payload },
            },
          })
        );
      }

      if (frame.event === "stop") {
        console.log(`[callBridge] Plivo stream stopped for call ${callId}`);
        store.updateCall(callId, { transcript });
        geminiSocket.close();
      }
    });

    plivoSocket.on("error", (err) => {
      console.error(`[callBridge] Plivo socket error for call ${callId}:`, err.message);
    });

    plivoSocket.on("close", (code, reason) => {
      console.log(`[callBridge] Plivo socket closed for call ${callId}: code=${code} reason=${reason?.toString() || "(none)"}`);
      store.updateCall(callId, { transcript });
      if (geminiSocket.readyState === WebSocket.OPEN) geminiSocket.close();
    });
  });

  return wss;
}
