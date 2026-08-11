/* Protocol detail frame.
 *
 * Two jobs: label itself from the ?slug= parameter, and tell the parent how
 * tall it is. The height goes out over postMessage with an explicit target
 * origin, so the parent can verify both the sender and the origin instead of
 * reaching into this document to measure it. */
(function () {
    'use strict';

    var TITLES = {
        'general-wellness': { name: 'General Wellness & Anti-Aging', route: 'Intravenous (IV)' },
        'autism':           { name: 'Autism',                        route: 'Intravenous (IV)' },
        'back-pain':        { name: 'Back Pain',                     route: 'Intra-Muscular (IM)' },
        'copd':             { name: 'COPD Treatment',                route: 'Intravenous (IV)' }
    };

    var slug = new URLSearchParams(window.location.search).get('slug') || '';
    var meta = Object.prototype.hasOwnProperty.call(TITLES, slug) ? TITLES[slug] : null;

    /* Unknown slugs render a neutral heading rather than echoing whatever was
     * in the query string. textContent would already neutralise markup; the
     * allowlist keeps arbitrary text off the page as well. */
    document.getElementById('protoTitle').textContent = meta ? meta.name : 'Protocol not found';
    document.getElementById('protoRoute').textContent = meta ? meta.route : 'Unavailable';
    document.title = (meta ? meta.name : 'Protocol') + ' — CelluNOVA';

    var lastSent = 0;

    function postHeight() {
        if (window.parent === window) return;

        var h = Math.ceil(document.documentElement.getBoundingClientRect().height);
        if (h === lastSent) return;
        lastSent = h;

        window.parent.postMessage({ type: 'proto:height', height: h }, window.location.origin);
    }

    window.addEventListener('load', postHeight);
    window.addEventListener('resize', postHeight);

    if (typeof ResizeObserver === 'function') {
        new ResizeObserver(postHeight).observe(document.body);
    }

    postHeight();
})();
