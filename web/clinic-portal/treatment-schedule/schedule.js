/* ─────────────────────────────────────────────────────────────────────────
 * Treatment Schedule.
 *
 * Form fields match the captured scheduler (date / protocol / patients / notes);
 * the upcoming list and page layout are a fresh design (the real DOM wasn't
 * captured). Submit is a stub — the real flow posts to the review endpoint. The
 * date floor is derived from the browser clock (not a baked, staleable value).
 * ───────────────────────────────────────────────────────────────────────── */
(function () {
    'use strict';
    var $ = function (id) { return document.getElementById(id); };

    /* Placeholder upcoming treatments. Replace with the server's list. */
    var UPCOMING = [
        { date: '2026-08-14', protocol: 'General Wellness & Anti-Aging', patients: 2, status: 'pending' },
        { date: '2026-08-21', protocol: 'Back Pain', patients: 1, status: 'confirmed' }
    ];
    var PROTO_LABEL = {
        'general-wellness': 'General Wellness & Anti-Aging', 'autism': 'Autism',
        'back-pain': 'Back Pain', 'copd': 'COPD Treatment'
    };

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

    function renderUpcoming() {
        var el = $('upcomingList'); el.textContent = '';
        if (!UPCOMING.length) { var e = document.createElement('div'); e.className = 'sched-empty'; e.textContent = 'Nothing scheduled yet.'; el.appendChild(e); return; }
        UPCOMING.forEach(function (u) {
            var d = new Date(u.date + 'T00:00:00');
            var row = document.createElement('div'); row.className = 'sched-item';
            var date = document.createElement('div'); date.className = 'sched-date';
            var dd = document.createElement('div'); dd.className = 'd'; dd.textContent = isNaN(d) ? '—' : String(d.getDate());
            var mm = document.createElement('div'); mm.className = 'm'; mm.textContent = isNaN(d) ? '' : d.toLocaleString('en-US', { month: 'short' });
            date.append(dd, mm);
            var body = document.createElement('div'); body.className = 'sched-body';
            var title = document.createElement('div'); title.className = 'sched-title'; title.textContent = u.protocol;
            var sub = document.createElement('div'); sub.className = 'sched-sub'; sub.textContent = u.patients + (u.patients === 1 ? ' patient' : ' patients');
            body.append(title, sub);
            var pill = document.createElement('span'); pill.className = 'sched-pill'; pill.textContent = u.status;
            if (u.status === 'confirmed') { pill.style.background = 'rgba(57,255,138,.12)'; pill.style.color = '#39ff8a'; }
            row.append(date, body, pill);
            el.appendChild(row);
        });
    }

    var form = $('schedForm'), err = $('schedError');
    // Date floor from the browser clock.
    var now = new Date();
    $('treatDate').min = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        var date = $('treatDate').value, proto = $('treatProtocol').value, patients = parseInt($('treatPatients').value || '1', 10);
        function fail(m) { err.textContent = m; err.hidden = false; }
        if (!date) return fail('Please select a treatment date.');
        if (!proto) return fail('Please select a protocol.');
        if (!(patients >= 1 && patients <= 50)) return fail('Enter a patient count between 1 and 50.');
        err.hidden = true;
        // Optimistic add to the placeholder upcoming list (client-only).
        UPCOMING.push({ date: date, protocol: PROTO_LABEL[proto] || proto, patients: patients, status: 'pending' });
        UPCOMING.sort(function (a, b) { return a.date.localeCompare(b.date); });
        renderUpcoming();
        form.reset(); $('treatPatients').value = '1';
        cModal.alert('Requested', 'Your treatment request was queued for physician review. In production this posts to the review endpoint; this static build sends nothing.');
    });

    var st = $('sidebarToggle');
    st.addEventListener('click', function () { var sb = document.querySelector('.portal-sidebar'); st.setAttribute('aria-expanded', sb.classList.toggle('open') ? 'true' : 'false'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && cModal.isOpen()) cModal.close(); });

    renderUpcoming();
})();
