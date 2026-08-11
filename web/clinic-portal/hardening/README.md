# Hardening the live CelluNOVA portal

Deployable fixes for the **real** portal — not the `web/clinic-portal/` rebuild
(that one is already clean). Each item maps to a finding in
[`../SECURITY-REVIEW.md`](../SECURITY-REVIEW.md).

| File | Fixes | Kind |
| --- | --- | --- |
| `portal-protocols.hardened.js` | §5 (unchecked `postMessage`), §3 note | **Full drop-in** — replace `/frontend/js/dist/portal-protocols.js` |
| `portal.js.security-patches.md` | §2 (`escHtml` quote XSS), §4 (URL-pixel telemetry) | Paste-in patches |
| `demo_action.reference.php` | §1 (self-service permissions), §3, §6 (CSRF) | Reference gate |
| this file | §1 keystroke recorder removal | Instructions |

Why not a full hardened `portal.js`? It's a 59 KB build artifact. Hand-retyping it
would add more bugs than it fixes — the fixes belong in the source that compiles
into it, which isn't in these exports. The patches are small and pinpoint the
exact lines.

---

## 1. Remove the keystroke recorder (§1) — highest priority

**It is not in `portal.js`.** It's an inline `<script>` in the page template (the
PHP that renders `body.portal-page`), the **second** `<script>` in `<body>`,
starting:

```html
<script>
/* ── Action Recorder ────────────────────────────────────────────────────────
 * Captures every interaction a logged-in user makes and batches it to
 * /portal.php?action=user_events_log. …
 ...
```

**Delete that entire `<script>` block** from the template. It's first-party
analytics, not malware — but it captures keystrokes by default and skips only
`type=password` and `data-no-log`, while the treatment-scheduler **Notes**
textarea (which invites case notes) carries neither. On a portal that touches
patient scheduling, that's PHI flowing into an events table.

If you want to keep *some* interaction analytics, don't just re-add it — invert
the default: capture nothing textual unless a field is explicitly
`data-log-safe`, and never record `value` for `textarea` / free-text inputs.
Then set a retention window and restrict who can replay sessions
(`_isReplayView` shows a replay UI exists).

Also decommission the receiving endpoint or scope it down:
`/portal.php?action=user_events_log`.

---

## 2. Swap in the hardened protocols bundle (§5)

Replace `/frontend/js/dist/portal-protocols.js` with
`portal-protocols.hardened.js`. Only real change: the iframe-sizing
`postMessage` listener now verifies `e.source` **and** `e.origin` and bounds the
height. Everything else is byte-for-byte the original. Have `proto_render` emit
its height with an explicit target origin:

```js
parent.postMessage({ type: "protoHeight", height: document.body.scrollHeight },
                   window.location.origin);
```

---

## 3. Apply the `portal.js` patches (§2, §4)

Follow `portal.js.security-patches.md` in order: add `escAttr`/`safeHref`, fix the
market-report links and demo profile inputs, convert the telemetry beacons to
`sendBeacon` POST. All five patches are surgical.

---

## 4. Gate the server endpoints (§1, §3, §6)

`demo_action.reference.php` shows the required shape:

- **`demo_action`** — verify `is_demo_account` from the session **before**
  dispatch, per sub-action; allowlist `set_permissions` keys; scope every
  mutation to the session's own `clinic_id`.
- **`proto_render`** — derive the lock from the session, ignore `&locked=1`,
  allowlist the slug.
- **CSRF** — per-session token on every mutating action; confirm `SameSite` on
  the session cookie.

**Before touching code, run the read-only probe** in that file's header from a
real non-demo clinic session — it tells you whether §1 is already handled or a
live bypass.

---

## Still owed a look (from the review, unchanged)

- `chart.js` from jsDelivr has no SRI, and nothing on the protocols page uses it
  (§9) — drop the tag there or add `integrity`.
- No usable CSP while inline handlers remain (§10). Once §2 is done and inline
  `onclick=` are gone, a real `script-src 'self'` becomes possible and would
  have contained §2 on its own.
- The `CSSEOF` heredoc marker left in `portal.css` silently kills the
  `.shop-grid` rule (§11) — a build-pipeline bug worth chasing to its source.
