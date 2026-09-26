# Config reference

Config file is YAML, validated by `ConfigSchema` in `packages/shared/src/config.ts`. Any key
can be overridden by env: `DI_` prefix, `__` as nesting separator, digits coerced to
numbers. Example: `DI_LLM__MODEL=gpt-4o` overrides `llm.model`;
`DI_SERVER__PORT=9000` overrides `server.port`. A value in env always wins over the
yaml file. Case-insensitive key paths after the prefix.

| Key                     | Type                              | Default                              | Description                                                              |
| ----------------------- | --------------------------------- | ------------------------------------ | ------------------------------------------------------------------------ |
| `server.port`           | int 1..65535                      | required                             | HTTP port for the API and SPA                                            |
| `server.auth`           | `none` \| `token`                 | `none`                               | auth middleware stub, inert in v1                                        |
| `llm.provider`          | `openai` \| `anthropic` \| `mock` | required                             | LLM contract; endpoints are all OpenAI-shaped                            |
| `llm.base_url`          | url                               | required                             | OpenAI-compatible base URL, e.g. `http://localhost:9000/v1`              |
| `llm.api_key`           | string                            | optional                             | bearer key for the LLM endpoint                                          |
| `llm.model`             | string                            | required                             | model id                                                                 |
| `llm.reasoning_exclude` | bool                              | `false`                              | send `reasoning: {exclude: true}` (OpenRouter-style) on chat completions |
| `llm.thinking_disabled` | bool                              | `false`                              | send `thinking: {type: "disabled"}` (Z.AI-style) on chat completions     |
| `stt.base_url`          | url                               | required                             | speech-to-text endpoint (OpenAI transcription shape)                     |
| `stt.api_key`           | string                            | optional                             | bearer key                                                               |
| `stt.model`             | string                            | required                             | STT model id                                                             |
| `stt.mode`              | `buffered`                        | required                             | transport is streaming WS; recognition is per-utterance buffered         |
| `tts.base_url`          | url                               | required                             | text-to-speech endpoint                                                  |
| `tts.api_key`           | string                            | optional                             | bearer key                                                               |
| `tts.model`             | string                            | required                             | TTS model id                                                             |
| `tts.voice`             | string                            | required                             | voice id, e.g. `alloy`                                                   |
| `embeddings.base_url`   | url                               | optional                             | embeddings endpoint                                                      |
| `embeddings.api_key`    | string                            | optional                             | bearer key                                                               |
| `embeddings.model`      | string                            | required if embeddings block present | embeddings model id                                                      |
| `phoenix.endpoint`      | url                               | optional                             | Arize Phoenix tracing endpoint                                           |
| `phoenix.headers`       | map                               | optional                             | headers for the Phoenix endpoint                                         |
| `files.db_path`         | string                            | optional                             | SQLite database path (default: platform data dir, below)                 |
| `files.log_path`        | string                            | optional                             | log file path (default: platform data dir)                               |
| `files.data_dir`        | string                            | optional                             | data directory (default: platform data dir)                              |

Omitted `files.*` keys default to the platform app-support dir: `~/Library/Application Support/di` on macOS, `%APPDATA%/di` on Windows, `$XDG_DATA_HOME/di` or `~/.local/share/di` elsewhere. A present-but-non-object `files:` still fails validation.

Standalone env vars:

| Var                   | Effect                                                                     |
| --------------------- | -------------------------------------------------------------------------- |
| `DI_TEST_MODE=1`      | mounts `/v1/test/*` debug routes                                           |
| `DI_URL`              | target server for the e2e suite (default `http://localhost:3000`)          |
| `DI_DEMO_LLM_*`       | demo LLM endpoint for `dev:server:demo-llm` (`BASE_URL`/`MODEL`/`API_KEY`) |
| `VITE_DEMO_LLM_*`     | same endpoint exposed to the SPA's one-click demo fill                     |
| `VITE_VOICE_DEFAULT`  | pin the voice driver (`server`/`browser`), overrides runtime probe         |
| `DI_<SECTION>__<KEY>` | yaml override for any config key, see rules above                          |

## API

The full machine-readable surface lives at `GET /v1/openapi.json` on a running
server (OpenAPI 3.1). Summary:

| Endpoint                                   | Purpose                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `POST /v1/sessions`                        | create session (`title`, `mode: interview\|coach`, `duration_min` 5..120, optional `prompt`, `tools` record) |
| `GET /v1/sessions`, `GET /v1/sessions/:id` | list / read sessions                                                                                         |
| `PATCH /v1/sessions/:id`                   | update status (`active`\|`ended`\|`discarded`)                                                               |
| `POST /v1/sessions/:id/turns`              | append a transcript turn                                                                                     |
| `GET /v1/sessions/:id/turns`               | read transcript                                                                                              |
| `POST /v1/sessions/:id/events`             | append a session lifecycle event                                                                             |
| `PUT` / `GET /v1/sessions/:id/tools`       | tool-state record keyed by toolId; the voice loop's `read_*`/`update_*` tools read it                        |
| `POST /v1/sessions/:id/documents`          | upload files for RAG ingestion (multipart `file`, repeatable; pdf/md/txt/docx, 10 files / 20MB caps)         |
| `GET /v1/sessions/:id/documents`           | list uploaded documents with ingestion status                                                                |
| `DELETE /v1/sessions/:id/documents/:docId` | remove a document and its chunks                                                                             |
| `GET /v1/sessions/:id/context`             | retrieved document chunks grounding the agent (optional `?query=`)                                           |
| `POST /v1/sessions/:id/report`             | generate the report from the transcript (idempotent; what `/finish` calls)                                   |
| `PUT` / `GET /v1/sessions/:id/report`      | store / read the scored report                                                                               |
| `GET /v1/sessions/:id/voice`               | WebSocket upgrade; voice loop (messages: `packages/shared/src/voice.ts`, not in openapi.json)                |
