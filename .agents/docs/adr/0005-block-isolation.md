# ADR 0005: block isolation by slice

status: accepted (2026-10-14), enforcement promoted to error (2026-10-14)
builds on: ADR-0002 (websocket voice, injected ports)
issue: #80

## context

The llm, tts and stt blocks are about to be split into slices so each can be swapped, tested and reasoned about alone. Today callers deep-import adapter files (for example `voice/stt/wav`, `voice/tts/pocket-tts`) and construct adapters wherever convenient, which couples callers to one implementation.

## decision

Planned slices: `apps/web/src/lib/{llm,tts,stt}` and `apps/server/src/voice/{llm,tts,stt}`.

Rule 1: code outside a slice imports it only through the slice `index` or `port` entry, never a deep path. Enforced by oxlint `no-restricted-imports` in `.oxlintrc.json`, with an override that turns the rule off inside the slice dirs.

Rule 2: adapters (`OpenAiChatClient`, `PocketTts`, `WhisperStt`, `BuiltinKittenTts`, `BuiltinSherpaStt`) are constructed only in composition roots, `apps/server/src/api/app.ts` and `apps/server/src/voice/loop.ts`, and in tests. Everything else depends on the port interface and receives the adapter by injection. Enforced by `rules/no-adapter-construction-outside-roots.yml` (ast-grep).

Both checks started as warnings and are now errors. All six slices exist and no caller deep-imports them or constructs adapters outside the allowed places, so the warning worklist is empty. Documented exceptions for rule 2: the composition roots, the per-slice `registry.ts` factories (`apps/server/src/voice/{llm,tts,stt}/registry.ts`, the slice-owned way callers obtain an adapter) and tests. Rule 1 is off inside the slice dirs.

The `maxFileLoc` ratchet now skips `vendor/` dirs and is set to 850 (current max is 825), so slice extraction can only shrink files.

## consequences

New coupling fails the gate (oxlint and ast-grep scan in `validate:quick`).
