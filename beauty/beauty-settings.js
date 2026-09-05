/* Beauty settings: presets and sanitization. ES module. */
export var PRESETS = {
  natural: { label: 'Natural', beauty: 35, smooth: 35, retouch: 15, eyes: 10, teeth: 5, light: 10, uniform: 15 },
  suave: { label: 'Suave', beauty: 55, smooth: 55, retouch: 30, eyes: 15, teeth: 10, light: 20, uniform: 25 },
  glamour: { label: 'Glamour', beauty: 75, smooth: 75, retouch: 45, eyes: 20, teeth: 20, light: 30, uniform: 35 }
};

export var BEAUTY_DEFAULTS = {
  enabled: false,
  preset: 'natural',
  beauty: 35, smooth: 35, retouch: 15, eyes: 10, teeth: 5, light: 10, uniform: 15
};

var KEYS = ['beauty', 'smooth', 'retouch', 'eyes', 'teeth', 'light', 'uniform'];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }

export function normalizeBeauty(s) {
  s = s || {};
  var o = {
    enabled: !!s.enabled,
    preset: PRESETS[s.preset] ? s.preset : 'natural'
  };
  for (var i = 0; i < KEYS.length; i++) {
    var k = KEYS[i];
    o[k] = clamp(num(s[k], BEAUTY_DEFAULTS[k]), 0, 100);
  }
  return o;
}

export function fromPreset(name) {
  var p = PRESETS[name] || PRESETS.natural;
  var o = { enabled: false, preset: name || 'natural' };
  for (var i = 0; i < KEYS.length; i++) {
    var k = KEYS[i];
    o[k] = p[k];
  }
  return o;
}

export function beautyValuesForUI(s) {
  return normalizeBeauty(s || BEAUTY_DEFAULTS);
}