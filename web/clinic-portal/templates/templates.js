/* Clinic Templates — static page; only the mobile sidebar toggle is wired. */
(function () {
    'use strict';
    var t = document.getElementById('sidebarToggle');
    if (!t) return;
    t.addEventListener('click', function () {
        var sb = document.querySelector('.portal-sidebar');
        var open = sb.classList.toggle('open');
        t.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
})();
