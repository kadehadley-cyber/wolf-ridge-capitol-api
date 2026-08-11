/* ─────────────────────────────────────────────────────────────────────────
   cellunova.bio homepage — the only script on the page. Draws the green
   particle-cell hero, rotates the headline, and handles the welcome card.
   Our own code (script-src 'self'); no external calls, no user data.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
    'use strict';
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ── Particle cell ── */
    var canvas = document.getElementById('cellField');
    if (canvas && canvas.getContext) {
        var ctx = canvas.getContext('2d');
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var W = 0, H = 0, cx = 0, cy = 0, parts = [];

        function build() {
            var host = canvas.parentElement;
            W = host.clientWidth; H = host.clientHeight;
            canvas.width = W * dpr; canvas.height = H * dpr;
            canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            cx = W * 0.64; cy = H * 0.52;
            var n = Math.round(Math.min(340, Math.max(140, W * H / 5200)));
            parts = [];
            for (var i = 0; i < n; i++) {
                // Cluster densely toward the centre (a cell), thinner outward.
                var a = Math.random() * Math.PI * 2;
                var g = Math.pow(Math.random(), 0.6);            // bias inward
                var rad = g * Math.min(W, H) * 0.52;
                var amber = Math.random() < 0.26;
                parts.push({
                    x: cx + Math.cos(a) * rad * (0.9 + Math.random() * 0.5),
                    y: cy + Math.sin(a) * rad,
                    r: 0.5 + Math.random() * (amber ? 1.9 : 1.5),
                    a0: 0.15 + Math.random() * 0.75,
                    ph: Math.random() * Math.PI * 2,
                    sp: 0.6 + Math.random() * 1.4,
                    col: amber ? (Math.random() < 0.5 ? '224,160,58' : '255,122,58')
                               : (Math.random() < 0.5 ? '125,211,64' : '111,206,53')
                });
            }
        }

        function glow() {
            var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(W, H) * 0.6);
            g.addColorStop(0, 'rgba(111,206,53,.22)');
            g.addColorStop(0.4, 'rgba(30,120,70,.10)');
            g.addColorStop(1, 'rgba(6,10,16,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, W, H);
        }

        function frame(t) {
            ctx.clearRect(0, 0, W, H);
            glow();
            for (var i = 0; i < parts.length; i++) {
                var p = parts[i];
                var tw = reduce ? 1 : (0.55 + 0.45 * Math.sin(t / 1000 * p.sp + p.ph));
                ctx.beginPath();
                ctx.fillStyle = 'rgba(' + p.col + ',' + (p.a0 * tw).toFixed(3) + ')';
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fill();
            }
            if (!reduce) requestAnimationFrame(frame);
        }

        build();
        if (reduce) frame(0); else requestAnimationFrame(frame);
        var rt;
        window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { build(); if (reduce) frame(0); }, 150); });
    }

    /* ── Rotating headline ── */
    var rot = document.getElementById('heroRot');
    if (rot && !reduce) {
        var lines = JSON.parse(rot.getAttribute('data-lines') || '[]');
        if (lines.length > 1) {
            var i = 0;
            setInterval(function () {
                i = (i + 1) % lines.length;
                rot.style.opacity = '0';
                setTimeout(function () { rot.textContent = lines[i]; rot.style.opacity = '1'; }, 400);
            }, 4200);
        }
    }

    /* ── Sign-in + gated "welcome back" ──
     * The welcome card shows ONLY for a returning user who signed in and ticked
     * "keep me signed in". That preference lives in localStorage; when set, the
     * sign-in email is also stored so it autofills next time. We never store a
     * password or token here. */
    var RKEY = 'cn_remember', DKEY = 'cn_welcome_dismissed';
    function readRemember() { try { return JSON.parse(localStorage.getItem(RKEY) || 'null'); } catch (e) { return null; } }
    function writeRemember(v) { try { v ? localStorage.setItem(RKEY, JSON.stringify(v)) : localStorage.removeItem(RKEY); } catch (e) {} }
    function dismissed() { try { return sessionStorage.getItem(DKEY) === '1'; } catch (e) { return false; } }
    function setDismissed() { try { sessionStorage.setItem(DKEY, '1'); } catch (e) {} }
    function clearDismissed() { try { sessionStorage.removeItem(DKEY); } catch (e) {} }

    var welcome = document.getElementById('welcomeCard');
    function refreshWelcome() {
        if (!welcome) return;
        welcome.hidden = !(readRemember() && !dismissed());
    }
    if (welcome) welcome.addEventListener('click', function (e) {
        var el = e.target.closest('[data-welcome]');
        if (el && el.dataset.welcome === 'stay') { setDismissed(); welcome.hidden = true; }
    });

    var modal = document.getElementById('signinModal'), form = document.getElementById('signinForm');
    function openSignin() {
        if (!modal) return;
        var r = readRemember();
        if (r && r.email) { document.getElementById('siEmail').value = r.email; document.getElementById('siRemember').checked = true; }
        modal.hidden = false;
        var f = document.getElementById('siEmail'); if (f) f.focus();
    }
    function closeSignin() { if (modal) modal.hidden = true; }

    document.addEventListener('click', function (e) {
        var el = e.target.closest('[data-action]');
        if (!el) return;
        if (el.dataset.action === 'signin') { e.preventDefault(); openSignin(); }
        else if (el.dataset.action === 'close-signin') { closeSignin(); }
    });
    if (form) form.addEventListener('submit', function (e) {
        e.preventDefault();
        var email = (document.getElementById('siEmail').value || '').trim();
        var remember = document.getElementById('siRemember').checked;
        // Only persist the "welcome back" preference when the box is ticked.
        if (remember && email) { writeRemember({ email: email }); clearDismissed(); }
        else { writeRemember(null); }
        closeSignin();
        refreshWelcome();
    });
    if (modal) modal.addEventListener('click', function (e) { if (e.target === modal) closeSignin(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSignin(); });

    refreshWelcome();

    /* ── Mobile nav ── */
    var burger = document.getElementById('navBurger');
    if (burger) burger.addEventListener('click', function () {
        var open = document.body.classList.toggle('nav-open');
        burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
})();
