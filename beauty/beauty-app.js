/* Beauty orchestrator: camera -> face detect -> skin mask -> GL beauty pass -> back to canvas.
   Single module that ties face-tracker, skin-mask and the WebGL engine. ES module. */
import { buildMaskCanvas, emptyMask } from './skin-mask.js';
import { ensureFaceModel, detectFaces, isLoaded as modelLoaded, closeFaceModel, lastLoadError } from './face-tracker.js';
import { BeautyGL } from './beauty-gl.js';

var gl = null;
var maskCanvas = null;
var videoEl = null;
var modelOk = false;
var modelFailed = false;
var active = false;

var lastFaceCount = 0;
var lmsCanvas = null;          // canvas-normalized smoothed landmark positions

var config = { weak: false, procScale: 1.0 };
var detectEvery = 80;          // ms between MediaPipe detections
var lastDetect = 0;
var lostGrace = 900;           // ms before dropping the last known mask when detection stops
var lastFaceAt = 0;

function now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

export var BeautyApp = {
  configure(weak) {
    config.weak = !!weak;
    config.procScale = config.weak ? 0.5 : 1.0;
  },
  isModelReady() { return modelOk; },
  isFailed() { return modelFailed; },
  lastError() { return lastLoadError(); },
  hasFaces() { return lastFaceCount > 0; },
  isActive() { return active; },
  getGL() { return gl; },

  setActive(a) {
    active = !!a;
    if (!active) this.releaseMask();
  },
  setVideoEl(el) { videoEl = el; },
  releaseMask() {
    lmsCanvas = null;
    maskCanvas = null;
    lastFaceCount = 0;
    lastFaceAt = 0;
  },

  loadModel() {
    if (modelOk) return Promise.resolve(true);
    if (modelFailed) return Promise.resolve(false);
    return ensureFaceModel().then(function (ok) {
      modelOk = ok;
      if (!ok) modelFailed = true;
      return ok;
    });
  },

  /* Runs one frame: detects (throttled), updates mask, renders beauty into the 2D ctx.
     source = the composed 2D canvas element; ctx2d = its context; outW/outH = canvas size. */
  frame(source, ctx2d, outW, outH, mirror, settings) {
    if (!active || !modelOk) return false;
    var t = now();
    if (t - lastDetect >= detectEvery) {
      lastDetect = t;
      this.stepDetect(source, outW, outH, mirror);
    }
    if (!maskCanvas || !lmsCanvas) return false;
    if (!gl) {
      try { gl = new BeautyGL(config.procScale); }
      catch (e) { gl = null; return false; }
    }
    var rendered = gl.process(source, maskCanvas, settings);
    if (rendered && gl) ctx2d.drawImage(gl.canvas, 0, 0, outW, outH);
    return rendered;
  },

  stepDetect(outW, outH, mirror) {
    if (!videoEl || !videoEl.videoWidth || !videoEl.videoHeight) return;
    var res = detectFaces(videoEl, lastDetect + 1);
    if (!res || !res.faceLandmarks || !res.faceLandmarks.length) {
      if (lastFaceCount > 0 && now() - lastFaceAt > lostGrace) this.releaseMask();
      return;
    }
    var lms = res.faceLandmarks[0];
    var vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    var sc = Math.max(outW / vw, outH / vh);
    var offX = (outW - vw * sc) / 2;
    var offY = (outH - vh * sc) / 2;
    var raw = [];
    for (var i = 0; i < lms.length; i++) {
      var x = (lms[i].x * vw * sc + offX) / outW;
      var y = (lms[i].y * vh * sc + offY) / outH;
      if (mirror) x = 1 - x;
      raw.push({ x: x, y: y });
    }
    // temporal smoothing: EMA between previous smoothed landmarks and new detection
    var alpha = 0.55;
    if (lmsCanvas && lmsCanvas.length === raw.length) {
      for (i = 0; i < raw.length; i++) {
        raw[i].x = lmsCanvas[i].x + alpha * (raw[i].x - lmsCanvas[i].x);
        raw[i].y = lmsCanvas[i].y + alpha * (raw[i].y - lmsCanvas[i].y);
      }
    }
    lmsCanvas = raw;
    lastFaceCount = 1;
    lastFaceAt = now();
    var procW = Math.max(2, Math.round(outW * config.procScale));
    var procH = Math.max(2, Math.round(outH * config.procScale));
    var m = buildMaskCanvas(lmsCanvas, procW, procH);
    if (m) maskCanvas = m;
  },

  dispose() {
    active = false;
    if (gl) { try { gl.dispose(); } catch (e) {} gl = null; }
    closeFaceModel();
    modelOk = false;
    modelFailed = false;
    this.releaseMask();
    videoEl = null;
  }
};