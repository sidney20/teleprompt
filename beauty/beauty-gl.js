/* Beauty WebGL engine. ES module.
   Renders a beauty pass on top of the composed 2D canvas.
   - source : HTMLVideoElement (uploaded directly, no CPU canvas copy) or a canvas
   - uFrame : source-res texture (camera / canvas)
   - uMask  : RGBA mask texture where R=skin, G=eyes, B=teeth (updated only on new detections)
   - blur   : separable bilateral passes into half-res FBOs
   - composite : cover-crops (uCrop) + mirrors (uMirror) + mixes by mask and settings
   - output : gl.canvas at outW×outH (drawImage-able into the 2D canvas / recorded stream)
   Everything (textures/FBOs/programs) is allocated once and reused. */
import { BEAUTY_VERT, BEAUTY_BLUR_FRAG, BEAUTY_COMPOSE_FRAG } from './beauty-shaders.js';

function compile(gl, type, src) {
  var s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    var log = gl.getShaderInfoLog(s) || 'compile error';
    gl.deleteShader(s);
    throw new Error(log);
  }
  return s;
}

function makeProgram(gl, vs, fs) {
  var p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    var log = gl.getProgramInfoLog(p) || 'link error';
    throw new Error(log);
  }
  return p;
}

var QUAD = new Float32Array([
  -1, -1, 1, -1, -1, 1,
  1, -1, 1, 1, -1, 1
]);

