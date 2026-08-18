/* ─────────────────────────────────────────────────────────────────────────
 * Marketing Resources — live AI market scans.
 *
 * The server is the source of truth: reports come from
 * GET /portal/api/marketing/reports, and "Run AI market scan" POSTs to
 * /portal/api/marketing/generate, which pulls real provider data for the
 * area from the CMS NPI registry and has the AI analyze it. All values
 * render through textContent; competitor links go through safeUrl so a
 * hostile value renders inert.
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

    var REPORTS = [];
    var listEl = $('reportList'), detailEl = $('reportDetail'), activeId = null;

    function reportTitle(r) {
        if (r.area && r.area.city) return r.area.city + ', ' + (r.area.state || '');
        return 'Market Analysis';
    }

    function renderList() {
        listEl.textContent = '';
        if (!REPORTS.length) {
            var empty = document.createElement('p');
            empty.className = 'crm-empty';
            empty.textContent = 'No scans yet — run your first AI market scan above.';
            listEl.appendChild(empty);
            return;
        }
        REPORTS.forEach(function (r) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'mk-list-item' + (r.id === activeId ? ' active' : '');
            btn.dataset.action = 'open'; btn.dataset.id = String(r.id);
            var left = document.createElement('div');
            var t = document.createElement('div'); t.className = 'mk-list-title'; t.textContent = reportTitle(r);
            var d = document.createElement('div'); d.className = 'mk-list-date'; d.textContent = fmt(r.completed_at || r.created_at);
            left.append(t, d);
            var st = document.createElement('span'); st.className = 'mk-status ' + (r.status || 'completed'); st.textContent = r.status || 'completed';
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
        if (r.status && r.status !== 'completed') {
            var p = document.createElement('p'); p.className = 'crm-empty';
            p.textContent = 'Report ' + r.status + ' — not ready yet.';
            detailEl.appendChild(p); return;
        }
        if (r.provider_count) {
            var src = document.createElement('div'); src.className = 'mk-card-sub';
            src.textContent = 'Based on ' + r.provider_count + ' providers pulled live from the CMS NPI registry for '
                + reportTitle(r) + (r.area && r.area.focus ? ' · focus: ' + r.area.focus : '');
            src.style.marginBottom = '10px';
            detailEl.appendChild(src);
        }
        if (r.summary) { var s = document.createElement('div'); s.className = 'mk-summary'; s.textContent = r.summary; detailEl.appendChild(s); }
        if (r.market_overview) { var mo = document.createElement('div'); mo.className = 'mk-section'; mo.appendChild(sectionH('Market overview')); var t = document.createElement('div'); t.textContent = r.market_overview; mo.appendChild(t); detailEl.appendChild(mo); }

        if (r.top_competitors && r.top_competitors.length) {
            var sec = document.createElement('div'); sec.className = 'mk-section'; sec.appendChild(sectionH('Top competitors & prospects'));
            r.top_competitors.forEach(function (c, i) {
                var card = document.createElement('div'); card.className = 'mk-card';
                var nm = document.createElement('div'); nm.className = 'mk-card-name'; nm.textContent = (i + 1) + '. ' + (c.name || '');
                card.appendChild(nm);
                if (c.address) { var ad = document.createElement('div'); ad.className = 'mk-card-sub'; ad.textContent = c.address; card.appendChild(ad); }
                if (c.why) { var w = document.createElement('div'); w.textContent = c.why; w.style.fontSize = '12px'; w.style.marginTop = '4px'; card.appendChild(w); }
                var meta = [];
                if (c.stem_cell_status) meta.push('Regen signals: ' + c.stem_cell_status);
                if (c.similarity) meta.push('Similarity: ' + c.similarity);
                if (c.phone) meta.push(c.phone);
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

    function selectReport(id) {
        activeId = id;
        var r = REPORTS.filter(function (x) { return x.id === activeId; })[0];
        renderList(); if (r) renderDetail(r);
    }

    function loadReports() {
        return fetch('/portal/api/marketing/reports', { credentials: 'same-origin' })
            .then(function (r) { if (!r.ok) throw new Error('bad status'); return r.json(); })
            .then(function (d) {
                REPORTS = d.reports || [];
                renderList();
                if (REPORTS.length && !activeId) selectReport(REPORTS[0].id);
            })
            .catch(function () {
                var p = document.createElement('p'); p.className = 'crm-empty';
                p.textContent = 'Could not load reports — refresh to retry.';
                listEl.textContent = ''; listEl.appendChild(p);
            });
    }

    /* ── Run a scan ── */
    var scanBtn = $('scanBtn'), scanStatus = $('scanStatus');
    scanBtn.addEventListener('click', function () {
        var city = $('scanCity').value.trim();
        var state = $('scanState').value.trim().toUpperCase();
        var focus = $('scanFocus').value.trim();
        if (!city || state.length !== 2) { scanStatus.textContent = 'Enter a city and two-letter state.'; return; }
        scanBtn.disabled = true;
        scanStatus.textContent = 'Scanning the NPI registry and running AI analysis — 15–30 seconds…';
        fetch('/portal/api/marketing/generate', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ city: city, state: state, focus: focus })
        }).then(function (r) {
            return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Scan failed'); return d; });
        }).then(function (d) {
            scanStatus.textContent = 'Done.';
            REPORTS.unshift(d.report);
            selectReport(d.report.id);
        }).catch(function (e) {
            scanStatus.textContent = e && e.message ? e.message : 'Scan failed — try again.';
        }).then(function () { scanBtn.disabled = false; });
    });

    document.addEventListener('click', function (e) {
        var el = e.target.closest('[data-action="open"]');
        if (!el) return;
        selectReport(el.dataset.id);
    });
    var st = $('sidebarToggle');
    st.addEventListener('click', function () { var sb = document.querySelector('.portal-sidebar'); st.setAttribute('aria-expanded', sb.classList.toggle('open') ? 'true' : 'false'); });

    loadReports();
})();
