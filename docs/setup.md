# Setup guide

Get **di.** running locally and start your first interview.

## 1. Get the app

### Option A: download a release (easiest)

Every tagged release ships prebuilt archives for Linux and macOS (x64 and arm64),
built by `mise run release` in CI. Grab the latest one from
[GitHub Releases](https://github.com/espetro/dits/releases), matching your platform
(`di-<version>-<platform>-<arch>.tar.gz`, e.g. `di-2026.36.0-darwin-arm64.tar.gz`).

```sh
tar xzf di-<version>-<platform>-<arch>.tar.gz
cd di-<version>-<platform>-<arch>
./install.sh   # or just run ./di directly
```

The archive bundles the compiled `di` binary, the built web SPA,
and a reference `config.example.yaml`. No `bun install` or build step needed.

### Option B: build from source

Requires [bun](https://bun.sh) and [mise](https://mise.jdx.dev).

```sh
curl -fsSL https://bun.sh/install | bash
curl -fsSL https://mise.jdx.dev/install.sh | sh

git clone https://github.com/espetro/dits.git dits
cd dits
bun install
mise run build   # builds the web SPA into apps/web/dist/client
```

## 2. Configure a provider

Copy the example config and edit it:

```sh
cp config.example.yaml config.yaml
```

By default it points `llm`, `stt`, `tts`, and `embeddings` at the in-repo mock
provider, so you can try the app with zero API keys:

```sh
bun run packages/evals/mock-provider/main.ts --port 9000 &
```

For a real interview, point each provider block at any OpenAI-compatible endpoint.
Example with OpenAI:

```yaml
llm:
  provider: openai
  base_url: https://api.openai.com/v1
  api_key: sk-...
  model: gpt-4o

stt:
  base_url: https://api.openai.com/v1
  api_key: sk-...
  model: whisper-1
  mode: buffered

tts:
  base_url: https://api.openai.com/v1
  api_key: sk-...
  model: tts-1
  voice: alloy
```

The same shape works against a local Ollama or vLLM server: set `base_url` to your
local endpoint and drop `api_key` if the server doesn't need one. `embeddings` is
optional and only needed if you want to upload documents (CV, JD) for retrieval
during the interview.

Voice interviews also need a LiveKit server. For local dev:

```sh
livekit-server --dev   # api_key: devkey, api_secret: secret, url: ws://localhost:7880
```

```yaml
livekit:
  url: ws://localhost:7880
  api_key: devkey
  api_secret: secret
```

Validate config and provider connectivity before starting the server:

```sh
./di --config config.yaml --check
# or, from source: bun run apps/server/src/cli.ts --config config.yaml --check
```

Full key-by-key reference: [`.agents/docs/config-reference.md`](../.agents/docs/config-reference.md).

## 3. Run your first interview

```sh
./di --config config.yaml
# or, from source: bun run apps/server/src/cli.ts --config config.yaml
```

Open `http://localhost:3000` (or whatever `server.port` you set), pick a preset or
paste your own prompt, optionally upload a CV/JD, set a duration, and start. You'll
get a live voice interview, then a transcript and a scored report saved to local
history.

## Troubleshooting

- **Port already in use**: the server binds `server.port` (default `3000`), the
  mock provider `9000`, LiveKit `7880`. Override the server port with
  `DI_SERVER__PORT=<port>` or edit `config.yaml`; kill strays with
  `lsof -ti :PORT | xargs kill`.
- **`--check` fails on llm/stt/tts**: the provider endpoint isn't reachable. For
  offline use, start the mock provider first and point `base_url` at
  `http://localhost:9000/v1`.
- **LiveKit connection fails**: voice needs a LiveKit server matching
  `livekit.url` / `api_key` / `api_secret`. For local dev, `livekit-server --dev`
  with the default `devkey`/`secret` works.
- **Blank UI**: the server only serves the SPA if `apps/web/dist/client` exists. If
  you built from source, run `mise run build` first.
- **Config errors name the exact key** (e.g. `config.llm.model: ...`). Bad env
  overrides report the effective key path too.
