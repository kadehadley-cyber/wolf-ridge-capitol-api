# Security review — CelluNOVA clinic portal, `/portal/protocols`

Reviewed from Chrome DevTools AI-assistance exports dated 2026-08-10.

## Scope

Second pass. The first review covered only the page markup, because every DOM extraction
hit the tool's output limit. The bundles have since been fetched, so this pass covers:

| Source | Coverage |
| --- | --- |
| `/frontend/js/dist/portal.js` | **complete** — 59,237 chars, five contiguous segments |
| `/frontend/js/dist/portal-protocols.js` | **complete** — 4,275 chars |
| Page markup, `<head>`, inline `<style>` | first ~1000 chars of each block |
| Inline "Action Recorder" `<script>` | **partial** — cut off at `sessionStorage.getItem(SEQ_KE` |
| `/frontend/styles/portal.css` | first 50KB of 107,287 — covers every section this page uses |
| `/frontend/styles/style.css` | not captured (cosmetic) |
| `/portal.php` | not captured — **every authorization decision lives here** |

**Verdict on malicious code: none.** With both bundles fully read, there is no `eval`, no
`Function()` constructor, no obfuscation, no cryptominer, no injected redirect, no
form-jacking, and no third-party exfiltration. Every `fetch` and image beacon targets
`BASE + "/portal.php"`, and `BASE` is `''`. The only external scripts are Chart.js from
jsDelivr and the Cloudflare beacon. That part is clean, and it is now an evidence-based
statement rather than a hedge.

What the code *does* contain is two serious design flaws and a working XSS primitive.

Two caveats remain. The Action Recorder's transmit logic is still unread — the part that
builds and sends the payload was never captured. And `portal.php` is the authority for
findings 1 and 3; the client evidence is strong but the server gets the final word.

The exports are AI-chat renderings of live page content, so I also checked for
prompt-injection aimed at an agent reading them. There is none.

---

## Findings

### 1. `demo_action` is a self-service permission-granting API — **most serious**

`portal.js` ships this to the browser:

```js
function _demoApi(sub, body) {
  body = body || {};
  body.sub = sub;
  return fetch(BASE + "/portal.php?action=demo_action", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(function (r) { return r.json(); });
}

window.demoSavePermissions = function () {
  var boxes = document.querySelectorAll("[data-demo-perm]");
  var perms = {};
  boxes.forEach(function (b) {
    var key = b.getAttribute("data-demo-perm");
    if (key && b.checked) perms[key] = 1;
  });
  _demoApi("set_permissions", { permissions: perms });
};
```

The panel's own caption: *"Toggle any rep-level permission for your account. Saves
immediately on change."*

So there is an endpoint, reachable from any authenticated session, whose stated purpose is
**granting the caller arbitrary permissions on their own account**. The full sub-action list
is `get_state`, `update_profile`, `set_permissions`, `view_splash`, `reset_splash`,
`run_market_analysis`, `clear_ndas`, `clear_reports`, `clear_cart`,
`clear_custom_pricing`, `reset_all`.

The one question that matters: **does `demo_action` verify server-side that the session
belongs to a demo account, on every sub-action?** If that check is missing — or if it only
governs whether the template renders the button — then any clinic can run this in a console
and escalate:

```js
fetch('/portal.php?action=demo_action', {
  method: 'POST', credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sub: 'set_permissions', permissions: { /* every key */ } })
})
```

Hiding the button is not a control. The captured page had `_isAdmin = false` and
`_clinicId = 2`, and the Demo button was rendered anyway, which confirms the surface reaches
at least some non-admin clinic sessions.

Two smaller notes on the same endpoint. `update_profile` accepts `npi` — a regulated
provider identifier — as a free-text client-supplied field. And `reset_all` permanently
deletes NDAs, marketing reports, custom pricing and carts; it operates on the session's own
account, so the blast radius is self-inflicted, but it is still an unauthenticated-by-token
destructive POST (see finding 6).

**Fix.** Gate `demo_action` in `portal.php` on a server-side `is_demo_account` check, per
sub-action, before any dispatch. Allowlist permission keys instead of accepting whatever
`permissions` map arrives. Ideally compile the whole surface out of production builds.

