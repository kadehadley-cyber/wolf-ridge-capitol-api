// The phone app: an installable web app (PWA) served by this Worker at /app/.
// Open it in Chrome on Android (or Safari on iPhone), choose "Install app" /
// "Add to Home Screen", and Jarvis lives on the phone: tap-to-talk or
// hands-free speech in, spoken replies out, camera identification, and a
// typed fallback — all against the same brain, tools, and memory as every
// other surface. Served from the Worker's own origin, so there's no CORS and
// nothing to configure but the API key.

import { ICON_192_B64, ICON_512_B64 } from "./appIcons";

export function appManifest(name: string): string {
	return JSON.stringify({
		name,
		short_name: name,
		description: "Your J.A.R.V.I.S. — voice assistant with tools, memory, and vision.",
		start_url: "/app/",
		scope: "/app/",
		display: "standalone",
		orientation: "portrait",
		background_color: "#02060b",
		theme_color: "#02060b",
		icons: [
			{ src: "/app/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
			{ src: "/app/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
			{ src: "/app/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
		],
	});
}

// Cache the static shell so the app opens instantly (and offline shows the HUD
// with a clear "no connection" state). API calls always go to the network.
export const APP_SW = `const CACHE = "jarvis-app-v1";
const SHELL = ["/app/", "/app/icon-192.png", "/app/icon-512.png"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || !url.pathname.startsWith("/app")) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) =>
      hit || fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
    )
  );
});
`;

export function iconBytes(which: "192" | "512"): Uint8Array {
	const b64 = which === "192" ? ICON_192_B64 : ICON_512_B64;
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

export function renderAppHtml(env: Env): string {
	const name = env.JARVIS_NAME || "Jarvis";
	const needsKey = Boolean(env.JARVIS_API_KEY);
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<meta name="theme-color" content="#02060b">
<link rel="manifest" href="/app/manifest.webmanifest">
<link rel="icon" href="/app/icon-192.png">
<link rel="apple-touch-icon" href="/app/icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="${escapeHtml(name)}">
<title>${escapeHtml(name)}</title>
<style>
  :root { color-scheme: dark; --cyan:#38bdf8; --dim:#155e75; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { height: 100%; }
  body { margin:0; background:#02060b; color:#c9ecff; overflow:hidden;
         font:16px/1.45 -apple-system, system-ui, "Segoe UI", Roboto, sans-serif;
         display:flex; flex-direction:column;
         padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
  header { display:flex; align-items:center; justify-content:space-between; padding:14px 18px 0; }
  header .brand { letter-spacing:.35em; font-size:13px; color:var(--cyan); font-weight:600; }
  header button { background:none; border:1px solid #1f2933; color:#8b98a5; border-radius:8px;
                  padding:6px 10px; font-size:13px; }

  main { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; padding:0 22px; min-height:0; }

  /* Arc reactor */
  #reactor { position:relative; width:min(58vw,260px); aspect-ratio:1; border-radius:50%; flex:none; }
  #reactor .ring { position:absolute; inset:0; border-radius:50%; border:2px solid rgba(56,189,248,.55); }
  #reactor .r2 { inset:12%; border-width:1.5px; opacity:.7; animation:spin 14s linear infinite; border-style:dashed; }
  #reactor .r3 { inset:26%; opacity:.8; animation:spin 9s linear infinite reverse; }
  #reactor .core { position:absolute; inset:38%; border-radius:50%;
                   background:radial-gradient(circle,#eafcff 0%,#9fe4ff 45%,rgba(56,189,248,.25) 75%,transparent 100%);
                   box-shadow:0 0 34px 8px rgba(56,189,248,.55), 0 0 90px 24px rgba(56,189,248,.22);
                   transition:transform .18s ease; }
  @keyframes spin { to { transform:rotate(360deg); } }
  @keyframes breathe { 0%,100% { transform:scale(1);} 50% { transform:scale(1.06);} }
  body[data-state="idle"]      .core { animation:breathe 3.6s ease-in-out infinite; }
  body[data-state="listening"] .core { transform:scale(calc(1 + var(--lvl,0)*.5)); }
  body[data-state="thinking"]  .r3   { animation-duration:1.6s; }
  body[data-state="thinking"]  .core { animation:breathe 1.1s ease-in-out infinite; }
  body[data-state="speaking"]  .core { animation:breathe .9s ease-in-out infinite; }

  #status { letter-spacing:.3em; font-size:12px; color:#8b98a5; text-transform:uppercase; }
  #you    { min-height:1.4em; color:#7dd3fc; font-style:italic; text-align:center; opacity:.9; }
  #reply  { min-height:4.2em; max-height:34vh; overflow-y:auto; text-align:center; font-size:18px; }
  #reply .caret { animation:blink 1s steps(1) infinite; } @keyframes blink { 50% {opacity:0;} }

  footer { display:flex; gap:10px; padding:12px 16px calc(12px + env(safe-area-inset-bottom)); align-items:center; }
  footer input[type=text] { flex:1; background:#0b1620; border:1px solid #1f2933; color:#c9ecff;
                            border-radius:22px; padding:11px 16px; font-size:16px; min-width:0; }
  .round { flex:none; width:46px; height:46px; border-radius:50%; border:1px solid #1f2933;
           background:#0b1620; color:var(--cyan); font-size:20px; display:flex; align-items:center; justify-content:center; }
  .round[aria-pressed="true"] { background:var(--cyan); color:#02060b; }
  #mic.listening { background:var(--cyan); color:#02060b; box-shadow:0 0 22px rgba(56,189,248,.8); }

  #settings { position:fixed; inset:0; background:rgba(2,6,11,.94); display:none;
              flex-direction:column; gap:14px; padding:28px 24px; z-index:9; }
  #settings.open { display:flex; }
  #settings h2 { margin:0 0 4px; font-size:16px; letter-spacing:.2em; color:var(--cyan); }
  #settings label { font-size:13px; color:#8b98a5; display:block; margin-bottom:6px; }
  #settings input, #settings select { width:100%; background:#0b1620; border:1px solid #1f2933; color:#c9ecff;
                      border-radius:10px; padding:11px 14px; font-size:16px; }
  #settings .row2 { display:flex; gap:10px; }
  #settings button { border-radius:10px; padding:12px; font-size:15px; border:1px solid #1f2933; background:#0b1620; color:#c9ecff; }
  #settings button.primary { background:var(--cyan); color:#02060b; border:none; font-weight:600; }
  #hint { font-size:12.5px; color:#64748b; }

  #install { display:flex; align-items:center; gap:10px; margin:10px 16px 0; padding:10px 14px;
             background:#0b1620; border:1px solid #164e63; border-radius:12px; font-size:13.5px; color:#a5d8ef; }
  #install[hidden] { display:none; }
  #install button { border:none; border-radius:8px; padding:7px 12px; font-size:13px; }
  #install-go { background:var(--cyan); color:#02060b; font-weight:600; }
  #install-x { background:none; color:#64748b; font-size:16px; }
</style>
</head>
<body data-state="idle">
  <header>
    <span class="brand">J.A.R.V.I.S.</span>
    <button id="gear" aria-label="Settings">⚙︎</button>
  </header>

  <div id="install" hidden>
    <span id="install-how" style="flex:1"></span>
    <button id="install-go" hidden>Install</button>
    <button id="install-x" aria-label="Dismiss">✕</button>
  </div>

  <main>
    <div id="reactor" role="button" aria-label="Talk to ${escapeHtml(name)}">
      <div class="ring"></div><div class="ring r2"></div><div class="ring r3"></div><div class="core"></div>
    </div>
    <div id="status">standby</div>
    <div id="you"></div>
    <div id="reply"></div>
  </main>

  <footer>
    <button class="round" id="cam" aria-label="Identify with the camera">📷</button>
    <input type="text" id="typed" placeholder="Type to ${escapeHtml(name)}…" autocomplete="off">
    <button class="round" id="send" aria-label="Send">➤</button>
    <button class="round" id="mic" aria-label="Hold a conversation" aria-pressed="false">🎙</button>
  </footer>
  <input type="file" id="camfile" accept="image/*" capture="environment" hidden>

  <div id="settings">
    <h2>SETTINGS</h2>
    <div><label for="key">API key ${needsKey ? "(required by this Worker)" : "(not required)"}</label>
      <input id="key" type="password" autocomplete="off" placeholder="JARVIS_API_KEY"></div>
    <div><label for="sess">Session (memory bucket)</label>
      <input id="sess" type="text" placeholder="phone"></div>
    <div><label for="voice">Voice</label><select id="voice"></select></div>
    <div class="row2">
      <button id="save" class="primary" style="flex:1">Save</button>
      <button id="close" style="flex:1">Close</button>
    </div>
    <p id="hint">Tap the reactor to talk once. The 🎙 button keeps the conversation going hands-free.
       “What am I looking at?” with 📷 sends a photo for identification.</p>
  </div>

<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const store = {
    get key() { return localStorage.getItem("jarvis_key") || ""; },
    set key(v) { localStorage.setItem("jarvis_key", v); },
    get sess() { return localStorage.getItem("jarvis_session") || "phone"; },
    set sess(v) { localStorage.setItem("jarvis_session", v || "phone"); },
    get voice() { return localStorage.getItem("jarvis_voice") || ""; },
    set voice(v) { localStorage.setItem("jarvis_voice", v); },
  };
  const NEEDS_KEY = ${needsKey ? "true" : "false"};

  // Platform: iOS installs from Safari's share sheet; Android from Chrome's
  // install prompt. (iPadOS masquerades as MacIntel with touch.)
  const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const STANDALONE = window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true;

  // ---- state / captions ----
  function setState(s) { document.body.dataset.state = s; $("status").textContent =
    { idle: "standby", listening: "listening", thinking: "processing", speaking: "speaking" }[s] || s; }
  let typer = null;
  function showReply(text) {
    const el = $("reply"); clearInterval(typer); el.textContent = "";
    let i = 0;
    typer = setInterval(() => {
      el.textContent = text.slice(0, ++i);
      const c = document.createElement("span"); c.className = "caret"; c.textContent = "▌";
      el.appendChild(c);
      if (i >= text.length) { clearInterval(typer); el.textContent = text; }
    }, 18);
  }

  // ---- speech out ----
  let voices = [];
  function loadVoices() {
    voices = speechSynthesis.getVoices();
    const sel = $("voice");
    sel.innerHTML = "";
    const def = document.createElement("option"); def.value = ""; def.textContent = "Automatic (British if available)";
    sel.appendChild(def);
    for (const v of voices) {
      const o = document.createElement("option");
      o.value = v.name; o.textContent = v.name + " — " + v.lang;
      sel.appendChild(o);
    }
    sel.value = store.voice;
  }
  if ("speechSynthesis" in window) {
    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
  }
  function pickVoice() {
    if (store.voice) { const v = voices.find((v) => v.name === store.voice); if (v) return v; }
    return voices.find((v) => /en[-_]GB/i.test(v.lang) && /male|daniel|arthur|brian|ryan/i.test(v.name))
        || voices.find((v) => /en[-_]GB/i.test(v.lang))
        || voices.find((v) => /^en/i.test(v.lang))
        || null;
  }
  function speak(text) {
    return new Promise((done) => {
      if (!("speechSynthesis" in window) || !text) return done();
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice(); if (v) u.voice = v;
      u.rate = 1.0; u.pitch = 0.95;
      u.onend = u.onerror = () => done();
      setState("speaking");
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    });
  }

  // ---- brain ----
  async function ask(text, image) {
    setState("thinking");
    $("you").textContent = "\\u201C" + text + "\\u201D";
    const headers = { "content-type": "application/json" };
    if (store.key) headers.authorization = "Bearer " + store.key;
    const body = { text, sessionId: store.sess };
    if (image) { body.imageBase64 = image.b64; body.imageType = image.type; }
    let reply;
    try {
      const res = await fetch("/jarvis", { method: "POST", headers, body: JSON.stringify(body) });
      if (res.status === 401) { openSettings("That key was refused — check the API key."); setState("idle"); return; }
      if (res.status === 413) reply = "That photo was too large to send.";
      else if (!res.ok) reply = "My brain returned an error, code " + res.status + ".";
      else reply = (await res.json()).reply || "";
    } catch {
      reply = "I couldn't reach my brain — check the connection.";
    }
    showReply(reply);
    await speak(reply);
    setState("idle");
    return reply;
  }

  // ---- speech in ----
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, handsFree = false, busy = false;
  function listenOnce() {
    return new Promise((resolve) => {
      if (!SR) return resolve(null);
      rec = new SR();
      rec.lang = "en-US"; rec.interimResults = true; rec.maxAlternatives = 1;
      let final = "";
      setState("listening");
      rec.onresult = (e) => {
        let interim = "";
        for (const r of e.results) (r.isFinal ? (final += r[0].transcript) : (interim += r[0].transcript));
        $("you").textContent = "\\u201C" + (final || interim) + "\\u201D";
      };
      rec.onerror = () => resolve(null);
      rec.onend = () => resolve(final.trim() || null);
      try { rec.start(); } catch { resolve(null); }
    });
  }
  async function voiceTurn() {
    if (busy) return; busy = true;
    const heard = await listenOnce();
    if (heard) await ask(heard);
    else setState("idle");
    busy = false;
    if (handsFree) setTimeout(() => { if (handsFree && !busy) voiceTurn(); }, 250);
  }
  $("reactor").addEventListener("click", () => {
    if (!SR) {
      showReply(IS_IOS
        ? "Voice input isn't available here — on iPhone, open me in Safari (iOS 16.4 or later), or type below."
        : "Voice input isn't available in this browser — use the keyboard, or open me in Chrome.");
      return;
    }
    if (document.body.dataset.state === "listening" && rec) { rec.stop(); return; }
    voiceTurn();
  });
  $("mic").addEventListener("click", () => {
    handsFree = !handsFree;
    $("mic").setAttribute("aria-pressed", String(handsFree));
    if (handsFree) voiceTurn(); else if (rec) rec.stop();
  });

  // ---- typed fallback ----
  function sendTyped() {
    const t = $("typed").value.trim();
    if (!t) return;
    $("typed").value = "";
    ask(t);
  }
  $("send").addEventListener("click", sendTyped);
  $("typed").addEventListener("keydown", (e) => { if (e.key === "Enter") sendTyped(); });

  // ---- camera identify ----
  $("cam").addEventListener("click", () => $("camfile").click());
  $("camfile").addEventListener("change", async () => {
    const file = $("camfile").files[0];
    $("camfile").value = "";
    if (!file) return;
    setState("thinking");
    const b64 = await downscale(file, 1280);
    if (b64) ask("What am I looking at?", { b64, type: "image/jpeg" });
    else { showReply("I couldn't read that photo."); setState("idle"); }
  });
  function downscale(file, maxSide) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
        URL.revokeObjectURL(img.src);
        resolve(dataUrl.split(",")[1] || null);
      };
      img.onerror = () => { URL.revokeObjectURL(img.src); resolve(null); };
      img.src = URL.createObjectURL(file);
    });
  }

  // ---- settings ----
  function openSettings(msg) {
    $("key").value = store.key; $("sess").value = store.sess;
    if (msg) $("hint").textContent = msg;
    $("settings").classList.add("open");
  }
  $("gear").addEventListener("click", () => openSettings());
  $("close").addEventListener("click", () => $("settings").classList.remove("open"));
  $("save").addEventListener("click", () => {
    store.key = $("key").value.trim();
    store.sess = $("sess").value.trim();
    store.voice = $("voice").value;
    $("settings").classList.remove("open");
    showReply("Configured. At your service.");
  });

  // First run on a keyed Worker: ask for the key before anything else.
  if (NEEDS_KEY && !store.key) openSettings();

  // ---- install coaching (only in a browser tab, until dismissed) ----
  // Android: Chrome hands us a real install prompt via beforeinstallprompt.
  // iOS: there is no prompt API — Safari's share sheet is the only path.
  let installPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e;
    if (!$("install").hidden) $("install-go").hidden = false;
  });
  if (!STANDALONE && !localStorage.getItem("jarvis_install_done")) {
    $("install-how").textContent = IS_IOS
      ? "Install me: in Safari, tap Share \\u2191 then \\u201CAdd to Home Screen\\u201D."
      : "Install me as an app: Chrome menu \\u22EE \\u2192 \\u201CInstall app\\u201D.";
    $("install").hidden = false;
    if (installPrompt) $("install-go").hidden = false;
    $("install-go").addEventListener("click", async () => {
      if (!installPrompt) return;
      installPrompt.prompt();
      await installPrompt.userChoice.catch(() => null);
      installPrompt = null;
      $("install").hidden = true;
      localStorage.setItem("jarvis_install_done", "1");
    });
    $("install-x").addEventListener("click", () => {
      $("install").hidden = true;
      localStorage.setItem("jarvis_install_done", "1");
    });
  }
  window.addEventListener("appinstalled", () => {
    $("install").hidden = true;
    localStorage.setItem("jarvis_install_done", "1");
  });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/app/sw.js").catch(() => {});
})();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
