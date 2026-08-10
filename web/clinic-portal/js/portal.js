/* ─────────────────────────────────────────────────────────────────────────
 * Clinic Portal — Protocols & Treatments
 *
 * All behaviour lives here rather than in inline `onclick=` attributes and
 * inline <script> blocks, so the page can ship the strict CSP declared in
 * index.html. Deliberately omitted from the original page:
 *
 *   - the "Action Recorder", which streamed every click and keystroke to
 *     /portal.php?action=user_events_log   (SECURITY-REVIEW.md §1)
 *   - the un-pinned chart.js CDN tag, which nothing on this page used
 *                                          (SECURITY-REVIEW.md §3)
 *
 * ───────────────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    /* ══ CONFIG ═══════════════════════════════════════════════════════════
     * Server-rendered in production. Every field here is a *display* hint:
     * nothing in this file may be the only thing standing between a user and
     * data they should not have. Locks, admin rights and demo powers are
     * enforced by the backend; the UI only reflects them.
     * ═════════════════════════════════════════════════════════════════════ */
    var CONFIG = window.PORTAL_CONFIG || {
        clinicId: null,
        isAdmin: false,
        viewingAs: null,   // 'clinic' when an admin is impersonating
        demo: false,       // demo controls stay inert unless the server says so
        currentTab: 'protocols'
    };

    /* Category labels, matching the server's _protoLabels map. */
    var CATEGORIES = [
        {
            key: 'ia',
            label: 'Intra-Articular',
            desc: 'Biologics delivered directly into the joint cavity to reduce inflammation and support tissue repair.'
        },
        {
            key: 'im',
            label: 'Intra-Muscular (IM)',
            desc: 'Injection into muscle tissue for systemic uptake over a longer window.'
        },
        {
            key: 'iv',
            label: 'Intravenous (IV)',
            desc: 'Infusion into the bloodstream for whole-body distribution.'
        },
        {
            key: 'other',
            label: 'Other / Specialized',
            desc: 'Routes and combinations outside the standard IA, IM and IV categories.'
        },
        {
            key: 'pre',
            label: 'Patient Pre-Treatment',
            desc: 'Preparation steps completed before the treatment appointment itself.'
        }
    ];

    /* The protocol list the server renders into #protoButtons. Only these four
     * survived the DevTools export (every capture was truncated), so this is
     * the captured subset, not the full library. */
    var PROTOCOLS = [
        { slug: 'general-wellness', name: 'General Wellness & Anti-Aging', cat: 'iv', locked: false },
        { slug: 'autism',           name: 'Autism',                        cat: 'iv', locked: false },
        { slug: 'back-pain',        name: 'Back Pain',                     cat: 'im', locked: false },
        { slug: 'copd',             name: 'COPD Treatment',                cat: 'iv', locked: false }
    ];

    /* Slug allowlist. The frame src is built only from slugs we rendered, so a
     * crafted value can never reach the protocol endpoint through this code. */
    var ALLOWED_SLUGS = PROTOCOLS.map(function (p) { return p.slug; });

    var $ = function (id) { return document.getElementById(id); };

    var frame          = $('protoFrame');
    var buttonsEl      = $('protoButtons');
    var catsEl         = $('protoCats');
    var sectionLabelEl = $('protoSectionLabel');

    var activeCat  = 'all';
    var activeSlug = PROTOCOLS.length ? PROTOCOLS[0].slug : null;

    /* ══ MODAL HELPER ═════════════════════════════════════════════════════ */

    var cModal = (function () {
        var overlay = $('cModalOverlay');
        var titleEl = $('cModalTitle');
        var bodyEl  = $('cModalBody');
        var okBtn   = $('cModalOk');
        var cancelBtn = $('cModalCancel');
        var onResolve = null;
        var lastFocus = null;

        function close(result) {
            overlay.hidden = true;
            var cb = onResolve;
            onResolve = null;
            if (lastFocus && lastFocus.focus) lastFocus.focus();
            if (cb) cb(result);
        }

        function open(title, body, withCancel, cb) {
            lastFocus = document.activeElement;
            // textContent, never innerHTML: message text may echo user input.
            titleEl.textContent = title;
            bodyEl.textContent = body;
            cancelBtn.hidden = !withCancel;
            onResolve = cb || null;
            overlay.hidden = false;
            okBtn.focus();
        }

        okBtn.addEventListener('click', function () { close(true); });
        cancelBtn.addEventListener('click', function () { close(false); });
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) close(false);
        });

        return {
            alert: function (title, body, cb) { open(title, body, false, cb); },
            confirm: function (title, body, cb) { open(title, body, true, cb); },
            isOpen: function () { return !overlay.hidden; },
            close: function () { close(false); }
        };
    })();

    /* ══ RENDER ═══════════════════════════════════════════════════════════ */

    function countIn(cat) {
        return PROTOCOLS.filter(function (p) { return p.cat === cat; }).length;
    }

    function svgFor(key) {
        var paths = {
            ia:    '<circle cx="12" cy="8" r="5"/><path d="M12 13v8"/><path d="M9 18h6"/>',
            im:    '<path d="M17 3l4 4-9 9-4 1 1-4 9-9z"/><path d="M6 14l4 4"/><path d="M3 21l3-1"/>',
            iv:    '<path d="M12 3v6"/><rect x="8" y="9" width="8" height="9" rx="2"/><path d="M12 18v3"/>',
            other: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/>',
            pre:   '<path d="M9 11l2 2 4-4"/><rect x="4" y="4" width="16" height="16" rx="2"/>'
        };
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
               'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
               (paths[key] || paths.other) + '</svg>';
    }

    function renderCategories() {
        catsEl.textContent = '';

        CATEGORIES.forEach(function (cat) {
            var n = countIn(cat.key);
            if (!n) return;   // don't advertise an empty category

            var card = document.createElement('button');
            card.type = 'button';
            card.className = 'proto-cat cat-' + cat.key;
            card.dataset.action = 'filter';
            card.dataset.cat = cat.key;
            card.setAttribute('aria-pressed', 'false');

            var strip = document.createElement('div');
            strip.className = 'proto-cat-strip';

            var body = document.createElement('div');
            body.className = 'proto-cat-body';

            var icon = document.createElement('div');
            icon.className = 'proto-cat-icon';
            icon.innerHTML = svgFor(cat.key);   // static markup from the map above

            var label = document.createElement('div');
            label.className = 'proto-cat-label';
            label.textContent = cat.label;

            var desc = document.createElement('div');
            desc.className = 'proto-cat-desc';
            desc.textContent = cat.desc;

            var count = document.createElement('div');
            count.className = 'proto-cat-count';
            count.textContent = n + (n === 1 ? ' protocol' : ' protocols');

            body.append(icon, label, desc, count);
            card.append(strip, body);
            catsEl.appendChild(card);
        });
    }

    function renderProtocolButtons() {
        buttonsEl.textContent = '';

        PROTOCOLS.forEach(function (p, i) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'proto-btn' + (p.slug === activeSlug ? ' active' : '');
            btn.dataset.action = 'load';
            btn.dataset.slug = p.slug;
            btn.dataset.cat = p.cat;
            btn.dataset.idx = String(i);
            btn.dataset.locked = p.locked ? '1' : '0';
            btn.setAttribute('role', 'tab');
            btn.setAttribute('aria-selected', p.slug === activeSlug ? 'true' : 'false');
            // Names come from the server; textContent keeps them inert.
            btn.textContent = p.name;
            buttonsEl.appendChild(btn);
        });
    }

    function renderProtocolOptions() {
        var select = $('treatProtocol');
        if (!select) return;
        PROTOCOLS.forEach(function (p) {
            var opt = document.createElement('option');
            opt.value = p.slug;
            opt.textContent = p.name;
            select.appendChild(opt);
        });
    }

    /* ══ FILTER + LOAD ════════════════════════════════════════════════════ */

    function filterProtos(cat) {
        activeCat = cat;

        var shown = 0;
        Array.prototype.forEach.call(buttonsEl.children, function (btn) {
            var match = (cat === 'all' || btn.dataset.cat === cat);
            btn.hidden = !match;
            if (match) shown++;
        });

        var meta = CATEGORIES.filter(function (c) { return c.key === cat; })[0];
        sectionLabelEl.textContent = meta ? meta.label : 'All Protocols';

        Array.prototype.forEach.call(catsEl.children, function (card) {
            var on = card.dataset.cat === cat;
            card.classList.toggle('selected', on);
            card.setAttribute('aria-pressed', on ? 'true' : 'false');
        });

        var empty = buttonsEl.querySelector('.proto-empty');
        if (!shown && !empty) {
            var note = document.createElement('p');
            note.className = 'proto-empty';
            note.textContent = 'No protocols in this category yet.';
            buttonsEl.appendChild(note);
        } else if (shown && empty) {
            empty.remove();
        }
    }

    function loadProto(slug, btn) {
        if (ALLOWED_SLUGS.indexOf(slug) === -1) return;

        var proto = PROTOCOLS.filter(function (p) { return p.slug === slug; })[0];

        /* A locked protocol is refused by the server too — this branch only
         * saves the user a pointless round trip. Flipping data-locked in the
         * console gains nothing. */
        if (proto && proto.locked) {
            cModal.alert(
                'Protocol Locked',
                'This protocol is not enabled for your account. Contact your CelluNOVA representative to request access.'
            );
            return;
        }

        activeSlug = slug;

        Array.prototype.forEach.call(buttonsEl.children, function (el) {
            if (!el.dataset || !el.dataset.slug) return;
            var on = el === btn;
            el.classList.toggle('active', on);
            el.setAttribute('aria-selected', on ? 'true' : 'false');
        });

        frame.style.height = '';
        frame.src = 'protocols/protocol.html?slug=' + encodeURIComponent(slug);
        $('protoViewer').classList.add('open');
    }

    /* ══ FRAME SIZING ═════════════════════════════════════════════════════
     * The original sized the frame by reaching into its document. This listens
     * for a height message instead, and accepts it only from this exact frame,
     * on this exact origin.
     * ═════════════════════════════════════════════════════════════════════ */
    window.addEventListener('message', function (e) {
        if (e.source !== frame.contentWindow) return;
        if (e.origin !== window.location.origin) return;

        var msg = e.data;
        if (!msg || msg.type !== 'proto:height') return;

        var h = Number(msg.height);
        if (!isFinite(h) || h <= 0) return;

        frame.style.height = Math.min(h, 20000) + 'px';
    });

    /* ══ TREATMENT SCHEDULER ══════════════════════════════════════════════ */

    var schedulerModal = $('treatmentSchedulerModal');
    var schedulerForm  = $('treatmentForm');
    var schedulerError = $('treatError');
    var schedulerOpener = null;

    function openScheduler() {
        schedulerOpener = document.activeElement;
        schedulerError.hidden = true;

        // Today, in the browser's own timezone — not a server-baked constant
        // that goes stale and lets past dates through.
        var now = new Date();
        var today = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
            .toISOString().slice(0, 10);
        $('treatDate').min = today;

        schedulerModal.hidden = false;
        $('treatDate').focus();
    }

    function closeScheduler() {
        schedulerModal.hidden = true;
        if (schedulerOpener && schedulerOpener.focus) schedulerOpener.focus();
    }

    schedulerForm.addEventListener('submit', function (e) {
        e.preventDefault();

        var date     = $('treatDate').value;
        var protocol = $('treatProtocol').value;
        var patients = $('treatPatients').value || '1';

        if (!date)     { return fail('Please select a treatment date.'); }
        if (!protocol) { return fail('Please select a protocol or treatment type.'); }

        var count = parseInt(patients, 10);
        if (!(count >= 1 && count <= 50)) {
            return fail('Enter a patient count between 1 and 50.');
        }

        schedulerError.hidden = true;
        closeScheduler();

        /* In production this posts to /portal/treatment-schedule with the CSRF
         * token. The static build stops here so no data leaves the page. */
        cModal.alert(
            'Request Received',
            'Your treatment request has been queued for physician review. ' +
            'We will confirm by email before the appointment.'
        );
        schedulerForm.reset();

        function fail(message) {
            schedulerError.textContent = message;
            schedulerError.hidden = false;
        }
    });

    schedulerModal.addEventListener('click', function (e) {
        if (e.target === schedulerModal) closeScheduler();
    });

    /* ══ DEMO CONTROLS ════════════════════════════════════════════════════ */

    var demoModal  = $('demoControlsModal');
    var demoToggle = $('demoControlsToggle');

    if (CONFIG.demo) demoToggle.hidden = false;

    demoModal.addEventListener('click', function (e) {
        if (e.target === demoModal) demoModal.hidden = true;
    });

    /* ══ EVENT DELEGATION ═════════════════════════════════════════════════ */

    document.addEventListener('click', function (e) {
        var el = e.target.closest('[data-action]');
        if (!el) return;

        switch (el.dataset.action) {
            case 'filter':
                filterProtos(el.dataset.cat);
                break;
            case 'load':
                loadProto(el.dataset.slug, el);
                break;
            case 'open-scheduler':
                openScheduler();
                break;
            case 'close-scheduler':
                closeScheduler();
                break;
            case 'open-demo':
                if (CONFIG.demo) demoModal.hidden = false;
                break;
            case 'close-demo':
                demoModal.hidden = true;
                break;
            case 'dismiss-order-bar':
                $('orderBar').hidden = true;
                break;
        }
    });

    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (cModal.isOpen()) { cModal.close(); return; }
        if (!schedulerModal.hidden) { closeScheduler(); return; }
        if (!demoModal.hidden) { demoModal.hidden = true; }
    });

    var sidebarToggle = $('sidebarToggle');
    sidebarToggle.addEventListener('click', function () {
        var sidebar = document.querySelector('.portal-sidebar');
        var open = sidebar.classList.toggle('open');
        sidebarToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    /* ══ INIT ═════════════════════════════════════════════════════════════ */

    if (CONFIG.viewingAs === 'clinic' && CONFIG.isAdmin) {
        $('viewAsBanner').hidden = false;
    }

    renderCategories();
    renderProtocolButtons();
    renderProtocolOptions();
    filterProtos('all');
})();
