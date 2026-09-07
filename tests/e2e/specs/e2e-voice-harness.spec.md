# e2e: voice functional harness

Covers the p3.1 dev harness route (`/dev/voice-harness`): a deterministic,
mic-free voice loop. The page creates a session via `POST /v1/sessions`,
connects the ServerVoiceDriver WS, and feeds scripted PCM16 sine frames, so
the whole turn (STT -> LLM -> TTS -> metrics) runs against the mock provider
in a test-mode di server. Requires the web dev server plus a test-mode di
server (see the top of `playwright.spec.ts`); the harness targets the SPA
origin, the API comes from `VITE_DI_API_BASE`.

## voice harness runs a full turn loop without a mic

Load `/dev/voice-harness`, click "create session + connect" and wait for
status `ready`, click "run scenario", and expect the agent transcript to
become non-empty within 30s. The metrics panel shows llm ttft and total ms
from the `metrics` message.
