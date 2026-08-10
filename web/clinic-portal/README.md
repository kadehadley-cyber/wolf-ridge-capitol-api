# Clinic Portal — Protocols & Treatments

A self-contained static rebuild of the CelluNOVA clinic portal's
`/portal/protocols` page, reconstructed from a Chrome DevTools export and
hardened along the way.

Unrelated to the Jarvis Worker in `src/` — it lives here as a standalone
front-end reference, with no build step and no dependencies.

```
web/clinic-portal/
├── index.html              page markup, strict CSP, no inline handlers
├── styles/portal.css       layout + theme
├── js/portal.js            all behaviour
├── protocols/
│   ├── protocol.html       the detail frame
│   ├── frame.css
│   └── frame.js            origin-checked height messaging
├── SECURITY-REVIEW.md      audit of the original page  ← read this first
└── README.md
```

## Running it

`postMessage` frame sizing needs a real origin, so serve it rather than opening
`index.html` from disk:

```sh
python3 -m http.server 8000 --directory web/clinic-portal
# → http://localhost:8000
```

## How faithful is this?

**Reproduced from captured source:** the `<head>`, the full DOM structure
(sidebar → topbar → main → footer, order bar, demo controls, scheduler modal),
all visible copy, the `.order-bar` and `#demoControlsToggle` CSS blocks verbatim,
the five protocol categories from `_protoLabels`, and the four protocol entries
that survived truncation.

**Styling is the original's.** The first 50KB of `portal.css` was fetched on a
later pass, which covers every section this page uses, so the layout metrics,
the category palette (IA green, IM cyan, IV purple, Other amber, Pre coral), the
hero gradients, the pill buttons and the dimmed light-on-dark protocol frame are
the real values rather than inferred ones. `style.css` — which defines the
shared `--bg`/`--text` tokens — was not captured, so those few root variables are
still approximations.

**Behaviour is not guesswork.** `portal.js` (59,237 chars) and
`portal-protocols.js` (4,275 chars) were both fetched in full on a later pass, so
the security review reflects the real implementation. This rebuild deliberately
does not reproduce their architecture — it re-implements the same UI without the
string-built HTML, the client-trusted authorization flags, or the telemetry.

**Deliberately left blank:** the clinical content inside the protocol frame.
Indications, dosing, dilution and administration sequence are server-rendered by
`/portal.php?action=proto_render` and weren't in the export. Fabricating dosing
guidance for a medical portal would be worse than an empty placeholder, so the
frame renders a labelled notice instead.

**Placeholders, not real values:** the sidebar email is `clinic@example.com`
rather than the address in the export; CSRF token inputs are present but empty.

## What changed versus the original

Each of these traces to a numbered finding in
[SECURITY-REVIEW.md](./SECURITY-REVIEW.md).

| Change | Why |
| --- | --- |
| Demo controls inert unless the server sets `PORTAL_CONFIG.demo`; no `demo_action` client | §1 — the original shipped a self-service permission-granting API |
| No string-built HTML: nodes are created with `textContent` / `setAttribute` | §2 — the original's `escHtml` leaves quotes intact in attribute positions |
| `PORTAL_CONFIG` and `locked` treated as display hints; never sent back as authority | §3 — the original posted `&locked=1` from the client |
| Action Recorder removed entirely; Case Notes marked `data-no-log` | §4 — keystrokes from clinical free-text fields |
| Frame height via origin- **and** source-checked `postMessage`; slug allowlisted | §5 |
| CSRF token inputs present on every mutating form | §6 |
| Un-pinned `chart.js` CDN tag dropped (neither bundle referenced `Chart`) | §9 |
| Strict CSP; every `onclick=` replaced with delegated listeners | §10 |
| Date `min` computed from the browser clock | §12 — the baked value had gone stale |

Also picked up along the way: category counts are derived from the protocol list
instead of hard-coded (the original's "4 protocols" label could drift from
reality), keyboard and focus handling was added to the modals, and the duplicate
"Have a patient scheduled for treatment?" call-to-action — which appeared twice
on the original page, once linking to `/portal/treatment-schedule` and once
opening a modal — is kept but left visually distinct, since which one is intended
is a product decision.

## Wiring it to the real backend

1. Render `window.PORTAL_CONFIG` (as JSON in a `<script type="application/json">`
   block, not an inline assignment) with `clinicId`, `isAdmin`, `viewingAs` and
   `demo`.
2. Replace the `PROTOCOLS` array in `js/portal.js` with the server's list,
   including a real `locked` flag per entry.
3. Point the frame at `/portal.php?action=proto_render&slug=…` and have that
   endpoint post its height to the parent, matching the contract in
   `protocols/frame.js`.
4. Populate the CSRF inputs, and enforce locks, `admin_view_as`, and the date
   floor server-side. The client checks here are conveniences, not controls.
