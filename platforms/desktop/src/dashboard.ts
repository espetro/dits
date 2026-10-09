/**
 * Dashboard markup for the control shell. Plain/dark on purpose — this is a
 * control surface, not product UI, and does not reuse the app's design system.
 * The webview never loads the SPA; "open di" goes to the real browser.
 */
export function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>di.</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 24px;
    background: #0c0c0e;
    color: #d7d7db;
    font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 16px; letter-spacing: 0.02em; }
  .row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #55565c; flex: none; }
  .dot.on { background: #46c46c; }
  #state { color: #9a9aa2; }
  #url { color: #d7d7db; }
  .muted { color: #62626a; font-size: 12px; word-break: break-all; }
  .actions { display: flex; gap: 8px; margin: 16px 0 20px; }
  button {
    background: #1d1d22;
    color: #d7d7db;
    border: 1px solid #333338;
    border-radius: 6px;
    padding: 7px 14px;
    font: inherit;
    cursor: pointer;
  }
  button:hover:not(:disabled) { background: #26262c; }
  button:disabled { opacity: 0.4; cursor: default; }
  button.primary { background: #d7d7db; color: #0c0c0e; border-color: #d7d7db; }
  button.primary:hover:not(:disabled) { background: #ffffff; }
  h2 { font-size: 12px; font-weight: 600; color: #62626a; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.08em; }
  pre {
    margin: 0;
    padding: 12px;
    background: #101013;
    border: 1px solid #1d1d22;
    border-radius: 6px;
    height: 300px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
    color: #8f8f97;
    font-size: 12px;
  }
  #err { color: #e06c6c; min-height: 18px; }
</style>
</head>
<body>
  <h1>di.</h1>
  <div class="row"><span id="dot" class="dot"></span><span id="state">checking…</span><span id="url"></span></div>
  <div class="row muted" id="config"></div>
  <div class="actions">
    <button id="toggle" class="primary">start</button>
    <button id="open">open di</button>
  </div>
  <div id="err"></div>
  <h2>server log</h2>
  <pre id="logs"></pre>
<script>
  const $ = (id) => document.getElementById(id);
  const err = (m) => { $("err").textContent = m || ""; };

  async function post(path) {
    err("");
    const res = await fetch("/api/" + path, { method: "POST" });
    if (!res.ok) err(await res.text());
    await refresh();
  }

  async function refresh() {
    let s;
    try {
      s = await (await fetch("/api/state")).json();
    } catch (e) {
      err("control api unreachable");
      return;
    }
    $("dot").className = "dot" + (s.running ? " on" : "");
    $("state").textContent = s.running ? "running" : "stopped";
    $("url").textContent = s.running ? s.url : "";
    $("config").textContent = s.configPath ? "config: " + s.configPath : "";
    const toggle = $("toggle");
    toggle.textContent = s.running ? "stop" : "start";
    toggle.onclick = () => post(s.running ? "stop" : "start");
    $("open").disabled = !s.running;
    $("logs").textContent = s.logs.join("\\n") || "(no output yet)";
    $("logs").scrollTop = $("logs").scrollHeight;
  }

  $("open").onclick = () => post("open");
  refresh();
  setInterval(refresh, 1500);
</script>
</body>
</html>`;
}
