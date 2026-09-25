# Setup prompt: clone to a full interview session via API

Copy everything below the line into an LLM agent. It goes from a fresh clone to a running stack and one complete interview session driven entirely over HTTP in test mode, no API keys needed.

---

You are setting up di, a local-first AI mock interview agent, and driving one interview session through its HTTP API. Work on macOS or Linux with bash. Do not open a browser; everything is done with curl.

## 1. Install toolchain

di needs bun and mise. If missing, install:

```sh
curl -fsSL https://mise.jdx.dev/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
mise use -g bun@latest node@24
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"
```

Verify: `bun --version` and `mise --version` both print.

## 2. Clone and build

```sh
git clone <repo-url> deep-interview && cd deep-interview
bun install
mise run build
```

`mise run build` must finish without errors. It produces `apps/web/dist/client` (the SPA the server serves) and the worker bundle. If the build fails, stop and report the error; do not try to patch code.

## 3. Generate a config with the mock provider

Write `config.yaml` in the repo root with exactly this content:

```yaml
server:
  port: 8090
  auth: none

llm:
  provider: mock
  base_url: http://localhost:9000/v1
  model: mock-llm

stt:
  base_url: http://localhost:9000/v1
  model: mock-stt
  mode: buffered

tts:
  base_url: http://localhost:9000/v1
  model: mock-tts
  voice: alloy

files:
  db_path: .deepinterview/di.db
  log_path: .deepinterview/di.log
  data_dir: .deepinterview/data
```

No API keys are needed: everything points at the in-repo mock provider.

## 4. Verify with di --check

Start the mock provider, then validate:

```sh
bun run packages/evals/mock-provider/main.ts --port 9000 &
sleep 1
bun run apps/server/src/cli.ts --config config.yaml --check
```

Expected output ends with `[di --check] all good` (db plus llm, stt, tts probes all ok). If a probe fails, check that port 9000 is actually listening: `curl -s localhost:9000/v1/models`.

## 5. Start the stack in test mode

```sh
DI_TEST_MODE=1 bun run apps/server/src/cli.ts --config config.yaml &
sleep 2
curl -s localhost:8090/v1/test/ping
```

The ping must return `{"testMode":true}`. If it returns 404, `DI_TEST_MODE=1` did not reach the server; restart with the env var inline as shown.

## 6. Drive one full interview session via API

Run this block as-is. It creates a session, posts a user turn and an agent turn, pushes tool state, stores a report, and asserts every step.

```sh
set -e
BASE=http://localhost:8090
SID=$(curl -s -X POST $BASE/v1/sessions -H 'content-type: application/json' \
  -d '{"title":"behavioral warmup","mode":"interview","duration_min":30}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
echo "session: $SID"
test $(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/v1/sessions/$SID/turns \
  -H 'content-type: application/json' \
  -d '{"id":"'"$(uuidgen | tr A-Z a-z)"'","seq":0,"speaker":"user","text":"I want to practice system design questions","created_at":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","source":"text"}') = 201
test $(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/v1/sessions/$SID/turns \
  -H 'content-type: application/json' \
  -d '{"id":"'"$(uuidgen | tr A-Z a-z)"'","seq":1,"speaker":"agent","text":"Walk me through how you would design a rate limiter.","created_at":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","source":"text"}') = 201
test $(curl -s -o /dev/null -w '%{http_code}' -X PUT $BASE/v1/sessions/$SID/tools \
  -H 'content-type: application/json' \
  -d '{"editor":"rate limiter notes: token bucket","whiteboard":"{\"shapeCount\":1}"}') = 200
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
test $(curl -s -o /dev/null -w '%{http_code}' -X PUT $BASE/v1/sessions/$SID/report \
  -H 'content-type: application/json' \
  -d '{"session_id":"'$SID'","overall_score":7.8,"coverage_pct":80,"competencies":[{"name":"system design","score":7.5,"evidence":[{"quote":"token bucket","turn_seq":0,"verdict":"worked"}]}],"model_answers":[],"generated_at":"'$NOW'"}') = 200
curl -s $BASE/v1/sessions/$SID/report | python3 -c 'import sys,json;r=json.load(sys.stdin);assert r["overall_score"]==7.8;print("report ok")'
curl -s $BASE/v1/test/state | python3 -c 'import sys,json;s=json.load(sys.stdin);assert any(x["id"]=="'$SID'" for x in s["sessions"]);assert any(r["session_id"]=="'$SID'" for r in s["reports"]);print("state ok")'
curl -s "$BASE/v1/test/events?session_id=$SID" >/dev/null
echo "full session driven: $SID"
```

Every assertion must pass and the last line must print `full session driven: <uuid>`.

## 7. Report back

Summarize: versions installed, build result, `--check` output, the session id, and any step that failed with its exact error output. Do not modify source files. To stop the stack afterwards: `kill %1 %2` or `lsof -ti :8090 :9000 | xargs kill`.

## Troubleshooting

- `config file not found` / `invalid config`: the yaml path or a key is wrong. Errors name the exact key (`config.llm.model: ...`).
- Port 8090 or 9000 in use: `lsof -ti :8090 | xargs kill`, or change `server.port` in config.yaml.
- `/v1/test/ping` 404: server was started without `DI_TEST_MODE=1`.
- Blank page on `http://localhost:8090`: `apps/web/dist/client` missing, rerun `mise run build`.
- Voice: the WS voice loop runs in-process against the mock provider; no extra services needed.
