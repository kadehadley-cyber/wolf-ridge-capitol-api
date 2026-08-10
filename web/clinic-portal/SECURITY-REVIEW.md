# Security review — CelluNOVA clinic portal, `/portal/protocols`

Reviewed from a Chrome DevTools AI-assistance export dated 2026-08-10.

## What was actually reviewable

This matters more than any single finding below, so it goes first.

Every extraction in that export hit the tool's output limit. `document.documentElement.outerHTML`
failed, `document.body.innerHTML` failed, `.portal-layout` failed, and `.portal-content-wrap`
failed. What came back was:

- the complete `<head>`,
- a structural outline of the DOM,
- the **first ~1000 characters** of each top-level block, truncated mid-token.

Critically, **the page's actual application code was never captured at all**:

| Not captured | Why it matters |
| --- | --- |
| `/frontend/js/dist/portal.js` | Session handling, modals, the `cModal`/`overlayClose` globals, whatever listens for `message` events |
| `/frontend/js/dist/portal-protocols.js` | `loadProto()`, `filterProtos()`, the frame-resize logic, lock enforcement |
| `/frontend/styles/style.css`, `portal.css` | — |
| The rest of the Action Recorder | Cut off mid-function at `sessionStorage.getItem(SEQ_KE` — the part that builds and transmits the payload is missing |
| `/portal.php` (all server code) | Every authorization decision |

So: **nothing below is a clean bill of health.** In the fragments that were captured I found
no obfuscated payload, no `eval`, no data exfiltration to a third-party domain, no injected
redirect, no cryptominer, and no form-jacking. That is a real result, but it covers maybe a
twentieth of what executes on that page. To actually clear it, pull the two bundles:

```
curl -s https://cellunova.bio/frontend/js/dist/portal.js          -o portal.js
curl -s https://cellunova.bio/frontend/js/dist/portal-protocols.js -o portal-protocols.js
```

One more note, since the source was an AI chat export of live page content: I checked for
prompt-injection — page text crafted to issue instructions to an AI agent reading it. There
is none. The export is what it claims to be.

---

## Findings

Ordered by how much they'd cost you if exploited, not by how exotic they are.

### 1. A keystroke recorder running on a portal that handles patient data — **highest concern**

The second inline `<script>` is a session-replay recorder, self-documented in its own header
comment:

> Captures every interaction a logged-in user makes and batches it to
> `/portal.php?action=user_events_log`. […] Inputs of type=password and any element with
> `data-no-log` are skipped for keystroke capture.

This is first-party and openly labelled, so it is **not malicious code** — it's an analytics
feature. It is still the most dangerous thing on the page, for four reasons:

1. **The exclusion list is an allowlist problem wearing a denylist's clothes.** Only
   `type=password` and explicit `data-no-log` are skipped. Everything else is captured by
   default, so any new field is logged unless someone remembers to opt it out.
2. **The fields that most need excluding are not excluded.** The treatment scheduler collects
   a date, a protocol, a patient count, and a free-text **Notes** textarea, on a page whose own
   copy says *"Please add case/usage notes"*. None of those carry `data-no-log`. The one element
   that does carry it is `#orderBar` — a static block of marketing text with no inputs at all.
   The protection is on the thing that needs none.
3. **Clinical free text is where PHI goes.** A physician typing "pt. presenting with…" into that
   Notes box is streaming identifiable patient information into an events table. If this portal
   is in HIPAA scope, that table is now PHI storage — with the retention, access-control, audit,
   and BAA obligations that follow — and it very likely was not designed as such.
4. **Admins can replay these sessions.** `_isReplayView` exists specifically to suppress
   recording while an admin views a user's session, which confirms a replay UI exists on the
   other end. That is broad surveillance of clinic users' keystrokes.

**Fix.** Invert the default: capture nothing textual unless a field is explicitly marked
`data-log-safe`. Never record `value` for `textarea`, `type=text`, `type=email`, or `type=tel`
in a clinical context — record focus/blur/change *events* without content. Then set a retention
window, restrict replay access, and if HIPAA applies, get the events table into your risk
analysis. This rebuild ships without the recorder entirely.

### 2. Authorization state that exists only in the browser

The first inline script publishes the whole permission model to the client:

```js
var _isAdmin  = false;
var _clinicId = 2;
var _isLocked = false;
```

and each protocol button carries `data-locked="0"`. The "Back to Admin" control is a plain form
POSTing `admin_view_as=admin`.

None of this is a vulnerability by itself — the client has to know what to render. It becomes one
the moment the server *trusts* any of it. The questions to answer in `/portal.php`:

- Does `action=proto_render` re-check the lock for `slug`, or does it serve any slug to any
  authenticated clinic because the UI "wouldn't have shown the button"? If it's the latter,
  `document.querySelectorAll('.proto-btn').forEach(b => b.dataset.locked = 0)` in the console
  unlocks your paid library.
- Does `admin_view_as` verify the session is genuinely an admin, or does accepting the field
  imply it? If the latter, any clinic can POST `admin_view_as=admin` and escalate.
- `_clinicId = 2` is a small sequential integer. If any endpoint accepts a clinic id from the
  client, that's an IDOR into another clinic's data.

Also: the button list leaks the **names and slugs of locked protocols** to every clinic, even
when the content stays gated. Whether that matters is a business call, not a technical one.

### 3. `chart.js` loaded from a CDN with no integrity pin

```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
```

No `integrity`, no `crossorigin`. A compromise of jsDelivr — or of that package — yields
arbitrary JavaScript with full DOM access on an authenticated clinical portal, on the same page
as the recorder in §1.

The inconsistency is instructive: the Cloudflare beacon on the same page **is** pinned, with a
SHA-512 `integrity` hash and `crossorigin="anonymous"`. Someone knew the pattern; it just wasn't
applied here.

