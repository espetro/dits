/**
 * Dashboard markup for the control shell. Uses the app's design system
 * (theme.css tokens: cream ground, espresso ink, persimmon accent, Fraunces
 * display) so the shell reads as the same product. The webview never loads
 * the SPA; "open di" goes to the real browser. Fraunces is served from the
 * bundled SPA assets (views/web/fonts → /fonts/*); without a built SPA the
 * serif/system fallbacks keep the layout usable.
 */
export function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>di.</title>
<style>
  /* di design tokens — mirrors apps/web/src/theme.css (Variant B). */
  :root {
    --cream: #fdfbf9;
    --cream-deep: #f7f1ea;
    --paper: #fffdfb;
    --espresso: #2b2118;
    --espresso-soft: #6b5d4f;
    --espresso-faint: #a89a8a;
    --persimmon: #ff6f1e;
    --persimmon-deep: #c2480a;
    --persimmon-soft: #ffe8d9;
    --persimmon-faint: #fff3ea;
    --sage: #8a9b7d;
    --hairline: rgba(43, 33, 24, 0.08);
    --font-display: "Fraunces", ui-serif, Georgia, serif;
    --font-body: "Plus Jakarta Sans Variable", ui-sans-serif, system-ui, sans-serif;
    --font-mono: "Berkeley Mono", ui-monospace, "SF Mono", monospace;
    --ease-out-expo: cubic-bezier(0.32, 0.72, 0, 1);
    color-scheme: light;
  }
  @font-face {
    font-family: "Fraunces";
    font-style: normal;
    font-weight: 900;
    font-display: swap;
    src: local("Fraunces Black"), url("/fonts/Fraunces-Black.woff2") format("woff2");
  }
  @font-face {
    font-family: "Fraunces";
    font-style: italic;
    font-weight: 900;
    font-display: swap;
    src: local("Fraunces Black Italic"), url("/fonts/Fraunces-BlackItalic.woff2") format("woff2");
  }
  @font-face {
    font-family: "Fraunces";
    font-style: normal;
    font-weight: 400;
    font-display: swap;
    src: local("Fraunces Regular"), url("/fonts/Fraunces-Regular.woff2") format("woff2");
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    background: var(--cream);
    color: var(--espresso);
    font: 14px/1.55 var(--font-body);
    -webkit-font-smoothing: antialiased;
  }
  /* ambient orbs + grain, same recipe as the app shell */
  .ambient::before {
    content: "";
    position: fixed;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    background:
      radial-gradient(42rem 42rem at 85% -10%, rgba(255, 111, 30, 0.1), transparent 65%),
      radial-gradient(36rem 36rem at -8% 100%, rgba(138, 155, 125, 0.09), transparent 65%),
      radial-gradient(28rem 28rem at 70% 110%, rgba(242, 201, 76, 0.07), transparent 60%);
  }
  .grain::after {
    content: "";
    position: fixed;
    inset: 0;
    z-index: 40;
    pointer-events: none;
    opacity: 0.035;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E");
  }
  main {
    position: relative;
    z-index: 1;
    max-width: 560px;
    margin: 0 auto;
    padding: 28px 20px 40px;
  }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; }
  .wordmark {
    font-family: var(--font-display);
    font-size: 30px;
    font-weight: 900;
    font-style: italic;
    color: var(--persimmon-deep);
    letter-spacing: -0.01em;
  }
  .badge {
    border-radius: 999px;
    background: var(--espresso);
    color: var(--cream);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    padding: 4px 12px;
  }
  .card {
    background: var(--paper);
    border: 1px solid var(--hairline);
    border-radius: 20px;
    padding: 18px 20px;
    box-shadow: 0 2px 6px rgba(43, 33, 24, 0.04);
  }
  .row { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--espresso-faint);
    flex: none;
    transition: all 400ms var(--ease-out-expo);
  }
  .dot.on {
    background: var(--persimmon);
    box-shadow: 0 0 0 4px var(--persimmon-soft), 0 2px 10px rgba(194, 72, 10, 0.25);
  }
  #state { font-weight: 700; font-size: 15px; }
  #url { color: var(--espresso-soft); font-family: var(--font-mono); font-size: 12px; }
  .muted {
    color: var(--espresso-faint);
    font-size: 12px;
    font-family: var(--font-mono);
    word-break: break-all;
    user-select: text;
  }
  .microlabel {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--espresso-faint);
  }
  .actions { display: flex; gap: 10px; margin: 16px 0 4px; }
  button {
    font: inherit;
    font-weight: 600;
    border-radius: 999px;
    padding: 9px 18px;
    cursor: pointer;
    border: 1px solid var(--hairline);
    background: var(--paper);
    color: var(--espresso);
    transition: all 250ms var(--ease-out-expo);
  }
  button:hover:not(:disabled) { background: var(--cream-deep); }
  button:disabled { opacity: 0.35; cursor: default; }
  button.primary {
    background: var(--persimmon);
    color: var(--cream);
    border-color: var(--persimmon);
    box-shadow: 0 10px 24px -10px rgba(255, 111, 30, 0.5);
  }
  button.primary:hover:not(:disabled) { background: var(--persimmon-deep); border-color: var(--persimmon-deep); }
  button.espresso {
    background: var(--espresso);
    color: var(--cream);
    border-color: var(--espresso);
  }
  button.espresso:hover:not(:disabled) { background: #3d2f22; }
  #err { color: #c0392b; min-height: 20px; font-size: 12.5px; margin-top: 8px; }
  details { margin-top: 16px; }
  summary {
    cursor: pointer;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 8px;
    user-select: none;
  }
  summary::-webkit-details-marker { display: none; }
  summary .chev { transition: transform 250ms var(--ease-out-expo); display: inline-block; }
  details[open] summary .chev { transform: rotate(90deg); }
  summary:hover .microlabel { color: var(--espresso-soft); }
  pre {
    margin: 10px 0 0;
    padding: 14px;
    background: #1a1512;
    border-radius: 14px;
    height: 260px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
    color: #e8e0d8;
    font: 11.5px/1.6 var(--font-mono);
  }
  .logpath {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-top: 10px;
  }
  .logpath .microlabel { flex: none; white-space: nowrap; }
  .logpath code {
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--espresso-soft);
    word-break: break-all;
    user-select: text;
  }
  button.copy {
    padding: 3px 10px;
    font-size: 11px;
    flex: none;
  }
