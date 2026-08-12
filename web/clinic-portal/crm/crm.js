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
    var PLACEHOLDER_LEADS = [
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
        ourPricePerCc: 800,         // $ per cc across the line
        novaExoPlusPerCc: 500       // NOVA-EXO+ per cc
    };

    /* ══ INTELLIGENCE SIGNALS (PLACEHOLDER) ═══════════════════════════════
     * Extra screening signals the "intelligence" scan / rep enrichment would
     * populate. Kept in a compact per-id map so the LEADS array above stays
     * readable; missing fields fall back to SIGNAL_DEFAULTS. Replace with the
     * server's enriched values.
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
        regen_specialty: false,
        advertising_regen: false, website_mentions_regen: false,
        google_rating: null, review_count: null, decision_maker_is_owner: false,
        contract_status: 'none', supplier_risk: false, engagement: 'none',
        competitors_nearby: null, buy_likelihood: null
    };
    var SIGNALS = {
        1: { website_mentions_regen: true, google_rating: 4.6, review_count: 180, decision_maker_is_owner: true, contract_status: 'none', engagement: 'visited_pricing', competitors_nearby: 5 },
        2: { advertising_regen: true, website_mentions_regen: true, google_rating: 4.8, review_count: 320, decision_maker_is_owner: false, contract_status: 'month_to_month', engagement: 'sample_requested', competitors_nearby: 9 },
        3: { advertising_regen: true, website_mentions_regen: true, google_rating: 4.9, review_count: 410, decision_maker_is_owner: true, contract_status: 'in_contract', engagement: 'demo', competitors_nearby: 4 },
        4: { google_rating: 4.3, review_count: 75, decision_maker_is_owner: true, contract_status: 'expiring', supplier_risk: true, engagement: 'email_open', competitors_nearby: 6 },
        5: { google_rating: null, review_count: null, contract_status: 'none', engagement: 'none', competitors_nearby: 0 },
        6: { advertising_regen: true, google_rating: 4.7, review_count: 210, decision_maker_is_owner: true, contract_status: 'month_to_month', engagement: 'visited_pricing', competitors_nearby: 7 },
        7: { advertising_regen: true, website_mentions_regen: true, google_rating: 4.5, review_count: 150, decision_maker_is_owner: true, contract_status: 'none', engagement: 'sample_requested', competitors_nearby: 8 },
        8: { advertising_regen: true, website_mentions_regen: true, google_rating: 4.6, review_count: 260, decision_maker_is_owner: true, contract_status: 'expiring', supplier_risk: true, engagement: 'demo', competitors_nearby: 5 },
        9: { google_rating: 4.2, review_count: 60, decision_maker_is_owner: true, contract_status: 'none', engagement: 'none', competitors_nearby: 3 }
    };
    PLACEHOLDER_LEADS.forEach(function (l) {
        var s = SIGNALS[l.id] || {};
        Object.keys(SIGNAL_DEFAULTS).forEach(function (k) {
            if (l[k] === undefined) l[k] = (s[k] !== undefined ? s[k] : SIGNAL_DEFAULTS[k]);
        });
    });

    /* ══ LEAD SOURCE ══════════════════════════════════════════════════════
     * LEADS is whatever source is currently loaded:
     *   placeholder  the sample rows above (no real PII in the repo)
     *   server       fetched from the leads endpoint at load
     *   import       a CSV/JSON file the rep loaded; stays on this device
     * The real list is PII and lives server-side only. */
    var LEADS = PLACEHOLDER_LEADS;
    var LEAD_SOURCE = { kind: 'placeholder', label: '' };

    /* Device-local persistence for imported lists, so a rep's working leads
     * survive a reload. Data lives in this browser's localStorage only; it is
     * never uploaded and never leaves the device. */
    var SAVE_KEY = 'cn_crm_leads';
    function saveLocalLeads(list, label) {
        try { localStorage.setItem(SAVE_KEY, JSON.stringify({ label: label, leads: list, ts: Date.now() })); } catch (e) {}
    }
    function readLocalLeads() {
        try {
            var raw = localStorage.getItem(SAVE_KEY);
            if (!raw) return null;
            var j = JSON.parse(raw);
            return (j && Array.isArray(j.leads) && j.leads.length) ? j : null;
        } catch (e) { return null; }
    }
    function clearLocalLeads() {
        try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
    }

    function toBool(v) {
        if (typeof v === 'boolean') return v;
        var s = String(v == null ? '' : v).trim().toLowerCase();
        return s === '1' || s === 'true' || s === 'yes' || s === 'y';
    }
    function toNum(v) {
        if (v == null || v === '') return null;
        var n = Number(String(v).replace(/[^0-9.\-]/g, ''));
        return isNaN(n) ? null : n;
    }

    /* Normalize server/imported rows into the lead schema; missing intelligence
     * signals fall back to SIGNAL_DEFAULTS. Rows without a name are dropped. */
    function normalizeLeads(arr) {
        var out = [];
        (arr || []).forEach(function (r, i) {
            if (!r || typeof r !== 'object') return;
            var l = {
                id: toNum(r.id) || (i + 1),
                name: String(r.name || r.clinic || r.clinic_name || '').trim(),
                stage: String(r.stage || 'new').trim().toLowerCase().replace(/\s+/g, '_'),
                tier: String(r.tier || 'standard'),
                phone: String(r.phone || ''), email: String(r.email || ''),
                address: String(r.address || ''), city: String(r.city || ''),
                state: String(r.state || '').trim().toUpperCase().slice(0, 2),
                website: String(r.website || ''),
                category: String(r.category || '').trim().toLowerCase().replace(/\s+/g, '_'),
                source: String(r.source || 'import'),
                score: toNum(r.score) || 0,
                scan_score: toNum(r.scan_score),
                last_contacted: String(r.last_contacted || ''),
                next_followup: String(r.next_followup || ''),
                rep_first: String(r.rep_first || r.rep || ''), rep_last: String(r.rep_last || ''),
                created_at: String(r.created_at || ''),
                owner_name: String(r.owner_name || r.owner || ''),
                doctor_name: String(r.doctor_name || r.doctor || ''),
                is_provider: r.is_provider !== undefined ? toBool(r.is_provider) : true,
                patients_per_day: toNum(r.patients_per_day) || 0,
                offers_prp: toBool(r.offers_prp),
                offers_exosomes: toBool(r.offers_exosomes),
                offers_stem_cells: toBool(r.offers_stem_cells),
                npi: String(r.npi || ''),
                current_supplier: String(r.current_supplier || r.supplier || ''),
                price_per_cc_current: toNum(r.price_per_cc_current != null ? r.price_per_cc_current : r.price_per_cc),
                est_monthly_cc: toNum(r.est_monthly_cc) || 0,
                switch_likelihood: toNum(r.switch_likelihood)
            };
            Object.keys(SIGNAL_DEFAULTS).forEach(function (k) {
                var d = SIGNAL_DEFAULTS[k];
                if (r[k] === undefined || r[k] === '') l[k] = d;
                else if (typeof d === 'boolean') l[k] = toBool(r[k]);
                else if (k === 'contract_status' || k === 'engagement') l[k] = String(r[k]).trim().toLowerCase().replace(/\s+/g, '_');
                else l[k] = toNum(r[k]);
            });
            if (l.name) out.push(l);
        });
        return out;
    }

    function applyLeads(list, kind, label) {
        LEADS = list;
        LEAD_SOURCE = { kind: kind, label: label || '' };
        if (kind === 'import') saveLocalLeads(list, label || '');
        activeId = null;
        detailEl.textContent = '';
        var empty = document.createElement('p');
        empty.className = 'crm-empty';
        empty.textContent = 'Select a lead to view details.';
        detailEl.appendChild(empty);
        renderList();
    }

    /* Minimal CSV parser: quoted fields, escaped quotes, CRLF. Header row maps
     * to schema field names (lowercased, spaces to underscores). */
    function parseCsv(text) {
        var rows = [], row = [], cur = '', inQ = false;
        for (var i = 0; i < text.length; i++) {
            var c = text[i];
            if (inQ) {
                if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
                else cur += c;
            }
            else if (c === '"') inQ = true;
            else if (c === ',') { row.push(cur); cur = ''; }
            else if (c === '\n' || c === '\r') {
                if (cur !== '' || row.length) { row.push(cur); rows.push(row); row = []; cur = ''; }
                if (c === '\r' && text[i + 1] === '\n') i++;
            }
            else cur += c;
        }
        if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
        if (rows.length < 2) return [];
        var head = rows[0].map(function (h) { return String(h).trim().toLowerCase().replace(/\s+/g, '_'); });
        return rows.slice(1).map(function (r) {
            var o = {};
            head.forEach(function (h, idx) { if (h) o[h] = r[idx]; });
            return o;
        });
    }

    function importLeadFile(file) {
        var reader = new FileReader();
        reader.onload = function () {
            var text = String(reader.result || '');
            var list = [];
            try {
                if (/^\s*[\[{]/.test(text)) {
                    var j = JSON.parse(text);
                    list = normalizeLeads(Array.isArray(j) ? j : (j && j.leads) || []);
                } else {
                    list = normalizeLeads(parseCsv(text));
                }
            } catch (e) {
                cModal.alert('Import failed', 'Could not parse that file. Use a CSV with a header row, or a JSON array of leads.');
                return;
            }
            if (!list.length) {
                cModal.alert('No leads found', 'The file parsed but had no usable rows. It needs at least a name column.');
                return;
            }
            uploadLeads(list, file.name);
        };
        reader.readAsText(file);
    }

    /* Auto-upload an imported list to the portal so every device loads it
     * automatically from then on. When the server is unreachable (offline, or
     * the static demo build), fall back to keeping the list on this device. */
    function uploadLeads(list, sourceName) {
        fetch(CONFIG.leadsUrl || '/portal/api/leads', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ leads: list })
        })
            .then(function (res) { if (!res.ok) throw new Error('upload failed'); return res.json(); })
            .then(function (data) {
                var serverList = normalizeLeads((data && data.leads) || []);
                clearLocalLeads();
                applyLeads(serverList.length ? serverList : list, 'server',
                    'Uploaded ' + list.length + (list.length === 1 ? ' lead' : ' leads') + ' from ' + sourceName + ' to the portal.');
            })
            .catch(function () {
                applyLeads(list, 'import', 'Imported ' + list.length + (list.length === 1 ? ' lead' : ' leads') + ' from ' + sourceName + '.');
            });
    }

    /* How naturally a specialty uses stem cells / exosomes (buy-side weight). */
    var SPECIALTY_FIT = {
        ortho: 10, pain_management: 10, wellness: 8, med_spa: 7,
        aesthetic: 7, plastic_surgery: 6, podiatry: 6
    };

    /* Specialties whose core practice centers on PRP / exosomes / stem cells /
     * regenerative injections. Used only to nudge the buy score and label the
     * lead detail — NOT to gate the filter (podiatry / plastic surgery aren't
     * here, so they get the score nudge only via a registry sub-specialty). */
    var REGEN_CATEGORIES = { ortho: 1, pain_management: 1, med_spa: 1, wellness: 1, aesthetic: 1 };

    /* The "Mentions regenerative therapies" filter is inclusive of EVERY kind of
     * clinic: any provider, any clinic category, or any explicit/known regen
     * signal qualifies. Only non-clinic vendor rows (is_provider false, no
     * category, no regen signal) fall out. */
    function mentionsRegen(l) {
        return !!(l.is_provider || l.category
            || l.offers_prp || l.offers_exosomes || l.offers_stem_cells
            || l.advertising_regen || l.website_mentions_regen || l.regen_specialty);
    }
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

    /* ══ SCORE BANDS (tunable) ════════════════════════════════════════════
     * The cut points for hot / warm / cold. Registry-sourced leads carry less
     * signal than fully-enriched ones, so the ceiling is lower — these are set
     * so the strongest scanned clinics read hot, solid providers warm, and only
     * thin/low-fit records cold. Lower `hot`/`warm` to grade more generously. */
    var BANDS = { hot: 58, warm: 40 };
    function bandName(s) { return s >= BANDS.hot ? 'hot' : s >= BANDS.warm ? 'warm' : 'cold'; }

    function band(s, reasons) {
        s = Math.max(0, Math.min(100, Math.round(s)));
        return { score: s, band: bandName(s), reasons: reasons };
    }

    /* ══ BUY PROPENSITY ═══════════════════════════════════════════════════
     * Likelihood the clinic buys stem cells / exosomes at all, independent of
     * who they buy from today. Transparent heuristic; tune to what closes.
     * A server override (`buy_likelihood`) wins when present. */
    function computeBuy(l) {
        // Baseline: a verified medical provider in a target specialty is already a
        // real prospect. Unknown signals stay NEUTRAL (no penalty) so a freshly
        // scanned clinic lands warm, not cold; confirmed positives lift it toward hot.
        var reasons = [], s = 40;
        if (!l.is_provider) { reasons.push('Not a medical provider, unlikely to administer biologics'); return band(6, reasons); }
        reasons.push('Active medical provider, can administer biologics in-clinic');

        var sf = SPECIALTY_FIT[l.category] || 5; s += sf;
        var catName = cap(String(l.category || 'clinic').replace(/_/g, ' '));
        if (sf >= 9) reasons.push(catName + ', high-use specialty for stem cells and exosomes');
        else if (l.category) reasons.push(catName + ', a fit for regenerative protocols');

        if (l.offers_prp || l.offers_exosomes || l.offers_stem_cells) { s += 15; reasons.push('Already offers regenerative medicine, in-market'); }
        else if (l.regen_specialty) { s += 12; reasons.push('Registry sub-specialty indicates an active regenerative practice'); }
        else if (REGEN_CATEGORIES[l.category]) { s += 8; reasons.push('Specialty centers on regenerative therapies, likely in-market'); }
        if (l.offers_prp && !l.offers_exosomes && !l.offers_stem_cells) { s += 8; reasons.push('Runs PRP only, natural step up to exosomes/stem cells'); }
        if (l.website_mentions_regen) { s += 6; reasons.push('Website already markets regenerative therapies'); }
        if (l.advertising_regen) { s += 10; reasons.push('Actively advertising regenerative treatments, demand in place'); }
        if (l.patients_per_day >= 40) { s += 8; reasons.push('High patient volume (' + l.patients_per_day + '/day)'); }
        else if (l.patients_per_day >= 20) { s += 4; }
        if (l.est_monthly_cc >= 100) { s += 6; reasons.push('~' + l.est_monthly_cc + ' cc/mo potential'); }
        if ((l.google_rating || 0) >= 4.5 && (l.review_count || 0) >= 100) { s += 5; reasons.push('Strong reputation (' + l.google_rating + '★, ' + l.review_count + ' reviews)'); }
        if (l.engagement === 'sample_requested' || l.engagement === 'demo') { s += 10; reasons.push(engagementLabel(l.engagement) + ', active buying signal'); }
        else if (l.engagement === 'visited_pricing') { s += 6; reasons.push('Visited pricing, evaluating'); }
        if (l.decision_maker_is_owner) { s += 4; reasons.push('Physician-owner decides, faster close'); }

        // Registry-fit score from the scan (primary specialty, regenerative
        // sub-specialty, organization, reachability) nudges the buy propensity.
        if (l.scan_score != null) {
            s = Math.round(s * 0.7 + l.scan_score * 0.3);
            if (l.scan_score >= 75) reasons.push('Top registry match, primary specialty and/or regenerative sub-specialty');
        }

        if (l.buy_likelihood != null) return band(Number(l.buy_likelihood), reasons);
        return band(s, reasons);
    }

    /* ══ SWITCH LIKELIHOOD ════════════════════════════════════════════════
     * Likelihood they leave their current supplier for us. A server override
     * (`switch_likelihood`) wins when present. */
    function computeSwitch(l) {
        // Baseline: a reachable prospect. An UNKNOWN supplier is treated as a
        // greenfield opportunity (neutral), never a penalty; a known displaceable
        // supplier scores higher because it's a clearer switch target.
        var reasons = [], s = 44;
        var supplier = (l.current_supplier || '').trim();
        var parity = PRICING.parityCompetitor;
        if (!supplier) { reasons.push('No known biologics supplier, a first-fit, greenfield sale'); }
        else if (supplier.toLowerCase() === parity) { s += 5; reasons.push(cap(parity) + ' incumbent at near price parity; win on physician-led sourcing and service'); }
        else { s += 18; reasons.push('On ' + supplier + ', not at price parity, so competitive pricing applies'); }
        if (l.price_per_cc_current && l.price_per_cc_current > PRICING.ourPricePerCc)
            reasons.push('Paying $' + l.price_per_cc_current + ' per cc against our $' + PRICING.ourPricePerCc
                + ', a $' + (l.price_per_cc_current - PRICING.ourPricePerCc) + ' per cc gap');
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
        return { score: blended, band: bandName(blended), buy: buy, switch: sw };
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
    /* Concrete savings math from real prices: their reported price per cc vs
     * our $800 (NOVA-EXO+ at $500 is the sharper opener when they buy exosomes). */
    function savingsLine(l) {
        var supplier = (l.current_supplier || '').trim();
        if (supplier.toLowerCase() === PRICING.parityCompetitor)
            return cap(PRICING.parityCompetitor) + ' incumbent at price parity; differentiate on physician-led sourcing and support.';
        if (!supplier) return 'Qualify current supplier and price per cc to size the opportunity.';
        if (l.price_per_cc_current && l.price_per_cc_current > PRICING.ourPricePerCc) {
            var delta = l.price_per_cc_current - PRICING.ourPricePerCc;
            var line = 'They pay $' + l.price_per_cc_current + ' per cc; ours is $' + PRICING.ourPricePerCc
                + ', saving $' + delta + ' per cc';
            if (l.est_monthly_cc) line += ' (about $' + (delta * l.est_monthly_cc).toLocaleString()
                + ' per month at ' + l.est_monthly_cc + ' cc)';
            if (l.offers_exosomes) line += '. NOVA-EXO+ at $' + PRICING.novaExoPlusPerCc + ' per cc widens it further';
            return line + '.';
        }
        return 'Versus ' + supplier + ', lead with NOVA-EXO+ at $' + PRICING.novaExoPlusPerCc
            + ' per cc and physician-led support.';
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
            confirm: function (t, b, fn) { open(t, b, true, fn); },
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
            switchWindow: $('crmSwitchWindow').checked,
            hotOnly: $('crmHotOnly').checked
        };
    }

    function matches(lead, f) {
        if (f.stage && lead.stage !== f.stage) return false;
        if (f.states.length && f.states.indexOf(lead.state) === -1) return false;
        if (f.source && lead.source !== f.source) return false;
        if (!f.allTypes && f.category && lead.category !== f.category) return false;
        if (f.offersRegen && !mentionsRegen(lead)) return false;
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

        if (LEAD_SOURCE.kind !== 'server' || LEAD_SOURCE.label) {
            var note = document.createElement('div');
            note.className = 'crm-placeholder-note';
            note.textContent = LEAD_SOURCE.kind === 'server'
                ? LEAD_SOURCE.label + ' Leads now load automatically on any signed-in device.'
                : LEAD_SOURCE.kind === 'import'
                    ? LEAD_SOURCE.label + ' Saved on this device only. It will upload automatically the next time the portal is reachable at import.'
                    : 'Demo data. On the live portal this page shows your real leads only.';
            listEl.appendChild(note);
        }
        var clearBtn = $('crmClearLocal');
        if (clearBtn) clearBtn.hidden = LEAD_SOURCE.kind !== 'import';

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
            empty.textContent = (LEAD_SOURCE.kind === 'server' && !LEADS.length)
                ? 'No leads yet. Click “Find leads” above to pull real clinics from the NPI Registry for your '
                  + 'selected states and specialties. Clinic applications from your website appear here automatically.'
                : 'No leads match these filters.';
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

        /* ── AI screening scores: priority + buy propensity + switch likelihood ──
         * Wrapped so a data quirk in one lead can never silently remove the AI
         * breakdown (or abort the rest of the detail view). */
        try {
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
        } catch (e) {
            var scoreErr = document.createElement('div');
            scoreErr.className = 'crm-fitbox crm-fit-cold';
            scoreErr.textContent = 'AI screening could not score this lead: ' + (e && e.message ? e.message : e);
            detailEl.appendChild(scoreErr);
        }

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
        if (lead.regen_specialty) chips.append(yesNoChip(true, 'Regen sub-specialty (registry)'));
        else if (REGEN_CATEGORIES[lead.category]) chips.append(yesNoChip(true, 'Regenerative-therapy specialty'));
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
        if (lead.npi) kv(grid, 'NPI', textNode(lead.npi));
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

    /* ══ OUTREACH DRAFTING ════════════════════════════════════════════════
     * Composes a personalized first-touch email from the lead's intelligence
     * signals. The ANGLE is chosen by the strongest response driver we know:
     *   1. supplier_risk        their supply is shaky; lead with reliability
     *   2. contract expiring    the switch window is open; lead with timing
     *   3. month_to_month       no lock-in; low-friction trial ask
     *   4. PRP-only             natural upsell into exosomes/stem cells
     *   5. no regen yet         education-first intro
     *   6. parity incumbent     physician-led service, never price
     *   7. default              physician-led sourcing intro
     * Every draft stays short, names their practice specifics, and asks for one
     * small step (an MD-to-MD call). No pricing figures are ever embedded; the
     * rep quotes numbers live once the finalized cost is set.
     * In production the same payload goes to the AI drafting endpoint. */
    var CATEGORY_PHRASE = {
        ortho: 'orthopedic practice', pain_management: 'pain management practice',
        med_spa: 'med spa', aesthetic: 'aesthetic practice',
        plastic_surgery: 'plastic surgery practice', podiatry: 'podiatry practice',
        wellness: 'wellness practice'
    };
    function firstNameLine(l) {
        var n = (l.doctor_name || l.owner_name || '').trim();
        if (!n) return 'Hi there,';
        return 'Hi ' + n + ',';
    }
    function composeOutreach(l) {
        var clinic = l.name;
        var catPhrase = CATEGORY_PHRASE[l.category] || 'practice';
        var supplier = (l.current_supplier || '').trim();
        var parity = supplier && supplier.toLowerCase() === PRICING.parityCompetitor;
        var runsRegen = l.offers_prp || l.offers_exosomes || l.offers_stem_cells;
        var prpOnly = l.offers_prp && !l.offers_exosomes && !l.offers_stem_cells;

        var subject, hook;
        if (l.supplier_risk && supplier) {
            subject = 'A reliable biologics source for ' + clinic;
            hook = 'I understand ' + supplier + ' has had supply disruptions recently. When a treatment day '
                + 'depends on product arriving on time, that is a real problem, and it is the main reason '
                + 'clinics start a conversation with us.';
        } else if (l.contract_status === 'expiring') {
            subject = 'Worth a look before your supplier agreement renews';
            hook = 'If your current supplier agreement is coming up for renewal, this is the easiest moment '
                + 'to compare options with zero switching pressure. A short call now means you renew, or not, '
                + 'with full information.';
        } else if (l.contract_status === 'month_to_month') {
            subject = 'A low-risk look at physician-led biologics for ' + clinic;
            hook = 'Since you are not locked into a supplier contract, trying us costs nothing but a '
                + 'conversation. Many clinics start with a single order alongside their current source and '
                + 'compare results directly.';
        } else if (prpOnly) {
            subject = 'Adding exosomes to the PRP program at ' + clinic;
            hook = 'You already run PRP, which means your patients and workflows are ready for the next step. '
                + 'Clinics like yours typically add exosomes first: same visit structure, familiar consent '
                + 'conversation, and a natural fit with the ' + catPhrase + ' cases you already treat.';
        } else if (!runsRegen) {
            subject = 'Bringing regenerative medicine to ' + clinic;
            hook = 'Many ' + catPhrase + 's are adding regenerative options, and the ones that do it well '
                + 'start with protocols and physician support rather than product alone. That is exactly how '
                + 'we onboard new clinics.';
        } else if (parity) {
            subject = 'Physician-led sourcing and support for ' + clinic;
            hook = 'You clearly take sourcing seriously. Where we stand apart is that CelluNOVA is '
                + 'physician-led end to end: protocols, physician-reviewed ordering, and direct MD-to-MD '
                + 'support for your clinical team.';
        } else {
            subject = 'Physician-led biologics for ' + clinic;
            hook = 'CelluNOVA is a physician-led distributor of MSC biologics and exosomes, with competitive '
                + 'per-cc pricing and clinical protocols included. Clinics come for the pricing and stay for '
                + 'the physician support.';
        }

        // Engagement-aware opener: reference the step they already took.
        var opener;
        if (l.engagement === 'sample_requested') {
            opener = 'Following up on the sample you requested. I wanted to make sure it arrived and answer '
                + 'anything that came up.';
        } else if (l.engagement === 'demo') {
            opener = 'Thanks for taking the time on the demo. Following up with the next step while it is fresh.';
        } else if (l.engagement === 'visited_pricing') {
            opener = 'I wanted to follow up while you are evaluating options for the practice.';
        } else {
            opener = 'I will keep this short.';
        }

        // Practice-specific proof point: use what we know, never invent.
        var specifics = [];
        if (l.patients_per_day >= 20) specifics.push('At ' + l.patients_per_day + ' patients a day, even a small per-treatment improvement compounds fast.');
        if (l.offers_exosomes && l.offers_stem_cells) specifics.push('Since you already run a full regenerative line, the fit conversation is mostly about sourcing quality and support.');

        var cta = 'Would you be open to a 15-minute call with one of the physicians on our medical board? '
            + 'Not a sales call: an MD-to-MD conversation about your cases, protocols, and what has worked '
            + 'in practices like yours.';

        var body = [
            firstNameLine(l),
            '',
            opener + ' ' + hook,
            specifics.length ? specifics.join(' ') : null,
            cta,
            '',
            'Best,',
            (CONFIG.repName || '{Rep name}'),
            'CelluNOVA',
            (CONFIG.repPhone || '{Rep phone}')
        ].filter(function (x) { return x !== null; }).join('\n');

        return { subject: subject, body: body };
    }

    var outreachModal = $('outreachModal'), outreachLastFocus = null;
    function openOutreach(lead) {
        if (!lead) return;
        var d = composeOutreach(lead);
        $('outreachSub').textContent = 'To ' + (lead.email || 'the lead') + ' · composed from '
            + lead.name + '’s signals';
        $('outreachSubject').value = d.subject;
        $('outreachBody').value = d.body;
        $('outreachCopied').hidden = true;
        var mailto = 'mailto:' + encodeURIComponent(lead.email || '')
            + '?subject=' + encodeURIComponent(d.subject)
            + '&body=' + encodeURIComponent(d.body);
        $('outreachMailto').setAttribute('href', safeUrl(mailto, ['mailto:']));
        outreachLastFocus = document.activeElement;
        outreachModal.hidden = false;
        $('outreachSubject').focus();
    }
    function closeOutreach() {
        outreachModal.hidden = true;
        if (outreachLastFocus && outreachLastFocus.focus) outreachLastFocus.focus();
    }
    function copyOutreach() {
        var text = 'Subject: ' + $('outreachSubject').value + '\n\n' + $('outreachBody').value;
        function done() { var c = $('outreachCopied'); c.hidden = false; setTimeout(function () { c.hidden = true; }, 1800); }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, function () { $('outreachBody').select(); });
        } else {
            $('outreachBody').select();
            try { document.execCommand('copy'); done(); } catch (e) {}
        }
    }

    /* ══ FIND LEADS (SCAN) ════════════════════════════════════════════════
     * Posts to the scan endpoint, which searches the NPI Registry by state
     * and specialty server-side, dedupes, and appends. Nothing manual. */
    var scanModal = $('scanModal'), scanLastFocus = null, scanning = false;

    function populateScanStates() {
        var sel = $('scanState');
        if (!sel || sel.options.length) return;
        var all = document.createElement('option');
        all.value = 'ALL';
        all.textContent = 'All states (nationwide)';
        sel.appendChild(all);
        stateCbs().forEach(function (cb) {
            var o = document.createElement('option');
            o.value = cb.value;
            o.textContent = cb.parentNode.textContent.trim();
            sel.appendChild(o);
        });
    }

    function scanCatEls() { return Array.prototype.slice.call(document.querySelectorAll('.scan-cat')); }
    /* Keep the "All clinics" master box in sync with the individual specialties. */
    function syncScanAllCats() {
        var master = $('scanAllCats');
        if (master) master.checked = scanCatEls().every(function (c) { return c.checked; });
    }
    function openScan() {
        populateScanStates();
        // Carry the toolbar's parameters into the scan, so "Find leads" searches
        // the states and specialty the rep already set rather than starting blank.
        var states = selectedStates();
        var pinned = states[0] || CONFIG.defaultState || '';
        if (pinned) $('scanState').value = pinned;
        var f = currentFilters();
        var scanCats = scanCatEls();
        if (!f.allTypes && f.category) {
            // A single category is chosen in the toolbar: scan exactly that specialty.
            scanCats.forEach(function (c) { c.checked = (c.value === f.category); });
            // Toolbar categories without a registry mapping (e.g. aesthetic) fall back to all.
            if (!scanCats.some(function (c) { return c.checked; })) scanCats.forEach(function (c) { c.checked = true; });
        } else if (f.allTypes) {
            scanCats.forEach(function (c) { c.checked = true; });
        }
        syncScanAllCats();
        $('scanError').hidden = true;
        $('scanStatus').textContent = '';
        scanLastFocus = document.activeElement;
        scanModal.hidden = false;
        $('scanState').focus();
    }
    function closeScan() {
        if (scanning) return;
        scanModal.hidden = true;
        if (scanLastFocus && scanLastFocus.focus) scanLastFocus.focus();
    }
    function runScan() {
        if (scanning) return;
        var cats = Array.prototype.slice.call(document.querySelectorAll('.scan-cat'))
            .filter(function (c) { return c.checked; })
            .map(function (c) { return c.value; });
        var err = $('scanError');
        if (!cats.length) { err.textContent = 'Pick at least one specialty.'; err.hidden = false; return; }
        err.hidden = true;
        scanning = true;
        $('scanRun').disabled = true;
        $('scanStatus').textContent = 'Searching the registry…';
        fetch('/portal/api/leads/scan', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                state: $('scanState').value,
                categories: cats,
                limit: Number($('scanLimit').value) || 50
            })
        })
            .then(function (res) {
                return res.json().then(function (data) {
                    if (!res.ok) throw new Error(data && data.error ? data.error : 'Scan failed.');
                    return data;
                });
            })
            .then(function (data) {
                scanning = false;
                $('scanRun').disabled = false;
                var added = data.added || 0;
                if (added > 0) {
                    var list = normalizeLeads((data && data.leads) || []);
                    scanModal.hidden = true;
                    applyLeads(list, 'server', 'Added ' + added + (added === 1 ? ' new lead' : ' new leads')
                        + ' from the registry scan.');
                } else if (data.errors && data.errors.length) {
                    $('scanStatus').textContent = 'The registry could not complete the search: ' + data.errors.join(' · ');
                } else {
                    $('scanStatus').textContent = 'No new clinics found for that state and specialty; everything '
                        + 'matched leads you already have. Try another state or specialty.';
                }
            })
            .catch(function (e) {
                scanning = false;
                $('scanRun').disabled = false;
                $('scanStatus').textContent = '';
                err.textContent = (e && e.message) ? e.message : 'The scan could not reach the registry. Try again.';
                err.hidden = false;
            });
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

    /* ══ PDF EXPORT ═══════════════════════════════════════════════════════
     * Builds a print-only sheet of the current (filtered, sorted) leads and
     * opens the browser print dialog so the rep can "Save as PDF". The CSP
     * forbids inline styles and external PDF libraries, so all styling lives in
     * crm.css (@media print) and print-to-PDF is the compliant path. */
    function filterSummary(f) {
        var parts = [];
        parts.push(f.states.length ? f.states.join(', ') : 'All states');
        parts.push(f.allTypes || !f.category ? 'All clinic types' : cap(f.category.replace(/_/g, ' ')));
        if (f.stage) parts.push(stageLabel(f.stage));
        if (f.source) parts.push('Source: ' + f.source);
        if (f.offersRegen) parts.push('Regenerative therapies');
        if (f.switchWindow) parts.push('Switch window');
        if (f.hotOnly) parts.push('Hot only');
        if (f.q) parts.push('“' + f.q + '”');
        return parts.join(' · ');
    }

    function printTd(text) {
        var c = document.createElement('td');
        c.textContent = String(text == null ? '' : text);
        return c;
    }

    function exportPdf() {
        var f = currentFilters();
        var list = sortLeads(LEADS.filter(function (l) { return matches(l, f); }), f.sort);
        var area = $('crmPrintArea');
        area.textContent = '';

        var head = document.createElement('div');
        head.className = 'crm-print-head';
        var h1 = document.createElement('h1');
        h1.className = 'crm-print-title';
        var mark = document.createElement('span'); mark.textContent = 'NOVA';
        h1.appendChild(document.createTextNode('Cellu'));
        h1.appendChild(mark);
        h1.appendChild(document.createTextNode(' — Lead List'));
        var meta = document.createElement('div');
        meta.className = 'crm-print-meta';
        meta.textContent = list.length + (list.length === 1 ? ' lead' : ' leads') + '  ·  '
            + filterSummary(f) + '  ·  Generated ' + new Date().toLocaleDateString();
        head.append(h1, meta);
        area.appendChild(head);

        if (!list.length) {
            var empty = document.createElement('p');
            empty.className = 'crm-print-empty';
            empty.textContent = 'No leads match the current filters.';
            area.appendChild(empty);
        } else {
            var table = document.createElement('table');
            table.className = 'crm-print-table';
            var thead = document.createElement('thead');
            var hr = document.createElement('tr');
            ['#', 'Practice', 'Specialty', 'Location', 'Phone', 'Email', 'Priority'].forEach(function (t) {
                var th = document.createElement('th'); th.textContent = t; hr.appendChild(th);
            });
            thead.appendChild(hr);
            table.appendChild(thead);

            var tbody = document.createElement('tbody');
            list.forEach(function (l, i) {
                var pr = priority(l);
                var tr = document.createElement('tr');
                tr.appendChild(printTd(String(i + 1)));

                var nameTd = document.createElement('td');
                var nm = document.createElement('div'); nm.className = 'crm-print-name'; nm.textContent = l.name;
                nameTd.appendChild(nm);
                var bits = [];
                if (l.doctor_name && l.doctor_name !== l.name) bits.push(l.doctor_name);
                if (l.npi) bits.push('NPI ' + l.npi);
                if (l.regen_specialty) bits.push('Runs regen');
                if (l.decision_maker_is_owner) bits.push('Owner');
                if (bits.length) {
                    var sub = document.createElement('div'); sub.className = 'crm-print-sub'; sub.textContent = bits.join(' · ');
                    nameTd.appendChild(sub);
                }
                tr.appendChild(nameTd);

                tr.appendChild(printTd(l.category ? cap(String(l.category).replace(/_/g, ' ')) : ''));
                tr.appendChild(printTd([l.city, l.state].filter(Boolean).join(', ')));
                tr.appendChild(printTd(l.phone || ''));
                tr.appendChild(printTd(l.email || ''));

                var pTd = document.createElement('td');
                var pspan = document.createElement('span');
                pspan.className = 'crm-print-band ' + pr.band;
                pspan.textContent = pr.band.toUpperCase() + ' ' + pr.score;
                pTd.appendChild(pspan);
                tr.appendChild(pTd);

                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            area.appendChild(table);
        }

        // The @media print rules only apply while printing, so leaving the class
        // on has no on-screen effect; still, clean it up after the dialog closes.
        function done() { document.body.classList.remove('crm-printing'); window.removeEventListener('afterprint', done); }
        window.addEventListener('afterprint', done);
        document.body.classList.add('crm-printing');
        window.print();
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
            case 'import-leads': $('crmImportFile').click(); break;
            case 'export-pdf':  exportPdf(); break;
            case 'open-scan':  openScan(); break;
            case 'close-scan': closeScan(); break;
            case 'run-scan':   runScan(); break;
            case 'clear-local':
                cModal.confirm('Clear saved leads',
                    'Remove the lead list saved on this device and go back to the placeholders?',
                    function (ok) {
                        if (!ok) return;
                        clearLocalLeads();
                        applyLeads(PLACEHOLDER_LEADS, 'placeholder', '');
                    });
                break;
            case 'save-note':
                cModal.alert('Not wired', 'In production this posts the note to the CRM endpoint. '
                    + 'This static build does not send anything.');
                break;
            case 'build-queue': buildQueue(); break;
            case 'run-intel':      runTool('Scanning website & ads, regen mentions, services, ad presence…', 'website/ads intelligence'); break;
            case 'tool-reviews':   runTool('Pulling reviews & rating, volume, recency, sentiment…', 'reviews / reputation'); break;
            case 'tool-supplier':  runTool('Checking supplier risk, recalls, backorders, FDA warnings for the current supplier…', 'supplier-risk'); break;
            case 'tool-lookalike': runTool('Finding look-alikes, clinics similar to your best customers in this territory…', 'look-alike'); break;
            case 'tool-outreach': {
                var lead = LEADS.filter(function (l) { return l.id === activeId; })[0];
                var st = $('crmIntelStatus');
                if (st) st.textContent = 'Drafting outreach from this lead’s signals…';
                setTimeout(function () { if (st) st.textContent = ''; openOutreach(lead); }, 500);
                break;
            }
            case 'close-outreach': closeOutreach(); break;
            case 'copy-outreach':  copyOutreach(); break;
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
     'crmSort', 'crmOffersRegen', 'crmSwitchWindow', 'crmHotOnly'].forEach(function (id) {
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

    outreachModal.addEventListener('click', function (e) { if (e.target === outreachModal) closeOutreach(); });

    scanModal.addEventListener('click', function (e) { if (e.target === scanModal) closeScan(); });

    // "All clinics" toggles every specialty; unchecking one clears the master.
    scanModal.addEventListener('change', function (e) {
        if (e.target.id === 'scanAllCats') {
            var on = e.target.checked;
            scanCatEls().forEach(function (c) { c.checked = on; });
        } else if (e.target.classList && e.target.classList.contains('scan-cat')) {
            syncScanAllCats();
        }
    });

    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (cModal.isOpen()) { cModal.close(); return; }
        if (!scanModal.hidden) { closeScan(); return; }
        if (!outreachModal.hidden) { closeOutreach(); return; }
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

    $('crmImportFile').addEventListener('change', function () {
        if (this.files && this.files[0]) importLeadFile(this.files[0]);
        this.value = '';
    });

    /* Restore a lead list saved on this device (from a previous offline
     * Import) so there is something to work with before the server answers. */
    var saved = readLocalLeads();
    if (saved) {
        LEADS = saved.leads;
        LEAD_SOURCE = { kind: 'import', label: 'Restored ' + saved.leads.length
            + (saved.leads.length === 1 ? ' lead' : ' leads') + ' saved on this device.' };
    }

    /* The server is the source of truth. When it answers, its list is shown
     * even if empty: on the live portal the placeholders never appear. A list
     * saved on this device from an earlier offline import is auto-uploaded.
     * Only when the server is unreachable (the static demo build, offline)
     * do the placeholders or the device-local list remain. */
    var leadsUrl = CONFIG.leadsUrl || '/portal/api/leads';
    try {
        fetch(leadsUrl, { credentials: 'same-origin' })
            .then(function (res) { if (!res.ok) throw new Error('bad status'); return res.json(); })
            .then(function (data) {
                var list = normalizeLeads(Array.isArray(data) ? data : (data && data.leads) || []);
                if (!list.length && saved && saved.leads.length) {
                    uploadLeads(saved.leads, 'this device');
                    return;
                }
                applyLeads(list, 'server', '');
            })
            .catch(function () { /* server unreachable: keep what we have */ });
    } catch (e) { /* server unreachable: keep what we have */ }

    renderList();
    showTab('leads');
})();
