/* ─────────────────────────────────────────────────────────────────────────
 * Admin dashboard.
 *
 * Reconstructed from the captured portal.css admin spec. ALL data is
 * fabricated placeholder — real admin figures and clinic records must load
 * server-side behind an admin check (this static page has no auth). Rendered
 * through the DOM (textContent) so nothing is string-built from data.
 * ───────────────────────────────────────────────────────────────────────── */
(function () {
    'use strict';
    var $ = function (id) { return document.getElementById(id); };
    var money = function (n) { return '$' + Number(n || 0).toLocaleString(); };

    /* ══ PLACEHOLDER DATA ═════════════════════════════════════════════════ */
    var OVERVIEW = [
        { label: 'Revenue (30d)', value: money(0), tag: null },
        { label: 'Settled', value: money(0), settled: true, tag: 'settled' },
        { label: 'Pending review', value: '0', tag: null },
        { label: 'Orders (30d)', value: '0', tag: null },
        { label: 'Active clinics', value: '0', tag: null },
        { label: 'Open tickets', value: '0', tag: null }
    ];
    var FIN_CARDS = [
        { label: 'Gross (YTD)', value: money(0), tag: 'est' },
        { label: 'Settled (YTD)', value: money(0), settled: true, tag: 'settled' },
        { label: 'Outstanding', value: money(0), tag: 'est' }
    ];
    var BREAKDOWN = [
        { month: '2026-08', orders: 0, gross: 0, settled: 0 },
        { month: '2026-07', orders: 0, gross: 0, settled: 0 },
        { month: '2026-06', orders: 0, gross: 0, settled: 0 }
    ];
    var CLINICS = [
        { name: 'Example Ortho Clinic', contact: 'clinic@example-ortho.test', state: 'AZ', status: 'approved' },
        { name: 'Desert Wellness Spa',  contact: 'hello@desert-wellness.test', state: 'AZ', status: 'pending' },
        { name: 'Valley Regenerative',  contact: 'care@valley-regen.test',     state: 'UT', status: 'approved' },
        { name: 'Old Town Aesthetics',  contact: 'front@oldtown.test',         state: 'NV', status: 'revoked' }
    ];

    /* ══ MODAL ════════════════════════════════════════════════════════════ */
    var cModal = (function () {
        var overlay = $('cModalOverlay'), titleEl = $('cModalTitle'), bodyEl = $('cModalBody'),
            okBtn = $('cModalOk'), cancelBtn = $('cModalCancel'), cb = null, lastFocus = null;
        function close(r) { overlay.hidden = true; var f = cb; cb = null; if (lastFocus) lastFocus.focus(); if (f) f(r); }
        function open(t, b, wc, fn) { lastFocus = document.activeElement; titleEl.textContent = t; bodyEl.textContent = b; cancelBtn.hidden = !wc; cb = fn || null; overlay.hidden = false; okBtn.focus(); }
        okBtn.addEventListener('click', function () { close(true); });
        cancelBtn.addEventListener('click', function () { close(false); });
        overlay.addEventListener('click', function (e) { if (e.target === overlay) close(false); });
        return { alert: function (t, b, fn) { open(t, b, false, fn); }, isOpen: function () { return !overlay.hidden; }, close: function () { close(false); } };
    })();

    /* ══ RENDER ═══════════════════════════════════════════════════════════ */
    function finCard(c) {
        var card = document.createElement('div');
        card.className = 'fin-card';
        var lab = document.createElement('div'); lab.className = 'label'; lab.textContent = c.label;
        var val = document.createElement('div'); val.className = 'value' + (c.settled ? ' settled' : '');
        val.textContent = c.value;
        if (c.tag === 'settled') { var t = document.createElement('span'); t.className = 'fin-settled-tag'; t.textContent = 'SETTLED'; val.appendChild(t); }
        else if (c.tag === 'est') { var e = document.createElement('span'); e.className = 'fin-est-tag'; e.textContent = 'EST'; val.appendChild(e); }
        card.append(lab, val);
        return card;
    }
    function renderCards(el, data) { el.textContent = ''; data.forEach(function (c) { el.appendChild(finCard(c)); }); }

    function renderBreakdown() {
        var tb = $('finBreakdown'); tb.textContent = '';
        BREAKDOWN.forEach(function (r) {
            var tr = document.createElement('tr');
            [r.month, String(r.orders), money(r.gross), money(r.settled)].forEach(function (v) {
                var td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
            });
            tb.appendChild(tr);
        });
    }

    function renderClinics() {
        var tb = $('clinicsBody'); tb.textContent = '';
        CLINICS.forEach(function (c) {
            var tr = document.createElement('tr');
            function cell(text) { var td = document.createElement('td'); td.textContent = text; return td; }
            tr.appendChild(cell(c.name));
            tr.appendChild(cell(c.contact));
            tr.appendChild(cell(c.state));
            var st = document.createElement('td');
            var pill = document.createElement('span'); pill.className = 'status-pill ' + c.status; pill.textContent = c.status;
            st.appendChild(pill); tr.appendChild(st);
            var act = document.createElement('td');
            var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn sm';
            btn.dataset.action = 'manage'; btn.textContent = 'Manage';
            act.appendChild(btn); tr.appendChild(act);
            tb.appendChild(tr);
        });
    }

    function showTab(tab) {
        ['overview', 'clinics', 'financials'].forEach(function (t) {
            $('adminView-' + t).hidden = t !== tab;
        });
        Array.prototype.forEach.call(document.querySelectorAll('.admin-tab'), function (b) {
            var on = b.dataset.tab === tab;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
    }

    /* ══ EVENTS ═══════════════════════════════════════════════════════════ */
    document.addEventListener('click', function (e) {
        var el = e.target.closest('[data-action]');
        if (!el) return;
        if (el.dataset.action === 'tab') showTab(el.dataset.tab);
        else if (el.dataset.action === 'manage')
            cModal.alert('Not wired', 'Clinic management (approve / revoke / edit) is server-side and admin-gated; not implemented in this static build.');
    });
    var st = $('sidebarToggle');
    st.addEventListener('click', function () {
        var sb = document.querySelector('.portal-sidebar');
        st.setAttribute('aria-expanded', sb.classList.toggle('open') ? 'true' : 'false');
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && cModal.isOpen()) cModal.close(); });

    renderCards($('overviewCards'), OVERVIEW);
    renderCards($('finCards'), FIN_CARDS);
    renderBreakdown();
    renderClinics();
    showTab('overview');
})();
