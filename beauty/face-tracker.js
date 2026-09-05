/* MediaPipe Face Landmarker wrapper (lazy load, offline via vendored assets).
   ES module. */

var MODULE_BUNDLE = new URL('../vendor/mediapipe/vision_bundle.mjs', import.meta.url).href;
var FETCH_DIR = './vendor/mediapipe/';

var landmarker = null;
var resolver = null;
var loadPromise = null;
var lastError = null;

export function faceModelPaths() {
  return {
    loader: FETCH_DIR + 'vision_wasm_internal.js',
    binary: FETCH_DIR + 'vision_wasm_internal.wasm',
    model: FETCH_DIR + 'face_landmarker.task'
  };
}

export function isLoaded() { return !!landmarker; }
export function lastLoadError() { return lastError; }

export function ensureFaceModel() {
  if (landmarker) return Promise.resolve(true);
  if (loadPromise) return loadPromise;
  loadPromise = Promise.resolve().then(function () {
    return import(MODULE_BUNDLE).then(function (mod) {
      var FaceLandmarker = mod.FaceLandmarker;
      var FilesetResolver = mod.FilesetResolver;
      return FilesetResolver.forVisionTasks(FETCH_DIR).then(function (res) {
        resolver = res;
        return FaceLandmarker.createFromOptions(res, {
          baseOptions: {
            modelAssetPath: FETCH_DIR + 'face_landmarker.task',
            delegate: 'CPU'
          },
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

/* Detect faces in a video element (must be VIDEO runningMode). Timestamp must be monotonic. */
export function detectFaces(videoEl, timestampMs) {
  if (!landmarker || !videoEl) return null;
  try {
    var res = landmarker.detectForVideo(videoEl, timestampMs);
    if (res && res.faceLandmarks && res.faceLandmarks.length) return res;
    return null;
  } catch (e) {
    return null;
  }
}

export function closeFaceModel() {
  if (landmarker) {
    try { landmarker.close(); } catch (e) {}
    landmarker = null;
  }
  resolver = null;
  loadPromise = null;
  lastError = null;
}