### 2. `escHtml()` does not escape quotes, and it is used in ~40 attribute positions

The escaper both bundles rely on:

```js
function escHtml(str) {
  var d = document.createElement("div");
  d.textContent = String(str || "");
  return d.innerHTML;
}
```

Serializing a **text node** escapes `&`, `<`, `>` and ` ` — but *not* `"` or `'`.
That makes this function correct for element content and unsafe for attribute values.
Verified in Chromium:

```js
escHtml('" onmouseover="alert(1)')   // → " onmouseover="alert(1)   (unchanged)

host.innerHTML = '<a href="' + escHtml('" onmouseover="alert(1)') + '">x</a>';
host.querySelector('a').getAttributeNames();   // → ["href", "onmouseover"]
```

The injected handler becomes a real attribute on a real element. `portal.js` then uses
`escHtml` inside quoted attributes throughout — `value="…"`, `href="…"`,
`placeholder="…"`, `data-demo-perm="…"`. Any value containing a double quote breaks out.

Two realistic paths to a `"`:

- **Market analysis reports.** `loadMarketingReport()` renders
  `'<a href="' + escHtml(c.website) + '" target="_blank">'` and the same for `c.maps_url`.
  Those fields come from an AI-generated competitor scan built on web-derived data — the
  least trustworthy input in the system, rendered straight into an `href`. The same function
  is missing a scheme check, so `javascript:` URIs also survive: `escHtml` returns
  `javascript:alert(1)` verbatim.
- **Your own profile.** `_demoRender()` renders `p.clinic_name`, `p.npi`, `p.phys_first`,
  `p.address` and the rest into `value="…"`, and those fields are user-writable through
  `update_profile`. That is stored self-XSS on its own; it becomes stored XSS against staff
  if any admin view renders the same fields through the same helper.

**Fix.** Add a distinct attribute escaper and use it in every attribute position:

```js
function escAttr(s) {
  return escHtml(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
```

Better, build these nodes with `createElement` + `setAttribute`/`textContent` instead of
string-concatenated `innerHTML`. And allowlist `http:`/`https:` before assigning any `href`
that came from a report.

Note `esc()` in `portal-protocols.js` has the identical flaw but is used only in element
content (`<li>`, `<td>`, `<h2>`), so it is currently safe. It is one refactor away from not
being.

### 3. The client tells the server which protocols it may read

`loadProto()` in `portal-protocols.js`:

```js
var isLocked = btn.dataset.locked === "1";
if (!isLocked) logEvent("protocol_view", slug);
var url = BASE + "/portal.php?action=proto_render&slug=" + encodeURIComponent(slug);
if (isLocked) url += "&locked=1";
frame.src = url;
```

The lock flag is read from a DOM attribute and **sent to the server as a query parameter**.
Nothing else in the client enforces the lock. So the request for gated content differs from
the request for open content only by a parameter the user controls:

```js
document.querySelectorAll('.proto-btn').forEach(b => b.dataset.locked = '0');
```

…and every subsequent click requests the protocol without `&locked=1`.

Whether that yields the content depends entirely on whether `proto_render` re-derives the
lock from the session, or trusts `&locked=1`. A server that derived it independently would
not need the client to send it — the parameter's existence is itself the smell. **Verify
this one first.** Related: an unlocked view is logged and a locked view is not, so a
successful bypass would also be invisible in the event log.

Two more instances of the same shape, both in `portal.js`:

```js
function logEvent(event, detail) { if (_isAdmin) return; /* … */ }
(function () { if (_isAdmin) return; /* 30s heartbeat */ })();
```

`_isAdmin` is a `var` in page scope. `_isAdmin = true` in the console silences the audit
trail and the heartbeat. Client-side flags cannot enforce anything; the server must judge
its own sessions.

Also unresolved from the markup pass: the `admin_view_as=admin` form POST, and
`_clinicId = 2` being a small sequential integer. If any endpoint accepts a clinic id from
the client, that is an IDOR across tenants.

### 4. Telemetry is broader than the recorder, and it is all GET pixels

