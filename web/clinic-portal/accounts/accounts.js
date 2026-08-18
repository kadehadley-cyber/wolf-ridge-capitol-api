/* Account manager (admin only). All values render through textContent. */
(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };
    var accounts = [];

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    }

    function api(body) {
        return fetch('/portal/api/accounts', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
        }).then(function (r) {
            return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Request failed'); return d; });
        });
    }

    /* One-time password modal */
    var overlay = $('pwOverlay');
    function showPassword(title, user, password) {
        $('pwTitle').textContent = title;
        $('pwBody').textContent = 'For "' + user + '". Copy this now — it will not be shown again. '
            + 'Share it by phone or text, separately from the portal address.';
        $('pwSecret').textContent = password;
        overlay.hidden = false;
        $('pwCopy').focus();
    }
    $('pwCopy').addEventListener('click', function () {
        var text = $('pwSecret').textContent;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { $('pwCopy').textContent = 'Copied!'; });
        }
    });
    $('pwDone').addEventListener('click', function () {
        overlay.hidden = true;
        $('pwSecret').textContent = '';
        $('pwCopy').textContent = 'Copy';
    });

    /* Table */
    function fmtDate(iso) {
        if (!iso) return '—';
        var d = new Date(iso);
        return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function actionBtn(label, cls, fn) {
        var b = el('button', 'acct-btn ' + cls, label);
        b.type = 'button';
        b.addEventListener('click', function () {
            b.disabled = true;
            fn().catch(function (e) { alert(e.message); }).then(function () { b.disabled = false; });
        });
        return b;
    }

    function render() {
        var tbody = $('acctRows');
        tbody.textContent = '';
        accounts.forEach(function (a) {
            var tr = document.createElement('tr');
            tr.appendChild(el('td', 'acct-user', a.user));
            var roleTd = el('td');
            roleTd.appendChild(el('span', 'acct-role ' + a.role, a.role));
            tr.appendChild(roleTd);
            tr.appendChild(el('td', 'acct-status ' + (a.builtin ? 'builtin' : a.disabled ? 'disabled' : 'active'),
                a.builtin ? 'built-in' : a.disabled ? 'disabled' : 'active'));
            tr.appendChild(el('td', '', a.builtin ? '—' : fmtDate(a.created_at)));
            var actions = el('td');
            var wrap = el('div', 'acct-actions');
            if (a.builtin) {
                wrap.appendChild(el('span', 'acct-status builtin', 'managed in code'));
            } else {
                wrap.appendChild(actionBtn('Reset password', 'ghost', function () {
                    return api({ action: 'reset', user: a.user }).then(function (d) {
                        showPassword('Password reset', d.user, d.password);
                    });
                }));
                wrap.appendChild(actionBtn(a.disabled ? 'Enable' : 'Disable', 'ghost', function () {
                    return api({ action: a.disabled ? 'enable' : 'disable', user: a.user }).then(load);
                }));
                wrap.appendChild(actionBtn('Delete', 'danger', function () {
                    if (!window.confirm('Delete the "' + a.user + '" login permanently?')) return Promise.resolve();
                    return api({ action: 'delete', user: a.user }).then(load);
                }));
            }
            actions.appendChild(wrap);
            tr.appendChild(actions);
            tbody.appendChild(tr);
        });
    }

    function load() {
        return fetch('/portal/api/accounts', { credentials: 'same-origin' })
            .then(function (r) { if (!r.ok) throw new Error('Could not load accounts'); return r.json(); })
            .then(function (d) { accounts = d.accounts || []; render(); });
    }

    $('createBtn').addEventListener('click', function () {
        var user = $('newUser').value.trim();
        var role = $('newRole').value;
        if (!user) { alert('Enter a username first.'); return; }
        var btn = $('createBtn');
        btn.disabled = true;
        api({ action: 'create', user: user, role: role })
            .then(function (d) {
                $('newUser').value = '';
                showPassword('Account created', d.user, d.password);
                return load();
            })
            .catch(function (e) { alert(e.message); })
            .then(function () { btn.disabled = false; });
    });

    var sidebarToggle = $('sidebarToggle');
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', function () {
            var sb = document.querySelector('.portal-sidebar');
            var open = sb.classList.toggle('open');
            sidebarToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
    }

    load().catch(function () {
        $('acctRows').appendChild(el('tr')).appendChild(el('td', '', 'Could not load accounts — refresh to retry.'));
    });
})();
