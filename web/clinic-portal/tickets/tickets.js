/* ─────────────────────────────────────────────────────────────────────────
 * Support chat.
 *
 * Mirrors portal.js's chat flow (thread list → messages → composer) with
 * placeholder threads. Message bodies — server/user data on the real page —
 * render through textContent, never string-built HTML. Composer is a stub.
 * ───────────────────────────────────────────────────────────────────────── */
(function () {
    'use strict';
    var $ = function (id) { return document.getElementById(id); };
    function fmt(ts) { if (!ts) return ''; var d = new Date(String(ts).replace(' ', 'T')); return isNaN(d.getTime()) ? String(ts) : d.toLocaleString(); }

    /* ══ PLACEHOLDER THREADS ══════════════════════════════════════════════ */
    var THREADS = [
        {
            id: 1, subject: 'Protocol question — COPD', status: 'open', last_activity: '2026-08-09 10:00:00',
            message: 'What dilution do you recommend for the COPD IV protocol?',
            messages: [
                { who: 'you', name: 'You', time: '2026-08-09 10:00:00', body: 'What dilution do you recommend for the COPD IV protocol?' },
                { who: 'team', name: 'CelluNOVA', time: '2026-08-09 10:22:00', body: 'Great question — see the protocol sheet; a physician will follow up with specifics shortly.' }
            ]
        },
        {
            id: 2, subject: 'Order CN-1039 shipping', status: 'resolved', last_activity: '2026-08-02 14:00:00',
            message: 'Has my order shipped?',
            messages: [
                { who: 'you', name: 'You', time: '2026-08-02 13:30:00', body: 'Has CN-1039 shipped yet?' },
                { who: 'team', name: 'CelluNOVA', time: '2026-08-02 14:00:00', body: 'Yes — tracking is in your email. Marking resolved.' }
            ]
        },
        {
            id: 3, subject: 'Account update', status: 'soft_closed', last_activity: '2026-07-28 09:00:00',
            message: 'Please update our shipping address.',
            messages: [
                { who: 'you', name: 'You', time: '2026-07-28 09:00:00', body: 'Please update our shipping address to the new suite.' }
            ]
        }
    ];

    var activeId = null;

    function renderThreads() {
        var list = $('threadList'); list.textContent = '';
        THREADS.forEach(function (t) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'chat-thread-item' + (t.id === activeId ? ' active' : '');
            btn.dataset.action = 'open'; btn.dataset.id = String(t.id);
            var title = document.createElement('div'); title.className = 'chat-thread-item-title'; title.textContent = t.subject;
            var prev = document.createElement('div'); prev.className = 'chat-thread-item-preview'; prev.textContent = t.message;
            var meta = document.createElement('div'); meta.className = 'chat-thread-item-meta';
            var when = document.createElement('span'); when.textContent = fmt(t.last_activity);
            var st = document.createElement('span'); st.className = 'status-pill ' + t.status;
            st.textContent = t.status === 'soft_closed' ? 'soft closed' : t.status;
            meta.append(when, st);
            btn.append(title, prev, meta);
            list.appendChild(btn);
        });
    }

    function openThread(id) {
        activeId = id;
        var t = THREADS.filter(function (x) { return x.id === id; })[0];
        if (!t) return;
        $('chatWelcome').hidden = true;
        $('chatThread').hidden = false;
        $('threadTitle').textContent = t.subject;
        var st = $('threadStatus'); st.className = 'status-pill ' + t.status;
        st.textContent = t.status === 'soft_closed' ? 'soft closed' : t.status;

        var box = $('chatMessages'); box.textContent = '';
        t.messages.forEach(function (m) {
            var wrap = document.createElement('div');
            wrap.className = 'chat-msg ' + (m.who === 'you' ? 'outgoing' : 'incoming');
            var bubble = document.createElement('div'); bubble.className = 'chat-msg-bubble';
            bubble.textContent = m.body;               // textContent — inert
            var meta = document.createElement('div'); meta.className = 'chat-msg-meta';
            meta.textContent = m.name + ' · ' + fmt(m.time);
            wrap.append(bubble, meta);
            box.appendChild(wrap);
        });
        box.scrollTop = box.scrollHeight;
        renderThreads();
    }

    document.addEventListener('click', function (e) {
        var el = e.target.closest('[data-action]');
        if (!el) return;
        if (el.dataset.action === 'open') openThread(Number(el.dataset.id));
        else if (el.dataset.action === 'send') {
            var inp = $('chatInput');
            if (inp) inp.value = '';
            // Stub — the real flow posts to chat_send.
        } else if (el.dataset.action === 'new') {
            activeId = null;
            $('chatWelcome').hidden = true;
            $('chatThread').hidden = false;
            $('threadTitle').textContent = 'New conversation';
            $('threadStatus').className = 'status-pill open'; $('threadStatus').textContent = 'open';
            $('chatMessages').textContent = '';
            renderThreads();
            $('chatInput').focus();
        }
    });

    var inp = $('chatInput');
    if (inp) inp.addEventListener('input', function () { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 120) + 'px'; });

    var stog = $('sidebarToggle');
    stog.addEventListener('click', function () { var sb = document.querySelector('.portal-sidebar'); stog.setAttribute('aria-expanded', sb.classList.toggle('open') ? 'true' : 'false'); });

    renderThreads();
})();
