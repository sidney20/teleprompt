/* Beauty settings: single fixed preset for skin smoothing. ES module. */
export var PRESETS = {
  natural: { label: 'Natural', beauty: 45, smooth: 50, retouch: 0, eyes: 0, teeth: 0, light: 0, uniform: 0 }
};

export var BEAUTY_DEFAULTS = {
  enabled: false,
  beauty: 45, smooth: 50, retouch: 0, eyes: 0, teeth: 0, light: 0, uniform: 0
};

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }

export function normalizeBeauty(s) {
  s = s || {};
  var o = { enabled: !!s.enabled };
  o.beauty = clamp(num(s.beauty, BEAUTY_DEFAULTS.beauty), 0, 100);
  o.smooth = clamp(num(s.smooth, BEAUTY_DEFAULTS.smooth), 0, 100);
  o.retouch = 0;
  o.eyes = 0;
  o.teeth = 0;
  o.light = 0;
  o.uniform = 0;
  return o;
}

export function fromPreset() {
  return { enabled: false, beauty: 45, smooth: 50, retouch: 0, eyes: 0, teeth: 0, light: 0, uniform: 0 };
}

export function beautyValuesForUI(s) {
  return normalizeBeauty(s || BEAUTY_DEFAULTS);
}
