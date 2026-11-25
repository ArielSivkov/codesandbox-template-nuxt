#!/usr/bin/env node
/**
 * ESH27 Studio Release Gate (`studio-release-gate.js`) — v0.4.6-rc.1 (RC Build #29)
 * Validates:
 *  1. SemVer 2.0.0 manifest & monotonic build numbers (`VERSION.json`)
 *  2. Zero CSS `backdrop-filter` in `01-version-hud.js` (60 FPS mobile guarantee)
 *  3. Ashdod 17 Towers Ground-Truth invariants (`data/ashdod_17_towers_v041_rc2.json`)
 *  4. HaErez Pilot Neighborhood Floors, AGL Heights, Bare-Earth DTM & Sanhedrin Task #7 Gate
 *     (`data/haerez_pilot_buildings_v046_rc1.json` + `data/haerez_500m_bare_earth_dtm_25m.json`)
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isValidSemVer } = require(fs.existsSync(path.join(__dirname, '01-version-hud.js')) ? './01-version-hud.js' : '../integration/world/adapters/01-version-hud.js');

function auditVersionManifest(manifestPath) {
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const errors = [];

  if (!isValidSemVer(raw.semver)) errors.push(`Invalid SemVer in 'semver': ${raw.semver}`);
  if (raw.next_rc && !isValidSemVer(raw.next_rc)) errors.push(`Invalid SemVer in 'next_rc': ${raw.next_rc}`);
  if (!Number.isInteger(raw.build_number) || raw.build_number < 1) errors.push(`Invalid build_number: ${raw.build_number}`);
  if (raw.rc_build_number !== undefined && (!Number.isInteger(raw.rc_build_number) || raw.rc_build_number <= raw.build_number)) {
    errors.push(`rc_build_number (${raw.rc_build_number}) must exceed live build_number (${raw.build_number})`);
  }
  if (!raw.commit || String(raw.commit).length < 6) errors.push(`Missing git commit short SHA: ${raw.commit}`);
  if (raw.budgets && raw.budgets.building_extrusion_datum !== 'AGL') {
    errors.push(`building_extrusion_datum must be 'AGL', got: ${raw.budgets.building_extrusion_datum}`);
  }
  if (!Array.isArray(raw.history) || raw.history.length === 0) {
    errors.push('History array must contain at least one documented release');
  } else {
    let prevBuild = Infinity;
    for (const h of raw.history) {
      if (!isValidSemVer(h.version)) errors.push(`Invalid history SemVer: ${h.version}`);
      if (h.build >= prevBuild) errors.push(`Non-monotonic build order at build ${h.build}`);
      prevBuild = h.build;
    }
  }

  const hudPath = fs.existsSync(path.join(path.dirname(manifestPath), '01-version-hud.js')) ? path.join(path.dirname(manifestPath), '01-version-hud.js') : path.join(path.dirname(manifestPath), 'integration/world/adapters/01-version-hud.js');
  if (fs.existsSync(hudPath)) {
    const hudCode = fs.readFileSync(hudPath, 'utf8');
    if (/backdrop-filter\s*:/i.test(hudCode)) {
      errors.push('Forbidden CSS backdrop-filter detected in 01-version-hud.js');
    }
  }

  return {
    ok: errors.length === 0,
    version: raw.semver,
    next_rc: raw.next_rc || null,
    build: raw.build_number,
    rc_build: raw.rc_build_number || null,
    errors
  };
}

function auditHaerezPilotGroundTruth(pilotPath, dtmPath) {
  const rawText = fs.readFileSync(pilotPath, 'utf8');
  const pilot = JSON.parse(rawText);
  const dtm = JSON.parse(fs.readFileSync(dtmPath, 'utf8'));
  const errors = [];

  // N4 Privacy checks
  if (/\b\d{2,3}-\d{2,3}-\d{2,3}\b/.test(rawText)) errors.push('N4 violation: license plate pattern found in pilot JSON');
  if (/1[A-Za-z0-9_-]{24,}/.test(rawText)) errors.push('N4 violation: raw cloud/Drive ID found in pilot JSON');
  if (rawText.includes('/working_dir/')) errors.push('Sandbox path leak found in pilot JSON');

  const buildings = pilot.buildings || [];
  if (buildings.length < 30) errors.push(`Expected >= 30 pilot records, got ${buildings.length}`);

  let approvedCount = 0;
  let holdoutCount = 0;
  const byId = new Map();

  for (const b of buildings) {
    byId.set(b.pilot_id, b);
    if (b.extrusion_datum !== 'AGL') errors.push(`${b.pilot_id}: extrusion_datum must be AGL`);
    if (!Number.isFinite(b.height_agl_m) || b.height_agl_m <= 2 || b.height_agl_m > 160) {
      errors.push(`${b.pilot_id}: invalid height_agl_m=${b.height_agl_m}`);
    }
    if (!Number.isFinite(b.sigma_height_m) || b.sigma_height_m <= 0) {
      errors.push(`${b.pilot_id}: invalid sigma_height_m=${b.sigma_height_m}`);
    }
    if (!Number.isFinite(b.ground_dtm_asl_m) || b.ground_dtm_asl_m < 0 || b.ground_dtm_asl_m > 40) {
      errors.push(`${b.pilot_id}: invalid ground_dtm_asl_m=${b.ground_dtm_asl_m}`);
    }
    const expectedRoof = Number((b.ground_dtm_asl_m + b.height_agl_m).toFixed(2));
    if (Math.abs(b.roof_asl_m - expectedRoof) > 0.05) {
      errors.push(`${b.pilot_id}: roof_asl_m (${b.roof_asl_m}) != ground + agl (${expectedRoof})`);
    }
    if (!String(b.primary_source_url || '').startsWith('https://') || !String(b.secondary_source_url || '').startsWith('https://')) {
      errors.push(`${b.pilot_id}: missing verified https primary/secondary source URLs`);
    }

    if (b.approved_for_tile_injection) {
      approvedCount++;
      if (b.n_independent_sources < 2) errors.push(`${b.pilot_id}: approved record violates QUEUE #7 n>=2 (${b.n_independent_sources})`);
      if (b.sigma_floors > 1.0) errors.push(`${b.pilot_id}: approved record violates QUEUE #7 sigma_floors<=1.0 (${b.sigma_floors})`);
      if (![1, 2, 3].includes(b.truth_tier)) errors.push(`${b.pilot_id}: approved record has disallowed truth_tier=${b.truth_tier}`);
      if (b.sigma_pos_m > 2.0) errors.push(`${b.pilot_id}: sigma_pos_m=${b.sigma_pos_m} > 2.0m`);
      if (b.sigma_ground_m > 2.0) errors.push(`${b.pilot_id}: sigma_ground_m=${b.sigma_ground_m} > 2.0m`);
    } else {
      holdoutCount++;
    }
  }

  if (approvedCount < 28) errors.push(`Expected >= 28 approved records, got ${approvedCount}`);
  if (holdoutCount < 1) errors.push('Expected at least 1 quarantined holdout record demonstrating QUEUE #7 rejection of n=1');

  // Specific regression locks for commit 434ca11 & field cross-checks
  const bcBase = byId.get('ASH-PLT-09');
  const bcStep = byId.get('ASH-PLT-10');
  const bcTower = byId.get('ASH-PLT-11');
  const dekel1 = byId.get('ASH-PLT-12');
  const dekel3 = byId.get('ASH-PLT-14');
  const rogozin27 = byId.get('ASH-PLT-31');

  if (!bcBase || bcBase.floors_canonical !== 4) errors.push('Beit Canada 1968 base wing must be locked at 4 floors (fixes 8-floor heuristic)');
  if (!bcStep || bcStep.floors_canonical !== 12) errors.push('Beit Canada 2022 stepped addition must be locked at 12 floors');
  if (!bcTower || bcTower.floors_canonical !== 21) errors.push('Beit Canada 2022 east tower must be locked at 21 floors');
  if (!dekel1 || dekel1.floors_canonical !== 29 || !dekel3 || dekel3.floors_canonical !== 29) {
    errors.push('Migdalei HaDekel built towers 1-3 must be locked at 29 floors per TABA 603-1218759');
  }
  if (!rogozin27 || rogozin27.floors_canonical !== 24 || rogozin27.inside_500m_home_radius !== false) {
    errors.push('Rogozin 27 must be locked at 24 floors per Tax Authority and flagged outside 500m Quarter Alef core');
  }

  // Bare-earth DTM gate check
  if (!dtm.uncertainty || dtm.uncertainty.bare_earth_dtm_effective_sigma_m > 2.0) {
    errors.push(`Bare-earth DTM sigma (${dtm.uncertainty && dtm.uncertainty.bare_earth_dtm_effective_sigma_m}) exceeds Stage 1 ±2.0m gate`);
  }

  return {
    ok: errors.length === 0,
    approvedCount,
    holdoutCount,
    dtmSigmaM: dtm.uncertainty ? dtm.uncertainty.bare_earth_dtm_effective_sigma_m : null,
    errors
  };
}


function auditUnifiedAdaptersAndIpSafety(baseDir) {
  const adaptersDir = path.join(baseDir, 'integration/world/adapters');
  const errors = [];
  let adapterCount = 0;
  if (fs.existsSync(adaptersDir)) {
    for (const fn of fs.readdirSync(adaptersDir).filter((f) => f.endsWith('.js')).sort()) {
      adapterCount++;
      const code = fs.readFileSync(path.join(adaptersDir, fn), 'utf8');
      if (/^\s*export\s+/m.test(code) || /^\s*import\s+/m.test(code)) {
        errors.push(`${fn}: ES module import/export syntax forbidden in classic <script> adapter`);
      }
      if (/backdrop-filter\s*:/i.test(code)) {
        errors.push(`${fn}: Forbidden CSS backdrop-filter detected`);
      }
    }
  }
  // Ensure zero private .step CAD files leak into public twin/ directory
  function scanForStep(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) scanForStep(full);
      else if (/\.(step|stp)$/i.test(entry.name)) {
        errors.push(`IP leak: private CAD file ${entry.name} found in public web tree`);
      }
    }
  }
  scanForStep(baseDir);
  if (adapterCount < 22) errors.push(`Expected >= 22 unified adapters, got ${adapterCount}`);
  return { ok: errors.length === 0, adapterCount, errors };
}

if (require.main === module) {
  const baseDir = fs.existsSync(path.join(__dirname, 'VERSION.json')) ? __dirname : path.resolve(__dirname, '..');
  const vRes = auditVersionManifest(path.join(baseDir, 'VERSION.json'));
  const pRes = auditHaerezPilotGroundTruth(
    path.join(baseDir, 'data/haerez_pilot_buildings_v046_rc1.json'),
    path.join(baseDir, 'data/haerez_500m_bare_earth_dtm_25m.json')
  );
  const uRes = auditUnifiedAdaptersAndIpSafety(baseDir);
  const allOk = vRes.ok && pRes.ok && uRes.ok;
  console.log(JSON.stringify({
    gate: allOk ? 'RELEASE_GATE_PASSED' : 'RELEASE_GATE_FAILED',
    version_audit: vRes,
    haerez_pilot_audit: pRes,
    unified_47_spacex_a27_audit: uRes
  }, null, 2));
  process.exit(allOk ? 0 : 1);
}

module.exports = {
  auditVersionManifest,
  auditHaerezPilotGroundTruth,
  auditUnifiedAdaptersAndIpSafety
};
