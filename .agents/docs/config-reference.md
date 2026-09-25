# Config reference

Config file is YAML, validated by `ConfigSchema` in `packages/shared/src/config.ts`. Any key
can be overridden by env: `DI_` prefix, `__` as nesting separator, digits coerced to
numbers. Example: `DI_LLM__MODEL=gpt-4o` overrides `llm.model`;
`DI_SERVER__PORT=9000` overrides `server.port`. A value in env always wins over the
yaml file. Case-insensitive key paths after the prefix.

| Key                   | Type                              | Default                              | Description                                                      |
| --------------------- | --------------------------------- | ------------------------------------ | ---------------------------------------------------------------- |
| `server.port`         | int 1..65535                      | required                             | HTTP port for the API and SPA                                    |
| `server.auth`         | `none` \| `token`                 | `none`                               | auth middleware stub, inert in v1                                |
| `llm.provider`        | `openai` \| `anthropic` \| `mock` | required                             | LLM contract; endpoints are all OpenAI-shaped                    |
| `llm.base_url`        | url                               | required                             | OpenAI-compatible base URL, e.g. `http://localhost:9000/v1`      |
| `llm.api_key`         | string                            | optional                             | bearer key for the LLM endpoint                                  |
| `llm.model`           | string                            | required                             | model id                                                         |
| `stt.base_url`        | url                               | required                             | speech-to-text endpoint (OpenAI transcription shape)             |
| `stt.api_key`         | string                            | optional                             | bearer key                                                       |
| `stt.model`           | string                            | required                             | STT model id                                                     |
| `stt.mode`            | `buffered`                        | required                             | transport is streaming WS; recognition is per-utterance buffered |
| `tts.base_url`        | url                               | required                             | text-to-speech endpoint                                          |
| `tts.api_key`         | string                            | optional                             | bearer key                                                       |
| `tts.model`           | string                            | required                             | TTS model id                                                     |
| `tts.voice`           | string                            | required                             | voice id, e.g. `alloy`                                           |
| `embeddings.base_url` | url                               | optional                             | embeddings endpoint                                              |
| `embeddings.api_key`  | string                            | optional                             | bearer key                                                       |
| `embeddings.model`    | string                            | required if embeddings block present | embeddings model id                                              |
| `phoenix.endpoint`    | url                               | optional                             | Arize Phoenix tracing endpoint                                   |
| `phoenix.headers`     | map                               | optional                             | headers for the Phoenix endpoint                                 |
| `files.db_path`       | string                            | required                             | SQLite database path                                             |
| `files.log_path`      | string                            | required                             | log file path                                                    |
| `files.data_dir`      | string                            | required                             | data directory                                                   |

Standalone env vars:

| Var                   | Effect                                                            |
| --------------------- | ----------------------------------------------------------------- |
| `DI_TEST_MODE=1`      | mounts `/v1/test/*` debug routes                                  |
| `DI_URL`              | target server for the e2e suite (default `http://localhost:3000`) |
| `DI_<SECTION>__<KEY>` | yaml override for any config key, see rules above                 |

## API

The full machine-readable surface lives at `GET /v1/openapi.json` on a running
server (OpenAPI 3.1). Summary:

| Endpoint                                   | Purpose                                                                                              |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `POST /v1/sessions`                        | create session (`title`, `mode: interview\|coach`, `duration_min` 5..120, optional `prompt`)         |
| `GET /v1/sessions`, `GET /v1/sessions/:id` | list / read sessions                                                                                 |
| `POST /v1/sessions/:id/turns`              | append a transcript turn                                                                             |
| `GET /v1/sessions/:id/turns`               | read transcript                                                                                      |
| `POST /v1/sessions/:id/events`             | worker -> server session event                                                                       |
| `PUT` / `GET /v1/sessions/:id/tools`       | editor + whiteboard state the worker reads via `read_editor` / `read_whiteboard`                     |
| `POST /v1/sessions/:id/documents`          | upload files for RAG ingestion (multipart `file`, repeatable; pdf/md/txt/docx, 10 files / 20MB caps) |
| `GET /v1/sessions/:id/documents`           | list uploaded documents with ingestion status                                                        |
| `DELETE /v1/sessions/:id/documents/:docId` | remove a document and its chunks                                                                     |
| `GET /v1/sessions/:id/context`             | retrieved document chunks grounding the agent (optional `?query=`)                                   |
| `PUT` / `GET /v1/sessions/:id/report`      | store / read the scored report                                                                       |
| `GET /v1/sessions/:id/voice`               | WebSocket upgrade; voice loop (messages: `packages/shared/src/voice.ts`, not in openapi.json)        |
