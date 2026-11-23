/* מקום מוכן ל-look-pro של מחלקת הרינדור (swarm/shaders/look-pro.js) — כבוי עד שהמחלקה מדווחת שהוא מוכן. הפעלה: ?look-pro=1 או לוח המודולים.
 * הסקריפט נטען רק כשמפעילים (לא עולה כלום כשהוא כבוי). רישום ידני (LOOKPRO_MANUAL) כדי לשלוט בסדר ובברירת המחדל.
 * בלעדי מול מחלקת האווירה (שניהם מחליפים את ה-render): כשהוא עולה — האווירה מושבתת זמנית, וחוזרת כשהוא כבה.
 */
(function () {
  'use strict';
  window.LOOKPRO_MANUAL = true;
  const self = { id: 'look-pro', name: 'מראה מקצועי (look-pro, מחלקת הרינדור)', dept: 'shaders', order: 33, defaultOff: true, timeoutMs: 45000,
    scripts: ['mods/shaders/look-pro.js'], requires: () => !!(window.LookPro || (window.ESH27 && window.ESH27.LookPro)),
    async init(world, api) {
      const LP = window.LookPro || window.ESH27.LookPro, def = LP.plugin({ order: 33 });
      if (YZW.plugins().find(p => p.id === 'atmosphere' && p.state === 'on')) { YZW.enable('atmosphere', false, true); self._atmoWasOn = true; }
      self.update = def.update; self.render = def.render; self.settings = def.settings; self._dispose = def.dispose;
      return def.init(world, api);
    },
    dispose(world) { if (self._dispose) try { self._dispose(world); } catch (e) { /* */ } if (self._atmoWasOn) { self._atmoWasOn = false; setTimeout(() => YZW.enable('atmosphere', true, true), 0); } },
  };
  YZW.register(self);
})();