Worth noting the version is pinned to `4.4.7` rather than a floating tag, which limits the blast
radius. Also — nothing in the captured markup for this page uses Chart.js. If it's only needed on
the dashboard, drop the tag here. Otherwise self-host it, or add SRI:

```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"
        integrity="sha384-…" crossorigin="anonymous"></script>
```

### 4. No usable Content-Security-Policy

No CSP meta tag appears in the `<head>`, and the page's construction makes one hard to add: it
uses inline handlers everywhere (`onclick="filterProtos('ia')"`, `onclick="demoOpen()"`,
`onclick="openTreatmentScheduler()"`), several inline `<script>` blocks, and inline `style`
attributes throughout. Any policy would need `script-src 'unsafe-inline'`, which gives up most of
what a CSP is for.

Check whether one is set as a *response header* — that wouldn't show in the DOM export. If not,
this is the single highest-leverage hardening available, because it turns most XSS from
"full account compromise" into "blocked". This rebuild removes every inline handler so the
policy in `index.html` can be strict.

### 5. Server-rendered JSON inside an inline `<script>` — currently safe, fragile by construction

```js
var _protoLabels = {"ia":"Intra-Articular", … ,"other":"Other \/ Specialized", …};
```

Injecting server data into a `<script>` body is the classic XSS breakout: a label containing
`</script>` ends the block early and the rest becomes markup.

Here it's **currently fine**, and the escaped `\/` proves why — PHP's `json_encode` escapes
forward slashes by default, so `</script>` is emitted as `<\/script>` and cannot break out.

The problem is that the safety is incidental. Anyone who later adds `JSON_UNESCAPED_SLASHES`
for cleaner output — a purely cosmetic change, in an unrelated file — silently introduces stored
XSS. Make it explicit and un-break-able:

```php
json_encode($labels, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT)
```

Better still, move the data out of executable context entirely:
`<script type="application/json" id="proto-labels">` and `JSON.parse(el.textContent)`.

### 6. The protocol `<iframe>`: an unvalidated slug and unverified resizing

```html
<iframe id="protoFrame" scrolling="no"
        src="/portal.php?action=proto_render&slug=general-wellness"
        style="display: block; height: 2547px;">
```

Two issues.

**The slug reaches the server.** `slug` is client-controlled and lands in a PHP render action.
`proto_render` needs an explicit allowlist. If it maps the slug to a filesystem path or a database
lookup, that's the path-traversal / injection surface on this page. It's also the endpoint that
must enforce §2's locks.

**The height is set from somewhere.** `2547px` is computed at runtime, and `portal-protocols.js`
wasn't captured, so I can't tell which mechanism is used. If it's a `message` listener,
**check whether it validates `event.origin` and `event.source`** — an unvalidated listener that
does anything richer than set a height (writes `innerHTML`, dispatches by `data.type`) is a DOM
XSS sink reachable from any page that can get a handle to this window.

The rebuild sizes the frame via `postMessage` with both checks:

```js
if (e.source !== frame.contentWindow) return;
if (e.origin !== window.location.origin) return;
```

One honest caveat on the `sandbox` attribute added in the rebuild: because the frame is
same-origin and needs scripts, it must carry `allow-scripts allow-same-origin`, and that
combination lets the frame remove its own sandbox. It is documentation, not a boundary. The real
isolation win would be serving protocol fragments from a separate origin.

### 7. Demo controls shipped to live clinic sessions

A floating **Demo** button and modal are present in the live DOM, captioned *"All actions hit your
own account — safe to experiment."* Its body loads remotely (`Loading…`), so the actions behind it
weren't captured — but a control panel offering state mutation "to experiment with" does not
belong on a production clinical portal, even a demo tenant's.

The risk isn't the button; it's the assumption behind it. If those endpoints check "is this a demo
account?" only by whether the template rendered the button, they're callable by anyone who finds
the URLs. Gate them server-side, per request. The rebuild keeps the component but leaves it
`hidden` unless the server sets `PORTAL_CONFIG.demo`.

### 8. Cloudflare beacon — no action needed

```html
<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js/…"
        integrity="sha512-…" crossorigin="anonymous" data-cf-beacon="{…}">
```

Standard Cloudflare Web Analytics, correctly pinned with SRI and `crossorigin`. Listed so it isn't
mistaken for something to remove — this is the pattern §3 should copy.

### 9. Minor: a stale minimum date

```html
<input type="date" id="treatDate" min="2026-08-08" required>
```

The export is dated **2026-08-10**, so the server-baked `min` was already two days stale and the
scheduler accepted appointments in the past. Not a security issue — a correctness one, and a sign
the value is rendered once and cached rather than computed per request. The rebuild derives it from
the browser clock; the server should also reject past dates on submit, since a client `min` is
advisory.

---

## Priority

| # | Finding | Severity | Effort |
| --- | --- | --- | --- |
| 1 | Keystroke recorder capturing clinical free text | **High** — privacy / possible HIPAA | Medium |
| 2 | Client-side-only authorization signals | **High, if the server trusts them** | Low to verify |
| 3 | Un-pinned CDN script | **Medium** — supply chain | Low |
| 4 | No usable CSP | **Medium** — removes XSS mitigation | Medium |
| 6 | Unvalidated `slug`; unverified frame resize | **Medium** | Low |
| 7 | Demo controls in production | **Medium** | Low |
| 5 | JSON-in-`<script>` | **Low now**, high if flags change | Low |
| 9 | Stale `min` date | Low | Low |

Findings 2 and 6 are server-side and cannot be settled from the client. They are the two worth
checking first, because they're the ones where the answer might be "already fine" — or might be a
live authorization bypass.