export class BeautyGL {
  constructor(procScale) {
    this.canvas = document.createElement('canvas');
    this.gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false, alpha: false, preserveDrawingBuffer: true })
      || this.canvas.getContext('webgl', { premultipliedAlpha: false, alpha: false, preserveDrawingBuffer: true })
      || this.canvas.getContext('experimental-webgl', { premultipliedAlpha: false, alpha: false, preserveDrawingBuffer: true });
    if (!this.gl) throw new Error('webgl-unavailable');
    this.procScale = procScale > 0 ? procScale : 0.5;
    this.W = 0; this.H = 0;            // output canvas size
    this.srcW = 0; this.srcH = 0;      // source texture size
    this.procW = 0; this.procH = 0;    // render (mask/blur) size
    this.maskBound = null;             // identity of last uploaded mask
    this.initGL();
  }

  initGL() {
    var gl = this.gl;
    this.blurProg = makeProgram(gl, BEAUTY_VERT, BEAUTY_BLUR_FRAG);
    this.composeProg = makeProgram(gl, BEAUTY_VERT, BEAUTY_COMPOSE_FRAG);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
    this.loc = {};
    var attr = gl.getAttribLocation(this.blurProg, 'aPos');
    this.enableAttrib(attr);

    this.frameTex = this.createTexture();
    this.maskTex = this.createTexture();
    this.fb1 = this.createFBO();
    this.fb2 = this.createFBO();
  }

  setProcScale(scale) {
    var s = scale > 0 ? scale : 0.5;
    if (s === this.procScale && this.W > 0) return;
    this.procScale = s;
    this.W = 0; // force re-allocation on next process
  }

  enableAttrib(attr) {
    var gl = this.gl;
    this.attrib = attr;
    gl.enableVertexAttribArray(attr);
    gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);
  }

  createTexture() {
    var gl = this.gl;
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  createFBO() {
    var gl = this.gl;
    var fbo = gl.createFramebuffer();
    var tex = this.createTexture();
    return { fbo: fbo, tex: tex };
  }

  resize(texId, w, h, fbo) {
    var gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texId);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    if (fbo) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texId, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  ensureSize(outW, outH, srcW, srcH) {
    if (this.W === outW && this.H === outH && this.srcW === srcW && this.srcH === srcH) return;
    var gl = this.gl;
    this.W = outW; this.H = outH;
    this.srcW = srcW; this.srcH = srcH;
    this.procW = Math.max(2, Math.round(outW * this.procScale));
    this.procH = Math.max(2, Math.round(outH * this.procScale));
    if (this.canvas.width !== outW) this.canvas.width = outW;
    if (this.canvas.height !== outH) this.canvas.height = outH;
    this.resize(this.frameTex, srcW, srcH, null);
    this.resize(this.maskTex, this.procW, this.procH, null);
    this.resize(this.fb1.tex, this.procW, this.procH, this.fb1.fbo);
    this.resize(this.fb2.tex, this.procW, this.procH, this.fb2.fbo);
    this.maskBound = null;
  }

  isReady() { return this.W > 0; }

  /* Cover-crop mapping from output UVs onto the source texture (normalized [x,y,w,h]).
     Shows the same region the 2D drawImage cover-crop shows: the source slice of
     size outW/scale x outH/scale (no extra zoom when aspects match). */
  cropUv(outW, outH, srcW, srcH) {
    var scale = Math.max(outW / srcW, outH / srcH);
    var sw = outW / scale, sh = outH / scale;
    var offX = Math.max(0, (srcW - sw) / 2);
    var offY = Math.max(0, (srcH - sh) / 2);
    return [offX / srcW, offY / srcH, sw / srcW, sh / srcH];
  }

  /* source: HTMLVideoElement or canvas. mask: mask image (may be null). Returns true if rendered. */
  process(source, mask, settings, opts) {
    if (!source) return false;
    var gl = this.gl;
    var srcW = typeof source.videoWidth === 'number' && source.videoWidth ? source.videoWidth : source.width;
    var srcH = typeof source.videoHeight === 'number' && source.videoHeight ? source.videoHeight : source.height;
    if (!srcW || !srcH) return false;
    opts = opts || {};
    var outW = opts.outW || srcW, outH = opts.outH || srcH;
    if (!outW || !outH) return false;
    this.ensureSize(outW, outH, srcW, srcH);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    // 1) upload source texture (top-left canvas/video coords)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    // 2) upload mask texture only when a new one arrived
    var needMask = mask && (!opts.skipMaskUpload || this.maskBound !== mask);
    if (needMask) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask);
      this.maskBound = mask;
    }

    var sigma = 1.6 + 6.0 * (settings.smooth / 100) * (settings.beauty / 100);
    var edge = 2.0 + 14.0 * (settings.beauty / 100);

    // 3) horizontal blur -> fb1 (render at proc res)
    this.useProg(this.blurProg, this.frameTex, 0);
    gl.uniform2f(this.uniformLoc(this.blurProg, 'uTexel'), 1 / this.srcW, 1 / this.srcH);
    gl.uniform2f(this.uniformLoc(this.blurProg, 'uDir'), 1, 0);
    gl.uniform1f(this.uniformLoc(this.blurProg, 'uSigma'), sigma);
    gl.uniform1f(this.uniformLoc(this.blurProg, 'uEdge'), edge);
    this.drawTo(this.fb1);

    // 4) vertical blur -> fb2
    this.useProg(this.blurProg, this.fb1.tex, 0);
    gl.uniform2f(this.uniformLoc(this.blurProg, 'uTexel'), 1 / this.srcW, 1 / this.srcH);
    gl.uniform2f(this.uniformLoc(this.blurProg, 'uDir'), 0, 1);
    gl.uniform1f(this.uniformLoc(this.blurProg, 'uSigma'), sigma);
    gl.uniform1f(this.uniformLoc(this.blurProg, 'uEdge'), edge);
    this.drawTo(this.fb2);

    // 5) composite to default framebuffer (outW×outH)
    gl.viewport(0, 0, this.W, this.H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.composeProg);
    gl.enableVertexAttribArray(this.attrib);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.vertexAttribPointer(this.attrib, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.fb2.tex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, mask ? this.maskTex : this.frameTex);
    gl.uniform1i(this.uniformLoc(this.composeProg, 'uFrame'), 0);
    gl.uniform1i(this.uniformLoc(this.composeProg, 'uBase'), 1);
    gl.uniform1i(this.uniformLoc(this.composeProg, 'uMask'), 2);
    var crop = this.cropUv(outW, outH, srcW, srcH);
    gl.uniform4f(this.uniformLoc(this.composeProg, 'uCrop'), crop[0], crop[1], crop[2], crop[3]);
    gl.uniform1f(this.uniformLoc(this.composeProg, 'uMirror'), opts.mirror ? 1 : 0);

    var s = settings;
    gl.uniform1f(this.uniformLoc(this.composeProg, 'uBeauty'), s.beauty / 100);
    gl.uniform1f(this.uniformLoc(this.composeProg, 'uSmooth'), s.smooth / 100);
    gl.uniform1f(this.uniformLoc(this.composeProg, 'uRetouch'), opts.effects > 1 ? 0 : s.retouch / 100);
    gl.uniform1f(this.uniformLoc(this.composeProg, 'uEyes'), s.eyes / 100);
    gl.uniform1f(this.uniformLoc(this.composeProg, 'uTeeth'), s.teeth / 100);
    gl.uniform1f(this.uniformLoc(this.composeProg, 'uLight'), s.light / 100);
    gl.uniform1f(this.uniformLoc(this.composeProg, 'uUniform'), opts.effects > 0 ? 0 : s.uniform / 100);
    this.drawTo(null);

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    return true;
  }

  useProg(prog, tex, unit) {
    var gl = this.gl;
    gl.useProgram(prog);
    gl.enableVertexAttribArray(this.attrib);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.vertexAttribPointer(this.attrib, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(unit === 0 ? gl.TEXTURE0 : gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  drawTo(fbo) {
    var gl = this.gl;
    if (fbo) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fbo);
      gl.viewport(0, 0, this.procW, this.procH);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.W, this.H);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  uniformLoc(prog, name) {
    var gl = this.gl;
    var l = this.loc;
    var key = name + '_' + (prog === this.blurProg ? 'b' : 'c');
    if (l[key] === undefined) l[key] = gl.getUniformLocation(prog, name);
    return l[key];
  }

  dispose() {
    var gl = this.gl;
    try {
      if (gl && gl.getExtension) {
        var ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
      }
    } catch (e) {}
    this.gl = null;
    this.canvas = null;
    this.fb1 = this.fb2 = null;
    this.frameTex = this.maskTex = null;
    this.quad = null;
    this.blurProg = this.composeProg = null;
    this.maskBound = null;
  }
}