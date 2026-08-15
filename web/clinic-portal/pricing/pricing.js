/* ─────────────────────────────────────────────────────────────────────────
 * Pricing / Ordering.
 *
 * Reconstructed from the captured portal.css shop spec (real class names +
 * layout); the product data and per-cc cost are PLACEHOLDER — the line was
 * redone. Everything price-related lives in the PRODUCTS/PRICING block below,
 * so swapping in the finalized catalog is a single edit.
 *
 * Hardened like the other rebuilt pages: strict CSP, no Action Recorder,
 * delegated listeners, PORTAL_CONFIG as display hints only, and all output
 * built through the DOM (textContent / createElement) — no string-built HTML
 * from data, so nothing user/catalog-derived can break out of an attribute.
 * Ordering itself is a client-side draft; "Submit for review" is a stub — the
 * real flow posts to the physician-review endpoint.
 * ───────────────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    var CONFIG = window.PORTAL_CONFIG || { clinicId: null, isAdmin: false };
    var $ = function (id) { return document.getElementById(id); };

    /* ══ PLACEHOLDER CATALOG ══════════════════════════════════════════════
     * The product line and cost were redone — replace this whole block with the
     * finalized catalog. Prices are $/vial (or $/cc — match your unit). `cat`
     * drives the colour: msc=green, exo=cyan, lyo=purple. `popular` is a badge.
     * ═════════════════════════════════════════════════════════════════════ */
    var CATEGORIES = [
        { key: 'msc', label: 'NOVA biologics' },
        { key: 'exo', label: 'Exosomes' }
    ];
    /* The NOVA product family, from the CelluNOVA Brand Standards Guide:
     * NOVA-FLOW, NOVA-FLEX, NOVA-ELITE at $800 per cc; NOVA-EXO+ at $500 per
     * cc. Volume options are placeholders until the finalized sizes are set. */
    var PRICING = {
        perCc: 800,
        novaExoPlusPerCc: 500
    };
    var PRODUCTS = [
        { id: 'nova-flow',  name: 'NOVA-FLOW', cat: 'msc',
          variants: [{ vol: '1 cc', price: 800 }, { vol: '2 cc', price: 1600 }, { vol: '5 cc', price: 4000 }] },
        { id: 'nova-flex',  name: 'NOVA-FLEX', cat: 'msc',
          variants: [{ vol: '1 cc', price: 800 }, { vol: '2 cc', price: 1600 }, { vol: '5 cc', price: 4000 }] },
        { id: 'nova-elite', name: 'NOVA-ELITE', cat: 'msc', popular: true,
          variants: [{ vol: '1 cc', price: 800 }, { vol: '2 cc', price: 1600 }, { vol: '5 cc', price: 4000 }] },
        { id: 'exo-plus',   name: 'NOVA-EXO+', cat: 'exo', popular: true,
          variants: [{ vol: '1 cc', price: 500 }, { vol: '2 cc', price: 1000 }, { vol: '5 cc', price: 2500 }] }
    ];

    var catLabel = {};
    CATEGORIES.forEach(function (c) { catLabel[c.key] = c.label; });

    var money = function (n) { return '$' + Number(n || 0).toLocaleString(); };

    /* Order state: key `productId::vol` → { product, variant, qty }. */
    var order = {};
    var activeVariant = {};   // productId → chosen vol (defaults to first)

    /* ══ MODAL ════════════════════════════════════════════════════════════ */
    var cModal = (function () {
        var overlay = $('cModalOverlay'), titleEl = $('cModalTitle'), bodyEl = $('cModalBody'),
            okBtn = $('cModalOk'), cancelBtn = $('cModalCancel'), cb = null, lastFocus = null;
        function close(r) { overlay.hidden = true; var f = cb; cb = null; if (lastFocus) lastFocus.focus(); if (f) f(r); }
        function open(t, b, withCancel, fn) {
            lastFocus = document.activeElement;
            titleEl.textContent = t; bodyEl.textContent = b;
            cancelBtn.hidden = !withCancel; cb = fn || null; overlay.hidden = false; okBtn.focus();
        }
        okBtn.addEventListener('click', function () { close(true); });
        cancelBtn.addEventListener('click', function () { close(false); });
        overlay.addEventListener('click', function (e) { if (e.target === overlay) close(false); });
        return { alert: function (t, b, fn) { open(t, b, false, fn); }, isOpen: function () { return !overlay.hidden; }, close: function () { close(false); } };
    })();

    /* ══ RENDER CATALOG ═══════════════════════════════════════════════════ */
    var listEl = $('prodList');

    function variantOf(p, vol) {
        return p.variants.filter(function (v) { return v.vol === vol; })[0] || p.variants[0];
    }
    function keyFor(pid, vol) { return pid + '::' + vol; }

    function renderCatalog() {
        listEl.textContent = '';
        CATEGORIES.forEach(function (c) {
            var inCat = PRODUCTS.filter(function (p) { return p.cat === c.key; });
            if (!inCat.length) return;
            var head = document.createElement('div');
            head.className = 'shop-cat-head';
            head.textContent = c.label;
            listEl.appendChild(head);
            inCat.forEach(function (p) { listEl.appendChild(renderRow(p)); });
        });
    }

    function renderRow(p) {
        if (!activeVariant[p.id]) activeVariant[p.id] = p.variants[0].vol;
        var v = variantOf(p, activeVariant[p.id]);
        var k = keyFor(p.id, v.vol);
        var inOrder = order[k];

        var row = document.createElement('div');
        row.className = 'prod-row prod-' + p.cat + (inOrder ? ' prod-selected' : '');
        row.dataset.pid = p.id;

        // main
        var main = document.createElement('div');
        main.className = 'prod-main';
        var left = document.createElement('div');
        left.className = 'prod-left';
        var nm = document.createElement('div');
        nm.className = 'prod-name';
        nm.textContent = p.name;                    // textContent — inert
        var meta = document.createElement('div');
        meta.className = 'prod-meta';
        var vol = document.createElement('span');
        vol.className = 'prod-vol';
        vol.textContent = v.vol;
        meta.appendChild(vol);
        if (p.popular) { var pop = document.createElement('span'); pop.className = 'prod-pop'; pop.textContent = 'Popular'; meta.appendChild(pop); }
        left.append(nm, meta);

        var right = document.createElement('div');
        right.className = 'prod-right';
        var price = document.createElement('div');
        price.className = 'prod-price';
        price.textContent = v.price ? money(v.price) : '—';
        right.appendChild(price);

        var selArea = document.createElement('div');
        selArea.className = 'prod-select-area';
        selArea.appendChild(inOrder ? qtyControls(p, v) : addButton(p, v));

        main.append(left, right, selArea);
        row.appendChild(main);

        // variant pills
        if (p.variants.length > 1) {
            var vr = document.createElement('div');
            vr.className = 'prod-variants';
            var lab = document.createElement('span');
            lab.className = 'prod-variants-label';
            lab.textContent = 'Size';
            var pills = document.createElement('div');
            pills.className = 'prod-variants-pills';
            p.variants.forEach(function (vv) {
                var pill = document.createElement('button');
                pill.type = 'button';
                pill.className = 'prod-variant-pill' + (vv.vol === v.vol ? ' active' : '');
                pill.dataset.action = 'pick-variant';
                pill.dataset.pid = p.id;
                pill.dataset.vol = vv.vol;
                var pv = document.createElement('span'); pv.className = 'pv-vol'; pv.textContent = vv.vol;
                var pp = document.createElement('span'); pp.className = 'pv-price'; pp.textContent = vv.price ? money(vv.price) : '—';
                pill.append(pv, pp);
                pills.appendChild(pill);
            });
            vr.append(lab, pills);
            row.appendChild(vr);
        }
        return row;
    }

    function addButton(p, v) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'prod-add-btn';
        b.dataset.action = 'add';
        b.dataset.pid = p.id;
        b.dataset.vol = v.vol;
        b.textContent = 'Add';
        return b;
    }
    function qtyControls(p, v) {
        var wrap = document.createElement('div');
        wrap.className = 'prod-qty visible';
        var line = order[keyFor(p.id, v.vol)];
        var minus = document.createElement('button'); minus.type = 'button'; minus.className = 'prod-qty-btn'; minus.dataset.action = 'qty'; minus.dataset.pid = p.id; minus.dataset.vol = v.vol; minus.dataset.d = '-1'; minus.textContent = '−';
        var val = document.createElement('span'); val.className = 'prod-qty-val'; val.textContent = String(line ? line.qty : 0);
        var plus = document.createElement('button'); plus.type = 'button'; plus.className = 'prod-qty-btn'; plus.dataset.action = 'qty'; plus.dataset.pid = p.id; plus.dataset.vol = v.vol; plus.dataset.d = '1'; plus.textContent = '+';
        wrap.append(minus, val, plus);
        return wrap;
    }

    /* ══ ORDER STATE ══════════════════════════════════════════════════════ */
    function productById(id) { return PRODUCTS.filter(function (p) { return p.id === id; })[0]; }

    function addToOrder(pid, vol) {
        var p = productById(pid); if (!p) return;
        var v = variantOf(p, vol);
        var k = keyFor(pid, vol);
        if (order[k]) order[k].qty += 1;
        else order[k] = { product: p, variant: v, qty: 1 };
        refresh();
    }
    function changeQty(pid, vol, d) {
        var k = keyFor(pid, vol);
        if (!order[k]) return;
        order[k].qty += d;
        if (order[k].qty <= 0) delete order[k];
        refresh();
    }
    function removeLine(k) { delete order[k]; refresh(); }

    function orderLines() { return Object.keys(order).map(function (k) { return { k: k, line: order[k] }; }); }
    function orderTotal() { return orderLines().reduce(function (s, x) { return s + x.line.variant.price * x.line.qty; }, 0); }
    function orderCount() { return orderLines().reduce(function (s, x) { return s + x.line.qty; }, 0); }

    /* ══ RENDER SUMMARY ═══════════════════════════════════════════════════ */
    function renderSummary() {
        var itemsEl = $('summaryItems'), totalsEl = $('summaryTotals');
        var lines = orderLines();
        itemsEl.textContent = '';

        if (!lines.length) {
            var empty = document.createElement('div');
            empty.className = 'shop-summary-empty';
            empty.textContent = 'No items yet — pick a product and quantity.';
            itemsEl.appendChild(empty);
            totalsEl.hidden = true;
            $('orderSubmit').disabled = true;
        } else {
            lines.forEach(function (x) {
                var row = document.createElement('div');
                row.className = 'shop-summary-item';
                var nm = document.createElement('div');
                nm.className = 'shop-summary-item-name';
                nm.textContent = x.line.product.name;
                var sub = document.createElement('span');
                sub.textContent = x.line.variant.vol + ' ×' + x.line.qty;
                nm.appendChild(sub);
                var rightWrap = document.createElement('div');
                var price = document.createElement('span');
                price.className = 'shop-summary-item-price';
                price.textContent = money(x.line.variant.price * x.line.qty);
                var rm = document.createElement('button');
                rm.type = 'button'; rm.className = 'shop-summary-item-x';
                rm.dataset.action = 'remove-line'; rm.dataset.k = x.k;
                rm.setAttribute('aria-label', 'Remove'); rm.textContent = '×';
                rightWrap.append(price, rm);
                row.append(nm, rightWrap);
                itemsEl.appendChild(row);
            });
            $('summarySubtotal').textContent = money(orderTotal());
            $('summaryTotal').textContent = money(orderTotal());
            totalsEl.hidden = false;
            $('orderSubmit').disabled = false;
        }

        var n = orderCount();
        $('summaryCount').textContent = n + (n === 1 ? ' item' : ' items');
        $('mobileCount').textContent = String(n);
        $('mobileTotal').textContent = money(orderTotal());
    }

    function refresh() { renderCatalog(); renderSummary(); }

    /* ══ CHECKOUT ═════════════════════════════════════════════════════════
     * Posts the cart (ids + quantities only — the server owns the prices) to
     * the checkout endpoint and redirects to Stripe's hosted payment page.
     * Cards never touch this site. */
    var checkingOut = false;
    function startCheckout() {
        if (checkingOut) return;
        checkingOut = true;
        var btn = $('orderSubmit');
        var oldLabel = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Starting secure checkout…';
        fetch('/portal/api/checkout', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                items: orderLines().map(function (x) {
                    return { id: x.line.product.id, vol: x.line.variant.vol, qty: x.line.qty };
                }),
                notes: ($('orderNotes').value || '').slice(0, 480)
            })
        })
            .then(function (res) {
                return res.json().then(function (d) {
                    if (!res.ok) throw new Error(d && d.error ? d.error : 'Checkout failed.');
                    return d;
                });
            })
            .then(function (d) { window.location.assign(d.url); })
            .catch(function (e) {
                checkingOut = false;
                btn.disabled = false;
                btn.textContent = oldLabel;
                cModal.alert('Checkout unavailable',
                    (e && e.message) ? e.message : 'Could not start checkout. Please try again.');
            });
    }

    /* ══ EVENTS ═══════════════════════════════════════════════════════════ */
    document.addEventListener('click', function (e) {
        var el = e.target.closest('[data-action]');
        if (!el) return;
        var a = el.dataset.action;
        if (a === 'pick-variant') { activeVariant[el.dataset.pid] = el.dataset.vol; renderCatalog(); }
        else if (a === 'add') { addToOrder(el.dataset.pid, el.dataset.vol); }
        else if (a === 'qty') { changeQty(el.dataset.pid, el.dataset.vol, Number(el.dataset.d)); }
        else if (a === 'remove-line') { removeLine(el.dataset.k); }
        else if (a === 'toggle-mobile-bar') { /* room for an expand panel */ }
        else if (a === 'submit-order') {
            if (!orderLines().length) return;
            startCheckout();
        }
    });

    var sidebarToggle = $('sidebarToggle');
    sidebarToggle.addEventListener('click', function () {
        var sb = document.querySelector('.portal-sidebar');
        var open = sb.classList.toggle('open');
        sidebarToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && cModal.isOpen()) cModal.close();
    });

    refresh();
})();
