# Pricing / Ordering page

Hardened rebuild of `/portal/pricing`. Unlike the CRM page, this one was
**reconstructed from the captured CSS** rather than invented — the shop spec
(`.prod-list` / `.prod-row`, variant pills, `.shop-summary`, `.order-hero`,
`.shop-mobile-bar`) was fully present in `portal.css`, so the layout and styling
match the real page. The product data and per-cc cost are placeholder.

## Faithful vs. placeholder

| Faithful (from captured CSS) | Placeholder / stub |
| --- | --- |
| Order hero + journey, catalog list, category colours (msc/exo/lyo), variant pills, add/qty controls, sticky order summary, mobile order bar | The product catalog + prices; `portal-pricing.js`'s real logic; the submit flow |

## Placeholder catalog in one spot

The line and cost were redone, so the whole catalog lives in the
`PRODUCTS` / `PRICING` block at the top of `pricing.js`:

```js
var PRODUCTS = [
  { id: 'msc-umb', name: 'Umbilical MSC', cat: 'msc', popular: true,
    variants: [{ vol: '1 cc', price: 0 }, ...] },
  ...
];
```

Set real `price` values (and add/rename products) and the catalog, variant
pills, order summary, and totals all update. `cat` drives the colour:
`msc`=green, `exo`=cyan, `lyo`=purple.

## Behaviour

Client-side draft order: pick a variant, **Add**, adjust quantity, remove from
the summary; the total and item count update live (desktop summary + mobile
bar). **Submit for review** is a stub — the real flow posts to the
physician-review endpoint; no payment is taken until a physician confirms (the
copy matches the live order-bar messaging).

## Hardening

Strict CSP (no inline styles or handlers — verified clean in Chromium), no
Action Recorder, delegated listeners, `PORTAL_CONFIG` as display hints only, and
all catalog output built through the DOM (`textContent` / `createElement`) so no
product- or user-derived value is ever string-concatenated into HTML.

## Making it faithful

From a logged-in `/portal/pricing` session: grab `portal-pricing.js` (open the
URL directly and Save As), the page's `.portal-main` HTML, and the real product
list — then the catalog logic and cart/order-history wiring can replace the
reconstruction. Enforce pricing and the order submission server-side.
