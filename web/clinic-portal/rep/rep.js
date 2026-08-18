/* Rep workspace: assigned leads with notes, follow-ups, and reminders.
 *
 * Server is the source of truth (/portal/api/rep/leads). All values render
 * through textContent — never string-concatenated into HTML. Reps see their
 * own assignments; the admin sees every lead plus an assign dropdown; a
 * manager sees everything read-only. */
(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };
    var state = { role: 'rep', user: '', leads: [], reps: [] };

    /* ── helpers ── */
    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    }
    function todayStr() {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function dueBucket(due) {
        var day = String(due).slice(0, 10);
        var t = todayStr();
        if (day < t) return 'overdue';
        if (day === t) return 'today';
        return 'later';
    }
    function fmtDue(due) {
        var d = new Date(String(due).length === 10 ? due + 'T12:00' : due);
        if (isNaN(d.getTime())) return String(due);
        var opts = { month: 'short', day: 'numeric' };
        if (String(due).length > 10) { opts.hour = 'numeric'; opts.minute = '2-digit'; }
        return d.toLocaleString('en-US', opts);
    }
    function api(path, body) {
        return fetch(path, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
        }).then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Request failed'); return d; }); });
    }
    var readOnly = function () { return state.role === 'manager'; };

    /* ── reminders strip ── */
    function renderReminders() {
        var pills = $('reminderPills');
        pills.textContent = '';
        var overdue = 0, today = 0;
        state.leads.forEach(function (l) {
            (l.followups || []).forEach(function (f) {
                if (f.done) return;
                var b = dueBucket(f.due);
                if (b === 'overdue') overdue++;
                if (b === 'today') today++;
            });
        });
        var box = $('reminders');
        if (!overdue && !today) { box.hidden = true; return; }
        box.hidden = false;
        if (overdue) pills.appendChild(el('span', 'rep-pill overdue', overdue + ' overdue'));
        if (today) { pills.appendChild(document.createTextNode(' ')); pills.appendChild(el('span', 'rep-pill today', today + ' due today')); }
    }

    /* ── lead cards ── */
    function leadFlag(l) {
        var worst = '';
        (l.followups || []).forEach(function (f) {
            if (f.done) return;
            var b = dueBucket(f.due);
            if (b === 'overdue') worst = 'overdue';
            else if (b === 'today' && worst !== 'overdue') worst = 'today';
        });
        return worst;
    }

    function renderNotes(l, wrap) {
        wrap.textContent = '';
        (l.rep_notes || []).slice(-30).forEach(function (n) {
            var box = el('div', 'rep-note', n.text);
            var when = new Date(n.at);
            box.appendChild(el('div', 'rep-note-meta',
                (n.by || '') + ' · ' + (isNaN(when.getTime()) ? '' : when.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))));
            wrap.appendChild(box);
        });
        if (!(l.rep_notes || []).length) wrap.appendChild(el('div', 'rep-card-sub', 'No notes yet.'));
    }

    function renderFollowups(l, wrap) {
        wrap.textContent = '';
        var fus = (l.followups || []).slice();
        if (!fus.length) { wrap.appendChild(el('div', 'rep-card-sub', 'Nothing scheduled.')); return; }
        fus.forEach(function (f) {
            var row = el('div', 'rep-fu' + (f.done ? ' done' : '') + (!f.done ? ' ' + dueBucket(f.due) : ''));
            var cb = document.createElement('input');
            cb.type = 'checkbox'; cb.checked = !!f.done; cb.disabled = readOnly();
            cb.addEventListener('change', function () {
                api('/portal/api/rep/followup-done', { id: l.id, fid: f.fid, done: cb.checked })
                    .then(function (d) { l.followups = d.followups; refresh(); })
                    .catch(function (e) { alert(e.message); cb.checked = !cb.checked; });
            });
            row.appendChild(cb);
            row.appendChild(el('span', 'rep-fu-due', fmtDue(f.due)));
            row.appendChild(el('span', 'rep-fu-kind', f.kind || ''));
            if (f.note) row.appendChild(el('span', 'rep-fu-note', f.note));
            wrap.appendChild(row);
        });
    }

    function buildCard(l) {
        var card = el('article', 'rep-card');

        var head = el('div', 'rep-card-head');
        head.appendChild(el('span', 'rep-card-name', l.name || l.practice_name || 'Unnamed lead'));
        var locBits = [l.city, l.state].filter(Boolean).join(', ');
        if (locBits) head.appendChild(el('span', 'rep-card-sub', locBits));
        if (l.specialty) head.appendChild(el('span', 'rep-card-sub', String(l.specialty)));
        var flag = leadFlag(l);
        if (flag) head.appendChild(el('span', 'rep-card-flag ' + flag, flag === 'overdue' ? 'Overdue follow-up' : 'Follow up today'));
        card.appendChild(head);

        var contact = el('div', 'rep-card-contact');
        if (l.doctor_name || l.owner_name) contact.appendChild(el('span', '', String(l.doctor_name || l.owner_name)));
        if (l.phone) {
            var tel = el('a', '', String(l.phone));
            tel.href = 'tel:' + String(l.phone).replace(/[^+\d]/g, '');
            contact.appendChild(tel);
        }
        if (l.email) {
            var mail = el('a', '', String(l.email));
            mail.href = 'mailto:' + String(l.email);
            contact.appendChild(mail);
        }
        card.appendChild(contact);

        // Admin: assignment control. Manager: static label.
        if (state.role === 'admin' || state.role === 'manager') {
            var assign = el('div', 'rep-assign');
            assign.appendChild(el('span', '', 'Assigned to:'));
            if (state.role === 'admin') {
                var sel = document.createElement('select');
                var optNone = document.createElement('option');
                optNone.value = ''; optNone.textContent = '— unassigned —';
                sel.appendChild(optNone);
                (state.reps || []).forEach(function (r) {
                    var o = document.createElement('option');
                    o.value = r; o.textContent = r;
                    if ((l.assigned_rep || '') === r) o.selected = true;
                    sel.appendChild(o);
                });
                sel.addEventListener('change', function () {
                    api('/portal/api/rep/assign', { id: l.id, rep: sel.value })
                        .then(function () { l.assigned_rep = sel.value; })
                        .catch(function (e) { alert(e.message); });
                });
                assign.appendChild(sel);
            } else {
                assign.appendChild(el('strong', '', l.assigned_rep || 'unassigned'));
            }
            card.appendChild(assign);
        }

        var body = el('div', 'rep-card-body');

        var notesCol = el('div');
        notesCol.appendChild(el('h3', 'rep-sec-title', 'Account Notes'));
        var notesWrap = el('div', 'rep-notes');
        renderNotes(l, notesWrap);
        notesCol.appendChild(notesWrap);
        if (!readOnly()) {
            var noteForm = el('div', 'rep-form');
            var ta = document.createElement('textarea');
            ta.placeholder = 'Log a call, meeting, or detail about this account…';
            ta.maxLength = 2000;
            noteForm.appendChild(ta);
            var addBtn = el('button', 'rep-btn', 'Add note');
            addBtn.type = 'button';
            addBtn.addEventListener('click', function () {
                var text = ta.value.trim();
                if (!text) return;
                addBtn.disabled = true;
                api('/portal/api/rep/note', { id: l.id, text: text })
                    .then(function (d) { l.rep_notes = d.rep_notes; ta.value = ''; renderNotes(l, notesWrap); })
                    .catch(function (e) { alert(e.message); })
                    .then(function () { addBtn.disabled = false; });
            });
            noteForm.appendChild(addBtn);
            notesCol.appendChild(noteForm);
        }
        body.appendChild(notesCol);

        var fuCol = el('div');
        fuCol.appendChild(el('h3', 'rep-sec-title', 'Follow-ups & Reminders'));
        var fuWrap = el('div', 'rep-fus');
        renderFollowups(l, fuWrap);
        fuCol.appendChild(fuWrap);
        if (!readOnly()) {
            var fuForm = el('div', 'rep-form');
            var date = document.createElement('input');
            date.type = 'date'; date.min = todayStr();
            var kind = document.createElement('select');
            ['call', 'email', 'visit', 'other'].forEach(function (k) {
                var o = document.createElement('option'); o.value = k; o.textContent = k; kind.appendChild(o);
            });
            var note = document.createElement('input');
            note.type = 'text'; note.placeholder = 'What for? (optional)'; note.maxLength = 500;
            var schedBtn = el('button', 'rep-btn', 'Schedule');
            schedBtn.type = 'button';
            schedBtn.addEventListener('click', function () {
                if (!date.value) { alert('Pick a date first.'); return; }
                schedBtn.disabled = true;
                api('/portal/api/rep/followup', { id: l.id, due: date.value, kind: kind.value, note: note.value.trim() })
                    .then(function (d) { l.followups = d.followups; date.value = ''; note.value = ''; refresh(); })
                    .catch(function (e) { alert(e.message); })
                    .then(function () { schedBtn.disabled = false; });
            });
            fuForm.appendChild(date); fuForm.appendChild(kind); fuForm.appendChild(note); fuForm.appendChild(schedBtn);
            fuCol.appendChild(fuForm);
        }
        body.appendChild(fuCol);

        card.appendChild(body);
        return card;
    }

    function refresh() {
        renderReminders();
        var list = $('leadList');
        list.textContent = '';
        if (!state.leads.length) {
            list.appendChild(el('div', 'rep-empty', state.role === 'rep'
                ? 'No leads assigned to you yet — check back after your manager assigns accounts.'
                : 'No leads in the CRM yet.'));
            return;
        }
        // Overdue first, then due-today, then the rest.
        var rank = { overdue: 0, today: 1, '': 2 };
        state.leads.slice().sort(function (a, b) { return rank[leadFlag(a)] - rank[leadFlag(b)]; })
            .forEach(function (l) { list.appendChild(buildCard(l)); });
    }

    function load() {
        fetch('/portal/api/rep/leads', { credentials: 'same-origin' })
            .then(function (r) { if (!r.ok) throw new Error('bad status'); return r.json(); })
            .then(function (d) {
                state.role = d.role || 'rep';
                state.user = d.user || '';
                state.leads = d.leads || [];
                state.reps = d.reps || [];
                var who = $('sidebarEmail');
                if (who) who.textContent = state.user ? state.user + ' · ' + state.role : 'Rep workspace';
                refresh();
            })
            .catch(function () {
                $('leadList').appendChild(el('div', 'rep-empty', 'Could not load your leads — refresh to retry.'));
            });
    }

    var sidebarToggle = $('sidebarToggle');
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', function () {
            var sb = document.querySelector('.portal-sidebar');
            var open = sb.classList.toggle('open');
            sidebarToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
    }

    load();
})();
