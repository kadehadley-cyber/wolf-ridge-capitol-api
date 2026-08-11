# `portal.js` — security patches (paste-in)

`portal.js` is a **59 KB built artifact** (`/frontend/js/dist/`). The right place
to make these changes is the **source** that compiles into it, not the bundle by
hand — retyping 59 KB by hand would introduce more bugs than it fixes. Each patch
below is small, self-contained, and shows the exact original so you can find it.

Apply patch 1 (the escaper), then 2 and 3 which depend on it, then 4 and 5.

---

## Patch 1 — add an attribute-safe escaper and a URL allowlist

**Why:** `escHtml` serialises a text node, which escapes `< & >` but **not `"` or
`'`**. It's used in ~40 quoted-attribute positions, so any value containing a
double quote breaks out of the attribute. Confirmed exploitable
(SECURITY-REVIEW.md §2). `escHtml` itself is fine for element *content* — leave it;
just stop using it for attributes.

**Find** (top of file):

```js
function escHtml(str) {
  var d = document.createElement("div");
  d.textContent = String(str || "");
  return d.innerHTML;
}
```

**Add immediately after it:**

```js
// Attribute-safe: escHtml does NOT escape quotes. Use this for any value that
// lands inside quoted HTML attributes (value="…", href="…", placeholder="…").
function escAttr(str) {
  return escHtml(str).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Scheme allowlist for URLs coming from data (competitor scans, etc.).
// Blocks javascript:, data:, vbscript:, and other executable schemes.
function safeHref(url) {
  var s = String(url == null ? "" : url).trim();
  return /^(https?:|mailto:|tel:)/i.test(s) ? s : "#";
}
```

> Optional but recommended: change `String(str || "")` to
> `String(str == null ? "" : str)` so the literal `0` / `false` aren't dropped.

---

## Patch 2 — market-report links (data-driven XSS + `javascript:` URIs)

**Why:** `loadMarketingReport` renders competitor `website` / `maps_url` — AI-scan,
web-derived, least-trusted data in the system — straight into `href` via `escHtml`,
which leaves quotes intact and never checks the scheme (SECURITY-REVIEW.md §2).

**Find:**

```js
if (c.website) html += '<a href="' + escHtml(c.website) + '" target="_blank" class="btn sm" style="font-size:10px">Website</a>';
if (c.maps_url) html += '<a href="' + escHtml(c.maps_url) + '" target="_blank" class="btn sm" style="font-size:10px;color:#3d9fff;border-color:rgba(61,159,255,.3)">Maps</a>';
```

**Replace with:**

```js
if (c.website) html += '<a href="' + escAttr(safeHref(c.website)) + '" target="_blank" rel="noopener noreferrer" class="btn sm" style="font-size:10px">Website</a>';
if (c.maps_url) html += '<a href="' + escAttr(safeHref(c.maps_url)) + '" target="_blank" rel="noopener noreferrer" class="btn sm" style="font-size:10px;color:#3d9fff;border-color:rgba(61,159,255,.3)">Maps</a>';
```

(`rel="noopener noreferrer"` also closes the `target="_blank"` reverse-tabnabbing gap.)

---

## Patch 3 — demo profile fields (stored self-XSS → staff XSS)

**Why:** `_demoRender` writes user-writable profile fields (`clinic_name`, `npi`,
`address`, contact fields, and the `data-demo-perm` key) into `value="…"` /
attributes via `escHtml`. Stored XSS against yourself, and against staff if any
admin view renders the same fields through the same helper.

**Rule:** in the `_demoRender` HTML string, every `escHtml(...)` that sits inside a
quoted attribute becomes `escAttr(...)`. These are the ones to change (all the
`value="…"` inputs and the checkbox key):

```js
// value="' + escHtml(p.clinic_name || "") + '"      → escAttr(p.clinic_name || "")
// value="' + escHtml(p.npi || "") + '"              → escAttr(p.npi || "")
// value="' + escHtml(p.phys_first || "") + '"       → escAttr(...)   (and phys_last)
// value="' + escHtml(p.phone || "") + '"            → escAttr(...)
// value="' + escHtml(p.email || "") + '"            → escAttr(...)
// value="' + escHtml(p.address || "") + '"          → escAttr(...)   (city/state/zip)
// value="' + escHtml(p.contact_* || "") + '"        → escAttr(...)   (all contact_ fields)
// data-demo-perm="' + escHtml(perm.key) + '"        → escAttr(perm.key)
```

Leave the `escHtml(...)` calls that sit in element content (e.g.
`>' + escHtml(perm.label) + '<`, error messages) exactly as they are — those are
already safe.

> Cleaner long-term fix: build these inputs with `document.createElement` +
> `el.value = ...` + `el.setAttribute(...)` instead of string-concatenated
> `innerHTML`. Then no escaping is needed and the whole class of bug is gone.

---

## Patch 4 — telemetry beacons: POST, not URL pixels; server-authorised

**Why:** `logEvent` and the 30 s heartbeat put activity in **URLs** via
`new Image().src`, so it lands in access/proxy logs and `Referer` chains; both are
gated only by the client-side `_isAdmin` (SECURITY-REVIEW.md §4). `detail` is
free-text and one careless call site from carrying PHI.

**Find:**

```js
function logEvent(event, detail) {
  if (_isAdmin) return;
  var img = new Image();
  img.src = BASE + "/portal.php?action=log_event&event=" + encodeURIComponent(event) + "&detail=" + encodeURIComponent(detail || "");
}
```

**Replace with:**

```js
function logEvent(event, detail) {
  // Admin suppression is a courtesy; the SERVER must decide whether to record,
  // from the session — never trust this client flag.
  if (_isAdmin) return;
  try {
    var body = new Blob(
      [JSON.stringify({ event: event, detail: detail || "" })],
      { type: "application/json" }
    );
    // sendBeacon keeps the payload in the request BODY, out of URLs and logs.
    navigator.sendBeacon(BASE + "/portal.php?action=log_event", body);
  } catch (e) { /* best-effort telemetry, never block the UI */ }
}
```

And the heartbeat (search for `action=heartbeat`):

```js
// Original: var img = new Image(); img.src = BASE + "/portal.php?action=heartbeat&page=" + …
navigator.sendBeacon(
  BASE + "/portal.php?action=heartbeat",
  new Blob([JSON.stringify({ page: _currentTab, secs: _heartbeatInterval })], { type: "application/json" })
);
```

Update the server side to read these actions from the JSON body instead of the
query string.

---

## Patch 5 — stop the client from asserting its own protocol lock

See `portal-protocols.hardened.js` (shipped alongside this file) — the only change
there is the origin-checked `postMessage` listener, plus a note that `loadProto`'s
`&locked=1` is advisory and `proto_render` must enforce the lock from the session.
Nothing to change in `portal.js` for this one.

---

## What is NOT in `portal.js`

- **The keystroke recorder** is an inline `<script>` in the page template, not in
  this bundle — see `README.md` for the removal.
- **`demo_action` authorisation** is server-side — see `demo_action.reference.php`.
