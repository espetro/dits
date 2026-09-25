# e2e: full interview loop

The coverage the earlier suite encoded as green: turns that reach the agent
over the real transport, a report produced by the generator (not PUT
round-trips), and the finish -> report flow the user actually walks.

Server mode needs the test-mode server AND the mock provider
(`bun run packages/evals/mock-provider/main.ts --port 9000`). The client-only
test needs the web dev server.

## voice ws text turn reaches the agent and persists both sides

`{t:"text"}` over the voice WebSocket takes the same pipeline as speech:
`user_transcript` -> `agent_transcript` -> `agent_speaking on` -> binary tts
frames -> `agent_speaking off`. Both turns land in `GET /turns` with
`source: "text"`.

## kickoff greets an idle session

Open the voice WS and send nothing. After `KICKOFF_DELAY_MS` (5s) the loop
fires the synthetic kickoff turn itself — an `agent_transcript` greeting
arrives unprompted and the turn is persisted.

## report is generated, not just stored

`POST /v1/sessions/:id/report` runs the real `generateReport` against the
mock provider (which echoes a schema-valid report for report prompts) and
flips the session to `reported`; a second POST returns the same stored
report without regenerating.

## finish builds the report and lands on /report/:id

(client-only) After a typed turn, navigating to `/finish/[id]` auto-builds
the report through `generateReport` + the mocked chat endpoint and advances
to `/report/[id]`, where the score and competencies render.
