# Rebuild plan — scraping cellunova.bio into a hardened front-end mirror

Source repo (PHP + JS + CSS) is not available to this session, so we
reconstruct each page from the live site and harden as we go. This is a
**front-end mirror**: no `portal.php`, no auth, no database. Pages that need the
backend get a documented stub, not a fake.

## Hard rules

1. **No real data in git.** Admin exports contain lead/patient PII, other
   clinics' records, and financials. Every real name / email / phone / address /
   price / recorded session is replaced with a placeholder before commit. If a
   real value slips in, it gets scrubbed and the history noted.
2. **Every page carries the same hardening** the protocols + CRM pages do:
   strict CSP, no inline handlers, no Action Recorder, `escAttr` + `safeUrl` for
   any user/lead-derived output, server-authority treated as authority (the UI
   only reflects it).
3. **Backend logic is never invented.** `demo_action`, `proto_render`, pricing
   math, lead storage, replay — stubbed with a TODO pointing at the real endpoint.

## Fastest extraction recipe (avoids the truncation we kept hitting)

The DevTools-AI `fetch()` path truncates at ~1000–20000 chars, which cost many
round-trips. For whole files, skip it:

- **JS / CSS bundles** (`portal.js`, `portal-<page>.js`, `portal.css`,
  `style.css`): open the URL directly in a browser tab
  (e.g. `https://cellunova.bio/frontend/js/dist/portal-pricing.js`) and **Save
  As**, or `View Source`. Whole file, no truncation. Paste or attach.
- **Page HTML**: DevTools → **Sources** tab → the document → right-click → Save,
  or `Ctrl-U` view-source on the page. Grab the whole thing.
- **When using the AI-assistant export anyway**: ask it for the page's main
  content in one slice —
  `document.querySelector('.portal-main, main, .portal-content-wrap').outerHTML`
  — rather than letting it walk the tree child by child.

Shared assets (`portal.js`, `portal.css`) only need to be fetched **once** — the
CRM and protocols pages already reuse them. New pages usually need only their
own `portal-<page>.js` and their slice of `portal.css`.

## Page inventory

Status: ✅ built · 🟡 partial · ⬜ not started

| Page | Route | Status | Still needs |
| --- | --- | --- | --- |
| Protocols | `/portal/protocols` | ✅ | complete (JS+CSS+DOM captured) |
| CRM | `/portal/crm` | 🟡 | real `portal-crm.js` (64KB), CRM DOM, `.crm-*` CSS past 70KB |
| Pricing / Ordering | `/portal/pricing` | ⬜ | page DOM, `portal-pricing.js`?, product data (placeholder) |
| Tickets / Support chat | `/portal/tickets` | ⬜ | DOM; chat logic already partly in `portal.js` |
| Order history | `/portal/orders` | ⬜ | DOM, order-card + timeline CSS (have some) |
| Treatment schedule | `/portal/treatment-schedule` | ⬜ | DOM |
| Marketing resources | `/portal/marketing-resources` | ⬜ | DOM; report render already in `portal.js` |
| First-login splash | `/portal/welcome` | ⬜ | DOM |
| Admin dashboard | `/portal/` (admin) | ⬜ | DOM, admin tabs/financials (CSS partly captured) |
| Public marketing site | `/` and children | ⬜ | separate from the portal; own CSS (`style.css`) |

## Per-page checklist

For each new page, capture and hand over:

1. The page's **main-content HTML** (one slice, per recipe above).
2. Its **page-specific JS** (`portal-<page>.js`) in full, if one exists.
3. Any **`portal.css` section** for that page not already captured (past 70KB).
4. Note any **new endpoints** the JS calls (`?action=...`) so the review's
   server-authority findings stay current.

Then I build the hardened page, browser-test it, scrub placeholders, commit.
