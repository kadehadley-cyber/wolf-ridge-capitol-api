/* ─────────────────────────────────────────────────────────────────────────
 * Order History.
 *
 * Reconstructed from the captured portal.css order spec (real class names +
 * layout). Order and message data are PLACEHOLDER — real orders are per-clinic
 * and were not captured. Replace ORDERS with the server's list.
 *
 * Hardened like the other pages: strict CSP, no Action Recorder, delegated
 * listeners, PORTAL_CONFIG display-only, and every order/message value (which
 * would be server data on a real page) rendered through the DOM via
 * textContent — never string-concatenated into HTML.
 * ───────────────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };

    /* Pipeline the timeline walks through. `stage` on each order indexes here;
     * 'cancelled' is handled separately. */
    var STEPS = ['Placed', 'Review', 'Approved', 'Shipped', 'Delivered'];

    /* ══ PLACEHOLDER ORDERS ═══════════════════════════════════════════════ */
    var ORDERS = [
        {
            id: 'CN-1042', date: '2026-08-08 14:12:00', stage: 1, total: 0,
            items: [
                { name: 'Umbilical MSC', vol: '2 cc', qty: 4, price: 0 },
                { name: 'Exosomes — standard', vol: '1 cc', qty: 2, price: 0 }
            ],
            messages: [
                { who: 'you', name: 'You', time: '2026-08-08 14:12:00', body: 'Placing our monthly restock — patients scheduled next week.' },
                { who: 'team', name: 'CelluNOVA', time: '2026-08-08 15:40:00', body: 'Received — a physician is reviewing now. We’ll confirm before any charge.' }
            ]
        },
        {
            id: 'CN-1039', date: '2026-08-01 09:30:00', stage: 3, total: 0,
            items: [
                { name: 'Lyophilized exosomes', vol: '3 vials', qty: 3, price: 0 }
            ],
            messages: [
                { who: 'you', name: 'You', time: '2026-08-01 09:30:00', body: 'Standard reorder.' },
                { who: 'team', name: 'CelluNOVA', time: '2026-08-01 11:05:00', body: 'Approved and shipped — tracking sent to your email.' }
            ]
        },
        {
            id: 'CN-1031', date: '2026-07-20 16:00:00', stage: 4, total: 0,
            items: [
                { name: 'Umbilical MSC', vol: '1 cc', qty: 6, price: 0 }
            ],
            messages: [
                { who: 'team', name: 'CelluNOVA', time: '2026-07-24 10:00:00', body: 'Delivered — thanks! Reorder any time.' }
            ]
        },
        {
            id: 'CN-1026', date: '2026-07-10 12:00:00', stage: -1, total: 0, cancelled: true,
            items: [
                { name: 'Exosomes — high-count', vol: '2 cc', qty: 2, price: 0 }
            ],
            messages: [
                { who: 'you', name: 'You', time: '2026-07-10 12:30:00', body: 'Please cancel — ordering the standard line instead.' },
                { who: 'team', name: 'CelluNOVA', time: '2026-07-10 13:15:00', body: 'Cancelled, no charge.' }
            ]
        }
    ];

    var money = function (n) { return '$' + Number(n || 0).toLocaleString(); };
    function fmt(ts) {
        if (!ts) return '';
        var d = new Date(String(ts).replace(' ', 'T'));
        return isNaN(d.getTime()) ? String(ts) : d.toLocaleString('en-US',
            { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    }

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

    /* ══ RENDER ═══════════════════════════════════════════════════════════ */
    var listEl = $('orderList');
    var expanded = {};   // orderId → bool

    function renderTimeline(o) {
        var tl = document.createElement('div');
        tl.className = 'order-timeline';
        var cancelled = o.cancelled === true;
        STEPS.forEach(function (label, i) {
            if (i > 0) {
                var line = document.createElement('div');
                line.className = 'order-timeline-line' + (!cancelled && i <= o.stage ? ' done' : '');
                tl.appendChild(line);
            }
            var step = document.createElement('div');
            step.className = 'order-timeline-step' +
                (cancelled ? '' : (i < o.stage ? ' done' : i === o.stage ? ' active' : ''));
            var dot = document.createElement('div');
            dot.className = 'order-timeline-dot';
            dot.textContent = (!cancelled && i < o.stage) ? '✓' : String(i + 1);
            var lab = document.createElement('div');
            lab.className = 'order-timeline-label';
            lab.textContent = label;
            step.append(dot, lab);
            tl.appendChild(step);
        });
        return tl;
    }

    function orderItemsTotal(o) {
        return o.items.reduce(function (s, it) { return s + it.price * it.qty; }, 0);
    }

    function renderBody(o) {
        var body = document.createElement('div');
        body.className = 'order-body';
        if (!expanded[o.id]) body.hidden = true;

        var layout = document.createElement('div');
        layout.className = 'order-body-layout';

        // conversation
        var convo = document.createElement('div');
        convo.appendChild(sectionTitle('Conversation'));
        o.messages.forEach(function (m) {
            var msg = document.createElement('div');
            msg.className = 'order-msg ' + (m.who === 'team' ? 'order-msg-team' : 'order-msg-you');
            var head = document.createElement('div');
            head.className = 'order-msg-header';
            var who = document.createElement('span'); who.className = 'who'; who.textContent = m.name;
            var when = document.createElement('span'); when.className = 'when'; when.textContent = fmt(m.time);
            head.append(who, when);
            var bd = document.createElement('div');
            bd.className = 'order-msg-body';
            bd.textContent = m.body;                 // textContent — inert
            msg.append(head, bd);
            convo.appendChild(msg);
        });
        // reply (stub)
        var form = document.createElement('div');
        form.className = 'order-reply-form';
        var inp = document.createElement('input');
        inp.type = 'text'; inp.className = 'order-reply-input';
        inp.placeholder = 'Reply to our team…'; inp.setAttribute('data-no-log', '');
        var send = document.createElement('button');
        send.type = 'button'; send.className = 'btn sm primary';
        send.dataset.action = 'reply'; send.textContent = 'Send';
        form.append(inp, send);
        convo.appendChild(form);

        // items sidebar
        var side = document.createElement('div');
        side.className = 'order-items-sidebar';
        side.appendChild(sectionTitle('Items'));
        o.items.forEach(function (it) {
            var row = document.createElement('div');
            row.className = 'order-item-row';
            var left = document.createElement('div');
            var nm = document.createElement('div'); nm.className = 'order-item-name'; nm.textContent = it.name;
            var meta = document.createElement('div'); meta.className = 'order-item-meta'; meta.textContent = it.vol + ' ×' + it.qty;
            left.append(nm, meta);
            var price = document.createElement('div');
            price.className = 'order-item-price';
            price.textContent = it.price ? money(it.price * it.qty) : '—';
            row.append(left, price);
            side.appendChild(row);
        });
        var tot = document.createElement('div');
        tot.className = 'order-items-total';
        var tl = document.createElement('span'); tl.textContent = 'Total';
        var tv = document.createElement('span'); tv.textContent = orderItemsTotal(o) ? money(orderItemsTotal(o)) : '—';
        tot.append(tl, tv);
        side.appendChild(tot);

        layout.append(convo, side);
        body.appendChild(layout);
        return body;
    }

    function sectionTitle(text) {
        var h = document.createElement('div');
        h.className = 'order-section-title';
        h.textContent = text;
        return h;
    }

    function renderCard(o) {
        var card = document.createElement('div');
        card.className = 'order-card' + (o.cancelled ? ' cancelled' : '') + (expanded[o.id] ? ' open' : '');
        card.dataset.id = o.id;

        card.appendChild(renderTimeline(o));

        var header = document.createElement('div');
        header.className = 'order-header';
        header.dataset.action = 'toggle';
        header.dataset.id = o.id;

        var left = document.createElement('div');
        var num = document.createElement('span'); num.className = 'order-num'; num.textContent = 'Order ' + o.id;
        var date = document.createElement('span'); date.className = 'order-date'; date.textContent = fmt(o.date);
        left.append(num, date);

        var right = document.createElement('div');
        right.className = 'order-header-right';
        if (o.cancelled) {
            var pill = document.createElement('span');
            pill.className = 'order-msg-badge';
            pill.style.color = '#ff6b8a';
            pill.textContent = 'Cancelled';
            right.appendChild(pill);
        }
        if (o.messages && o.messages.length) {
            var badge = document.createElement('span');
            badge.className = 'order-msg-badge';
            badge.textContent = o.messages.length + ' message' + (o.messages.length === 1 ? '' : 's');
            right.appendChild(badge);
        }
        var total = document.createElement('span');
        total.className = 'order-total';
        total.textContent = orderItemsTotal(o) ? money(orderItemsTotal(o)) : '—';
        right.appendChild(total);
        var exp = document.createElement('span'); exp.className = 'order-expand'; exp.textContent = '▾';
        right.appendChild(exp);

        header.append(left, right);
        card.appendChild(header);
        card.appendChild(renderBody(o));
        return card;
    }

    function render() {
        listEl.textContent = '';
        if (!ORDERS.length) {
            var empty = document.createElement('div');
            empty.className = 'order-empty';
            empty.textContent = 'No orders yet.';
            listEl.appendChild(empty);
            return;
        }
        ORDERS.forEach(function (o) { listEl.appendChild(renderCard(o)); });
    }

    /* ══ EVENTS ═══════════════════════════════════════════════════════════ */
    document.addEventListener('click', function (e) {
        var el = e.target.closest('[data-action]');
        if (!el) return;
        if (el.dataset.action === 'toggle') {
            var id = el.dataset.id;
            expanded[id] = !expanded[id];
            render();
        } else if (el.dataset.action === 'reply') {
            cModal.alert('Not wired', 'In production this posts your reply to the order thread. '
                + 'This static build sends nothing.');
        }
    });

    var sidebarToggle = $('sidebarToggle');
    sidebarToggle.addEventListener('click', function () {
        var sb = document.querySelector('.portal-sidebar');
        var open = sb.classList.toggle('open');
        sidebarToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && cModal.isOpen()) cModal.close(); });

    render();
})();
