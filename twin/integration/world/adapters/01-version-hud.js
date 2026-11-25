(function () {
  'use strict';

  var DEFAULT_VERSION_INFO = {
    product: 'עולם 27',
    semver: '0.4.6',
    build_number: 24,
    commit: '35de539',
    branch: 'twin-world',
    released_at: '2026-11-23 23:20',
    environment: 'staging',
    budgets: {
      scene_max_triangles: 250000,
      scene_max_draw_calls: 120
    },
    highlights: [
      'היסט מפ"י רשמי 1507.82/757.76 מ\' אוחד במנוע',
      'תבליט גבעת יונה עלה ל-48.9 מ\' (במקום 34.8 מ\')',
      'רכב אאודי A1 מהודק ל-FPV + אתר 3 עגורנים במגדלי הדקל'
    ]
  };

  var SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

  function isValidSemVer(ver) {
    return typeof ver === 'string' && SEMVER_REGEX.test(ver.trim());
  }

  function formatBadgeLabel(info) {
    var v = (info && info.semver) || DEFAULT_VERSION_INFO.semver;
    var b = (info && info.build_number) ? ' · #' + info.build_number : '';
    var c = (info && info.commit) ? ' (' + String(info.commit).slice(0, 7) + ')' : '';
    return 'v' + v + b + c;
  }

  function evaluateTelemetryHealth(metrics, budgets) {
    var b = budgets || DEFAULT_VERSION_INFO.budgets;
    var tris = Number(metrics.triangles || 0);
    var calls = Number(metrics.drawCalls || 0);
    var fps = Number(metrics.fps || 60);
    var warnings = [];
    if (tris > b.scene_max_triangles) warnings.push('חריגת משולשים (' + tris + ' > ' + b.scene_max_triangles + ')');
    if (calls > b.scene_max_draw_calls) warnings.push('חריגת קריאות ציור (' + calls + ' > ' + b.scene_max_draw_calls + ')');
    if (fps > 0 && fps < 24) warnings.push('קצב פריימים נמוך (' + fps.toFixed(0) + ' FPS)');
    return {
      status: warnings.length === 0 ? 'green' : (warnings.length === 1 ? 'amber' : 'red'),
      warnings: warnings
    };
  }

  var S = {
    badgeEl: null,
    panelEl: null,
    panelOpen: false,
    frames: 0,
    accSec: 0,
    fps: 60,
    info: DEFAULT_VERSION_INFO
  };

  function createDomHud(info) {
    if (typeof document === 'undefined' || !document.body) return;
    var badge = document.createElement('button');
    badge.type = 'button';
    badge.id = 'yzw-version-badge';
    badge.dir = 'rtl';
    badge.setAttribute('aria-label', 'פרטי גרסה ומדדי ביצועים');
    badge.style.cssText = [
      'position:fixed',
      'top:8px',
      'left:8px',
      'z-index:9990',
      'padding:4px 9px',
      'border-radius:999px',
      'border:1px solid rgba(255,255,255,0.22)',
      'background:rgba(12,18,28,0.88)',
      'color:#e8f5e9',
      'font:600 11px/1.2 system-ui,-apple-system,sans-serif',
      'letter-spacing:0.2px',
      'cursor:pointer',
      'touch-action:manipulation',
      'user-select:none'
    ].join(';');
    badge.textContent = '🟢 ' + formatBadgeLabel(info);

    var panel = document.createElement('div');
    panel.id = 'yzw-version-panel';
    panel.dir = 'rtl';
    panel.style.cssText = [
      'display:none',
      'position:fixed',
      'top:38px',
      'left:8px',
      'width:min(310px, calc(100vw - 16px))',
      'z-index:9991',
      'padding:12px',
      'border-radius:12px',
      'border:1px solid rgba(255,255,255,0.18)',
      'background:rgba(12,18,28,0.92)',
      'color:#f1f5f9',
      'font:400 12px/1.45 system-ui,-apple-system,sans-serif',
      'box-shadow:0 10px 28px rgba(0,0,0,0.45)'
    ].join(';');

    badge.addEventListener('click', function () {
      S.panelOpen = !S.panelOpen;
      panel.style.display = S.panelOpen ? 'block' : 'none';
    });

    document.body.appendChild(badge);
    document.body.appendChild(panel);
    S.badgeEl = badge;
    S.panelEl = panel;
  }

  function renderPanelHtml(info, metrics, health) {
    var items = (info.highlights || []).map(function (h) {
      return '<li style="margin-bottom:3px;">' + String(h).replace(/[<>&]/g, '') + '</li>';
    }).join('');
    return (
      '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' +
      String(info.product || 'עולם 27').replace(/[<>&]/g, '') + ' · v' + String(info.semver).replace(/[<>&]/g, '') +
      ' (Build #' + Number(info.build_number || 0) + ')</div>' +
      '<div style="color:#94a3b8;font-size:11px;margin-bottom:8px;">ענף: ' +
      String(info.branch || 'twin-world').replace(/[<>&]/g, '') + ' · קומיט: ' +
      String(info.commit || '').slice(0, 7).replace(/[<>&]/g, '') + ' · ' +
      String(info.released_at || '').replace(/[<>&]/g, '') + '</div>' +
      '<div style="background:rgba(255,255,255,0.06);padding:6px 8px;border-radius:8px;margin-bottom:8px;font-size:11px;">' +
      '⚡ <b>FPS:</b> ' + metrics.fps.toFixed(0) +
      ' · 📐 <b>משולשים:</b> ' + metrics.triangles.toLocaleString('en-US') +
      ' · 🎨 <b>Draw Calls:</b> ' + metrics.drawCalls +
      (health.warnings.length ? '<div style="color:#fbbf24;margin-top:4px;">⚠️ ' + health.warnings.join(' | ') + '</div>' : '') +
      '</div>' +
      '<div style="font-weight:600;margin-bottom:3px;">מה נכנס בגרסה הזו:</div>' +
      '<ul style="margin:0;padding-right:16px;color:#cbd5e1;font-size:11.5px;">' + items + '</ul>'
    );
  }

  var ADAPTER_SPEC = {
    id: 'studio-version-hud',
    order: 1,
    init: function (world) {
      var custom = (typeof window !== 'undefined' && window.YZW_VERSION) ? window.YZW_VERSION : null;
      S.info = Object.assign({}, DEFAULT_VERSION_INFO, custom || {});
      createDomHud(S.info);
      if (typeof window !== 'undefined') {
        window.YZW_VersionHUD = {
          getVersionInfo: function () { return S.info; },
          formatBadgeLabel: function () { return formatBadgeLabel(S.info); }
        };
      }
    },
    update: function (dt, world) {
      S.frames += 1;
      S.accSec += (dt && dt > 0 && dt < 1) ? dt : 0.016;
      if (S.accSec < 0.5) return;

      S.fps = S.frames / S.accSec;
      S.frames = 0;
      S.accSec = 0;

      var renderInfo = world && world.renderer && world.renderer.info && world.renderer.info.render;
      var metrics = {
        fps: S.fps,
        triangles: renderInfo ? Number(renderInfo.triangles || 0) : 0,
        drawCalls: renderInfo ? Number(renderInfo.calls || 0) : 0
      };
      var health = evaluateTelemetryHealth(metrics, S.info.budgets);
      var dot = health.status === 'green' ? '🟢 ' : (health.status === 'amber' ? '🟡 ' : '🔴 ');

      if (S.badgeEl) {
        S.badgeEl.textContent = dot + formatBadgeLabel(S.info) + ' · ' + metrics.fps.toFixed(0) + 'fps';
      }
      if (S.panelOpen && S.panelEl) {
        S.panelEl.innerHTML = renderPanelHtml(S.info, metrics, health);
      }
    },
    dispose: function () {
      if (S.badgeEl && S.badgeEl.parentNode) S.badgeEl.parentNode.removeChild(S.badgeEl);
      if (S.panelEl && S.panelEl.parentNode) S.panelEl.parentNode.removeChild(S.panelEl);
      S.badgeEl = null;
      S.panelEl = null;
      S.panelOpen = false;
    }
  };

  if (typeof window !== 'undefined' && window.YZW && typeof window.YZW.register === 'function') {
    window.YZW.register(ADAPTER_SPEC);
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      ADAPTER_SPEC: ADAPTER_SPEC,
      DEFAULT_VERSION_INFO: DEFAULT_VERSION_INFO,
      isValidSemVer: isValidSemVer,
      formatBadgeLabel: formatBadgeLabel,
      formatVersionBadge: formatBadgeLabel,
      evaluateTelemetryHealth: evaluateTelemetryHealth
    };
  }
})();
