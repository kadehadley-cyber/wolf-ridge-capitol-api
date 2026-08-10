# Order History page

Hardened rebuild of `/portal/orders`, reconstructed from the captured
`portal.css` order spec (`.order-card`, `.order-timeline`, `.order-body-layout`,
`.order-msg`, `.order-item-row` were all present), so the layout and styling
match the real page. Order and message data are placeholder.

## Behaviour

Each order is a card with a status **timeline** (Placed → Review → Approved →
Shipped → Delivered; cancelled orders dim and clear the timeline). Click a card
to expand its body: a two-column layout with the **conversation** thread
(you vs. team, colour-coded) on the left and the **items** + total on the right.
The reply box is a stub — the real flow posts to the order thread.

## Placeholder data

Replace `ORDERS` at the top of `orders.js`. Each order: `id`, `date`, `stage`
(0–4 index into the timeline steps, or `cancelled: true`), `items[]`, and
`messages[]`. Prices are 0 → shown as `—` until the real catalog cost is set.

## Hardening

Strict CSP (no inline styles or handlers — verified clean in Chromium), no
Action Recorder, delegated listeners, `PORTAL_CONFIG` display-only, and every
order/message value rendered via `textContent` (never string-built HTML) — so
message bodies, which are server/user data on the real page, can't inject.

## Making it faithful

Grab the real `/portal/orders` `.portal-main` HTML and any `portal-orders.js`,
then the card/timeline/conversation wiring can replace the reconstruction, with
order and message loading enforced server-side and scoped to the clinic.
