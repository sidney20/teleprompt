/* Face detection facade. Two modes:
   - 'worker' (primary): MediaPipe runs inside a dedicated worker with masks built off-main-thread.
   - 'main' (fallback): classic synchronous detection on a reduced snapshot, kept for old Safari/iOS.
   Detection is always requested by the caller (BeautyApp scheduler); the main thread never blocks
   on the compositor when the worker path is active. ES module. */

var MODULE_BUNDLE = new URL('../vendor/mediapipe/vision_bundle.mjs', import.meta.url).href;
var FACE_DIR = new URL('../vendor/mediapipe/', import.meta.url).href;
var FACE_MODEL = new URL('../vendor/mediapipe/face_landmarker.task', import.meta.url).href;
var WASM_LOADER = new URL('../vendor/mediapipe/vision_wasm_internal.js', import.meta.url).href;
var WASM_BINARY = new URL('../vendor/mediapipe/vision_wasm_internal.wasm', import.meta.url).href;

var mode = null;          // 'worker' | 'main' | null
var worker = null;        // Worker instance (worker mode)
var workerReady = false;
var workerBroken = false;
var lastError = null;
var resultHandler = null;
var busy = false;
var nextId = 1;

// main-thread fallback state
var landmarker = null;
var resolver = null;
var loadPromise = null;
var fbMask = null; // reusable mask canvas for the main fallback

export function faceModelPaths() {
  return { loader: WASM_LOADER, binary: WASM_BINARY, model: FACE_MODEL };
}

export function isLoaded() { return workerReady || !!landmarker; }
export function lastLoadError() { return lastError; }
export function setResultHandler(cb) { resultHandler = cb; }
export function detectionMode() { return mode; }

function emit(r) {
  if (resultHandler) { try { resultHandler(r); } catch (e) {} }
}

function workerSupported() {
  try {
    if (typeof Worker === 'undefined') return false;
    if (typeof ImageBitmap === 'undefined') return false;
    if (typeof createImageBitmap !== 'function') return false;
    return true;
  } catch (e) { return false; }
}

/* ---------- worker path ---------- */
function ensureWorker() {
  var u = new URL('./face-worker.js', import.meta.url).href;
  worker = new Worker(u);
  worker.onmessage = function (e) {
    var d = e.data || {};
    if (d.type === 'init-done') {
      if (d.ok) workerReady = true;
      else { workerBroken = true; lastError = d.err || 'worker init falhou'; }
      return;
    }
    if (d.type === 'result') {
      busy = false;
      emit(d);
      return;
    }
  };
  worker.onerror = function (err) {
    workerBroken = true;
    busy = false;
    lastError = err && err.message ? err.message : 'worker erro';
  };
  worker.postMessage({
    type: 'init',
    module: MODULE_BUNDLE,
    dir: FACE_DIR,
    model: FACE_MODEL,
    maskModule: new URL('./skin-mask.js', import.meta.url).href
  });
  return worker;
}

/* ---------- main-thread fallback path ---------- */
export function ensureFaceModel() {
  if (landmarker) return Promise.resolve(true);
  if (loadPromise) return loadPromise;
  loadPromise = Promise.resolve().then(function () {
    return import(MODULE_BUNDLE).then(function (mod) {
      var FaceLandmarker = mod.FaceLandmarker;
      var FilesetResolver = mod.FilesetResolver;
      return FilesetResolver.forVisionTasks(FACE_DIR).then(function (res) {
        resolver = res;
        return FaceLandmarker.createFromOptions(res, {
          baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'CPU' },
          runningMode: 'VIDEO',
          numFaces: 1
        });
      }).then(function (fl) {
        landmarker = fl;
        return true;
      });
    }).catch(function (err) {
      lastError = err && err.message ? err.message : String(err);
      landmarker = null;
      resolver = null;
      loadPromise = null;
      return false;
    });
  });
  return loadPromise;
}

