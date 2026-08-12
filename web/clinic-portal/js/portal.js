/* ─────────────────────────────────────────────────────────────────────────
 * Clinic Portal — Protocols & Treatments
 *
 * Category cards (matching the live "Clinical Protocol Library") plus an admin
 * document manager: attach HTML or PDF files to each category. All behaviour is
 * here rather than in inline handlers, so the page keeps its strict CSP.
 *
 * Security posture:
 *   - Admin mode is a DISPLAY flag only. It changes which controls are visible;
 *     the server is the authority on who may add/remove documents (§3).
 *   - Uploaded HTML renders in an iframe with an EMPTY sandbox — no scripts, no
 *     same-origin — so a protocol file can display but never run code or reach
 *     the portal. PDFs render via the browser's native viewer. External links
 *     are scheme-checked (safeUrl) and opened in a new tab, never embedded.
 *   - No Action Recorder / keystroke logging (§4); no un-pinned CDN tags (§9).
 * ───────────────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    var CONFIG = window.PORTAL_CONFIG || {
        clinicId: null,
        isAdmin: false,     // display hint; server enforces. Toggled in-page for the demo.
        viewingAs: null,
        demo: false
    };

    var $ = function (id) { return document.getElementById(id); };

    /* ══ SAFE HELPERS ═════════════════════════════════════════════════════ */
    function esc(s) {
        var d = document.createElement('div');
        d.textContent = String(s == null ? '' : s);
        return d.innerHTML;
    }
    function safeUrl(raw) {
        var v = String(raw == null ? '' : raw).trim();
        try {
            var u = new URL(v, window.location.origin);
            return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '#';
        } catch (e) { return '#'; }
    }

    /* ══ CATEGORIES ═══════════════════════════════════════════════════════
     * Copy matches the live library; `seed` is how many placeholder documents
     * each category starts with so the "N PROTOCOLS" counts read like the real
     * page. Admin-added files change the counts live. */
    var ICONS = {
        ia:   '<path d="M12 3s6 6.5 6 10.5a6 6 0 11-12 0C6 9.5 12 3 12 3z"/>',
        im:   '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
        iv:   '<path d="M12 2v6"/><circle cx="12" cy="15" r="6"/><path d="M12 12v6"/>',
        other:'<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 00-4 12c1 1 1 2 1 3h6c0-1 0-2 1-3a7 7 0 00-4-12z"/>',
        pre:  '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 13l2 2 4-4"/>',
        ref:  '<path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z"/><path d="M4 19a2 2 0 012-2h13"/>'
    };
    var CATEGORIES = [
        { key: 'ia',    label: 'Intra-Articular',      seed: 4,
          desc: 'Biologics delivered directly into the joint cavity to reduce inflammation and support tissue repair.' },
        { key: 'im',    label: 'Intra-Muscular (IM)',  seed: 4,
          desc: 'Targets muscle tissue with stem cells or exosomes for systemic and localized conditions.' },
        { key: 'iv',    label: 'Intravenous (IV)',     seed: 13,
          desc: 'Systemic delivery for conditions involving widespread inflammation or complex multi-system presentations.' },
        { key: 'other', label: 'Other / Specialized',  seed: 5,
          desc: 'Subcutaneous, intradermal, topical, and intranasal methods for specialized clinical applications.' },
        { key: 'pre',   label: 'Patient Pre-Treatment', seed: 3,
          desc: 'Screening, consent, and treatment-planning documents to prepare a patient for care.' },
        { key: 'ref',   label: 'Reference & Operations', seed: 0,
          desc: 'Storage, dosing, documentation, and safety references for administering biologics.' }
    ];
    var CAT_CLASS = { ia: 'cat-ia', im: 'cat-im', iv: 'cat-iv', other: 'cat-other', pre: 'cat-pre', ref: 'cat-ref' };

    /* ══ DOCUMENT STORE ═══════════════════════════════════════════════════
     * kind: 'seed' (placeholder, HTML generated on view) | 'file' (uploaded,
     * blob URL) | 'link' (external URL, opened in a new tab). type: html|pdf|link. */
    /* Real physician protocols from Dr. Hadley's Protocol Library, hosted under
     * /portal/protocols/library/ as self-contained HTML pages (with chart-note
     * templates) or official PDFs. Each opens in the sandboxed viewer. Sorted
     * into the category that matches its administration route. */
    var LIBRARY = [
        { cat: 'ia',    slug: 'knee',                         title: 'Knee — intra-articular — chart notes' },
        { cat: 'ia',    slug: 'knee-protocol', type: 'pdf',   title: 'Intra-articular knee (official PDF)' },
        { cat: 'ia',    slug: 'hip',                          title: 'Hip — IA + IM — chart notes' },
        { cat: 'ia',    slug: 'hip-protocol', type: 'pdf',    title: 'Hip — IA + IM (official PDF)' },
        { cat: 'ia',    slug: 'shoulder',                     title: 'Shoulder — IA / peritendinous — chart notes' },
        { cat: 'ia',    slug: 'shoulder-ultrasound-ia', type: 'pdf', title: 'Shoulder — ultrasound-guided IA (official PDF)' },
        { cat: 'im',    slug: 'shoulder-im', type: 'pdf',     title: 'Shoulder — IM (official PDF)' },
        { cat: 'im',    slug: 'cervical-spine',               title: 'Cervical spine (neck) — chart notes' },
        { cat: 'im',    slug: 'cervical-neck-im', type: 'pdf', title: 'Neck pain — cervical spine (official PDF)' },
        { cat: 'im',    slug: 'injury-recovery', type: 'pdf', title: 'Injury recovery — return to work (official PDF)' },
        { cat: 'im',    slug: 'spina-bifida',                 title: 'Spina bifida — IM support — chart notes' },
        { cat: 'im',    slug: 'spina-bifida-support', type: 'pdf', title: 'Spina bifida support (official PDF)' },
        { cat: 'im',    slug: 'rheumatoid-arthritis',         title: 'Rheumatoid arthritis (RA)' },
        { cat: 'im',    slug: 'ankylosing-spondylitis',       title: 'Ankylosing spondylitis' },
        { cat: 'im',    slug: 'psoriatic-arthritis',          title: 'Psoriatic arthritis' },
        { cat: 'im',    slug: 'ibd-associated-arthritis',     title: 'IBD-associated arthritis' },
        { cat: 'iv',    slug: 'general-wellness-longevity',   title: 'General wellness & longevity' },
        { cat: 'other', slug: 'dementia',                     title: 'Cognitive — dementia & MCI — chart notes' },
        { cat: 'other', slug: 'cognitive-dementia-support', type: 'pdf', title: 'Cognitive decline & dementia support (official PDF)' },
        { cat: 'other', slug: 'hair-mesotherapy',             title: 'Hair & scalp mesotherapy — chart notes' },
        { cat: 'other', slug: 'hair-mesotherapy', type: 'pdf', title: 'Hair & mesotherapy (official PDF)' },
        { cat: 'other', slug: 'neuro-intranasal',             title: 'Neuro — intranasal — chart notes' },
        { cat: 'other', slug: 'intranasal-tbi-cognitive', type: 'pdf', title: 'Intranasal neural — TBI & cognitive (official PDF)' },
        { cat: 'pre',   slug: 'patient-screening',            title: 'Patient screening' },
        { cat: 'pre',   slug: 'informed-consent',             title: 'Informed consent' },
        { cat: 'pre',   slug: 'treatment-planning-worksheet', title: 'Treatment planning worksheet' },
        { cat: 'ref',   slug: 'storage-cold-chain',           title: 'Storage & cold chain' },
        { cat: 'ref',   slug: 'thaw-reconstitution',          title: 'Thaw & reconstitution' },
        { cat: 'ref',   slug: 'dosing-quick-reference',       title: 'Dosing quick reference' },
        { cat: 'ref',   slug: 'adverse-event-response',       title: 'Adverse-event response' },
        { cat: 'ref',   slug: 'chain-of-custody',             title: 'Chain of custody' },
        { cat: 'ref',   slug: 'reading-a-coa',                title: 'Reading a COA' }
    ];
    var DOCS = [];
    var docId = 0;
    LIBRARY.forEach(function (d) {
        var type = d.type || 'html';
        DOCS.push({ id: ++docId, cat: d.cat, kind: 'asset', type: type,
                    title: d.title, url: '/portal/protocols/library/' + d.slug + '.' + type });
    });

    function catOf(key) { return CATEGORIES.filter(function (c) { return c.key === key; })[0]; }
    function docsIn(key) { return DOCS.filter(function (d) { return d.cat === key; }); }

    /* ══ CATEGORY CARDS ═══════════════════════════════════════════════════ */
    var catsEl = $('protoCats');
    var activeCat = null;

    function renderCats() {
        catsEl.textContent = '';
        CATEGORIES.forEach(function (c) {
            var n = docsIn(c.key).length;
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'proto-cat ' + CAT_CLASS[c.key] + (c.key === activeCat ? ' active' : '');
            btn.dataset.action = 'open-cat';
            btn.dataset.cat = c.key;

            var strip = document.createElement('div'); strip.className = 'proto-cat-strip';
            var body = document.createElement('div'); body.className = 'proto-cat-body';

            var icon = document.createElement('div'); icon.className = 'proto-cat-icon';
            icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[c.key] + '</svg>';

            var label = document.createElement('div'); label.className = 'proto-cat-label'; label.textContent = c.label;
            var desc = document.createElement('div'); desc.className = 'proto-cat-desc'; desc.textContent = c.desc;
            var count = document.createElement('span'); count.className = 'proto-cat-count';
            count.textContent = n + (n === 1 ? ' protocol' : ' protocols');

            body.append(icon, label, desc, count);
            btn.append(strip, body);
            catsEl.appendChild(btn);
        });
    }

    /* ══ CATEGORY DOCUMENTS PANEL ═════════════════════════════════════════ */
    var panel = $('protoCatPanel'), listEl = $('docList'), addForm = $('docAddForm');

    function openCategory(key) {
        activeCat = key;
        var c = catOf(key);
        if (!c) return;
        $('docCatEyebrow').textContent = 'Category';
        $('docCatTitle').textContent = c.label;
        $('docCatDesc').textContent = c.desc;
        addForm.hidden = !CONFIG.isAdmin;
        panel.hidden = false;
        renderCats();
        renderDocs();
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function closeCategory() {
        activeCat = null;
        panel.hidden = true;
        renderCats();
    }

    function renderDocs() {
        listEl.textContent = '';
        var docs = docsIn(activeCat);
        if (!docs.length) {
            var empty = document.createElement('li');
            empty.className = 'doc-empty';
            empty.textContent = CONFIG.isAdmin
                ? 'No documents yet — add an HTML or PDF file above.'
                : 'No documents in this category yet.';
            listEl.appendChild(empty);
            return;
        }
        docs.forEach(function (d) {
            var li = document.createElement('li');
            li.className = 'doc-row';

            var badgeType = d.type === 'pdf' ? 'pdf' : d.type === 'link' ? 'link' : 'html';
            var badge = document.createElement('span');
            badge.className = 'doc-badge ' + badgeType;
            badge.textContent = badgeType === 'link' ? 'LINK' : badgeType.toUpperCase();

            var main = document.createElement('div'); main.className = 'doc-row-main';
            var title = document.createElement('div'); title.className = 'doc-row-title'; title.textContent = d.title;
            var sub = document.createElement('div'); sub.className = 'doc-row-sub';
            sub.textContent = d.kind === 'asset' ? 'CelluNOVA protocol library'
                           : d.kind === 'seed' ? 'Placeholder — replace with the real file'
                           : d.kind === 'link' ? 'External link' : 'Uploaded (preview only, not saved)';
            main.append(title, sub);

            var actions = document.createElement('div'); actions.className = 'doc-row-actions';
            var view = document.createElement('button');
            view.type = 'button'; view.className = 'btn sm'; view.dataset.action = 'view-doc'; view.dataset.id = String(d.id);
            view.textContent = d.type === 'link' ? 'Open' : 'View';
            actions.appendChild(view);
            if (CONFIG.isAdmin) {
                var rm = document.createElement('button');
                rm.type = 'button'; rm.className = 'doc-remove'; rm.dataset.action = 'remove-doc'; rm.dataset.id = String(d.id);
                rm.textContent = 'Remove';
                actions.appendChild(rm);
            }
            li.append(badge, main, actions);
            listEl.appendChild(li);
        });
    }

    /* ══ ADD / REMOVE (admin) ═════════════════════════════════════════════ */
    function showAddError(msg) {
        var e = $('docAddError');
        e.textContent = msg; e.hidden = false;
    }
    function clearAddError() { $('docAddError').hidden = true; }

    addForm.addEventListener('submit', function (e) {
        e.preventDefault();
        clearAddError();
        if (!CONFIG.isAdmin || !activeCat) return;
        var title = ($('docTitle').value || '').trim();
        var file = $('docFile').files && $('docFile').files[0];
        var url = ($('docUrl').value || '').trim();

        if (file) {
            var name = file.name.toLowerCase();
            var isPdf = file.type === 'application/pdf' || /\.pdf$/.test(name);
            var isHtml = file.type === 'text/html' || /\.html?$/.test(name);
            if (!isPdf && !isHtml) { showAddError('Please choose an HTML or PDF file.'); return; }
            DOCS.push({ id: ++docId, cat: activeCat, kind: 'file', type: isPdf ? 'pdf' : 'html',
                        title: title || file.name, _blobUrl: URL.createObjectURL(file) });
        } else if (url) {
            var safe = safeUrl(url);
            if (safe === '#') { showAddError('That link isn’t a valid http(s) URL.'); return; }
            DOCS.push({ id: ++docId, cat: activeCat, kind: 'link', type: 'link',
                        title: title || url, url: safe });
        } else {
            showAddError('Choose a file or paste a link first.'); return;
        }
        $('docTitle').value = ''; $('docFile').value = ''; $('docUrl').value = '';
        renderCats(); renderDocs();
    });

    function removeDoc(id) {
        var doc = DOCS.filter(function (d) { return d.id === id; })[0];
        if (!doc) return;
        cModal.confirm('Remove document', 'Remove “' + doc.title + '” from this category?', function (ok) {
            if (!ok) return;
            if (doc._blobUrl) { try { URL.revokeObjectURL(doc._blobUrl); } catch (e) {} }
            DOCS = DOCS.filter(function (d) { return d.id !== id; });
            renderCats(); renderDocs();
        });
    }

    /* ══ VIEWER ═══════════════════════════════════════════════════════════ */
    var viewer = $('docViewerModal'), viewerBody = $('docViewerBody'),
        viewerOpen = $('docViewerOpen'), viewerLastFocus = null;

    function seedHtml(doc) {
        var c = catOf(doc.cat) || { label: '' };
        return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
            + '<meta name="viewport" content="width=device-width,initial-scale=1">'
            + '<style>body{font:15px/1.65 system-ui,-apple-system,sans-serif;margin:36px;color:#0f172a;background:#fff;max-width:720px}'
            + 'h1{font-size:22px;margin:0 0 4px}.tag{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.08em;'
            + 'text-transform:uppercase;color:#0891b2;background:#ecfeff;padding:3px 10px;border-radius:999px;margin-bottom:16px}'
            + '.note{margin-top:20px;padding:14px 16px;border:1px dashed #cbd5e1;border-radius:10px;color:#475569;font-size:13.5px}</style>'
            + '<title>' + esc(doc.title) + '</title></head><body>'
            + '<div class="tag">' + esc(c.label) + '</div>'
            + '<h1>' + esc(doc.title) + '</h1>'
            + '<div class="note">Placeholder protocol document. Replace it by turning on <b>Admin mode</b> '
            + 'and uploading the real HTML or PDF for this category.</div></body></html>';
    }

    /* Render a resolved source URL in the sandboxed viewer frame. */
    function mountFrame(doc, url) {
        viewerBody.textContent = '';
        var frame = document.createElement('iframe');
        frame.className = 'doc-frame';
        frame.title = doc.title;
        // HTML gets a locked-down sandbox (no scripts, no same-origin). PDFs use
        // the native viewer (no sandbox needed; a PDF can't script the parent).
        if (doc.type === 'html') frame.setAttribute('sandbox', '');
        frame.src = url;
        viewerBody.appendChild(frame);
        // "Open in new tab" only for PDFs — an uploaded HTML must stay sandboxed.
        if (doc.type === 'pdf') { viewerOpen.hidden = false; viewerOpen.setAttribute('href', url); }
        else { viewerOpen.hidden = true; viewerOpen.removeAttribute('href'); }
    }

    function viewerMessage(text) {
        viewerBody.textContent = '';
        var p = document.createElement('p');
        p.className = 'doc-empty'; p.style.padding = '24px';
        p.textContent = text;
        viewerBody.appendChild(p);
    }

    function viewDoc(id) {
        var doc = DOCS.filter(function (d) { return d.id === id; })[0];
        if (!doc) return;

        // External links never embed — open in a new tab after a scheme check.
        if (doc.kind === 'link') { window.open(doc.url, '_blank', 'noopener,noreferrer'); return; }

        $('docViewerTitle').textContent = doc.title;
        $('docViewerSub').textContent = (doc.type === 'pdf' ? 'PDF' : 'HTML') + ' document';
        viewerLastFocus = document.activeElement;
        viewer.hidden = false;
        $('docViewerTitle').focus && $('docViewerTitle').focus();

        if (doc.kind === 'seed') {
            if (!doc._blobUrl) doc._blobUrl = URL.createObjectURL(new Blob([seedHtml(doc)], { type: 'text/html' }));
            mountFrame(doc, doc._blobUrl);
        } else if (doc.kind === 'asset') {
            // Fetch the hosted protocol (same-origin, credentialed) and render it as
            // a blob, so it displays in the sandboxed frame exactly like the other
            // document kinds — a sandboxed frame can't navigate to it directly.
            // PDFs are fetched as binary and shown in the native viewer.
            if (doc._blobUrl) { mountFrame(doc, doc._blobUrl); return; }
            viewerMessage('Loading protocol…');
            viewerOpen.hidden = true; viewerOpen.removeAttribute('href');
            fetch(doc.url, { credentials: 'same-origin' })
                .then(function (r) {
                    if (!r.ok) throw new Error('status ' + r.status);
                    return doc.type === 'pdf' ? r.blob() : r.text();
                })
                .then(function (data) {
                    var blob = doc.type === 'pdf'
                        ? new Blob([data], { type: 'application/pdf' })
                        : new Blob([data], { type: 'text/html' });
                    doc._blobUrl = URL.createObjectURL(blob);
                    if (!viewer.hidden) mountFrame(doc, doc._blobUrl);
                })
                .catch(function () { viewerMessage('Could not load this protocol. Please try again.'); });
        } else {
            mountFrame(doc, doc._blobUrl);
        }
    }
    function closeViewer() {
        viewer.hidden = true;
        viewerBody.textContent = '';   // detach the iframe
        if (viewerLastFocus && viewerLastFocus.focus) viewerLastFocus.focus();
    }

    /* ══ GENERIC MODAL ════════════════════════════════════════════════════ */
    var cModal = (function () {
        var overlay = $('cModalOverlay'), titleEl = $('cModalTitle'), bodyEl = $('cModalBody'),
            okBtn = $('cModalOk'), cancelBtn = $('cModalCancel'), cb = null, lastFocus = null;
        function close(r) { overlay.hidden = true; var f = cb; cb = null; if (lastFocus && lastFocus.focus) lastFocus.focus(); if (f) f(r); }
        function open(t, b, withCancel, fn) {
            lastFocus = document.activeElement;
            titleEl.textContent = t; bodyEl.textContent = b;
            cancelBtn.hidden = !withCancel; cb = fn || null; overlay.hidden = false; okBtn.focus();
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

    /* ══ ADMIN TOGGLE ═════════════════════════════════════════════════════ */
    var adminToggle = $('adminToggle');
    adminToggle.addEventListener('change', function () {
        CONFIG.isAdmin = this.checked;
        $('adminHint').textContent = CONFIG.isAdmin
            ? 'Admin mode — you can add or remove documents. (The server enforces this in production.)'
            : 'Clinic view — protocols are read-only.';
        addForm.hidden = !(CONFIG.isAdmin && !panel.hidden);
        if (!panel.hidden) renderDocs();
    });

    /* ══ TREATMENT SCHEDULER ══════════════════════════════════════════════ */
    var schedulerModal = $('treatmentSchedulerModal'), schedForm = $('treatmentForm');
    function populateProtocolSelect() {
        var sel = $('treatProtocol');
        if (!sel) return;
        CATEGORIES.forEach(function (c) {
            if (c.key === 'ref') return;   // references aren't a schedulable treatment route
            var o = document.createElement('option'); o.value = c.key; o.textContent = c.label; sel.appendChild(o);
        });
    }
    function setDateFloor() {
        var d = $('treatDate');
        if (!d) return;
        var now = new Date();
        var iso = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        d.min = iso;
    }
    function openScheduler() { schedulerModal.hidden = false; var f = $('treatDate'); if (f) f.focus(); }
    function closeScheduler() { schedulerModal.hidden = true; }
    if (schedForm) {
        schedForm.addEventListener('submit', function (e) {
            e.preventDefault();
            var err = $('treatError');
            var date = $('treatDate').value, proto = $('treatProtocol').value;
            if (!date || !proto) { err.textContent = 'Pick a date and a protocol.'; err.hidden = false; return; }
            err.hidden = true;
            closeScheduler();
            cModal.alert('Request submitted', 'Your treatment request was queued for physician review. This static build sends nothing.');
        });
    }

    /* ══ EVENTS ═══════════════════════════════════════════════════════════ */
    document.addEventListener('click', function (e) {
        var el = e.target.closest('[data-action]');
        if (!el) return;
        switch (el.dataset.action) {
            case 'open-cat':      openCategory(el.dataset.cat); break;
            case 'close-cat':     closeCategory(); break;
            case 'view-doc':      viewDoc(Number(el.dataset.id)); break;
            case 'remove-doc':    removeDoc(Number(el.dataset.id)); break;
            case 'close-viewer':  closeViewer(); break;
            case 'open-scheduler': openScheduler(); break;
            case 'close-scheduler': closeScheduler(); break;
            case 'dismiss-order-bar': { var bar = $('orderBar'); if (bar) bar.hidden = true; break; }
            case 'open-demo':     break;   // demo controls stay inert
            case 'close-demo':    { var m = $('demoControlsModal'); if (m) m.hidden = true; break; }
        }
    });

    // Close the viewer / modals on the overlay backdrop click.
    viewer.addEventListener('click', function (e) { if (e.target === viewer) closeViewer(); });
    schedulerModal.addEventListener('click', function (e) { if (e.target === schedulerModal) closeScheduler(); });

    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (cModal.isOpen()) { cModal.close(); return; }
        if (!viewer.hidden) { closeViewer(); return; }
        if (!schedulerModal.hidden) { closeScheduler(); return; }
    });

    var sidebarToggle = $('sidebarToggle');
    if (sidebarToggle) sidebarToggle.addEventListener('click', function () {
        var sb = document.querySelector('.portal-sidebar');
        var open = sb.classList.toggle('open');
        sidebarToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    /* ══ INIT ═════════════════════════════════════════════════════════════ */
    if (CONFIG.viewingAs === 'clinic' && CONFIG.isAdmin) $('viewAsBanner').hidden = false;
    adminToggle.checked = !!CONFIG.isAdmin;
    populateProtocolSelect();
    setDateFloor();
    renderCats();
})();