Three separate streams run on an authenticated clinical portal:

| Stream | Mechanism |
| --- | --- |
| Action Recorder | batches clicks + keystrokes to `action=user_events_log` |
| `logEvent()` | `new Image().src = …action=log_event&event=…&detail=…` |
| Heartbeat | `new Image().src = …action=heartbeat&page=…&secs=30` every 30s while visible |

The recorder remains the concern flagged in the first pass, and its exclusion list is still
inverted: only `type=password` and `data-no-log` are skipped, so everything else is captured
by default. The treatment scheduler's **Notes** textarea — sitting under copy that invites
*"case/usage notes"* — carries neither, while the one element that does carry `data-no-log`
is `#orderBar`, a block of static marketing text with no inputs. On a portal handling
patient scheduling, that is PHI flowing into an events table, with the retention,
access-control, audit and BAA obligations that follow. `_isReplayView` confirms a
session-replay UI exists on the other end.

The two beacons compound it: `logEvent` and `heartbeat` put activity data in **URLs**, where
it lands in access logs, proxy logs and `Referer` chains rather than a request body. Neither
carries PHI today, but `detail` is a free-text parameter one careless call site away from
doing so.

**Fix.** Invert the recorder's default — capture nothing textual unless explicitly marked
safe, and never capture `value` for `textarea` or free-text inputs in a clinical context.
Move the beacons to `POST`/`sendBeacon`. Set a retention window and restrict replay access.

### 5. `postMessage` listener with no origin or source check — real, but low impact

Confirmed in `portal-protocols.js`:

```js
window.addEventListener("message", function (e) {
  if (e.data && e.data.type === "protoHeight") {
    var frame = document.getElementById("protoFrame");
    if (frame) frame.style.height = e.data.height + "px";
  }
});
```

No `e.origin` check, no `e.source` check. Any context holding a handle to this window — an
opener, or a page framing it — can drive the message.

Calibrating honestly: the sink is `style.height`, and the CSSOM property setter discards
values that are not valid CSS lengths, so this is not an XSS vector. The achievable impact
is frame-size manipulation — collapse the protocol viewer to `0px`, or expand it absurdly.
UI spoofing and nuisance, not compromise. Worth fixing because it is two lines, and because
this listener is exactly the thing that becomes dangerous the moment someone adds a second
`data.type` branch that writes markup:

```js
if (e.source !== frame.contentWindow) return;
if (e.origin !== window.location.origin) return;
```

The `slug` question from the first pass is now half-answered: the client wraps it in
`encodeURIComponent`, so the client side is fine. What `proto_render` does with it —
filesystem path, database lookup — is still unreviewed, and needs an allowlist.

### 6. No CSRF tokens on any state-changing endpoint

Every mutating call follows this shape, with no token:

```js
fetch(BASE + "/portal.php?action=nda_sign", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ signer_name: name, signer_title: title, signer_email: email })
});
```

Same for `demo_action`, `chat_send`, `chat_delete`, `chat_resolve`, `mark_splash_seen`.

There is incidental protection: `Content-Type: application/json` makes these non-simple
requests, so a cross-origin `fetch` triggers a preflight the server presumably will not
approve. That is a side effect, not a control — it evaporates if the server ever accepts
form-encoded or `text/plain` bodies for the same actions. Add a per-session token and
verify `SameSite` is set on the session cookie.

`nda_sign` deserves its own note: it is a legally-operative signature, and `signer_email`
arrives from the client rather than the session, so a signer can attribute their typed
signature to an address they do not control.

### 7. Countdown-driven pricing — verify the deadline is real

`portal.js` runs a per-second countdown against `data-expires` on `.nda-countdown-card`,
adds a `nda-urgent` class under 24 hours, and on expiry writes:

> `WINDOW EXPIRED — RELOAD TO SEE STANDARD PRICING`

with `ndaShowStandard()` / `ndaShowQualifyBanner()` toggling the offer banner purely through
`sessionStorage.nda_dismissed`.