/* Legacy synchronous detect (main fallback uses this on a snapshot). */
export function detectFaces(inputEl, timestampMs) {
  if (!landmarker || !inputEl) return null;
  try {
    var res = landmarker.detectForVideo(inputEl, timestampMs);
    if (res && res.faceLandmarks && res.faceLandmarks.length) {
      var F = res.faceLandmarks[0];
      var lms = new Array(F.length);
      for (var i = 0; i < F.length; i++) lms[i] = { x: F[i].x, y: F[i].y };
      return { faceLandmarks: [lms] };
    }
    return null;
  } catch (e) {
    return null;
  }
}

/* ---------- unified facade ---------- */

/* Make the detector ready. Returns a Promise<boolean>. */
export function prepare() {
  if (workerReady || landmarker) return Promise.resolve(true);
  if (workerBroken) { mode = 'main'; return ensureFaceModel().then(function (ok) { if (!ok) lastError = 'modelo indisponível'; return ok; }); }
  try {
    ensureWorker();
    mode = 'worker';
    return new Promise(function (resolve) {
      var tries = 0;
      var iv = setInterval(function () {
        tries++;
        if (workerReady) { clearInterval(iv); resolve(true); }
        else if (workerBroken) {
          clearInterval(iv);
          mode = 'main';
          ensureFaceModel().then(function (ok) { if (!ok) lastError = 'modelo indisponível'; resolve(ok); });
        }
        else if (tries > 300) {
          clearInterval(iv);
          workerBroken = true;
          mode = 'main';
          ensureFaceModel().then(function (ok) { if (!ok) lastError = 'modelo indisponível'; resolve(ok); });
        }
      }, 100);
    });
  } catch (e) {
    workerBroken = true;
    mode = 'main';
    return ensureFaceModel().then(function (ok) { if (!ok) lastError = 'modelo indisponível'; return ok; });
  }
}

/* Request one detection. source: ImageBitmap (worker) or canvas/video (main fallback).
   Returns true if accepted. Main fallback runs synchronously but immediately emits the result. */
export function requestDetect(source, opts) {
  if (!source) return false;
  if (mode === 'worker') {
    if (!workerReady || busy) return false;
    if (!(source instanceof ImageBitmap)) return false;
    var id = nextId++;
    busy = true;
    try {
      worker.postMessage({ type: 'detect', id: id, bitmap: source, ts: opts.ts, maskW: opts.maskW, maskH: opts.maskH, t0: opts.t0 }, [source]);
      return true;
    } catch (e) {
      busy = false;
      return false;
    }
  }
  if (mode === 'main' && landmarker) {
    var res = detectFaces(source, opts.ts);
    var mask = null;
    if (res && res.faceLandmarks && res.faceLandmarks.length && opts.maskW > 1 && opts.maskH > 1) {
      try {
        import('./skin-mask.js').then(function (m) {
          mask = m.buildMaskCanvas(res.faceLandmarks[0], opts.maskW, opts.maskH, fbMask);
          emit({ type: 'result', id: nextId++, ok: true, count: res.faceLandmarks.length, ts: opts.ts, lms: res.faceLandmarks[0], mask: mask, t0: opts.t0 });
        }).catch(function () {
          emit({ type: 'result', id: nextId++, ok: true, count: res.faceLandmarks.length, ts: opts.ts, lms: res.faceLandmarks[0], mask: null, t0: opts.t0 });
        });
      } catch (e) {}
    } else {
      emit({ type: 'result', id: nextId++, ok: true, count: res ? res.faceLandmarks.length : 0, ts: opts.ts, lms: res ? res.faceLandmarks[0] : null, mask: null, t0: opts.t0 });
    }
    return true;
  }
  return false;
}

export function closeFaceModel() {
  if (worker) {
    try { worker.postMessage({ type: 'close' }); } catch (e) {}
    try { worker.terminate(); } catch (e) {}
    worker = null;
  }
  if (landmarker) {
    try { landmarker.close(); } catch (e) {}
    landmarker = null;
  }
  resolver = null;
  loadPromise = null;
  workerReady = false;
  workerBroken = false;
  mode = null;
  busy = false;
  lastError = null;
}