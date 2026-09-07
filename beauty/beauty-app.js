/* Beauty orchestrator. Non-blocking pipeline:
   - camera video keeps flowing (compositor only uploads the <video> to a texture)
   - face detection + mask building run in a worker (or a throttled main fallback),
     *scheduled* independently of the compositor, never inside the draw call
   - between detections the last mask is reused; settings update only shader uniforms
   - adaptive quality controller degrades render/detect/effects BEFORE any recording FPS drop
   ES module. */
import { buildMaskCanvas } from './skin-mask.js';
import { prepare as ensureFaceModel, requestDetect, isLoaded as modelLoaded, closeFaceModel, lastLoadError, setResultHandler, detectionMode } from './face-tracker.js';
import { BeautyGL } from './beauty-gl.js';

var TIERS = [
  { render: 1.0,  detectRes: 900, detectEvery: 80,  effects: 0 }, // forte: 12.5 det/s
  { render: 0.72, detectRes: 640, detectEvery: 90,  effects: 0 },
  { render: 0.55, detectRes: 480, detectEvery: 110, effects: 1 }, // desliga uniformização
  { render: 0.38, detectRes: 360, detectEvery: 140, effects: 2 }  // desliga uniformização + retoque
];

var gl = null;
var videoEl = null;
var modelOk = false;
var modelFailed = false;
var active = false;

var lastFaceCount = 0;
var hasMask = false;
var maskImage = null;       // current mask (ImageBitmap from worker, or canvas)
var maskCanvas = null;      // reusable canvas for masks built on the main thread
var maskBuilt = false;      // true when a mask arrives/changes since last process
var pending = null;         // latest detection result awaiting consumption
var lmsPrev = null;         // previous smoothed landmarks (for the main-built path)

var lastOut = null;         // [outW, outH] from last frame
var lastFaceAt = 0;
var lostGrace = 900;

var tier = 0;
var cfg = TIERS[0];
var lastTierAt = 0;

var pumpT = null;
var lastDetectAt = 0;
var detectInFlight = false;
var detectTs = 0;
var motionBoostUntil = 0;
var startedAt = 0;
var frames = 0;
var adaptCount = 0;
var glMsEMA = 0;
var detectResults = 0;
var lastDetectMs = 0;
var lastResultErr = null;
var snapCv = null;

function now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

function applyTier() {
  cfg = TIERS[tier];
  if (gl) gl.setProcScale(cfg.render);
}

/* ---------- adaptive quality ---------- */
function tryAdapt(costMs) {
  glMsEMA = glMsEMA * 0.92 + costMs * 0.08;
  adaptCount++;
  if (adaptCount < 25) return;
  adaptCount = 0;
  var t = now();
  if (t - lastTierAt < 1500) return;
  if (glMsEMA > 26 && tier < TIERS.length - 1) {
    tier++;
    lastTierAt = t;
    applyTier();
  } else if (glMsEMA < 11 && tier > 0) {
    tier--;
    lastTierAt = t;
    applyTier();
  }
}

/* ---------- detection scheduler (never inside drawCompose) ---------- */
function videoDims() {
  if (!videoEl) return null;
  var w = videoEl.videoWidth, h = videoEl.videoHeight;
  if (!w || !h) return null;
  return [w, h];
}

function captureDetect() {
  var dims = videoDims();
  if (!dims) return;
  var vw = dims[0], vh = dims[1];
  var dw = Math.min(vw, cfg.detectRes);
  var dh = Math.max(2, Math.round(dw * vh / vw));
  var mw = 2, mh = 2;
  if (lastOut) { mw = Math.round(lastOut[0] * cfg.render); mh = Math.round(lastOut[1] * cfg.render); }
  if (mw < 2) mw = 2; if (mh < 2) mh = 2;
  detectTs = Math.max(detectTs + 1, now());
  var t0 = now();
  if (typeof createImageBitmap === 'function') {
    var attempt = function (bmp) {
      detectInFlight = false;
      if (!bmp) return;
      if (requestDetect(bmp, { ts: detectTs, maskW: mw, maskH: mh, t0: t0 })) detectInFlight = true;
    };
    detectInFlight = true; // reserve slot until the bitmap callback fires
    try {
      createImageBitmap(videoEl, { resizeWidth: dw, resizeQuality: 'medium' }).then(attempt).catch(function () {
        createImageBitmap(videoEl).then(attempt).catch(function () { detectInFlight = false; });
      });
    } catch (e) { detectInFlight = false; }
  } else {
    // no createImageBitmap: main-thread fallback uses a small snapshot canvas
    detectInFlight = false;
    if (!snapCv) snapCv = document.createElement('canvas');
    var scw = dw, sch = Math.round(dh);
    if (snapCv.width !== scw) { snapCv.width = scw; snapCv.height = sch; }
    var sctx = snapCv.getContext('2d', { alpha: false });
    try { sctx.drawImage(videoEl, 0, 0, scw, sch); } catch (e) { return; }
    if (requestDetect(snapCv, { ts: detectTs, maskW: mw, maskH: mh, t0: t0 })) detectInFlight = true;
  }
}

function pumpTick() {
  pumpT = null;
  if (!active || !modelOk) return;
  var t = now();
  var every = t < motionBoostUntil ? 55 : cfg.detectEvery;
  if (!detectInFlight && t - lastDetectAt >= every) {
    lastDetectAt = t;
    captureDetect();
  }
  pumpT = setTimeout(pumpTick, 20);
}