This is a product decision, not a bug, and I am flagging it only because the brief was to
look for traps. A countdown that gates preferential pricing is a legitimate mechanic **if
the deadline is real and enforced server-side**. It becomes a deceptive-urgency problem — the
kind regulators have taken an interest in — if the timer resets per session, or if the
"expired" pricing never actually differs. Worth confirming which one this is, since the
client alone cannot tell.

### 8. Cloudflare beacon — no action needed

Standard Cloudflare Web Analytics, correctly pinned with a SHA-512 `integrity` hash and
`crossorigin="anonymous"`. Noted so it is not mistaken for something to remove — it is the
pattern finding 9 should copy.

### 9. `chart.js` from a CDN with no integrity pin

```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
```

No `integrity`, no `crossorigin`, on an authenticated clinical portal. The version is pinned
to `4.4.7` rather than a floating tag, which limits the blast radius to a compromise of
jsDelivr or that exact package. Neither bundle references `Chart` anywhere, so on this page
the tag appears to be dead weight — drop it here, or self-host it, or add SRI.

### 10. No usable CSP

Inline `onclick=` handlers throughout the markup, inline `<script>` blocks, and
string-built inline `style` attributes everywhere in `portal.js`. Any policy would need
`script-src 'unsafe-inline'`, which forfeits most of the protection — and finding 2 is
precisely the class of bug a real CSP contains. Check whether one is set as a response
header; if not, this is the highest-leverage structural fix available.

### 11. Two build artifacts in the shipped stylesheet

Not security issues — found while reading `portal.css` for the rebuild, and both
indicate something wrong in the build pipeline rather than the source.

**A heredoc terminator leaked into the CSS.** At roughly offset 32,000:

```css
    .order-journey-line { left: 40px; right: 40px; top: 20px; }
}

CSSEOF

/* Product grid */
.shop-grid { … }
```

`CSSEOF` is a shell heredoc marker that was written into the output file instead
of ending it. It is not valid at that position, so the parser folds it into the
next rule and reads the selector as `CSSEOF .shop-grid` — a descendant selector
matching a `<cssedof>` element that does not exist. **The `.shop-grid` rule
never applies.** Worth checking whether the shop page's product grid is silently
falling back to unstyled block layout, and whether the generator that emitted
this dropped anything else.

**The file is double-encoded.** Comment headers read
`PORTAL DASHBOARD (portal.php Ã¢â‚¬â€ body.portal-page)` — UTF-8 bytes
interpreted as Latin-1 and re-encoded, so every em-dash and box-drawing
character in the comments is mangled. Confined to comments today, so it renders
fine, but the same pipeline handles `content:` strings elsewhere, and there it
would be visible. Worth fixing at the source that writes the file.

### 12. Minor: a stale minimum date

`<input type="date" id="treatDate" min="2026-08-08">` on an export dated **2026-08-10** —
the server-baked floor was two days stale and the scheduler accepted past appointments.
A correctness bug, and a hint the value is rendered once and cached.

---

## Priority

| # | Finding | Severity | Where it's settled |
| --- | --- | --- | --- |
| 1 | `demo_action` grants permissions to the caller | **High** — privilege escalation | `portal.php` |
| 2 | `escHtml` leaves quotes → attribute-injection XSS | **High** — confirmed primitive | client |
| 3 | Client sends `&locked=1`; `_isAdmin` gates client-side | **High, if the server trusts it** | `portal.php` |
| 4 | Recorder + beacons capturing clinical free text | **High** — privacy / possible HIPAA | both |
| 6 | No CSRF tokens on mutating endpoints | Medium | `portal.php` |
| 10 | No usable CSP | Medium | server headers |
| 9 | Un-pinned CDN script | Medium — supply chain | client |
| 5 | Unchecked `postMessage` origin | Low — sink is `style.height` | client |
| 7 | Countdown-gated pricing | Verify enforcement | `portal.php` |
| 11 | `CSSEOF` heredoc marker in shipped CSS kills `.shop-grid` | Low — build bug | build |
| 12 | Stale `min` date | Low | server |

Findings 1 and 3 are the two to check first, because both might already be fine — and if
either is not, it is a live authorization bypass rather than a hardening opportunity.
Finding 2 is confirmed exploitable in the client and needs no server confirmation.
