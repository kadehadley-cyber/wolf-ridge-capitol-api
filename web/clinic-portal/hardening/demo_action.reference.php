<?php
/* ─────────────────────────────────────────────────────────────────────────
 * demo_action.reference.php — REFERENCE server gate, not your actual handler
 *
 * I do not have portal.php's source (the DevTools exports return the endpoint's
 * JSON output, never its PHP). This shows the shape a correct handler must have,
 * so you can compare it against your real one. SECURITY-REVIEW.md §1.
 *
 * THE FINDING: portal.js ships a self-service permission API —
 *   fetch('/portal.php?action=demo_action', {method:'POST', ...,
 *          body: JSON.stringify({ sub:'set_permissions', permissions:{...} })})
 * whose own UI says "Toggle any rep-level permission for your account." If the
 * server does not verify, per sub-action, that the session is a demo account,
 * ANY authenticated clinic can escalate from the browser console. Hiding the
 * button is not a control.
 *
 * THE TEST (run in a real, non-demo clinic session — read-only, mutates nothing):
 *   fetch('/portal.php?action=demo_action', {
 *     method:'POST', credentials:'same-origin',
 *     headers:{'Content-Type':'application/json'},
 *     body: JSON.stringify({ sub:'get_state' })
 *   }).then(r=>r.json()).then(console.log);
 *   • {ok:false}/403  → server gates it. §1 is UI-only, you're fine.
 *   • {ok:true,...}   → the endpoint serves a session it shouldn't. Live bypass.
 * ───────────────────────────────────────────────────────────────────────── */

function handle_demo_action(array $session, array $input): array
{
    // 1) GATE FIRST — before dispatching any sub-action. Derive demo status from
    //    the session/DB, never from anything the request carries.
    if (empty($session['is_demo_account'])) {
        http_response_code(403);
        return ['ok' => false, 'error' => 'Not available for this account.'];
    }

    // 2) The account these actions may touch is ALWAYS the session's own.
    //    Never read a clinic_id / account_id from $input.
    $clinicId = (int) $session['clinic_id'];

    $sub = is_string($input['sub'] ?? null) ? $input['sub'] : '';

    switch ($sub) {
        case 'get_state':
            return demo_get_state($clinicId);

        case 'set_permissions':
            // 3) ALLOWLIST keys — do not loop over whatever map arrived and write
            //    each one. Reject unknown keys, and never grant a permission that
            //    reaches non-demo data.
            $allowed = ['view_pricing', 'download_nda', 'run_market_scan']; // real rep-level keys
            $req     = is_array($input['permissions'] ?? null) ? $input['permissions'] : [];
            $grant   = [];
            foreach ($allowed as $key) {
                $grant[$key] = !empty($req[$key]) ? 1 : 0;
            }
            demo_set_permissions($clinicId, $grant); // writes ONLY $clinicId, ONLY $allowed keys
            return ['ok' => true];

        case 'update_profile':
            // NPI is a regulated identifier — validate format, don't store raw free text.
            return demo_update_profile($clinicId, $input);

        case 'reset_all':
        case 'clear_ndas':
        case 'clear_reports':
        case 'clear_cart':
        case 'clear_custom_pricing':
            // Destructive, but scoped to $clinicId (the session's own account).
            // Still require a CSRF token — see below.
            return demo_reset($clinicId, $sub);

        case 'view_splash':
        case 'reset_splash':
        case 'run_market_analysis':
            return demo_misc($clinicId, $sub);

        default:
            http_response_code(400);
            return ['ok' => false, 'error' => 'Unknown action.'];
    }
}

/* ── CSRF (SECURITY-REVIEW.md §6) ────────────────────────────────────────────
 * demo_action, nda_sign, chat_*, mark_splash_seen — every mutating endpoint —
 * need a per-session token, checked before the handler runs. The JSON
 * Content-Type triggers a CORS preflight, which is incidental protection, not a
 * control; it evaporates if the server ever accepts form-encoded bodies.
 *
 *   $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($input['csrf'] ?? '');
 *   if (!hash_equals($session['csrf'] ?? '', $token)) {
 *       http_response_code(403);
 *       exit(json_encode(['ok' => false, 'error' => 'Bad CSRF token.']));
 *   }
 *
 * Also confirm the session cookie is SameSite=Lax|Strict, HttpOnly, Secure.
 * ───────────────────────────────────────────────────────────────────────── */

/* ── proto_render (SECURITY-REVIEW.md §3) ────────────────────────────────────
 * Same principle for the protocol renderer: derive the lock from the session,
 * IGNORE the client's &locked=1, and allowlist the slug.
 *
 *   $slug = $input['slug'] ?? '';
 *   if (!in_array($slug, allowed_slugs_for($session), true)) { http_response_code(404); exit; }
 *   if (protocol_is_locked($slug, $session)) { render_locked_placeholder(); exit; }
 *   render_protocol($slug);
 *
 * If proto_render maps the slug to a filesystem path, allowlisting also closes
 * the path-traversal surface.
 * ───────────────────────────────────────────────────────────────────────── */
