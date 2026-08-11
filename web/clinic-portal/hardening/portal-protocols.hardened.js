/* ─────────────────────────────────────────────────────────────────────────
 * portal-protocols.js — HARDENED drop-in replacement
 *
 * This is the complete file (original was 4,275 chars, captured in full),
 * with one behavioural change: the postMessage listener that sizes the
 * protocol iframe now verifies BOTH the sender and the origin before acting,
 * and coerces the height to a finite, bounded number.
 *
 * Original (SECURITY-REVIEW.md §5):
 *     window.addEventListener("message", function (e) {
 *       if (e.data && e.data.type === "protoHeight") {
 *         var frame = document.getElementById("protoFrame");
 *         if (frame) frame.style.height = e.data.height + "px";
 *       }
 *     });
 *   — no e.origin check, no e.source check. Any window with a handle to this
 *     page could drive frame height. Low impact (the sink is style.height, and
 *     the CSSOM discards non-length values), but it is the exact listener that
 *     becomes an XSS sink the moment someone adds a branch that writes markup.
 *
 * Everything else is byte-for-byte the original. esc() below serialises a text
 * node, so it escapes < & > but NOT quotes — that is fine HERE because esc() is
 * only ever used in element content (<li>, <td>, <h1>…), never in an attribute.
 * If you ever use it inside a quoted attribute, switch to an attribute-safe
 * escaper first (see portal.js.patch, escAttr).
 * ───────────────────────────────────────────────────────────────────────── */

var IS_LOCKED = _isLocked;

function filterProtos(cat) {
  document.querySelectorAll(".proto-cat").forEach((c) => c.classList.toggle("active", c.dataset.cat === cat));
  document.querySelectorAll(".proto-btn").forEach((b) => {
    b.style.display = cat === "all" || b.dataset.cat === cat ? "" : "none";
  });
  document.getElementById("proto-section-label").textContent = _protoLabels[cat] || "All Protocols";
  document.getElementById("protoViewer").classList.remove("open");
  document.querySelectorAll(".proto-btn").forEach((b) => b.classList.remove("active"));
  var showAllBtn = document.querySelector(".proto-show-all-btn");
  if (showAllBtn) showAllBtn.style.display = cat === "all" ? "none" : "";
  document.querySelector(".proto-selector-wrap").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function esc(str) {
  const d = document.createElement("div");
  d.textContent = String(str != null ? str : "");
  return d.innerHTML;
}

function renderProtoJSON(data) {
  let html = "";
  let inList = false;
  let inSub = false;
  function closeSub() {
    if (inSub) {
      html += "</ul>";
      inSub = false;
    }
  }
  function closeList() {
    closeSub();
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  }
  for (const s of data.sections || []) {
    const text = (s.text || "").trim();
    if (!text && s.type !== "table") continue;
    if (s.type === "sub") {
      if (!inList) {
        html += '<ul class="proto-list">';
        inList = true;
      }
      if (!inSub) {
        html += '<ul class="proto-sublist">';
        inSub = true;
      }
      html += `<li>${esc(text)}</li>`;
      continue;
    }
    if (s.type === "li") {
      closeSub();
      if (!inList) {
        html += '<ul class="proto-list">';
        inList = true;
      }
      html += `<li>${esc(text)}</li>`;
      continue;
    }
    closeList();
    if (s.type === "h1") {
      html += `<h1>${esc(text)}</h1>`;
    } else if (s.type === "h2") {
      html += `<h2>${esc(text)}</h2>`;
    } else if (s.type === "h3") {
      html += `<h3>${esc(text)}</h3>`;
    } else if (s.type === "p") {
      if (text.length <= 65 && text.endsWith(":")) {
        html += `<div class="proto-label">${esc(text.slice(0, -1))}</div>`;
      } else {
        html += `<p>${esc(text)}</p>`;
      }
    } else if (s.type === "table") {
      html += '<div class="docx-table-wrap"><table class="docx-table"><thead><tr>';
      for (const h of s.headers || []) html += `<th>${esc(h)}</th>`;
      html += "</tr></thead><tbody>";
      for (const row of s.rows || []) {
        html += "<tr>";
        for (const cell of row) html += `<td>${esc(cell)}</td>`;
        html += "</tr>";
      }
      html += "</tbody></table></div>";
    }
  }
  closeList();
  return html;
}

/* ── HARDENED: origin- and source-checked frame sizing ──────────────────── */
window.addEventListener("message", function (e) {
  var frame = document.getElementById("protoFrame");
  if (!frame) return;

  // Only accept messages from THIS frame's own content window…
  if (e.source !== frame.contentWindow) return;
  // …delivered from our own origin. proto_render is served same-origin, so a
  // cross-origin sender is never legitimate.
  if (e.origin !== window.location.origin) return;

  var msg = e.data;
  if (!msg || msg.type !== "protoHeight") return;

  var h = Number(msg.height);
  if (!isFinite(h) || h <= 0) return;
  frame.style.height = Math.min(h, 20000) + "px";
});

function loadProto(slug, btn, noScroll) {
  document.querySelectorAll(".proto-btn").forEach(function (b) {
    b.classList.remove("active");
  });
  btn.classList.add("active");
  var viewer = document.getElementById("protoViewer");
  viewer.classList.add("open");
  viewer.querySelectorAll("p").forEach(function (p) {
    p.remove();
  });
  var frame = document.getElementById("protoFrame");
  if (!frame) {
    frame = document.createElement("iframe");
    frame.id = "protoFrame";
    frame.className = "proto-frame";
    frame.scrolling = "no";
    viewer.innerHTML = "";
    viewer.appendChild(frame);
  }
  frame.style.display = "block";
  frame.style.height = "400px";

  /* NOTE (SECURITY-REVIEW.md §3): the lock flag below is READ FROM THE DOM and
   * sent to the server. It is a display hint only — proto_render MUST re-derive
   * the lock from the session and refuse gated slugs regardless of this param,
   * because a user can set `data-locked="0"` in the console. We keep sending it
   * for backward compatibility, but log EVERY view (not just unlocked ones) so
   * a server-side bypass can't erase itself from the event log. */
  var isLocked = btn.dataset.locked === "1";
  logEvent("protocol_view", slug);
  var url = BASE + "/portal.php?action=proto_render&slug=" + encodeURIComponent(slug);
  if (isLocked) url += "&locked=1";
  frame.src = url;
  if (!noScroll) {
    var selector = document.querySelector(".proto-selector-wrap");
    if (selector) selector.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const firstBtn = document.querySelector(".proto-btn");
  if (firstBtn) loadProto(firstBtn.dataset.slug, firstBtn, true);
});
