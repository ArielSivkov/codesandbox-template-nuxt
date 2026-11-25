#!/usr/bin/env node
/**
 * Deterministically wires all 20 v0.5.0 Build #32 UMD adapters (base + v0.4.7 + A27 Hour 83 + SpaceX HR-01..09)
 * into twin/integration/world/index.html (and twin/preview/world/index.html if present) without duplicates.
 * Places 14-drawcall-coalescer-120gate.js LAST so both initial and per-frame coalescing cover all scene modules.
 */
import fs from 'node:fs';
import path from 'node:path';

export const ADAPTER_SCRIPTS = [
  'adapters/01-version-hud.js',
  'adapters/02-security-and-unhang-fixes.js',
  'adapters/05-mapi-itm-and-dem-bridge-v2.js',
  'adapters/12-phys2-core-fixes.js',
  'adapters/15-sea-lod-governor.js',
  'adapters/18-carmel-judea-terrain-skirts.js',
  'adapters/34-negev-desert-biome.js',
  'adapters/60-missions-and-avatar-style.js',
  'adapters/65-bina-bonah-assets.js',
  'adapters/68-step-ecosystem-bridge.js',
  'adapters/71-starlink-leo-shell.js',
  'adapters/72-rf-link-budget.js',
  'adapters/73-gnss-leo-ekf.js',
  'adapters/74-uav-6dof-aerospace.js',
  'adapters/75-gfold-precision-landing.js',
  'adapters/76-mission-control-hud.js',
  'adapters/77-floating-origin-lod.js',
  'adapters/78-eoir-lidar-gimbal.js',
  'adapters/79-starlink-mesh-resilience.js',
  'adapters/80-spacex-a27-world-orchestrator.js',
  'adapters/81-lido-railing-itm-fix.js',
  'adapters/14-drawcall-coalescer-120gate.js'
];

export function wireHtmlString(html) {
  const missing = ADAPTER_SCRIPTS.filter((src) => !html.includes(src));
  if (missing.length === 0) {
    return { html, added: [] };
  }
  const tagsBlock = missing.map((src) => `  <script src="${src}"></script>`).join('\n');

  const adapterTagRe = /([ \t]*<script[^>]+src=["'][^"']*adapters\/[^"']+["'][^>]*><\/script>)/gi;
  let lastMatch = null;
  let m;
  while ((m = adapterTagRe.exec(html)) !== null) {
    lastMatch = m;
  }

  let updated;
  if (lastMatch) {
    const insertPos = lastMatch.index + lastMatch[0].length;
    updated = html.slice(0, insertPos) + '\n' + tagsBlock + html.slice(insertPos);
  } else if (/<\/body>/i.test(html)) {
    updated = html.replace(/<\/body>/i, tagsBlock + '\n</body>');
  } else {
    updated = html + '\n' + tagsBlock + '\n';
  }
  return { html: updated, added: missing };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const repoRoot = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
  const candidates = [
    path.join(repoRoot, 'twin/integration/world/index.html'),
    path.join(repoRoot, 'twin/preview/world/index.html')
  ];
  let wiredFiles = 0;
  for (const idxPath of candidates) {
    if (!fs.existsSync(idxPath)) continue;
    const orig = fs.readFileSync(idxPath, 'utf8');
    const { html, added } = wireHtmlString(orig);
    if (added.length > 0) {
      fs.writeFileSync(idxPath, html, 'utf8');
    }
    wiredFiles++;
    console.log(JSON.stringify({ file: path.relative(repoRoot, idxPath), addedCount: added.length, added }));
  }
  if (wiredFiles === 0) {
    console.error('ERROR: No index.html found under ' + repoRoot);
    process.exit(1);
  }
}
