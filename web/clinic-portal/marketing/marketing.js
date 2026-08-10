/* ─────────────────────────────────────────────────────────────────────────
 * Marketing Resources.
 *
 * The report-detail render mirrors portal.js's loadMarketingReport schema
 * (summary, market_overview, top_competitors, search_terms, adoption_pathways,
 * regulatory_note). Data is placeholder. Competitor website/maps URLs come from
 * a scrape on the real page — the §2 sink — so they go through safeUrl and a
 * hostile scheme renders inert, unlike the original's escHtml-in-href.
 * ───────────────────────────────────────────────────────────────────────── */
(function () {
    'use strict';
    var $ = function (id) { return document.getElementById(id); };

    function safeUrl(raw) {
        var v = String(raw == null ? '' : raw).trim();
        try { var u = new URL(v, window.location.origin); return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '#'; }
        catch (e) { return '#'; }
    }
    function fmt(ts) { if (!ts) return ''; var d = new Date(String(ts).replace(' ', 'T')); return isNaN(d.getTime()) ? String(ts) : d.toLocaleString(); }

    /* ══ PLACEHOLDER REPORTS ══════════════════════════════════════════════ */
    var REPORTS = [
        {
            id: 7, status: 'completed', created_at: '2026-08-08 09:00:00', completed_at: '2026-08-08 09:01:00',
            summary: 'Phoenix metro shows strong demand for regenerative offerings; two nearby clinics already market exosomes.',
            market_overview: 'Placeholder overview — the finalized report would summarize local demand, saturation, and positioning.',
            top_competitors: [
                { name: 'Nearby Regen Center', address: '123 Main St, Phoenix AZ', why: 'Markets exosomes + PRP', stem_cell_status: 'advertised', similarity: 'high', reviews: 212, website: 'https://nearby-regen.test', maps_url: 'https://maps.example.test/?q=nearby-regen' },
                // Hostile scraped value — must render inert (§2).
                { name: 'Shady Wellness', address: '9 Elm Ave, Tempe AZ', why: 'PRP only', stem_cell_status: 'unclear', similarity: 'medium', reviews: 40, website: 'javascript:alert(document.cookie)', maps_url: '' }
            ],
            search_terms: [
                { term: 'exosome therapy near me', why: 'High local intent', score_0_100: 88 },
                { term: 'stem cell knee injection phoenix', why: 'Ortho crossover', score_0_100: 72 }
            ],
            adoption_pathways: [
                { angle: 'Lead with physician-led sourcing', why_relevant: 'Differentiator vs. local med-spas' },
                { angle: 'Bundle with PRP upsell', why_relevant: 'Most competitors already run PRP' }
            ],
            regulatory_note: 'Placeholder — confirm state advertising rules for regenerative claims before campaigns.'
        },
        { id: 6, status: 'completed', created_at: '2026-07-15 10:00:00', completed_at: '2026-07-15 10:01:30', summary: 'Earlier scan — fewer competitors advertising exosomes.', market_overview: 'Placeholder.', top_competitors: [], search_terms: [], adoption_pathways: [], regulatory_note: '' },
        { id: 5, status: 'queued', created_at: '2026-08-09 12:00:00', completed_at: '', summary: '', market_overview: '', top_competitors: [], search_terms: [], adoption_pathways: [], regulatory_note: '' }
    ];

    var listEl = $('reportList'), detailEl = $('reportDetail'), activeId = null;

    function renderList() {
        listEl.textContent = '';
        REPORTS.forEach(function (r) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'mk-list-item' + (r.id === activeId ? ' active' : '');
            btn.dataset.action = 'open'; btn.dataset.id = String(r.id);
            var left = document.createElement('div');
            var t = document.createElement('div'); t.className = 'mk-list-title'; t.textContent = 'Market Analysis #' + r.id;
            var d = document.createElement('div'); d.className = 'mk-list-date'; d.textContent = fmt(r.completed_at || r.created_at);
            left.append(t, d);
            var st = document.createElement('span'); st.className = 'mk-status ' + r.status; st.textContent = r.status;
            btn.append(left, st);
            listEl.appendChild(btn);
        });
    }

    function sectionH(text) { var h = document.createElement('div'); h.className = 'mk-section-h'; h.textContent = text; return h; }
    function linkBtn(label, url, tint) {
        var a = document.createElement('a'); a.className = 'btn sm'; a.textContent = label;
        a.setAttribute('href', safeUrl(url)); a.setAttribute('rel', 'noopener noreferrer');
        if (safeUrl(url) !== '#') a.setAttribute('target', '_blank');
        if (tint) a.style.color = '#3d9fff';
        return a;
    }

    function renderDetail(r) {
        detailEl.textContent = '';
        if (r.status !== 'completed') {
            var p = document.createElement('p'); p.className = 'crm-empty';
            p.textContent = 'Report ' + r.status + ' — not ready yet.';
            detailEl.appendChild(p); return;
        }
        if (r.summary) { var s = document.createElement('div'); s.className = 'mk-summary'; s.textContent = r.summary; detailEl.appendChild(s); }
        if (r.market_overview) { var mo = document.createElement('div'); mo.className = 'mk-section'; mo.appendChild(sectionH('Market overview')); var t = document.createElement('div'); t.textContent = r.market_overview; mo.appendChild(t); detailEl.appendChild(mo); }

        if (r.top_competitors && r.top_competitors.length) {
            var sec = document.createElement('div'); sec.className = 'mk-section'; sec.appendChild(sectionH('Top competitors'));
            r.top_competitors.forEach(function (c, i) {
                var card = document.createElement('div'); card.className = 'mk-card';
                var nm = document.createElement('div'); nm.className = 'mk-card-name'; nm.textContent = (i + 1) + '. ' + (c.name || '');
                card.appendChild(nm);
                if (c.address) { var ad = document.createElement('div'); ad.className = 'mk-card-sub'; ad.textContent = c.address; card.appendChild(ad); }
                if (c.why) { var w = document.createElement('div'); w.textContent = c.why; w.style.fontSize = '12px'; w.style.marginTop = '4px'; card.appendChild(w); }
                var meta = [];
                if (c.stem_cell_status) meta.push('Stem cells: ' + c.stem_cell_status);
                if (c.similarity) meta.push('Similarity: ' + c.similarity);
                if (c.reviews) meta.push(c.reviews + ' reviews');
                if (meta.length) { var m = document.createElement('div'); m.className = 'mk-card-sub'; m.textContent = meta.join(' · '); card.appendChild(m); }
                var links = document.createElement('div'); links.className = 'mk-card-links';
                if (c.website) links.appendChild(linkBtn('Website', c.website, false));
                if (c.maps_url) links.appendChild(linkBtn('Maps', c.maps_url, true));
                if (links.children.length) card.appendChild(links);
                sec.appendChild(card);
            });
            detailEl.appendChild(sec);
        }

        if (r.search_terms && r.search_terms.length) {
            var st = document.createElement('div'); st.className = 'mk-section'; st.appendChild(sectionH('Likely patient search terms'));
            r.search_terms.forEach(function (t) {
                var pct = Math.max(0, Math.min(100, parseInt(t.score_0_100, 10) || 0));
                var row = document.createElement('div'); row.className = 'mk-term';
                var main = document.createElement('div'); main.className = 'mk-term-main';
                var term = document.createElement('div'); term.style.fontWeight = '600'; term.textContent = '“' + (t.term || '') + '”';
                main.appendChild(term);
                if (t.why) { var why = document.createElement('div'); why.className = 'mk-card-sub'; why.textContent = t.why; main.appendChild(why); }
                var bar = document.createElement('div'); bar.className = 'mk-term-bar'; var fill = document.createElement('div'); fill.style.width = pct + '%'; bar.appendChild(fill);
                var sc = document.createElement('div'); sc.className = 'mk-term-score'; sc.textContent = String(pct);
                row.append(main, bar, sc);
                st.appendChild(row);
            });
            detailEl.appendChild(st);
        }

        if (r.adoption_pathways && r.adoption_pathways.length) {
            var ap = document.createElement('div'); ap.className = 'mk-section'; ap.appendChild(sectionH('Adoption pathways'));
            r.adoption_pathways.forEach(function (a) {
                var card = document.createElement('div'); card.className = 'mk-card';
                var ang = document.createElement('div'); ang.className = 'mk-card-name'; ang.textContent = a.angle || '';
                var wr = document.createElement('div'); wr.className = 'mk-card-sub'; wr.textContent = a.why_relevant || '';
                card.append(ang, wr); ap.appendChild(card);
            });
            detailEl.appendChild(ap);
        }

        if (r.regulatory_note) {
            var reg = document.createElement('div'); reg.className = 'mk-reg';
            var b = document.createElement('strong'); b.textContent = 'Regulatory: ';
            reg.appendChild(b); reg.appendChild(document.createTextNode(r.regulatory_note));
            detailEl.appendChild(reg);
        }
    }

    document.addEventListener('click', function (e) {
        var el = e.target.closest('[data-action="open"]');
        if (!el) return;
        activeId = Number(el.dataset.id);
        var r = REPORTS.filter(function (x) { return x.id === activeId; })[0];
        renderList(); if (r) renderDetail(r);
    });
    var st = $('sidebarToggle');
    st.addEventListener('click', function () { var sb = document.querySelector('.portal-sidebar'); st.setAttribute('aria-expanded', sb.classList.toggle('open') ? 'true' : 'false'); });

    renderList();
})();
