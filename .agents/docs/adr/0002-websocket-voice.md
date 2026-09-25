# ADR 0002: WebSocket + Web Audio voice transport (replacing LiveKit/WebRTC)

status: accepted (2026-09-04)
supersedes: the LiveKit transport implied by ADR-era M1 design
plan: `.agents/plans/2026-09-04-ws-voice-migration.md`

## context

The M1 voice plane ran a `@livekit/agents` worker behind a livekit-server SFU:
browser -> WebRTC -> SFU -> worker -> STT/LLM/TTS -> back. That carried three
processes (server, worker, SFU), UDP ports, token minting, and a native
dependency tree (rtc-ffi, onnxruntime-node, sharp) that dominated the release
archive. It also blocked the target architecture (option C, client-side
distribution): a Service Worker cannot host a LiveKit worker, and an SFU is
unhostable on static hosting.

## decision

Replace the media plane with plain WebSockets and Web Audio:

- browser captures 16k mono PCM16 via AudioWorklet, runs client-side Silero
  VAD (`@ricky0123/vad-web`, assets vendored locally), and streams frames over
  `GET /v1/sessions/:id/voice` (WS upgrade). Transport is streaming;
  recognition stays utterance-buffered (parakeet has no streaming endpoint).
- the voice loop lives in the server process (`apps/server/src/voice/`): accumulate
  frames -> buffered STT -> LLM -> persist turns -> TTS WAV -> decode/resample
  -> stream PCM chunks back. Barge-in is an `interrupt` control message that
  aborts in-flight LLM/TTS and stops client playback.
- the turn UX is orchestrated client-side by an xstate v5 FSM.
- removal is full: worker package, SFU supervision, `/v1/token`,
  `livekit-client`, livekit config fields.

why WS over WebRTC for the agent voice: no SFU, no UDP, works through any HTTP
host (including CF Pages and a future Service Worker), and barge-in is a
message instead of a track negotiation.

### hybrid drivers

- `server-driver` (default desktop/self-host): the WS pipeline above.
- `browser-driver` (static Pages build fallback): Web Speech API
  (`SpeechRecognition` + `speechSynthesis`), zero infrastructure, Chromium-only
  best effort. Both drivers post turns through the same REST API, so
  transcripts and reports are identical regardless of driver.

### future 1-on-1 human calls

A separate lightweight WebRTC implementation (P2P + STUN, Hono signaling) per
`/tmp/webrtc-alts.md`, reusing `PcmPlayer` for playback. No SFU, no LiveKit.

## architecture note

The repo stays a bun monorepo with ports/adapters inside each module; no
microservices. `VoiceLoop` (domain) depends on injected `SttPort`/`TtsPort`/
`LlmPort`/`EventSink` interfaces; provider adapters speak OpenAI-compatible
HTTP. The web client mirrors this with the `SpeechDriver` interface. `packages/shared/`
valibot contracts are the anti-corruption layer between the two runtimes.
A service-oriented split would add process and deployment overhead with no
benefit for a local-first single-user app.

## consequences

- one process fewer to run and package; release archives shrink drastically.
- browser mic latency is fine for interviews (100-300ms frame batching) but
  this is not a low-latency conferencing path; acceptable for agent voice.
- TTS is WAV-decoded and resampled server-side (mock 8k, pocket 24k) so any
  OpenAI-compatible provider works regardless of sample rate.
- SpeechRecognition requires network in Chrome; documented as best-effort.
