/* ESH27 twin — atmosphere & art direction — public entry (ES module). Plain-script build: dist/esh27-atmosphere.js → window.ESH27Atmosphere */
export { createAtmosphere, TIERS } from './rig.js';
export { computeLook, LOOK_TUNING, lightsOnFor } from './look.js';
export * from './astro.js';
export * from './curves.js';
export * from './airquality.js';
export * from './palette.js';
export { patchMaterial, createShared, bakeLampMap, createSprites } from './nightlights.js';
export { createSky, createStars } from './sky.js';
export { AtmoPost } from './post.js';
export const VERSION = '0.1.0';
