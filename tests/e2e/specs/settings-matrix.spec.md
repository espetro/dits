# e2e: settings matrix (provider layers x server state x CORS x key)

Covers the settings dialog Test rows and the model combobox across the combinations that have broken in the field. Runs against two mocks owned by this spec: `mxCors` (CORS on) and `mxNoCors` (no ACAO headers, preflight 403). Each scenario title below is a prefix of the executed test title.

## S1 fresh visitor, cors-off endpoint: list populates and Test works

Nothing persisted. Pick the cloud endpoint llm layer, point it at the cors-off mock with a key. The model list fills and Test says Working, with no CORS console errors, because the di server relays the call.

## S2 stale unreachable cache, cors-off endpoint: list populates once the probe settles

The reachability cache says the server is down although it is up. The probe settles reachable, then the list fills and Test works.

## S3 Test clicked while the health probe is still in flight gives a precise result

`/api/health` is delayed 3s and Test is clicked immediately. The result is either Working or a specific failure, never a generic fetch error, and never a CORS console error.

## S4 server gone but cache says reachable: cors-on works, cors-off names CORS

The cache says reachable and the server is unreachable. A cors-on endpoint works browser-direct. A cors-off endpoint fails with a status line that names CORS.

## S5 key and keyless against cors-on and cors-off

Keyless fills the list but leaves Test disabled. With a key, the Authorization header reaches the upstream through the relay, and the cors-on endpoint works too.

## S6 stt and tts rows: server and cloud picks report a result

The stt row with the desktop app pick finishes with a status. The tts row reports Working for the desktop app pick and for a cloud endpoint pick.

## S7 model combobox states: loading, populated, empty, error, keyboard pick

Populated list, keyboard selection that survives a reload, an empty list message, an html 200 "not a model list" alert, and a 401 alert.

## S8 slow reasoning model: pending, then ok, no timeout

The mock thinks for 4s before the first token. Test shows a busy state, then Working.
