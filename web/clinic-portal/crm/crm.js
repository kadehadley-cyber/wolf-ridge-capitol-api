/* ─────────────────────────────────────────────────────────────────────────
 * CRM page.
 *
 * Reconstructed from a Chrome DevTools export that captured the filter input
 * IDs and the exact field set portal-crm.js renders per lead, but NOT the
 * CRM's markup, its 64KB of logic, or its styles. So: the toolbar and the
 * lead-detail card are faithful; the lead rows below are clearly-marked
 * PLACEHOLDER sample data, and the "intelligence" scan and replay player are
 * intentionally not implemented.
 *
 * Hardened against the two findings the CRM export confirmed:
 *   §1  no Action Recorder; the replay overlay is inert and server-gated.
 *   §2  lead links (tel/mailto/website) are built with createElement +
 *       setAttribute and a scheme allowlist, never string-concatenated into
 *       an href through the quote-unsafe escHtml the original uses.
 * ───────────────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    /* Server-rendered in production. Display hints only, never authority.
     * `canReplay`, `isAdmin` etc. are reflected in the UI but enforced by the
     * backend. */
    var CONFIG = window.PORTAL_CONFIG || {
        clinicId: null,
        isAdmin: false,
        viewingAs: null,
        canReplay: false,
        defaultState: ''      // '' = All states; server may pin a rep's territory
    };

    var $ = function (id) { return document.getElementById(id); };

    /* ══ SAFE OUTPUT HELPERS ══════════════════════════════════════════════
     * escHtml, safe for element *content* only (escapes < & > but, like the
     *   browser's serializer, NOT quotes). Kept for text nodes.
     * escAttr, safe for quoted attribute values; escapes quotes too.
     * safeUrl, returns a URL only if its scheme is allowlisted, else "#".
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
     * new lead schema, populate them server-side (self-reported, scraped by
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
            is_provider: true, patients_per_day: 34,
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
            is_provider: true, patients_per_day: 22,
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
            is_provider: true, patients_per_day: 48,
            offers_prp: true, offers_exosomes: true, offers_stem_cells: true,
            current_supplier: 'Platinum', price_per_cc_current: 1100, est_monthly_cc: 120,
            switch_likelihood: null
        },
        {
            id: 4, name: 'Canyon Sports Medicine', stage: 'new', tier: 'standard',
            phone: '+1 480 555 0188', email: 'intake@canyon-sportsmed.test',
            address: '210 Ridgeline Dr', city: 'Mesa', state: 'AZ',
            website: 'https://canyon-sportsmed.test', category: 'ortho',
            source: 'intelligence', score: 55,
            last_contacted: '', next_followup: '',
            rep_first: 'Sample', rep_last: 'Rep', created_at: '2026-08-09 08:10:00',
            owner_name: 'Dr. Robin Vance', doctor_name: 'Dr. Robin Vance',
            is_provider: true, patients_per_day: 41,
            offers_prp: true, offers_exosomes: false, offers_stem_cells: false,
            current_supplier: 'MediGen', price_per_cc_current: 1000, est_monthly_cc: 80,
            switch_likelihood: null
        },
        {
            id: 5, name: 'Aesthetics Marketing Group', stage: 'new', tier: 'standard',
            phone: '+1 480 555 0199', email: 'team@aesthetics-mktg.test',
            address: '77 Commerce Ct', city: 'Tempe', state: 'AZ',
            website: 'https://aesthetics-mktg.test', category: 'wellness',
            source: 'inbound', score: 21,
            last_contacted: '', next_followup: '',
            rep_first: 'Sample', rep_last: 'Rep', created_at: '2026-08-09 12:00:00',
            owner_name: 'Casey Morgan', doctor_name: '',
            // Not a medical provider, a vendor. "Providers only" should hide it.
            is_provider: false, patients_per_day: 0,
            offers_prp: false, offers_exosomes: false, offers_stem_cells: false,
            current_supplier: '', price_per_cc_current: null, est_monthly_cc: 0,
            switch_likelihood: null
        },
        {
            id: 6, name: 'Lone Star Plastic Surgery', stage: 'new', tier: 'standard',
            phone: '+1 512 555 0210', email: 'front@lonestar-plastics.test',
            address: '400 Congress Ave', city: 'Austin', state: 'TX',
            website: 'https://lonestar-plastics.test', category: 'plastic_surgery',
            source: 'intelligence', score: 66,
            last_contacted: '', next_followup: '',
            rep_first: 'Sample', rep_last: 'Rep', created_at: '2026-08-06 10:15:00',
            owner_name: 'Dr. Taylor Brooks', doctor_name: 'Dr. Taylor Brooks',
            is_provider: true, patients_per_day: 28,
            offers_prp: true, offers_exosomes: false, offers_stem_cells: false,
            current_supplier: 'BioSource', price_per_cc_current: 1000, est_monthly_cc: 50,
            switch_likelihood: null
        },
        {
            id: 7, name: 'Sunshine Aesthetics', stage: 'contacted', tier: 'standard',
            phone: '+1 305 555 0233', email: 'hello@sunshine-aesthetics.test',
            address: '88 Ocean Dr', city: 'Miami', state: 'FL',
            website: 'https://sunshine-aesthetics.test', category: 'aesthetic',
            source: 'inbound', score: 70,
            last_contacted: '2026-08-07 13:00:00', next_followup: '2026-08-18 00:00:00',
            rep_first: 'Sample', rep_last: 'Rep', created_at: '2026-08-02 09:30:00',
            owner_name: 'Dr. Morgan Diaz', doctor_name: 'Dr. Morgan Diaz',
            is_provider: true, patients_per_day: 30,
            offers_prp: true, offers_exosomes: true, offers_stem_cells: false,
            current_supplier: '', price_per_cc_current: null, est_monthly_cc: 45,
            switch_likelihood: null
        },
        {
            id: 8, name: 'Summit Pain Management', stage: 'qualified', tier: 'priority',
            phone: '+1 720 555 0244', email: 'care@summit-pain.test',
            address: '1200 Alpine Way', city: 'Denver', state: 'CO',
            website: 'https://summit-pain.test', category: 'pain_management',
            source: 'referral', score: 88,
            last_contacted: '2026-08-08 15:45:00', next_followup: '2026-08-22 00:00:00',
            rep_first: 'Sample', rep_last: 'Rep', created_at: '2026-07-30 11:10:00',
            owner_name: 'Dr. Jamie Fox', doctor_name: 'Dr. Jamie Fox',
            is_provider: true, patients_per_day: 52,
            offers_prp: true, offers_exosomes: true, offers_stem_cells: true,
            current_supplier: 'MediGen', price_per_cc_current: 1050, est_monthly_cc: 130,
            switch_likelihood: null
        },
        {
            id: 9, name: 'Bay Area Foot & Ankle', stage: 'new', tier: 'standard',
            phone: '+1 415 555 0255', email: 'intake@bayarea-footankle.test',
            address: '30 Market St', city: 'San Francisco', state: 'CA',
            website: 'https://bayarea-footankle.test', category: 'podiatry',
            source: 'intelligence', score: 40,
            last_contacted: '', next_followup: '',
            rep_first: 'Sample', rep_last: 'Rep', created_at: '2026-08-09 14:05:00',
            owner_name: 'Dr. Lee Nakamura', doctor_name: 'Dr. Lee Nakamura',
            is_provider: true, patients_per_day: 26,
            offers_prp: false, offers_exosomes: false, offers_stem_cells: false,
            current_supplier: '', price_per_cc_current: null, est_monthly_cc: 20,
            switch_likelihood: null
        }
    ];

    /* ══ PRICING / POSITIONING (PLACEHOLDER) ══════════════════════════════
     * The product line and cost were redone. This is the one place to set
     * positioning: parityCompetitor is the supplier we treat as at price parity
     * (differentiate on sourcing and service, not price); ourPricePerCc is our
     * own per-cc cost, left null until the finalized number is set.
     * ═════════════════════════════════════════════════════════════════════ */
    var PRICING = {
        parityCompetitor: 'platinum',
        ourPricePerCc: null         // PLACEHOLDER: set when the finalized cost is known
    };

    /* ══ INTELLIGENCE SIGNALS (PLACEHOLDER) ═══════════════════════════════
     * Extra screening signals the "intelligence" scan / rep enrichment would
     * populate. Kept in a compact per-id map so the LEADS array above stays
     * readable; missing fields fall back to SIGNAL_DEFAULTS. Replace with the
     * server's enriched values.
     *   cash_pay_focus        , predominantly cash-pay / elective practice
     *   advertising_regen     , actively running ads for PRP / regen / etc.
     *   website_mentions_regen, site already markets regenerative therapies
     *   google_rating / review_count, reputation + demand proxy
     *   decision_maker_is_owner,  physician-owner signs off (faster close)
     *   contract_status       , none | month_to_month | expiring | in_contract
     *   supplier_risk         , current supplier hit a recall/backorder/warning
     *   engagement            , none | email_open | visited_pricing |
     *                            sample_requested | demo
     *   competitors_nearby    , # of nearby practices already offering regen
     *   buy_likelihood        , server override for the buy score (else null)
     * ═════════════════════════════════════════════════════════════════════ */
    var SIGNAL_DEFAULTS = {
        cash_pay_focus: false, advertising_regen: false, website_mentions_regen: false,
        google_rating: null, review_count: null, decision_maker_is_owner: false,
        contract_status: 'none', supplier_risk: false, engagement: 'none',
        competitors_nearby: null, buy_likelihood: null
    };
    var SIGNALS = {
        1: { cash_pay_focus: true, website_mentions_regen: true, google_rating: 4.6, review_count: 180, decision_maker_is_owner: true, contract_status: 'none', engagement: 'visited_pricing', competitors_nearby: 5 },
        2: { cash_pay_focus: true, advertising_regen: true, website_mentions_regen: true, google_rating: 4.8, review_count: 320, decision_maker_is_owner: false, contract_status: 'month_to_month', engagement: 'sample_requested', competitors_nearby: 9 },
        3: { cash_pay_focus: true, advertising_regen: true, website_mentions_regen: true, google_rating: 4.9, review_count: 410, decision_maker_is_owner: true, contract_status: 'in_contract', engagement: 'demo', competitors_nearby: 4 },
        4: { google_rating: 4.3, review_count: 75, decision_maker_is_owner: true, contract_status: 'expiring', supplier_risk: true, engagement: 'email_open', competitors_nearby: 6 },
        5: { google_rating: null, review_count: null, contract_status: 'none', engagement: 'none', competitors_nearby: 0 },
        6: { cash_pay_focus: true, advertising_regen: true, google_rating: 4.7, review_count: 210, decision_maker_is_owner: true, contract_status: 'month_to_month', engagement: 'visited_pricing', competitors_nearby: 7 },
        7: { cash_pay_focus: true, advertising_regen: true, website_mentions_regen: true, google_rating: 4.5, review_count: 150, decision_maker_is_owner: true, contract_status: 'none', engagement: 'sample_requested', competitors_nearby: 8 },
        8: { advertising_regen: true, website_mentions_regen: true, google_rating: 4.6, review_count: 260, decision_maker_is_owner: true, contract_status: 'expiring', supplier_risk: true, engagement: 'demo', competitors_nearby: 5 },
        9: { google_rating: 4.2, review_count: 60, decision_maker_is_owner: true, contract_status: 'none', engagement: 'none', competitors_nearby: 3 }
    };
    LEADS.forEach(function (l) {
        var s = SIGNALS[l.id] || {};
        Object.keys(SIGNAL_DEFAULTS).forEach(function (k) {
            if (l[k] === undefined) l[k] = (s[k] !== undefined ? s[k] : SIGNAL_DEFAULTS[k]);
        });
    });

    /* How naturally a specialty uses stem cells / exosomes (buy-side weight). */
    var SPECIALTY_FIT = {
        ortho: 10, pain_management: 10, wellness: 8, med_spa: 7,
        aesthetic: 7, plastic_surgery: 6, podiatry: 6
    };
    var ENGAGEMENT_LABELS = {
        none: 'No engagement yet', email_open: 'Opened outreach email',
        visited_pricing: 'Visited pricing', sample_requested: 'Requested a sample',
        demo: 'Booked a demo'
    };
    var CONTRACT_LABELS = {
        none: 'No supplier contract', month_to_month: 'Month-to-month',
        expiring: 'Contract expiring', in_contract: 'Under contract'
    };
    function engagementLabel(e) { return ENGAGEMENT_LABELS[e] || ', '; }
    function contractLabel(c) { return CONTRACT_LABELS[c] || ', '; }

    function band(s, reasons) {
        s = Math.max(0, Math.min(100, Math.round(s)));
        return { score: s, band: s >= 70 ? 'hot' : s >= 45 ? 'warm' : 'cold', reasons: reasons };
    }

    /* ══ BUY PROPENSITY ═══════════════════════════════════════════════════
     * Likelihood the clinic buys stem cells / exosomes at all, independent of
     * who they buy from today. Transparent heuristic; tune to what closes.
     * A server override (`buy_likelihood`) wins when present. */
    function computeBuy(l) {
        var reasons = [], s = 18;
        if (!l.is_provider) { reasons.push('Not a medical provider, unlikely to administer biologics'); return band(6, reasons); }

        var runsRegen = l.offers_prp || l.offers_exosomes || l.offers_stem_cells;
        if (runsRegen) { s += 18; reasons.push('Already offers regenerative medicine, in-market'); }
        else { s += 4; reasons.push('No regen yet, education sell, but larger upside'); }
        if (l.offers_prp && !l.offers_exosomes && !l.offers_stem_cells) { s += 8; reasons.push('Runs PRP only, natural step up to exosomes/stem cells'); }
        if (l.website_mentions_regen) { s += 7; reasons.push('Website already markets regenerative therapies'); }
        if (l.advertising_regen) { s += 12; reasons.push('Actively advertising regenerative treatments, demand in place'); }
        if (l.cash_pay_focus) { s += 8; reasons.push('Cash-pay / elective focus, margin fits biologics'); }
        var sf = SPECIALTY_FIT[l.category] || 5; s += sf;
        if (sf >= 9) reasons.push(cap(String(l.category).replace(/_/g, ' ')) + ', high-use specialty for biologics');
        if (l.patients_per_day >= 40) { s += 8; reasons.push('High patient volume (' + l.patients_per_day + '/day)'); }
        else if (l.patients_per_day >= 20) { s += 4; }
        if (l.est_monthly_cc >= 100) { s += 6; reasons.push('~' + l.est_monthly_cc + ' cc/mo potential'); }
        if ((l.google_rating || 0) >= 4.5 && (l.review_count || 0) >= 100) { s += 5; reasons.push('Strong reputation (' + l.google_rating + '★, ' + l.review_count + ' reviews)'); }
        if (l.engagement === 'sample_requested' || l.engagement === 'demo') { s += 12; reasons.push(engagementLabel(l.engagement) + ', active buying signal'); }
        else if (l.engagement === 'visited_pricing') { s += 6; reasons.push('Visited pricing, evaluating'); }
        if (l.decision_maker_is_owner) { s += 4; reasons.push('Physician-owner decides, faster close'); }

        if (l.buy_likelihood != null) return band(Number(l.buy_likelihood), reasons);
        return band(s, reasons);
    }

    /* ══ SWITCH LIKELIHOOD ════════════════════════════════════════════════
     * Likelihood they leave their current supplier for us. A server override
     * (`switch_likelihood`) wins when present. */
    function computeSwitch(l) {
        var reasons = [], s = 25;
        var supplier = (l.current_supplier || '').trim();
        var parity = PRICING.parityCompetitor;
        if (!supplier) { reasons.push('No current biologics supplier, so this is a first-fit sale, not a switch'); }
        else if (supplier.toLowerCase() === parity) { s += 5; reasons.push(cap(parity) + ' incumbent at near price parity; win on physician-led sourcing and service'); }
        else { s += 20; reasons.push('On ' + supplier + ', not at price parity, so competitive pricing applies'); }
        if (l.price_per_cc_current) reasons.push('Paying $' + l.price_per_cc_current + '/cc now, quantify savings against our price');
        if (l.supplier_risk) { s += 20; reasons.push('Current supplier flagged (recall / backorder / warning), active switch trigger'); }
        if (l.contract_status === 'month_to_month') { s += 12; reasons.push('Month-to-month, no lock-in'); }
        else if (l.contract_status === 'expiring') { s += 15; reasons.push('Supplier contract expiring, switch window open'); }
        else if (l.contract_status === 'in_contract') { s -= 12; reasons.push('Under contract, time outreach to renewal'); }
        if (l.est_monthly_cc >= 100) { s += 6; reasons.push('~' + l.est_monthly_cc + ' cc/mo, worth the switch effort'); }
        if (l.competitors_nearby >= 6) { s += 3; reasons.push(l.competitors_nearby + ' nearby practices already in regen, competitive market'); }
        if (l.engagement === 'sample_requested' || l.engagement === 'demo') { s += 8; reasons.push(engagementLabel(l.engagement)); }

        if (l.switch_likelihood != null) return band(Number(l.switch_likelihood), reasons);
        return band(s, reasons);
    }

    /* Blended priority, reward a strong showing on EITHER buy or switch, since
     * the goal is clinics most likely to buy AND/OR switch. */
    function priority(l) {
        var buy = computeBuy(l).score, sw = computeSwitch(l).score;
        var blended = Math.max(0, Math.min(100, Math.round(0.6 * Math.max(buy, sw) + 0.4 * ((buy + sw) / 2))));
        return { score: blended, band: blended >= 70 ? 'hot' : blended >= 45 ? 'warm' : 'cold', buy: buy, switch: sw };
    }

    function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

    /* Display labels for the sales stages. The stored value stays a clean slug
     * (matches the filter <option value> and the .crm-pill CSS class); only the
     * text shown to the rep comes from here. */
    var STAGE_LABELS = {
        new: 'New', contacted: 'Contacted', qualified: 'Qualified',
        sold: 'Sold', not_interested: 'Not interested'
    };
    function stageLabel(s) { return STAGE_LABELS[s] || s || ', '; }

    /* Estimated per-cc savings a rep can quote, given the lead's current price.
     * Reads the placeholder PRICING config, numbers change when it does. */
    function savingsLine(l) {
        var supplier = (l.current_supplier || '').trim();
        if (supplier.toLowerCase() === PRICING.parityCompetitor)
            return cap(PRICING.parityCompetitor) + ' incumbent at price parity; differentiate on physician-led sourcing and support.';
        if (!supplier) return 'Qualify current supplier and price per cc to size the opportunity.';
        return 'Competitive pricing versus ' + supplier + '; quantify once our per-cc cost is set.';
    }

    var listEl   = $('crmLeadList');
    var detailEl = $('crmLeadDetail');
    var activeId = null;

    /* ── States multi-select ──
     * Empty selection = all states (the master "All states" box just clears the
     * individual boxes). The button label reflects the current selection. */
    var statePanel = $('crmStatePanel'), stateBtn = $('crmStateBtn'), stateAll = $('crmStateAll');
    function stateCbs() { return Array.prototype.slice.call(statePanel.querySelectorAll('.crm-state-cb')); }
    function selectedStates() { return stateCbs().filter(function (cb) { return cb.checked; }).map(function (cb) { return cb.value; }); }
    function updateStateUI() {
        var sel = stateCbs().filter(function (cb) { return cb.checked; });
        stateAll.checked = sel.length === 0;
        stateBtn.textContent = sel.length === 0 ? 'All states'
            : sel.length === 1 ? sel[0].parentNode.textContent.trim()
            : sel.length + ' states';
    }
    function openStates(open) {
        statePanel.hidden = !open;
        stateBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

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
            states: selectedStates(),
            source: $('crmFilterSource').value,
            category: $('crmFilterCategory').value,
            sort: $('crmSort').value,
            allTypes: $('crmAllTypes').checked,
            offersRegen: $('crmOffersRegen').checked,
            advertising: $('crmAdvertising').checked,
            cashPay: $('crmCashPay').checked,
            switchWindow: $('crmSwitchWindow').checked,
            hotOnly: $('crmHotOnly').checked
        };
    }

    function matches(lead, f) {
        if (f.stage && lead.stage !== f.stage) return false;
        if (f.states.length && f.states.indexOf(lead.state) === -1) return false;
        if (f.source && lead.source !== f.source) return false;
        if (!f.allTypes && f.category && lead.category !== f.category) return false;
        if (f.offersRegen && !(lead.offers_prp || lead.offers_exosomes || lead.offers_stem_cells)) return false;
        if (f.advertising && !lead.advertising_regen) return false;
        if (f.cashPay && !lead.cash_pay_focus) return false;
        if (f.switchWindow && !(lead.supplier_risk || lead.contract_status === 'month_to_month' || lead.contract_status === 'expiring')) return false;
        if (f.hotOnly && priority(lead).band !== 'hot') return false;
        if (f.q) {
            var hay = [lead.name, lead.owner_name, lead.doctor_name, lead.email, lead.phone, lead.city]
                .join(' ').toLowerCase();
            if (hay.indexOf(f.q) === -1) return false;
        }
        return true;
    }

    function sortLeads(list, sort) {
        var by = {
            priority: function (a, b) { return priority(b).score - priority(a).score; },
            buy:      function (a, b) { return computeBuy(b).score - computeBuy(a).score; },
            switch:   function (a, b) { return computeSwitch(b).score - computeSwitch(a).score; },
            score:    function (a, b) { return (b.score || 0) - (a.score || 0); },
            patients: function (a, b) { return (b.patients_per_day || 0) - (a.patients_per_day || 0); },
            newest:   function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); }
        };
        return list.slice().sort(by[sort] || by.priority);
    }

    function renderList() {
        var f = currentFilters();
        listEl.textContent = '';

        var note = document.createElement('div');
        note.className = 'crm-placeholder-note';
        note.textContent = 'Placeholder leads, real lead data is PII and was not captured. '
            + 'Replace LEADS in crm.js with the server’s list.';
        listEl.appendChild(note);

        var shown = 0;
        sortLeads(LEADS.filter(function (l) { return matches(l, f); }), f.sort).forEach(function (l) {
            var pr = priority(l);
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
            nm.textContent = l.name;                 // textContent, inert
            var fitBadge = document.createElement('span');
            fitBadge.className = 'crm-fit crm-fit-' + pr.band;
            fitBadge.textContent = pr.band.toUpperCase() + ' ' + pr.score;
            top.append(nm, fitBadge);

            var meta = document.createElement('div');
            meta.className = 'crm-list-meta';
            meta.textContent = [l.city, l.state].filter(Boolean).join(', ')
                + ' · ' + stageLabel(l.stage) + ' · ' + l.patients_per_day + '/day';

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
    /* A labelled 0-100 bar with its top reasons, one per score. */
    function meterEl(label, res) {
        var box = document.createElement('div');
        box.className = 'crm-meter crm-fit-' + res.band;
        var head = document.createElement('div');
        head.className = 'crm-meter-head';
        var lab = document.createElement('span'); lab.className = 'crm-meter-label'; lab.textContent = label;
        var sc = document.createElement('span'); sc.className = 'crm-meter-score'; sc.textContent = res.score;
        head.append(lab, sc);
        var track = document.createElement('div'); track.className = 'crm-meter-track';
        var fill = document.createElement('div'); fill.className = 'crm-meter-fill'; fill.style.width = res.score + '%';
        track.appendChild(fill);
        var ul = document.createElement('ul'); ul.className = 'crm-meter-reasons';
        res.reasons.slice(0, 4).forEach(function (r) { var li = document.createElement('li'); li.textContent = r; ul.appendChild(li); });
        box.append(head, track, ul);
        return box;
    }

    function renderDetail(lead) {
        detailEl.textContent = '';

        var name = document.createElement('div');
        name.className = 'crm-lead-name';
        name.textContent = lead.name;
        detailEl.appendChild(name);

        var pill = document.createElement('span');
        pill.className = 'crm-pill ' + (lead.stage || '');
        pill.textContent = stageLabel(lead.stage);
        detailEl.appendChild(pill);
        if (lead.tier && lead.tier !== 'standard') {
            var tier = document.createElement('span');
            tier.className = 'crm-tier';
            tier.style.marginLeft = '8px';
            tier.textContent = String(lead.tier).replace(/_/g, ' ').toUpperCase();
            detailEl.appendChild(tier);
        }

        /* ── AI screening scores: priority + buy propensity + switch likelihood ── */
        var pr = priority(lead);
        var buyRes = computeBuy(lead), swRes = computeSwitch(lead);

        var prBox = document.createElement('div');
        prBox.className = 'crm-fitbox crm-fit-' + pr.band;
        var prHead = document.createElement('div');
        prHead.className = 'crm-fitbox-head';
        var prLabel = document.createElement('span');
        prLabel.className = 'crm-fit crm-fit-' + pr.band;
        prLabel.textContent = pr.band.toUpperCase() + ' · Priority ' + pr.score + '/100 (buy and/or switch)';
        prHead.appendChild(prLabel);
        prBox.appendChild(prHead);
        var save = document.createElement('div');
        save.className = 'crm-fit-save';
        save.textContent = savingsLine(lead);
        prBox.appendChild(save);
        var meters = document.createElement('div');
        meters.className = 'crm-meters';
        meters.append(meterEl('Buy propensity', buyRes), meterEl('Switch likelihood', swRes));
        prBox.appendChild(meters);
        detailEl.appendChild(prBox);

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
        kv2(buy, 'Contract', contractLabel(lead.contract_status));
        if (lead.supplier_risk) kv2(buy, 'Supplier risk', 'Flagged, recall / backorder / warning');
        detailEl.appendChild(buy);

        /* ── Buying signals (what the intelligence scan surfaced) ── */
        detailEl.appendChild(sectionTitle('Buying signals'));
        var sig = document.createElement('div');
        sig.className = 'crm-chips';
        sig.append(
            yesNoChip(lead.cash_pay_focus, 'Cash-pay focus'),
            yesNoChip(lead.advertising_regen, 'Advertising regen'),
            yesNoChip(lead.website_mentions_regen, 'Markets regen'),
            yesNoChip(lead.decision_maker_is_owner, 'Owner decides')
        );
        detailEl.appendChild(sig);
        var sig2 = document.createElement('div');
        sig2.className = 'crm-lead-grid';
        sig2.style.marginTop = '10px';
        if (lead.google_rating != null) kv2(sig2, 'Reputation', lead.google_rating + '★ (' + (lead.review_count || 0) + ' reviews)');
        if (lead.competitors_nearby != null) kv2(sig2, 'Regen competitors nearby', String(lead.competitors_nearby));
        kv2(sig2, 'Engagement', engagementLabel(lead.engagement));
        detailEl.appendChild(sig2);

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

        /* ── AI screening tools (stubs, wire each to its endpoint) ── */
        detailEl.appendChild(sectionTitle('AI screening tools'));
        var tools = document.createElement('div');
        tools.className = 'crm-tools';
        [
            ['run-intel',      'Scan website & ads'],
            ['tool-reviews',   'Pull reviews & rating'],
            ['tool-supplier',  'Check supplier risk'],
            ['tool-lookalike', 'Find look-alikes'],
            ['tool-outreach',  'Draft outreach email']
        ].forEach(function (t) {
            var b = document.createElement('button');
            b.type = 'button'; b.className = 'btn sm'; b.dataset.action = t[0]; b.textContent = t[1];
            tools.appendChild(b);
        });
        detailEl.appendChild(tools);
        var toolStatus = document.createElement('div');
        toolStatus.className = 'crm-tool-status muted'; toolStatus.id = 'crmIntelStatus';
        toolStatus.setAttribute('aria-live', 'polite');
        detailEl.appendChild(toolStatus);

        // Note + follow-up actions (the captured crmNoteInput / crmFollowupDate / crmDispNote).
        // Static markup (no lead-derived values) so innerHTML is safe here.
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

    /* Screening-tool stub: show the running copy, then a "wire me up" note.
     * Every tool is inert in this static build, nothing is fetched or sent. */
    function runTool(runningMsg, endpointName) {
        var st = $('crmIntelStatus');
        if (!st) return;
        st.textContent = runningMsg;
        setTimeout(function () {
            st.textContent = 'Stub, wire to the ' + endpointName + ' endpoint. This static build runs no scan and sends nothing.';
        }, 1100);
    }

    /* ══ QUEUE BUILDER ════════════════════════════════════════════════════
     * Client-side call list: providers in the chosen territory/category, ranked
     * by priority. In production this would page through the server's leads. */
    function buildQueue() {
        var terr = $('crmQueueTerritory').value, cat = $('crmQueueCategory').value;
        var out = $('crmQueueList');
        var list = LEADS.filter(function (l) {
            if (terr && l.state !== terr) return false;
            if (cat && l.category !== cat) return false;
            return l.is_provider;
        }).sort(function (a, b) { return priority(b).score - priority(a).score; });

        out.textContent = '';
        if (!list.length) {
            var e = document.createElement('li'); e.className = 'doc-empty';
            e.textContent = 'No provider leads match this territory and category.';
            out.appendChild(e); return;
        }
        list.forEach(function (l, i) {
            var pr = priority(l);
            var li = document.createElement('li'); li.className = 'doc-row';
            var num = document.createElement('span'); num.className = 'doc-badge html'; num.textContent = String(i + 1);
            var main = document.createElement('div'); main.className = 'doc-row-main';
            var nm = document.createElement('div'); nm.className = 'doc-row-title'; nm.textContent = l.name;
            var sub = document.createElement('div'); sub.className = 'doc-row-sub';
            sub.textContent = [l.city, l.state].filter(Boolean).join(', ') + (l.phone ? ', ' + l.phone : '');
            main.append(nm, sub);
            var badge = document.createElement('span'); badge.className = 'crm-fit crm-fit-' + pr.band;
            badge.textContent = pr.band.toUpperCase() + ' ' + pr.score;
            var call = document.createElement('a'); call.className = 'btn sm'; call.textContent = 'Call';
            call.setAttribute('href', safeUrl('tel:' + (l.phone || ''), ['tel:']));
            var acts = document.createElement('div'); acts.className = 'doc-row-actions'; acts.append(badge, call);
            li.append(num, main, acts);
            out.appendChild(li);
        });
    }

    /* ══ EVENTS ═══════════════════════════════════════════════════════════ */
    document.addEventListener('click', function (e) {
        var el = e.target.closest('[data-action]');
        var action = el && el.dataset.action;

        // States multi-select: toggle on the button, close on any outside click.
        if (action === 'toggle-states') { openStates(statePanel.hidden); return; }
        if (!e.target.closest('#crmStateMulti') && !statePanel.hidden) openStates(false);

        if (!el) return;
        switch (action) {
            case 'open-lead':   openLead(Number(el.dataset.id)); break;
            case 'tab':         showTab(el.dataset.tab); break;
            case 'save-note':
                cModal.alert('Not wired', 'In production this posts the note to the CRM endpoint. '
                    + 'This static build does not send anything.');
                break;
            case 'build-queue': buildQueue(); break;
            case 'run-intel':      runTool('Scanning website & ads, regen mentions, services, ad presence…', 'website/ads intelligence'); break;
            case 'tool-reviews':   runTool('Pulling reviews & rating, volume, recency, sentiment…', 'reviews / reputation'); break;
            case 'tool-supplier':  runTool('Checking supplier risk, recalls, backorders, FDA warnings for the current supplier…', 'supplier-risk'); break;
            case 'tool-lookalike': runTool('Finding look-alikes, clinics similar to your best customers in this territory…', 'look-alike'); break;
            case 'tool-outreach':  runTool('Drafting outreach, a first email built from this lead’s buy / switch reasons…', 'outreach drafting'); break;
            case 'close-replay': $('replayOverlay').hidden = true; break;
        }
    });

    // Searching or filtering always shows the Lead List (otherwise, on the Queue
    // tab, the list is hidden and search looks like it does nothing).
    function applyFilters() {
        if ($('crmView-leads').hidden) showTab('leads');
        renderList();
    }

    ['crmSearch', 'crmFilterStage', 'crmFilterSource', 'crmFilterCategory',
     'crmSort', 'crmOffersRegen', 'crmAdvertising', 'crmCashPay',
     'crmSwitchWindow', 'crmHotOnly'].forEach(function (id) {
        var el = $(id);
        if (el) el.addEventListener(el.tagName === 'INPUT' && el.type !== 'checkbox' ? 'input' : 'change', applyFilters);
    });

    // "All clinic types" overrides the category dropdown; disable it while on.
    $('crmAllTypes').addEventListener('change', function () {
        $('crmFilterCategory').disabled = this.checked;
        applyFilters();
    });

    // States panel: the master box clears the individual boxes; any individual
    // box unchecks the master. Either way, re-render.
    statePanel.addEventListener('change', function (e) {
        if (e.target === stateAll && stateAll.checked) {
            stateCbs().forEach(function (cb) { cb.checked = false; });
        }
        updateStateUI();
        applyFilters();
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
    if (CONFIG.defaultState) {
        var pin = statePanel.querySelector('.crm-state-cb[value="' + CONFIG.defaultState + '"]');
        if (pin) pin.checked = true;
    }
    updateStateUI();

    renderList();
    showTab('leads');
})();
