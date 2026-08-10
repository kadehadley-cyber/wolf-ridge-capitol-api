/* ─────────────────────────────────────────────────────────────────────────
 * CRM page.
 *
 * Reconstructed from a Chrome DevTools export that captured the filter input
 * IDs and the exact field set portal-crm.js renders per lead — but NOT the
 * CRM's markup, its 64KB of logic, or its styles. So: the toolbar and the
 * lead-detail card are faithful; the lead rows below are clearly-marked
 * PLACEHOLDER sample data, and the "intelligence" scan and replay player are
 * intentionally not implemented.
 *
 * Hardened against the two findings the CRM export confirmed:
 *   §1  no Action Recorder; the replay overlay is inert and server-gated.
 *   §2  lead links (tel/mailto/website) are built with createElement +
 *       setAttribute and a scheme allowlist — never string-concatenated into
 *       an href through the quote-unsafe escHtml the original uses.
 * ───────────────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    /* Server-rendered in production. Display hints only — never authority.
     * `canReplay`, `isAdmin` etc. are reflected in the UI but enforced by the
     * backend. */
    var CONFIG = window.PORTAL_CONFIG || {
        clinicId: null,
        isAdmin: false,
        viewingAs: null,
        canReplay: false,
        defaultState: 'AZ'
    };

    var $ = function (id) { return document.getElementById(id); };

    /* ══ SAFE OUTPUT HELPERS ══════════════════════════════════════════════
     * escHtml — safe for element *content* only (escapes < & > but, like the
     *   browser's serializer, NOT quotes). Kept for text nodes.
     * escAttr — safe for quoted attribute values; escapes quotes too.
     * safeUrl — returns a URL only if its scheme is allowlisted, else "#".
     *
     * The original's bug (§2) was using escHtml inside href="…". This file
     * avoids string-built HTML for anything user/lead-derived: it builds nodes
     * and assigns text/attributes via the DOM, and gates every href scheme.
     * ═════════════════════════════════════════════════════════════════════ */
    function escHtml(s) {
        var d = document.createElement('div');
        d.textContent = String(s == null ? '' : s);
        return d.innerHTML;
    }
    function escAttr(s) {
        return escHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function safeUrl(raw, extraSchemes) {
        var v = String(raw == null ? '' : raw).trim();
        var ok = ['http:', 'https:'].concat(extraSchemes || []);
        try {
            // tel:/mailto: have no host; test the scheme prefix directly.
            var scheme = (v.split(':', 1)[0] || '').toLowerCase() + ':';
            if (extraSchemes && extraSchemes.indexOf(scheme) !== -1) return v;
            var u = new URL(v, window.location.origin);
            return ok.indexOf(u.protocol) !== -1 ? u.href : '#';
        } catch (e) {
            return '#';
        }
    }

    /* ══ PLACEHOLDER LEADS ═════════════════════════════════════════════════
     * Not real data. The real list is PII delivered by the server and was
     * never captured. The base fields (name, phone, email, …) match
     * portal-crm.js exactly; the sales-intelligence fields below are the CRM's
     * new lead schema — populate them server-side (self-reported, scraped by
     * the "intelligence" scan, or rep-entered). `website` on lead 2 is a
     * hostile value that must render inert (§2 demo). */
    var LEADS = [
        {
            id: 1, name: 'Example Ortho Clinic', stage: 'new', tier: 'standard',
            phone: '+1 480 555 0101', email: 'front@example-ortho.test',
            address: '100 Example Way', city: 'Phoenix', state: 'AZ',
            website: 'https://example-ortho.test', category: 'ortho',
            source: 'intelligence', score: 62,
            last_contacted: '', next_followup: '',
            rep_first: 'Sample', rep_last: 'Rep', created_at: '2026-08-01 14:20:00',
            // ── sales intelligence ──
            owner_name: 'Dr. Alex Stone', doctor_name: 'Dr. Alex Stone',
            patients_per_day: 34,
            offers_prp: true, offers_exosomes: false, offers_stem_cells: false,
            current_supplier: '', price_per_cc_current: null, est_monthly_cc: 40,
            switch_likelihood: null   // null = compute from signals
        },
        {
            id: 2, name: 'Desert Wellness Spa', stage: 'contacted', tier: 'priority',
            phone: '+1 480 555 0142', email: 'hello@desert-wellness.test',
            address: '55 Cactus Rd', city: 'Scottsdale', state: 'AZ',
            website: 'javascript:alert(document.cookie)', category: 'med_spa',
            source: 'intelligence', score: 78,
            last_contacted: '2026-08-05 10:00:00', next_followup: '2026-08-02 00:00:00',
            rep_first: 'Sample', rep_last: 'Rep', created_at: '2026-07-28 09:05:00',
            owner_name: 'Jordan Lee', doctor_name: 'Dr. Priya Nair',
            patients_per_day: 22,
            offers_prp: true, offers_exosomes: true, offers_stem_cells: false,
            current_supplier: 'BioSource', price_per_cc_current: 950, est_monthly_cc: 60,
            switch_likelihood: null
        },
        {
            id: 3, name: 'Valley Regenerative', stage: 'qualified', tier: 'standard',
            phone: '+1 435 555 0177', email: 'care@valley-regen.test',
            address: '9 Red Rock Blvd', city: 'St. George', state: 'UT',
            website: 'https://valley-regen.test', category: 'wellness',
            source: 'referral', score: 91,
            last_contacted: '2026-08-08 16:30:00', next_followup: '2026-08-20 00:00:00',
            rep_first: 'Sample', rep_last: 'Rep', created_at: '2026-07-15 11:40:00',
            owner_name: 'Dr. Sam Reyes', doctor_name: 'Dr. Sam Reyes',
            patients_per_day: 48,
            offers_prp: true, offers_exosomes: true, offers_stem_cells: true,
            current_supplier: 'Platinum', price_per_cc_current: 1100, est_monthly_cc: 120,
            switch_likelihood: null
        }
    ];

    /* Our positioning, as data a rep can act on — the only physician-led stem
     * cell / exosome distributor, priced ~$200–400/cc under everyone except
     * Platinum. Kept here so the numbers live in one place. */
    var PRICE_EDGE_MIN = 200, PRICE_EDGE_MAX = 400, PRICE_PARITY_COMPETITOR = 'platinum';

    /* ══ SWITCH-LIKELIHOOD / FIT ══════════════════════════════════════════
     * Turns the raw lead signals into a 0–100 fit score, a Hot/Warm/Cold band,
     * and the plain-English reasons a rep would lead with. A server override
     * (`switch_likelihood`) wins when present. This is a transparent heuristic,
     * not a model — tune the weights to match what actually closes. */
    function computeFit(l) {
        var reasons = [], s = 30;   // neutral base

        var runsRegen = l.offers_prp || l.offers_exosomes || l.offers_stem_cells;
        if (runsRegen) { s += 18; reasons.push('Already runs regenerative medicine — in-category buyer'); }
        else { reasons.push('No regen yet — longer education sell'); }

        // Runs PRP but not exosomes/stem cells = prime upsell into our core line.
        if (l.offers_prp && !(l.offers_exosomes && l.offers_stem_cells)) {
            s += 12; reasons.push('Runs PRP but not full exosome/stem-cell line — upsell target');
        }

        var supplier = (l.current_supplier || '').trim();
        if (supplier && supplier.toLowerCase() !== PRICE_PARITY_COMPETITOR) {
            s += 15;
            reasons.push('On ' + supplier + ', not Platinum — price wedge applies (~$' +
                PRICE_EDGE_MIN + '–' + PRICE_EDGE_MAX + '/cc under)');
        } else if (supplier.toLowerCase() === PRICE_PARITY_COMPETITOR) {
            s -= 5;
            reasons.push('Platinum incumbent — near price parity; lead on physician-led + service, not price');
        } else {
            reasons.push('Supplier unknown — qualify current source and price/cc');
        }

        // Deal size: throughput and estimated cc/month.
        if (l.patients_per_day >= 40) { s += 8; reasons.push('High patient volume (' + l.patients_per_day + '/day) — larger account'); }
        else if (l.patients_per_day >= 20) { s += 4; }
        if (l.est_monthly_cc >= 100) { s += 6; reasons.push('~' + l.est_monthly_cc + ' cc/mo — high-volume deal'); }

        if (l.switch_likelihood != null) s = Number(l.switch_likelihood);
        s = Math.max(0, Math.min(100, Math.round(s)));

        var band = s >= 70 ? 'hot' : s >= 45 ? 'warm' : 'cold';
        return { score: s, band: band, reasons: reasons };
    }

    /* Estimated per-cc savings a rep can quote, given the lead's current price. */
    function savingsLine(l) {
        var supplier = (l.current_supplier || '').trim();
        if (supplier.toLowerCase() === PRICE_PARITY_COMPETITOR)
            return 'Platinum incumbent — price parity; differentiate on physician-led sourcing + support.';
        if (!supplier) return 'Qualify current supplier and price/cc to size the savings.';
        var base = '~$' + PRICE_EDGE_MIN + '–' + PRICE_EDGE_MAX + '/cc under ' + supplier;
        if (l.price_per_cc_current && l.est_monthly_cc) {
            var lo = PRICE_EDGE_MIN * l.est_monthly_cc, hi = PRICE_EDGE_MAX * l.est_monthly_cc;
            base += '  ·  ~$' + lo.toLocaleString() + '–' + hi.toLocaleString() + '/mo at ' +
                l.est_monthly_cc + ' cc';
        }
        return base;
    }

    var listEl   = $('crmLeadList');
    var detailEl = $('crmLeadDetail');
    var activeId = null;

    /* ══ MODAL HELPER (same contract as the protocols page) ═══════════════ */
    var cModal = (function () {
        var overlay = $('cModalOverlay'), titleEl = $('cModalTitle'),
            bodyEl = $('cModalBody'), okBtn = $('cModalOk'),
            cancelBtn = $('cModalCancel'), cb = null, lastFocus = null;
        function close(r) { overlay.hidden = true; var f = cb; cb = null; if (lastFocus) lastFocus.focus(); if (f) f(r); }
        function open(t, b, withCancel, fn) {
            lastFocus = document.activeElement;
            titleEl.textContent = t; bodyEl.textContent = b;
            cancelBtn.hidden = !withCancel; cb = fn || null;
            overlay.hidden = false; okBtn.focus();
        }
        okBtn.addEventListener('click', function () { close(true); });
        cancelBtn.addEventListener('click', function () { close(false); });
        overlay.addEventListener('click', function (e) { if (e.target === overlay) close(false); });
        return {
            alert: function (t, b, fn) { open(t, b, false, fn); },
            isOpen: function () { return !overlay.hidden; },
            close: function () { close(false); }
        };
    })();

    /* ══ RENDER: LIST ═════════════════════════════════════════════════════ */
    function currentFilters() {
        return {
            q: ($('crmSearch').value || '').trim().toLowerCase(),
            stage: $('crmFilterStage').value,
            state: $('crmFilterState').value,
            source: $('crmFilterSource').value,
            category: $('crmFilterCategory').value,
            sort: $('crmSort').value,
            offersRegen: $('crmOffersRegen').checked,
            notPlatinum: $('crmNotPlatinum').checked
        };
    }

    function matches(lead, f) {
        if (f.stage && lead.stage !== f.stage) return false;
        if (f.state && lead.state !== f.state) return false;
        if (f.source && lead.source !== f.source) return false;
        if (f.category && lead.category !== f.category) return false;
        if (f.offersRegen && !(lead.offers_prp || lead.offers_exosomes || lead.offers_stem_cells)) return false;
        if (f.notPlatinum && (lead.current_supplier || '').toLowerCase() === PRICE_PARITY_COMPETITOR) return false;
        if (f.q) {
            var hay = [lead.name, lead.owner_name, lead.doctor_name, lead.email, lead.phone, lead.city]
                .join(' ').toLowerCase();
            if (hay.indexOf(f.q) === -1) return false;
        }
        return true;
    }

    function sortLeads(list, sort) {
        var by = {
            fit:      function (a, b) { return computeFit(b).score - computeFit(a).score; },
            score:    function (a, b) { return (b.score || 0) - (a.score || 0); },
            patients: function (a, b) { return (b.patients_per_day || 0) - (a.patients_per_day || 0); },
            newest:   function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); }
        };
        return list.slice().sort(by[sort] || by.fit);
    }

    function renderList() {
        var f = currentFilters();
        listEl.textContent = '';

        var note = document.createElement('div');
        note.className = 'crm-placeholder-note';
        note.textContent = 'Placeholder leads — real lead data is PII and was not captured. '
            + 'Replace LEADS in crm.js with the server’s list.';
        listEl.appendChild(note);

        var shown = 0;
        sortLeads(LEADS.filter(function (l) { return matches(l, f); }), f.sort).forEach(function (l) {
            var fit = computeFit(l);
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'crm-list-item' + (l.id === activeId ? ' active' : '');
            btn.dataset.action = 'open-lead';
            btn.dataset.id = String(l.id);
            btn.setAttribute('role', 'option');

            var top = document.createElement('div');
            top.className = 'crm-list-top';
            var nm = document.createElement('div');
            nm.className = 'crm-list-name';
            nm.textContent = l.name;                 // textContent — inert
            var fitBadge = document.createElement('span');
            fitBadge.className = 'crm-fit crm-fit-' + fit.band;
            fitBadge.textContent = fit.band.toUpperCase() + ' ' + fit.score;
            top.append(nm, fitBadge);

            var meta = document.createElement('div');
            meta.className = 'crm-list-meta';
            meta.textContent = [l.city, l.state].filter(Boolean).join(', ')
                + ' · ' + l.stage + ' · ' + l.patients_per_day + '/day';

            btn.append(top, meta);
            listEl.appendChild(btn);
            shown++;
        });

        if (!shown) {
            var empty = document.createElement('p');
            empty.className = 'crm-empty';
            empty.style.padding = '14px';
            empty.textContent = 'No leads match these filters.';
            listEl.appendChild(empty);
        }
    }

    /* ══ RENDER: DETAIL ═══════════════════════════════════════════════════
     * Field-for-field with portal-crm.js, but every value goes in via
     * textContent and every link via setAttribute(safeUrl(...)). */
    function kv(grid, key, valueNode, full) {
        var cell = document.createElement('div');
        if (full) cell.className = 'full';
        var k = document.createElement('span');
        k.className = 'k'; k.textContent = key + ': ';
        cell.appendChild(k);
        cell.appendChild(valueNode);
        grid.appendChild(cell);
    }
    function textNode(s) { return document.createTextNode(String(s == null ? '' : s)); }
    function kv2(grid, key, str) { kv(grid, key, textNode(str)); }
    function linkNode(label, url, extraSchemes) {
        var a = document.createElement('a');
        a.textContent = label;
        a.setAttribute('href', safeUrl(url, extraSchemes));
        a.setAttribute('rel', 'noopener noreferrer');
        if (safeUrl(url, extraSchemes).slice(0, 4) === 'http') a.setAttribute('target', '_blank');
        return a;
    }

    function sectionTitle(text) {
        var h = document.createElement('div');
        h.className = 'crm-section-title';
        h.textContent = text;
        return h;
    }
    function yesNoChip(on, label) {
        var c = document.createElement('span');
        c.className = 'crm-chip ' + (on ? 'on' : 'off');
        c.textContent = (on ? '✓ ' : '· ') + label;
        return c;
    }

    function renderDetail(lead) {
        detailEl.textContent = '';
        var fit = computeFit(lead);

        var name = document.createElement('div');
        name.className = 'crm-lead-name';
        name.textContent = lead.name;
        detailEl.appendChild(name);

        var pill = document.createElement('span');
        pill.className = 'crm-pill ' + (lead.stage || '');
        pill.textContent = lead.stage || '—';
        detailEl.appendChild(pill);
        if (lead.tier && lead.tier !== 'standard') {
            var tier = document.createElement('span');
            tier.className = 'crm-tier';
            tier.style.marginLeft = '8px';
            tier.textContent = String(lead.tier).replace(/_/g, ' ').toUpperCase();
            detailEl.appendChild(tier);
        }

        /* ── Sales fit: the switch-likelihood + why ── */
        var fitBox = document.createElement('div');
        fitBox.className = 'crm-fitbox crm-fit-' + fit.band;
        var fitHead = document.createElement('div');
        fitHead.className = 'crm-fitbox-head';
        var fitLabel = document.createElement('span');
        fitLabel.className = 'crm-fit crm-fit-' + fit.band;
        fitLabel.textContent = fit.band.toUpperCase() + ' · ' + fit.score + '/100 likely to switch';
        fitHead.appendChild(fitLabel);
        fitBox.appendChild(fitHead);
        var save = document.createElement('div');
        save.className = 'crm-fit-save';
        save.textContent = savingsLine(lead);
        fitBox.appendChild(save);
        var ul = document.createElement('ul');
        ul.className = 'crm-fit-reasons';
        fit.reasons.forEach(function (r) {
            var li = document.createElement('li');
            li.textContent = r;                       // textContent — inert
            ul.appendChild(li);
        });
        fitBox.appendChild(ul);
        detailEl.appendChild(fitBox);

        /* ── Practice profile ── */
        detailEl.appendChild(sectionTitle('Practice profile'));
        var prof = document.createElement('div');
        prof.className = 'crm-lead-grid';
        if (lead.owner_name)  kv2(prof, 'Owner', lead.owner_name);
        if (lead.doctor_name) kv2(prof, 'Doctor', lead.doctor_name);
        if (lead.patients_per_day != null) kv2(prof, 'Patients/day', String(lead.patients_per_day));
        if (lead.est_monthly_cc != null)   kv2(prof, 'Est. volume', lead.est_monthly_cc + ' cc/mo');
        detailEl.appendChild(prof);

        /* ── Regenerative medicine offered ── */
        detailEl.appendChild(sectionTitle('Regenerative medicine offered'));
        var chips = document.createElement('div');
        chips.className = 'crm-chips';
        chips.append(
            yesNoChip(lead.offers_prp, 'PRP'),
            yesNoChip(lead.offers_exosomes, 'Exosomes'),
            yesNoChip(lead.offers_stem_cells, 'Stem cells')
        );
        detailEl.appendChild(chips);

        /* ── Buying ── */
        detailEl.appendChild(sectionTitle('Buying'));
        var buy = document.createElement('div');
        buy.className = 'crm-lead-grid';
        kv2(buy, 'Current supplier', lead.current_supplier || 'Unknown');
        if (lead.price_per_cc_current != null) kv2(buy, 'Their price/cc', '$' + lead.price_per_cc_current);
        detailEl.appendChild(buy);

        /* ── Contact (the fields portal-crm.js renders) ── */
        detailEl.appendChild(sectionTitle('Contact'));
        var grid = document.createElement('div');
        grid.className = 'crm-lead-grid';
        grid.style.marginTop = '12px';

        if (lead.phone)   kv(grid, 'Phone', linkNode(lead.phone, 'tel:' + lead.phone, ['tel:']));
        if (lead.email)   kv(grid, 'Email', linkNode(lead.email, 'mailto:' + lead.email, ['mailto:']));
        if (lead.address) kv(grid, 'Address', textNode(lead.address));
        var loc = [lead.city, lead.state].filter(Boolean).join(', ');
        if (loc)          kv(grid, 'Location', textNode(loc));
        if (lead.website) {
            var safe = safeUrl(lead.website);
            // Hostile schemes collapse to "#": show the raw text but never link it live.
            kv(grid, 'Website', safe === '#' ? textNode(lead.website + '  (blocked: unsafe URL)')
                                              : linkNode(lead.website, lead.website), true);
        }
        if (lead.category) kv(grid, 'Category', textNode(String(lead.category).replace(/_/g, ' ')));
        if (lead.source)   kv(grid, 'Source', textNode(lead.source));
        if (lead.last_contacted) kv(grid, 'Last Contacted', textNode(fmt(lead.last_contacted)));
        if (lead.next_followup) {
            var due = document.createElement('span');
            var overdue = new Date(lead.next_followup) <= new Date();
            if (overdue) due.className = 'crm-overdue';
            due.textContent = String(lead.next_followup).split(' ')[0];
            kv(grid, 'Follow-up', due);
        }
        if (lead.rep_first) kv(grid, 'Rep', textNode((lead.rep_first + ' ' + (lead.rep_last || '')).trim()));
        kv(grid, 'Score', textNode(lead.score || 0));
        if (lead.created_at) kv(grid, 'Added', textNode(fmt(lead.created_at)));
        detailEl.appendChild(grid);

        // Note + follow-up actions (the captured crmNoteInput / crmFollowupDate / crmDispNote).
        var actions = document.createElement('div');
        actions.className = 'crm-detail-actions';
        actions.innerHTML =
            '<textarea id="crmNoteInput" placeholder="Type a note..." data-no-log></textarea>' +
            '<div class="crm-detail-row">' +
              '<div class="field"><label for="crmFollowupDate">Follow-up date</label>' +
                '<input type="date" id="crmFollowupDate"></div>' +
              '<button type="button" class="btn sm primary" data-action="save-note">Save Note</button>' +
            '</div>' +
            '<textarea id="crmDispNote" placeholder="Add a note about this call (optional)..." data-no-log></textarea>';
        detailEl.appendChild(actions);
    }

    function fmt(ts) {
        if (!ts) return '';
        var d = new Date(String(ts).replace(' ', 'T'));
        return isNaN(d.getTime()) ? String(ts) : d.toLocaleString();
    }

    function openLead(id) {
        activeId = id;
        var lead = LEADS.filter(function (l) { return l.id === id; })[0];
        if (lead) renderDetail(lead);
        Array.prototype.forEach.call(listEl.querySelectorAll('.crm-list-item'), function (el) {
            el.classList.toggle('active', Number(el.dataset.id) === id);
        });
    }

    /* ══ TABS ═════════════════════════════════════════════════════════════ */
    function showTab(tab) {
        $('crmView-leads').hidden = tab !== 'leads';
        $('crmView-queue').hidden = tab !== 'queue';
        $('crmTabLeads').setAttribute('aria-selected', tab === 'leads' ? 'true' : 'false');
        $('crmTabQueue').setAttribute('aria-selected', tab === 'queue' ? 'true' : 'false');
        $('crmTabLeads').classList.toggle('primary', tab === 'leads');
        $('crmTabQueue').classList.toggle('primary', tab === 'queue');
    }

    /* ══ EVENTS ═══════════════════════════════════════════════════════════ */
    document.addEventListener('click', function (e) {
        var el = e.target.closest('[data-action]');
        if (!el) return;
        switch (el.dataset.action) {
            case 'open-lead':   openLead(Number(el.dataset.id)); break;
            case 'tab':         showTab(el.dataset.tab); break;
            case 'save-note':
                cModal.alert('Not wired', 'In production this posts the note to the CRM endpoint. '
                    + 'This static build does not send anything.');
                break;
            case 'build-queue':
                cModal.alert('Not wired', 'Queue building calls the server; not implemented in this build.');
                break;
            case 'close-replay': $('replayOverlay').hidden = true; break;
        }
    });

    ['crmSearch', 'crmFilterStage', 'crmFilterState', 'crmFilterSource',
     'crmFilterCategory', 'crmSort', 'crmShowProviders', 'crmOffersRegen',
     'crmNotPlatinum'].forEach(function (id) {
        var el = $(id);
        if (el) el.addEventListener(el.tagName === 'INPUT' && el.type !== 'checkbox' ? 'input' : 'change', renderList);
    });

    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (cModal.isOpen()) { cModal.close(); return; }
        if (!$('replayOverlay').hidden) $('replayOverlay').hidden = true;
    });

    var sidebarToggle = $('sidebarToggle');
    sidebarToggle.addEventListener('click', function () {
        var sb = document.querySelector('.portal-sidebar');
        var open = sb.classList.toggle('open');
        sidebarToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    /* ══ INIT ═════════════════════════════════════════════════════════════ */
    if (CONFIG.viewingAs === 'clinic' && CONFIG.isAdmin) $('viewAsBanner').hidden = false;
    // Replay stays inert regardless; the overlay only *opens* if the server
    // authorizes it, and even then this build renders no player.
    if ($('crmFilterState')) $('crmFilterState').value = CONFIG.defaultState || 'AZ';

    renderList();
    showTab('leads');
})();
