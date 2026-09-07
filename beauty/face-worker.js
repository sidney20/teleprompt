/* Face Landmarker + skin mask built inside a dedicated worker.
   Instantiated as a CLASSIC worker: classic workers keep importScripts(), which the
   MediaPipe wasm loader requires. The ES vision bundle and the mask builder are reached
   via dynamic import() (absolute URLs come in the init message from the main thread).
   Receives ImageBitmaps, returns { lms, mask } for the main thread to consume. ES-module-safe. */

var lnd = null;            // FaceLandmarker instance
var buildMask = null;      // buildMaskCanvas fn from skin-mask.js
var INIT = null;

function hasOC() {
  return typeof OffscreenCanvas !== 'undefined'
    && typeof OffscreenCanvas.prototype.transferToImageBitmap === 'function';
}

self.onmessage = function (e) {
  var d = e.data || {};
  if (d.type === 'init') {
    INIT = d;
    import(d.module).then(function (mod) {
      return mod.FilesetResolver.forVisionTasks(d.dir).then(function (res) {
        return mod.FaceLandmarker.createFromOptions(res, {
          baseOptions: { modelAssetPath: d.model, delegate: 'CPU' },
          runningMode: 'VIDEO',
          numFaces: 1
        });
      });
    }).then(function (fl) {
      lnd = fl;
      return import(d.maskModule).then(function (m) {
        buildMask = m.buildMaskCanvas;
        post({ type: 'init-done', ok: true, hasOC: hasOC() });
      });
    }).catch(function (err) {
      post({ type: 'init-done', ok: false, err: err && err.message ? err.message : String(err) });
    });
    return;
  }
  if (d.type === 'detect' && lnd && buildMask) {
    runDetect(d);
    return;
  }
  if (d.type === 'close') {
    try { if (lnd) lnd.close(); } catch (err) {}
    self.close();
  }
};

function post(msg, transfer) {
  self.postMessage(msg, transfer);
}

function runDetect(d) {
  var bmp = d.bitmap;
  try {
    var res = lnd.detectForVideo(bmp, d.ts);
    var list = res && res.faceLandmarks ? res.faceLandmarks : [];
    var count = list.length;
    var lms = null;
    if (count > 0) {
      var F = list[0];
      lms = new Array(F.length);
      for (var i = 0; i < F.length; i++) lms[i] = { x: F[i].x, y: F[i].y };
    }
    var mask = null;
    if (lms && d.maskW > 1 && d.maskH > 1) {
      try {
        mask = buildMask(lms, d.maskW, d.maskH, null);
      } catch (err) { mask = null; }
    }
    var out = { type: 'result', id: d.id, ok: true, count: count, ts: d.ts, lms: lms, t0: d.t0 };
    if (mask && hasOC()) {
      var bm = mask.transferToImageBitmap();
      post(out, [bm]);
    } else {
      out.mask = null;
      post(out);
    }
  } catch (err) {
    post({ type: 'result', id: d.id, ok: false, err: err && err.message ? err.message : String(err), t0: d.t0 });
  } finally {
    try { if (bmp && bmp.close) bmp.close(); } catch (err) {}
  }
}