function startPump() {
  if (pumpT) return;
  pumpT = setTimeout(pumpTick, 20);
}

function stopPump() {
  if (pumpT) { clearTimeout(pumpT); pumpT = null; }
}

/* ---------- result consumption ---------- */
function consume() {
  if (!pending) return;
  var r = pending;
  pending = null;
  if (r.t0 != null) lastDetectMs = now() - r.t0;
  if (r.ok) detectResults++;
  lastResultErr = r.ok ? null : (r.err || null);

  if (r.count > 0) {
    lastFaceCount = 1;
    lastFaceAt = now();
  }

  var m = r.mask;
  if (r.lms && r.lms.length) {
    // fast-motion boost: temporarily raise detection cadence
    if (lmsPrev && lmsPrev.length === r.lms.length) {
      var d = 0, cx = 0, cy = 0, px = 0, py = 0;
      for (var i = 0; i < 468; i += 6) {
        cx += r.lms[i].x; cy += r.lms[i].y; px += lmsPrev[i].x; py += lmsPrev[i].y;
      }
      d = Math.abs(cx - px) + Math.abs(cy - py);
      if (d > 1.2) motionBoostUntil = now() + 600;
    }
    lmsPrev = r.lms;
    if (!m) {
      // worker without OffscreenCanvas / main fallback: build mask here, preallocated
      try {
        if (!lastOut) lastOut = [16, 16];
        var pw = Math.round(lastOut[0] * cfg.render);
        var ph = Math.round(lastOut[1] * cfg.render);
        if (pw < 2) pw = 2; if (ph < 2) ph = 2;
        m = buildMaskCanvas(r.lms, pw, ph, maskCanvas);
        maskCanvas = m;
      } catch (e) { m = null; }
    }
  }

  var newMask = m || null;
  if (newMask && m !== maskImage) {
    if (maskImage && maskImage !== m && maskImage.close && typeof maskImage.close === 'function') {
      try { maskImage.close(); } catch (e) {}
    }
    maskImage = m;
    hasMask = true;
    maskBuilt = true;
  } else if (newMask && m === maskImage) {
    hasMask = true;
    maskBuilt = true; // content may have changed in-place (reused canvas)
  }

  if (!newMask && r.count === 0 && now() - lastFaceAt > lostGrace) releaseMask();
}

function releaseMask() {
  if (maskImage && maskImage.close && typeof maskImage.close === 'function') {
    try { maskImage.close(); } catch (e) {}
  }
  maskImage = null;
  hasMask = false;
  lastFaceCount = 0;
  lastFaceAt = 0;
  maskBuilt = false;
}

/* ---------- public API ---------- */
export var BeautyApp = {
  configure(weak) {
    tier = weak ? 2 : 0;
    applyTier();
  },

  isModelReady() { return modelOk; },
  isFailed() { return modelFailed; },
  lastError() { return lastLoadError(); },
  hasFaces() { return lastFaceCount > 0; },
  isActive() { return active; },
  getGL() { return gl; },
  getPerf() {
    var rate = 0;
    if (startedAt) rate = Math.round(detectResults * 1000 / Math.max(1, now() - startedAt));
    return {
      mode: detectionMode(),
      tier: tier,
      render: cfg.render,
      detectRes: cfg.detectRes,
      detectEvery: cfg.detectEvery,
      effects: cfg.effects,
      glMs: Math.round(glMsEMA * 10) / 10,
      frames: frames,
      detectRatePerSec: rate,
      lastDetectMs: Math.round(lastDetectMs),
      lastResultErr: lastResultErr
    };
  },

  setActive(a) {
    active = !!a;
    if (active) {
      if (!startedAt) startedAt = now();
      startPump();
    } else {
      stopPump();
      releaseMask();
    }
  },

  setVideoEl(el) { videoEl = el; },

  loadModel() {
    if (modelOk) return Promise.resolve(true);
    if (modelFailed) return Promise.resolve(false);
    return ensureFaceModel().then(function (ok) {
      modelOk = ok;
      if (!ok) modelFailed = true;
      return ok;
    });
  },

  frame(video, ctx2d, outW, outH, mirror, settings) {
    if (!active || !modelOk) return false;
    if (!video) return false;
    lastOut = [outW, outH];
    consume();
    if (!hasMask || !maskImage) return false;
    if (!gl) {
      try { gl = new BeautyGL(cfg.render); }
      catch (e) { gl = null; return false; }
    }
    if (gl.procScale !== cfg.render) gl.setProcScale(cfg.render);
    var t0 = now();
    var ok = false;
    try {
      ok = gl.process(video, maskImage, settings, {
        outW: outW,
        outH: outH,
        mirror: mirror,
        effects: cfg.effects,
        skipMaskUpload: !maskBuilt
      });
    } catch (e) { ok = false; }
    if (ok && gl && gl.canvas) ctx2d.drawImage(gl.canvas, 0, 0, outW, outH);
    maskBuilt = false;
    frames++;
    tryAdapt(now() - t0);
    return ok;
  },

  dispose() {
    active = false;
    stopPump();
    if (gl) { try { gl.dispose(); } catch (e) {} gl = null; }
    closeFaceModel();
    modelOk = false;
    modelFailed = false;
    releaseMask();
    videoEl = null;
    pending = null;
    lmsPrev = null;
    lastOut = null;
  }
};

setResultHandler(function (r) {
  detectInFlight = false;
  pending = r;
});