</style>
</head>
<body class="ambient grain">
<main>
  <div class="brand"><span class="wordmark">di.</span><span class="badge">desktop</span></div>
  <div class="card">
    <div class="row"><span id="dot" class="dot"></span><span id="state">checking…</span><span id="url"></span></div>
    <div class="row muted" id="config"></div>
    <div class="actions">
      <button id="toggle" class="espresso">start</button>
      <button id="open" class="primary">open di →</button>
    </div>
    <div id="err"></div>
    <details id="logpanel">
      <summary><span class="chev">▸</span><span class="microlabel">server log (<span id="logcount">0</span>)</span></summary>
      <div class="logpath"><span class="microlabel">saved to</span><code id="logpath">–</code><button id="copylog" class="copy">copy</button></div>
      <pre id="logs"></pre>
    </details>
  </div>
</main>
<script>
  const $ = (id) => document.getElementById(id);
  const err = (m) => { $("err").textContent = m || ""; };
  let lastLogPath = "";

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
    toggle.className = s.running ? "" : "espresso";
    toggle.onclick = () => post(s.running ? "stop" : "start");
    $("open").disabled = !s.running;
    lastLogPath = s.logPath || "";
    $("logpath").textContent = s.logPath || "(log file disabled — set files.log_path in config)";
    $("logs").textContent = s.logs.join("\\n") || "(no output yet)";
    $("logcount").textContent = s.logs.length;
    $("logs").scrollTop = $("logs").scrollHeight;
  }

  $("open").onclick = () => post("open");
  $("copylog").onclick = async () => {
    if (!lastLogPath) return;
    try {
      await navigator.clipboard.writeText(lastLogPath);
      $("copylog").textContent = "copied";
    } catch {
      const r = document.createRange();
      r.selectNodeContents($("logpath"));
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      $("copylog").textContent = "select+copy";
    }
    setTimeout(() => { $("copylog").textContent = "copy"; }, 1200);
  };
  refresh();
  setInterval(refresh, 1500);
</script>
</body>
</html>`;
}
