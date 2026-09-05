/* Skin mask generation from MediaPipe Face Landmarker landmarks (478 pts, normalized).
   Output: canvas (procW x procH) where R = skin, G = eyes, B = teeth.
   Face oval + protected regions (eyes, brows, mouth, nostrils) + soft beard/jaw attenuation.
   ES module. */

var FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
  152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109
];

var LEFT_EYE = [33, 133, 159, 145, 158, 144, 160, 153];
var RIGHT_EYE = [362, 263, 386, 374, 385, 373, 387, 380];
var LEFT_BROW = [70, 63, 105, 66, 107];
var RIGHT_BROW = [336, 296, 334, 293, 300];
var MOUTH_OUTER = [0, 17, 61, 291, 37, 84, 314, 267];
var MOUTH_INNER_TOP = 13;   // inner upper lip center
var MOUTH_INNER_BOTTOM = 14; // inner lower lip center
var NOSTRILS = [98, 327];

function pt(lms, i, procW, procH) {
  var p = lms[i];
  return { x: p.x * procW, y: p.y * procH };
}

function bboxOf(lms, indices, procW, procH) {
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (var i = 0; i < indices.length; i++) {
    var p = lms[indices[i]];
    if (!p) continue;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX * procW, y: minY * procH, w: (maxX - minX) * procW, h: (maxY - minY) * procH };
}

function ellipse(ctx, cx, cy, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
  ctx.fill();
}

export function buildMaskCanvas(landmarks, procW, procH) {
  var canvas = document.createElement('canvas');
  canvas.width = procW;
  canvas.height = procH;
  var ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, procW, procH);

  var scaleX = procW, scaleY = procH;

  // --- skin: filled face oval ---
  ctx.beginPath();
  for (var i = 0; i < FACE_OVAL.length; i++) {
    var p = pt(landmarks, FACE_OVAL[i], scaleX, scaleY);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,0,0,0.92)';
  ctx.fill();

  // --- punch out protected regions (destination-out) ---
  var eyes = [bboxOf(landmarks, LEFT_EYE, scaleX, scaleY), bboxOf(landmarks, RIGHT_EYE, scaleX, scaleY)];
  var brows = [bboxOf(landmarks, LEFT_BROW, scaleX, scaleY), bboxOf(landmarks, RIGHT_BROW, scaleX, scaleY)];
  var mouth = bboxOf(landmarks, MOUTH_OUTER, scaleX, scaleY);

  ctx.fillStyle = 'rgba(0,0,0,1)';
  ctx.globalCompositeOperation = 'destination-out';
  for (var e = 0; e < eyes.length; e++) {
    var b = eyes[e];
    ellipse(ctx, b.x + b.w / 2, b.y + b.h / 2 + b.h * 0.08, b.w * 0.62, b.h * 0.55);
  }
  for (var br = 0; br < brows.length; br++) {
    var bb = brows[br];
    ellipse(ctx, bb.x + bb.w / 2, bb.y + bb.h / 2 - bb.h * 0.25, bb.w * 0.75, bb.h * 0.85);
  }
  // mouth (outer lips + a bit)
  ellipse(ctx, mouth.x + mouth.w / 2, mouth.y + mouth.h / 2, mouth.w * 0.78, mouth.h * 0.8);
  // nostrils
  for (var n = 0; n < NOSTRILS.length; n++) {
    var np = pt(landmarks, NOSTRILS[n], scaleX, scaleY);
    var r = mouth.w * 0.13;
    ellipse(ctx, np.x, np.y, r, r);
  }

  // --- soft beard/jaw attenuation: gradient from mouth level down to chin ---
  if (landmarks[MOUTH_INNER_BOTTOM] && landmarks[152]) {
    var mouthY = landmarks[MOUTH_INNER_BOTTOM].y * scaleY;
    var chinY = landmarks[152].y * scaleY;
    if (chinY > mouthY) {
      var gradH = chinY - mouthY;
      var grad = ctx.createLinearGradient(0, mouthY, 0, chinY);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.5, 'rgba(0,0,0,0.35)');
      grad.addColorStop(1, 'rgba(0,0,0,0.6)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, mouthY, procW, gradH + 2);
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  // --- eyes channel (G) ---
  ctx.fillStyle = 'rgba(0,255,0,0.8)';
  for (e = 0; e < eyes.length; e++) {
    b = eyes[e];
    ellipse(ctx, b.x + b.w / 2, b.y + b.h / 2 + b.h * 0.06, b.w * 0.52, b.h * 0.46);
  }

  // --- teeth channel (B): small ellipse inside the mouth ---
  if (landmarks[MOUTH_INNER_TOP] && landmarks[MOUTH_INNER_BOTTOM]) {
    var tTop = landmarks[MOUTH_INNER_TOP].y * scaleY;
    var tBot = landmarks[MOUTH_INNER_BOTTOM].y * scaleY;
    if (tBot > tTop) {
      var tc = (tTop + tBot) / 2;
      ctx.fillStyle = 'rgba(0,0,255,0.85)';
      ellipse(ctx, mouth.x + mouth.w / 2, tc, mouth.w * 0.42, (tBot - tTop) * 0.75);
    }
  }

  // --- feather: soften mask edges (works in Chrome/Firefox/Safari 16.4+) ---
  try {
    ctx.filter = 'blur(3px)';
    ctx.drawImage(canvas, 0, 0);
    ctx.filter = 'none';
  } catch (e) {}

  return canvas;
}

/* Builds a blank mask (nothing detected yet). */
export function emptyMask(procW, procH) {
  var canvas = document.createElement('canvas');
  canvas.width = procW;
  canvas.height = procH;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, procW, procH);
  return canvas;
}