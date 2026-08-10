# CRM page

Hardened static rebuild of the CelluNOVA portal's `/portal/crm`, plus a
sales-intelligence lead schema for ranking the best leads.

Lives under `web/clinic-portal/crm/`; reuses the shared shell in
`../styles/portal.css`.

## Faithful vs. reconstructed vs. placeholder

The `/portal/crm` DevTools export was much thinner than the protocols one — it
captured the filter input IDs and the exact field set `portal-crm.js` renders,
but **not** the CRM's markup, its 64KB of logic, or its `.crm-*` styles.

| Faithful (from the export) | Reconstructed | Placeholder / not built |
| --- | --- | --- |
| Filter IDs (`crmSearch`, `crmFilter*`, `crmQueue*`, `crmFollowupDate`, `crmNoteInput`, `crmDispNote`), state/territory default `AZ`, REP sidebar, replay overlay IDs (`replaySessionSel`, `replaySpeed`) | Toolbar + split layout + detail card styling (matched to the shell) | The lead **rows** (real leads are PII, never captured), the "intelligence" scan, and the replay **player** |
| The lead-detail field set: name, phone, email, address, website, category, source, last_contacted, next_followup, stage, tier, rep, score, created_at | Section grouping of those fields | — |

`LEADS` in `crm.js` is clearly-marked sample data. Lead 2 carries a hostile
`javascript:` website value on purpose — it must render inert (see hardening).

## Sales-intelligence schema (added on request)

Beyond the captured fields, each lead carries:

| Field | Meaning |
| --- | --- |
| `owner_name`, `doctor_name` | decision-makers |
| `patients_per_day`, `est_monthly_cc` | throughput / deal size |
| `offers_prp`, `offers_exosomes`, `offers_stem_cells` | what regen they already run |
| `current_supplier`, `price_per_cc_current` | incumbent + their price |
| `switch_likelihood` | optional server override for the computed fit |

`computeFit()` turns those signals into a **0–100 switch-likelihood**, a
Hot/Warm/Cold band, and the reasons a rep leads with. The heuristic rewards:
already-in-category buyers, PRP-but-not-full-line upsell targets, anyone **not**
on Platinum (where the ~$200–400/cc price wedge applies), and higher volume.
Platinum incumbents are scored down on price and flagged to differentiate on our
physician-led sourcing + service instead. The weights are transparent and
commented — tune them to what actually closes.

Physician-led is **our** brand differentiator (the only physician-led stem
cell / exosome distributor), not a prospect attribute — so it's a talking point
in the Platinum fallback, not a lead field or a scoring signal.

`savingsLine()` quotes estimated per-cc and per-month savings from the lead's
current price and volume.

Sort defaults to **Best fit**; quick filters: already-runs-regen and
not-on-Platinum.

> The scoring is a rule-of-thumb to rank a rep's queue, not a prediction.
> Treat lead PII (owner, doctor, phone, email) as regulated contact data —
> access-control it and keep it out of the telemetry surface flagged in
> `../SECURITY-REVIEW.md` §4.

## Hardening (carried from the protocols rebuild)

- **No Action Recorder.** The keystroke tracker is gone; note fields carry `data-no-log`.
- **§2 fixed by construction.** Lead links (tel/mailto/website) are built with
  `createElement` + `setAttribute` and a **scheme allowlist** (`safeUrl`), never
  string-concatenated into an `href` through the quote-unsafe `escHtml` the
  original uses. A `javascript:` URL collapses to inert text — verified in
  Chromium (no dialog, no `javascript:` href).
- **Replay overlay is inert** and server-gated (`PORTAL_CONFIG.canReplay`); this
  build ships no player (§1).
- Strict CSP, delegated listeners (no inline `onclick`), `PORTAL_CONFIG` treated
  as display hints only.

## Making it faithful

Same loop that completed the protocols page — from a logged-in `/portal/crm`
session:

1. **The CRM markup** — `document.querySelector('.crm-main, .portal-main').innerHTML`
   in ~15KB slices, so the real lead-list / detail / queue / replay DOM replaces
   the reconstructed layout.
2. **`portal-crm.js`** in full (64,061 chars) — so the real render, the
   intelligence scan, and the replay player can be reviewed and reproduced.
3. **`portal.css` past 70KB** — the `.crm-*` rules, to replace `crm.css`.
4. Wire `crmNoteInput` / `crmFollowupDate` / queue to the real endpoints, and
   enforce every filter and the replay authorization **server-side**.
