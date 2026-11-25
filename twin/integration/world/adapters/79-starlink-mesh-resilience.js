/**
 * 79-starlink-mesh-resilience.js
 * ESH27 Twin World & Aerospace Simulation — Stage HR-09 (v0.5.0-hr09)
 *
 * First-Principles Hybrid Emergency Communications & Solar Edge-AI Resilience Simulator
 * (Starlink LEO Gateways + Airborne ORB-249 38cc UAV Relays + Off-Grid Solar/LiFePO4 Edge-AI Nodes)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TwinStarlinkMeshResilience = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const C_LIGHT = 299792458.0;
  const MESH_RF_CONFIG = Object.freeze({
    freqHz: 5.8e9,
    wavelengthM: C_LIGHT / 5.8e9,
    bandwidthHz: 40.0e6,
    txPowerDbm: 30.0,
    antennaGainDbi: 22.0,
    noiseFloorDbm: -95.0,
    macEfficiency: 0.62,
    packetBits: 12000.0,
    flowLoadBps: 18.0e6,
    hopProcDelayMs: 1.15,
    starlinkLeoRttMs: 26.20,
    fiberNominalRttMs: 6.40,
    hardLatencyGateMs: 45.0
  });

  const MICROGRID_CONFIG = Object.freeze({
    batteryCapacityWh: 1280.0,
    initialEnergyWh: 1152.0,
    continuousLoadW: 28.0,
    solarPeakWp: 180.0,
    chargeEfficiency: 0.95,
    inverterEfficiency: 0.94
  });

  const ASHDOD_MESH_NODES = Object.freeze([
    { id: 0,  code: 'GW_KTOWERS',        role: 'GATEWAY', nameHe: 'שער Starlink מגדלי K (+148m)',          enu: [-160.0, 148.0,  110.0], scene: [-48.0, 53.0,  34.0] },
    { id: 1,  code: 'GW_PORT_BARGE',     role: 'GATEWAY', nameHe: 'שער Starlink נמל אשדוד (+18m)',         enu: [-420.0,  18.0, -340.0], scene: [-95.0,  8.0, -88.0] },
    { id: 2,  code: 'GW_GIVAT_YONA',     role: 'GATEWAY', nameHe: 'שער Starlink גבעת יונה (+53m)',         enu: [ 310.0,  53.0, -290.0], scene: [ 82.0, 26.0, -76.0] },
    { id: 3,  code: 'UAV_RELAY_ALPHA',   role: 'UAV',     nameHe: 'ממסר רחפן ORB-249 אלפא (הארז/רוגוזין)', enu: [  15.0,  92.0,  -15.0], scene: [  6.0, 42.0,  -6.0] },
    { id: 4,  code: 'UAV_RELAY_BRAVO',   role: 'UAV',     nameHe: 'ממסר רחפן ORB-249 בראבו (הדקל/דמרי)',   enu: [-110.0, 118.0,   45.0], scene: [-32.0, 48.0,  16.0] },
    { id: 5,  code: 'UAV_RELAY_CHARLIE', role: 'UAV',     nameHe: 'ממסר רחפן ORB-249 צ׳ארלי (ציר נמל)',    enu: [-210.0,  96.0, -160.0], scene: [-56.0, 40.0, -45.0] },
    { id: 6,  code: 'EDGE_HAEREZ4_HQ',   role: 'EDGE',    nameHe: 'מוקד Edge-AI הארז 4 (חמ"ל ואתר)',       enu: [   0.0,  13.5,    0.0], scene: [  0.0,  6.5,   0.0] },
    { id: 7,  code: 'EDGE_ROGOZIN27',    role: 'EDGE',    nameHe: 'מוקד Edge-AI רוגוזין 27 (מקלט עירוני)',  enu: [  65.0,  24.0,  -45.0], scene: [ 22.0, 11.0, -14.0] },
    { id: 8,  code: 'EDGE_HADEKEL_SITE', role: 'EDGE',    nameHe: 'מוקד Edge-AI מגדלי הדקל (עגורן שלד)',   enu: [  42.0,  58.0,   52.0], scene: [ 18.0, 28.0, -20.0] },
    { id: 9,  code: 'EDGE_DIMRI_TOWER',  role: 'EDGE',    nameHe: 'מוקד Edge-AI מגדל דמרי (+42m)',         enu: [-125.0,  42.0,  -35.0], scene: [-38.0, 19.0, -12.0] },
    { id: 10, code: 'EDGE_MARINA_SOUTH', role: 'EDGE',    nameHe: 'מוקד Edge-AI מרינה אשדוד (+12m)',       enu: [-250.0,  12.0,  150.0], scene: [-68.0,  6.0,  46.0] },
    { id: 11, code: 'EDGE_NORTH_INDUST', role: 'EDGE',    nameHe: 'מוקד Edge-AI אזור תעשייה צפוני',        enu: [ 210.0,  16.0, -140.0], scene: [ 58.0,  8.0, -42.0] }
  ]);

  const EMERGENCY_SCENARIOS = Object.freeze({
    NOMINAL_FIBER_AND_STARLINK: {
      id: 'NOMINAL_FIBER_AND_STARLINK',
      nameHe: 'שגרה: סיבים אופטיים + חשמל רציף + גיבוי Starlink',
      failedNodes: [],
      activeGateways: [0, 1, 2],
      baseBackhaulMs: 6.40
    },
    BLACKOUT_AND_FIBER_CUT: {
      id: 'BLACKOUT_AND_FIBER_CUT',
      nameHe: 'חירום עירוני: קריסת סיבים + הפסקת חשמל (מעבר ל-Starlink + רחפנים)',
      failedNodes: [],
      activeGateways: [0, 1, 2],
      baseBackhaulMs: 26.20
    },
    EXTREME_BLACKOUT_KTOWERS_AND_BRAVO_LOST: {
      id: 'EXTREME_BLACKOUT_KTOWERS_AND_BRAVO_LOST',
      nameHe: 'קטסטרופה רב-זירתית: עלטה + קריסת סיבים + השבתת שער מגדלי K וממסר בראבו',
      failedNodes: [0, 4],
      activeGateways: [1, 2],
      baseBackhaulMs: 26.20
    }
  });

  function evaluateMeshLink(uIdx, vIdx, failedSet = new Set()) {
    if (uIdx === vIdx || failedSet.has(uIdx) || failedSet.has(vIdx)) return null;
    const nu = ASHDOD_MESH_NODES[uIdx];
    const nv = ASHDOD_MESH_NODES[vIdx];
    const dx = nu.enu[0] - nv.enu[0];
    const dy = nu.enu[1] - nv.enu[1];
    const dz = nu.enu[2] - nv.enu[2];
    const distM = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const hasUav = nu.role === 'UAV' || nv.role === 'UAV';
    const hasHighGw = nu.enu[1] >= 120.0 || nv.enu[1] >= 120.0;
    const maxRangeM = (hasUav || hasHighGw) ? 650.0 : 320.0;
    if (distM > maxRangeM) return null;

    const fsplDb = 20.0 * Math.log10((4.0 * Math.PI * distM) / MESH_RF_CONFIG.wavelengthM);
    const minAlt = Math.min(nu.enu[1], nv.enu[1]);
    const maxAlt = Math.max(nu.enu[1], nv.enu[1]);
    const urbanCanyonBlocked = minAlt < 30.0 && maxAlt < 85.0 && distM > 140.0;
    const nlosDb = urbanCanyonBlocked ? 24.5 : (hasUav ? 1.5 : 3.2);
    const prxDbm = MESH_RF_CONFIG.txPowerDbm + MESH_RF_CONFIG.antennaGainDbi - fsplDb - nlosDb;
    const snrDb = prxDbm - MESH_RF_CONFIG.noiseFloorDbm;
    if (snrDb < 6.0) return null;

    const snrLin = Math.pow(10.0, snrDb / 10.0);
    const rawCapBps = MESH_RF_CONFIG.macEfficiency * MESH_RF_CONFIG.bandwidthHz * Math.log2(1.0 + snrLin);
    const effCapBps = Math.max(MESH_RF_CONFIG.flowLoadBps + 5.0e6, Math.min(rawCapBps, 280.0e6));

    const propMs = (distM / C_LIGHT) * 1000.0;
    const queueMs = (MESH_RF_CONFIG.packetBits / (effCapBps - MESH_RF_CONFIG.flowLoadBps)) * 1000.0;
    const hopLatencyMs = propMs + MESH_RF_CONFIG.hopProcDelayMs + queueMs + (urbanCanyonBlocked ? 6.5 : 0.0);

    return {
      u: uIdx,
      v: vIdx,
      distM,
      snrDb,
      capacityMbps: effCapBps / 1e6,
      hopLatencyMs
    };
  }

  function computeLaplacianFiedlerLambda2(adjMatrix) {
    const m = adjMatrix.length;
    if (m <= 1) return 0.0;

    const a = new Array(m);
    for (let i = 0; i < m; i++) {
      a[i] = new Float64Array(m);
      let deg = 0.0;
      for (let j = 0; j < m; j++) {
        if (i !== j) {
          a[i][j] = -adjMatrix[i][j];
          deg += adjMatrix[i][j];
        }
      }
      a[i][i] = deg;
    }

    for (let sweep = 0; sweep < 45; sweep++) {
      let maxOff = 0.0;
      let p = 0, q = 1;
      for (let i = 0; i < m; i++) {
        for (let j = i + 1; j < m; j++) {
          const val = Math.abs(a[i][j]);
          if (val > maxOff) {
            maxOff = val;
            p = i;
            q = j;
          }
        }
      }
      if (maxOff < 1e-12) break;

      const app = a[p][p];
      const aqq = a[q][q];
      const apq = a[p][q];
      const tau = (aqq - app) / (2.0 * apq);
      const t = Math.sign(tau || 1.0) / (Math.abs(tau) + Math.sqrt(1.0 + tau * tau));
      const c = 1.0 / Math.sqrt(1.0 + t * t);
      const s = t * c;

      a[p][p] = app - t * apq;
      a[q][q] = aqq + t * apq;
      a[p][q] = a[q][p] = 0.0;

      for (let k = 0; k < m; k++) {
        if (k !== p && k !== q) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = a[p][k] = c * akp - s * akq;
          a[k][q] = a[q][k] = s * akp + c * akq;
        }
      }
    }

    const eigs = new Array(m);
    for (let i = 0; i < m; i++) eigs[i] = a[i][i];
    eigs.sort((x, y) => x - y);
    return Math.max(0.0, eigs[1]);
  }

  function evaluateEmergencyMeshScenario(scenarioKey = 'BLACKOUT_AND_FIBER_CUT', customFailedIds = null) {
    const sc = EMERGENCY_SCENARIOS[scenarioKey] || EMERGENCY_SCENARIOS.BLACKOUT_AND_FIBER_CUT;
    const failedSet = new Set(Array.isArray(customFailedIds) ? customFailedIds : sc.failedNodes);
    const n = ASHDOD_MESH_NODES.length;

    const adj = Array.from({ length: n }, () => []);
    const links = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const lnk = evaluateMeshLink(i, j, failedSet);
        if (lnk) {
          adj[i].push({ to: j, weightMs: lnk.hopLatencyMs, link: lnk });
          adj[j].push({ to: i, weightMs: lnk.hopLatencyMs, link: lnk });
          links.push(lnk);
        }
      }
    }

    const activeIds = [];
    const idToSub = new Map();
    for (let i = 0; i < n; i++) {
      if (!failedSet.has(i)) {
        idToSub.set(i, activeIds.length);
        activeIds.push(i);
      }
    }

    const m = activeIds.length;
    const adjSub = Array.from({ length: m }, () => new Float64Array(m));
    for (const lnk of links) {
      const si = idToSub.get(lnk.u);
      const sj = idToSub.get(lnk.v);
      if (si !== undefined && sj !== undefined) {
        adjSub[si][sj] = 1.0;
        adjSub[sj][si] = 1.0;
      }
    }
    const fiedlerLambda2 = computeLaplacianFiedlerLambda2(adjSub);

    const distMs = new Float64Array(n).fill(Infinity);
    const hops = new Int32Array(n).fill(0);
    const parent = new Int32Array(n).fill(-1);
    const visited = new Uint8Array(n);

    for (const gw of sc.activeGateways) {
      if (!failedSet.has(gw)) {
        distMs[gw] = sc.baseBackhaulMs;
      }
    }

    for (let step = 0; step < n; step++) {
      let u = -1;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        if (!visited[i] && !failedSet.has(i) && distMs[i] < bestD) {
          bestD = distMs[i];
          u = i;
        }
      }
      if (u === -1) break;
      visited[u] = 1;
      for (const edge of adj[u]) {
        const v = edge.to;
        if (!visited[v] && distMs[u] + edge.weightMs < distMs[v]) {
          distMs[v] = distMs[u] + edge.weightMs;
          hops[v] = hops[u] + 1;
          parent[v] = u;
        }
      }
    }

    let maxEdgeLatencyMs = 0.0;
    let connectedEdgeNodes = 0;
    const activeTreeEdges = [];
    for (let i = 0; i < n; i++) {
      if (failedSet.has(i)) continue;
      if (parent[i] !== -1) {
        activeTreeEdges.push([i, parent[i]]);
      }
      if (ASHDOD_MESH_NODES[i].role === 'EDGE' && Number.isFinite(distMs[i])) {
        connectedEdgeNodes++;
        if (distMs[i] > maxEdgeLatencyMs) maxEdgeLatencyMs = distMs[i];
      }
    }

    const haerez4PathCodes = [];
    const haerez4PathIds = [];
    let cur = 6;
    while (cur !== -1 && !failedSet.has(cur)) {
      haerez4PathIds.push(cur);
      haerez4PathCodes.push(ASHDOD_MESH_NODES[cur].code);
      cur = parent[cur];
    }

    return {
      scenarioId: sc.id,
      scenarioNameHe: sc.nameHe,
      activeNodesCount: activeIds.length,
      activeLinksCount: links.length,
      fiedlerLambda2,
      connectedEdgeNodes,
      haerez4LatencyMs: distMs[6],
      maxEdgeLatencyMs,
      within45msGate: maxEdgeLatencyMs < MESH_RF_CONFIG.hardLatencyGateMs,
      haerez4Hops: hops[6],
      haerez4PathCodes,
      haerez4PathIds,
      activeTreeEdges,
      links,
      failedSet
    };
  }

  function simulateSolarMicrogrid72h(nSteps = 720) {
    const capWh = MICROGRID_CONFIG.batteryCapacityWh;
    let energyWh = MICROGRID_CONFIG.initialEnergyWh;
    let minSocPct = (energyWh / capWh) * 100.0;
    const dtHr = 72.0 / Math.max(10, nSteps | 0);
    const omega = (2.0 * Math.PI) / 24.0;

    function solarPowerW(tHours) {
      const diurnal = 0.5 * (1.0 + Math.sin(omega * (tHours - 1.5)));
      const cloudFactor = 0.84 - 0.10 * Math.sin(tHours * 0.37);
      return MICROGRID_CONFIG.solarPeakWp * cloudFactor * Math.pow(diurnal, 4);
    }

    function dEdt(tHours) {
      return MICROGRID_CONFIG.chargeEfficiency * solarPowerW(tHours) -
        (MICROGRID_CONFIG.continuousLoadW / MICROGRID_CONFIG.inverterEfficiency);
    }

    const socSeries = new Float32Array(nSteps + 1);
    socSeries[0] = minSocPct;

    for (let s = 0; s < nSteps; s++) {
      const t = s * dtHr;
      const k1 = dEdt(t);
      const k23 = dEdt(t + 0.5 * dtHr);
      const k4 = dEdt(t + dtHr);
      energyWh = Math.min(capWh, Math.max(0.0, energyWh + (dtHr / 6.0) * (k1 + 4.0 * k23 + k4)));
      const soc = (energyWh / capWh) * 100.0;
      socSeries[s + 1] = soc;
      if (soc < minSocPct) minSocPct = soc;
    }

    const darkAutonomyHours = (MICROGRID_CONFIG.initialEnergyWh - 0.10 * capWh) /
      (MICROGRID_CONFIG.continuousLoadW / MICROGRID_CONFIG.inverterEfficiency);

    return {
      batteryCapacityWh: capWh,
      continuousLoadW: MICROGRID_CONFIG.continuousLoadW,
      minSoc72hPct: minSocPct,
      finalSoc72hPct: (energyWh / capWh) * 100.0,
      darkAutonomyHours,
      survives72hBlackout: minSocPct > 20.0,
      socSeries
    };
  }

  function createThreeMeshResilienceLayer(THREE, parentGroup, options = {}) {
    const group = new THREE.Group();
    parentGroup.add(group);

    const nodeGeo = new THREE.OctahedronGeometry(1.55, 0);
    const nodeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const nodeInst = new THREE.InstancedMesh(nodeGeo, nodeMat, ASHDOD_MESH_NODES.length);
    group.add(nodeInst);

    const maxSegments = 64;
    const linePositions = new Float32Array(maxSegments * 2 * 3);
    const lineColors = new Float32Array(maxSegments * 2 * 3);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    lineGeo.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));
    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9
    });
    const linkLines = new THREE.LineSegments(lineGeo, lineMat);
    group.add(linkLines);

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let currentReport = evaluateEmergencyMeshScenario(options.scenarioKey || 'BLACKOUT_AND_FIBER_CUT');

    function applyScenario(scenarioKey) {
      currentReport = evaluateEmergencyMeshScenario(scenarioKey);

      for (let i = 0; i < ASHDOD_MESH_NODES.length; i++) {
        const nd = ASHDOD_MESH_NODES[i];
        const isFailed = currentReport.failedSet.has(i);
        dummy.position.set(nd.scene[0], nd.scene[1], nd.scene[2]);
        const s = isFailed ? 0.55 : (nd.role === 'GATEWAY' ? 1.45 : (nd.role === 'UAV' ? 1.25 : 1.0));
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        nodeInst.setMatrixAt(i, dummy.matrix);

        if (isFailed) {
          color.setHex(0xef4444);
        } else if (nd.role === 'GATEWAY') {
          color.setHex(0x38bdf8);
        } else if (nd.role === 'UAV') {
          color.setHex(0xf59e0b);
        } else {
          color.setHex(0x10b981);
        }
        if (nodeInst.setColorAt) nodeInst.setColorAt(i, color);
      }
      nodeInst.instanceMatrix.needsUpdate = true;
      if (nodeInst.instanceColor) nodeInst.instanceColor.needsUpdate = true;

      const treeSet = new Set();
      for (const [u, v] of currentReport.activeTreeEdges) {
        treeSet.add(u < v ? `${u}-${v}` : `${v}-${u}`);
      }

      linePositions.fill(0);
      lineColors.fill(0);
      const count = Math.min(maxSegments, currentReport.links.length);
      for (let idx = 0; idx < count; idx++) {
        const lnk = currentReport.links[idx];
        const nu = ASHDOD_MESH_NODES[lnk.u];
        const nv = ASHDOD_MESH_NODES[lnk.v];
        const key = lnk.u < lnk.v ? `${lnk.u}-${lnk.v}` : `${lnk.v}-${lnk.u}`;
        const isPrimaryTree = treeSet.has(key);

        const base = idx * 6;
        linePositions[base + 0] = nu.scene[0];
        linePositions[base + 1] = nu.scene[1];
        linePositions[base + 2] = nu.scene[2];
        linePositions[base + 3] = nv.scene[0];
        linePositions[base + 4] = nv.scene[1];
        linePositions[base + 5] = nv.scene[2];

        const r = isPrimaryTree ? 0.06 : 0.22;
        const g = isPrimaryTree ? 0.92 : 0.45;
        const b = isPrimaryTree ? 0.65 : 0.72;
        lineColors[base + 0] = r; lineColors[base + 1] = g; lineColors[base + 2] = b;
        lineColors[base + 3] = r; lineColors[base + 4] = g; lineColors[base + 5] = b;
      }
      lineGeo.attributes.position.needsUpdate = true;
      lineGeo.attributes.color.needsUpdate = true;
      return currentReport;
    }

    function updatePulse(timeSec) {
      for (let i = 0; i < ASHDOD_MESH_NODES.length; i++) {
        const nd = ASHDOD_MESH_NODES[i];
        if (nd.role === 'UAV' && !currentReport.failedSet.has(i)) {
          const hoverY = nd.scene[1] + 1.2 * Math.sin(timeSec * 2.1 + i);
          dummy.position.set(nd.scene[0], hoverY, nd.scene[2]);
          dummy.scale.set(1.25, 1.25, 1.25);
          dummy.updateMatrix();
          nodeInst.setMatrixAt(i, dummy.matrix);
        }
      }
      nodeInst.instanceMatrix.needsUpdate = true;
    }

    applyScenario(options.scenarioKey || 'BLACKOUT_AND_FIBER_CUT');

    function dispose() {
      nodeGeo.dispose();
      nodeMat.dispose();
      lineGeo.dispose();
      lineMat.dispose();
    }

    return {
      group,
      nodeInst,
      linkLines,
      applyScenario,
      updatePulse,
      getReport: () => currentReport,
      dispose
    };
  }

  return {
    MESH_RF_CONFIG,
    MICROGRID_CONFIG,
    ASHDOD_MESH_NODES,
    EMERGENCY_SCENARIOS,
    evaluateMeshLink,
    computeLaplacianFiedlerLambda2,
    evaluateEmergencyMeshScenario,
    simulateSolarMicrogrid72h,
    createThreeMeshResilienceLayer
  };
});
