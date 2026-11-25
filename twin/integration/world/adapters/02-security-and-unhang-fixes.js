// Twin World v0.4.4-rc.1 — Security Lockdown (N5, C1-client), DOM Stability (#8, N8, N9) & Live Boot Unhang Watchdog
// Zero touch on locked twin-hud files (57-ariel-car.js, 53-materials-hd.js, js/flora.js, 61-beauty.js).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.YZW_SecUnhang = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function isLocalHostPage(loc) {
    if (!loc || !loc.hostname) return false;
    const h = String(loc.hostname).toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
  }

  function isLocalTargetUrl(rawUrl, pageLoc) {
    if (!isLocalHostPage(pageLoc) || !rawUrl) return false;
    try {
      const u = new URL(String(rawUrl), pageLoc.href || 'http://localhost/');
      const h = u.hostname.toLowerCase();
      const protoOk = u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'ws:' || u.protocol === 'wss:';
      return protoOk && (h === 'localhost' || h === '127.0.0.1' || h === '[::1]');
    } catch (_) {
      return false;
    }
  }

  // N5 + C2 FIX: Block ?acct=, ?tel=, ?mpsrv=, ?natbase=, ?maptiles= outside localhost
  function sanitizeRuntimeParams(searchStr, pageLoc) {
    const p = new URLSearchParams(searchStr || '');
    const sensitive = ['acct', 'tel', 'mpsrv', 'natbase', 'maptiles'];
    const blocked = [];
    const out = {};
    for (const key of sensitive) {
      if (p.has(key)) {
        const val = p.get(key);
        if (isLocalTargetUrl(val, pageLoc)) {
          out[key] = val;
        } else {
          blocked.push(key);
          out[key] = null;
        }
      }
    }
    return { allowed: out, blocked };
  }

  function escHtml(val) {
    return String(val == null ? '' : val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // N5 XSS FIX: Sanitize building popup fields (f, fl, fh, id, color)
  function formatBuildingPopupSafe(b) {
    const obj = b || {};
    const floors = Number.isFinite(Number(obj.fl)) ? Math.max(0, Math.round(Number(obj.fl))) : null;
    const height = Number.isFinite(Number(obj.fh)) ? Math.max(0, Math.round(Number(obj.fh) * 10) / 10) : null;
    const func = escHtml(obj.f || 'מבנה');
    const idSafe = escHtml(obj.id || '');
    const parts = [`<strong data-id="${idSafe}">${func}</strong>`];
    if (floors !== null) parts.push(`${floors} קומות`);
    if (height !== null) parts.push(`${height} מ'`);
    return parts.join(' · ');
  }

  // Queue #8 FIX: 35-camera.js insertBefore crash when 63-hud-clean moves #bMine into drawer
  function safeInsertBefore(parent, newNode, refNode) {
    if (!parent || !newNode) return false;
    if (refNode && refNode.parentNode === parent && typeof parent.insertBefore === 'function') {
      parent.insertBefore(newNode, refNode);
      return 'inserted_before';
    }
    if (refNode && refNode.parentNode && typeof refNode.parentNode.insertBefore === 'function') {
      refNode.parentNode.insertBefore(newNode, refNode);
      return 'inserted_in_actual_parent';
    }
    if (typeof parent.appendChild === 'function') {
      parent.appendChild(newNode);
      return 'appended_fallback';
    }
    return false;
  }

  // N9 FIX: Safe setPointerCapture wrapper
  function safeSetPointerCapture(el, pointerId) {
    if (!el || typeof el.setPointerCapture !== 'function') return false;
    try {
      el.setPointerCapture(pointerId);
      return true;
    } catch (_) {
      return false;
    }
  }

  // N8 FIX: Ensure toast notifications never cover open HUD drawer
  function computeToastOffsetTopPx(drawerOpen, drawerHeightPx) {
    if (!drawerOpen) return 12;
    return Math.max(12, Math.min(280, Number(drawerHeightPx || 180) + 12));
  }

  // C1 Client Storage Key Isolation: prevent raw.githack.com shared-origin collision
  function getIsolatedAccountStorageKey(pageLoc) {
    if (!pageLoc) return 'w27.acct.isolated';
    if (pageLoc.hostname === 'world.esh27.com') return 'w27.acct';
    const pathHash = String(pageLoc.pathname || '/').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
    return `w27.sandbox.${pageLoc.hostname}.${pathHash}`;
  }

  // Tel-Aviv / National Tiles GPS Jump Guard for legacy game engine
  function clampOrResolveTileCoord(eItm, nItm) {
    if (!Number.isFinite(eItm) || !Number.isFinite(nItm)) {
      return { valid: false, e: 166263.82, n: 634919.76, fallback: 'ashdod_haerez' };
    }
    const eClamped = Math.max(130000, Math.min(260000, eItm));
    const nClamped = Math.max(500000, Math.min(800000, nItm));
    const tileKey = `${Math.floor(eClamped / 1000)}_${Math.floor(nClamped / 1000)}`;
    return { valid: true, e: eClamped, n: nClamped, tileKey };
  }

  // Live "טוען..." Unhang Watchdog (Diagnosed on world.esh27.com in headless/slow-tile/no-WebGL environments)
  function installLoadingWatchdog(doc, opts) {
    const timeoutMs = (opts && opts.timeoutMs) || 4500;
    const state = { cleared: false, reason: null };
    function clearSplash(reason) {
      if (state.cleared) return state;
      state.cleared = true;
      state.reason = reason;
      if (doc && typeof doc.getElementById === 'function') {
        const loader = doc.getElementById('loading') || doc.getElementById('loader') || doc.getElementById('splash');
        if (loader && loader.style) {
          loader.style.opacity = '0';
          loader.style.pointerEvents = 'none';
          loader.style.display = 'none';
        }
      }
      return state;
    }
    return { state, clearSplash, timeoutMs };
  }

  return {
    isLocalHostPage,
    isLocalTargetUrl,
    sanitizeRuntimeParams,
    escHtml,
    formatBuildingPopupSafe,
    safeInsertBefore,
    safeSetPointerCapture,
    computeToastOffsetTopPx,
    getIsolatedAccountStorageKey,
    clampOrResolveTileCoord,
    installLoadingWatchdog
  };
});

// Auto-register with YZW runtime in browser index.html
(function () {
  if (typeof window === 'undefined' || !window.YZW_SecUnhang) return;
  var secApi = window.YZW_SecUnhang;
  var watchdogRef = null;
  var ADAPTER_02 = {
    id: '02-security-and-unhang-fixes',
    order: 2,
    init: function () {
      if (window.location) {
        window.__yzwSanitizedParams = secApi.sanitizeRuntimeParams(window.location.search, window.location);
      }
      if (typeof document !== 'undefined') {
        watchdogRef = secApi.installLoadingWatchdog(document, 8000);
      }
    },
    dispose: function () {
      watchdogRef = null;
    }
  };
  if (window.YZW && typeof window.YZW.register === 'function') {
    window.YZW.register(ADAPTER_02);
  }
})();
