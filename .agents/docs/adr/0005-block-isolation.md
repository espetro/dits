# ADR 0005: block isolation by slice (warn-only enforcement)

status: accepted (2026-10-14), enforcement in warn-only mode
builds on: ADR-0002 (websocket voice, injected ports)
issue: #80

## context

The llm, tts and stt blocks are about to be split into slices so each can be swapped, tested and reasoned about alone. Today callers deep-import adapter files (for example `voice/stt/wav`, `voice/tts/pocket-tts`) and construct adapters wherever convenient, which couples callers to one implementation.

## decision

Planned slices: `apps/web/src/lib/{llm,tts,stt}` and `apps/server/src/voice/{llm,tts,stt}`.

Rule 1: code outside a slice imports it only through the slice `index` or `port` entry, never a deep path. Enforced by oxlint `no-restricted-imports` in `.oxlintrc.json`, with an override that turns the rule off inside the slice dirs.

Rule 2: adapters (`OpenAiChatClient`, `PocketTts`, `WhisperStt`, `BuiltinKittenTts`, `BuiltinSherpaStt`) are constructed only in composition roots, `apps/server/src/api/app.ts` and `apps/server/src/voice/loop.ts`, and in tests. Everything else depends on the port interface and receives the adapter by injection. Enforced by `rules/no-adapter-construction-outside-roots.yml` (ast-grep).

Both checks are warnings for now. The slice dirs do not all exist yet and existing callers still deep-import, so the warnings are the migration worklist. Once a slice lands and its warnings reach zero, promote its check to error.

The `maxFileLoc` ratchet now skips `vendor/` dirs and is set to 850 (current max is 825), so slice extraction can only shrink files.

## consequences

New code gets warnings instead of silently adding coupling. No gate breaks. Promotion to error is a per-slice follow-up under #80.
