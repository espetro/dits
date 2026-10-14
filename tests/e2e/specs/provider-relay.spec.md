# e2e: provider relay (browser provider calls through the di server)

Covers the `/v1/relay` bridge: when the di server is reachable, browser-side
provider calls (model dropdown `/v1/models` probes, settings llm Test, chat)
are rewritten same-origin through the server, so CORS-hostile endpoints
(openrouter, keyless bifrost) work. The mock provider runs with `--no-cors`
(no ACAO headers, preflight 403) to reproduce the exact browser-direct
failure mode the relay exists to fix.

Preconditions (see AGENTS.md): di server in test mode on `DI_URL`, web dev
server on :5173 with `VITE_DI_API_BASE=$DI_URL`. The no-CORS mock provider
is spawned by the spec on `MOCK_NOCORS_PORT` (default 9100).

## dropdown populates via relay, no-CORS upstream, keyless

Open settings (voice pane), pick the "cloud endpoint" llm layer, set Base URL
to the no-CORS mock, leave the API key empty (keyless gateways like bifrost
are a first-class case). The Model ID datalist fills with the mock's fixture
model ids; the mock recorded the `/v1/models` hit; zero `blocked by CORS`
console errors.

## dropdown populates via relay with key, no-CORS upstream

Same as above with an API key set. The datalist fills and the mock's recorded
`/v1/models` request carries the `authorization` header (the relay allowlist
forwards it).

## chat through relay, no-CORS upstream

Settings llm remote section against the no-CORS mock; the Test button streams
a short completion and reports ok; the mock recorded the
`/v1/chat/completions` hit; zero CORS console errors.

## abort propagates, no zombie upstream

A streaming chat request through `/v1/relay` aborted client-side drains the
mock's in-flight count to zero: the relay wires the incoming request signal
through to upstream, so no zombie provider streams survive a page abort.

## browser-direct fallback (no di server)

Env-gated (`RELAY_FALLBACK_URL`): a build served with no reachable di server
keeps populating the dropdown browser-direct against a CORS-ENABLED endpoint,
guarding the public-site no-regression clause.
