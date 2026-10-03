// GeneralsX Web - load-screen frame receiver (main thread).
//
// During map load the game pthread is blocked and OffscreenCanvas frames are
// never composited (browsers only push them when the worker yields). The
// engine-side pump (LoadScreen.cpp, gxWebPumpLoadFrame) glReadPixels() the
// rendered frame and hands the raw RGBA pixels to the main thread.
//
// WebGL glReadPixels() rows are bottom-up. ImageData/2D canvas expects the
// first row at the top, so the frame must be flipped exactly once here.
//
// GeneralsX @build web-port loadscreen 09/07/2026

'use strict';

const gxLoadScreen = {
  canvas: null,
  ctx: null,
  active: false,

  _ensure() {
    if (this.canvas) return;
    const cv = document.createElement('canvas');
    cv.id = 'gx-loadframe';
    cv.style.cssText =
      'position:fixed;inset:0;width:100vw;height:100vh;z-index:9;' +
      'display:none;background:#000;pointer-events:none;';
    document.body.appendChild(cv);
    this.canvas = cv;
    this.ctx = cv.getContext('2d');
  },

  begin() {
    this._ensure();
    this.active = true;
    this.canvas.style.display = 'block';
  },

  // px: raw Uint8Array RGBA from glReadPixels(), whose rows are bottom-up.
  frameRGBA(px, w, h) {
    if (!this.active) return;
    this._ensure();
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const img = new ImageData(new Uint8ClampedArray(px.buffer, px.byteOffset, w * h * 4), w, h);
    this.ctx.putImageData(img, 0, 0);
    this.ctx.save();
    this.ctx.globalCompositeOperation = 'copy';
    this.ctx.scale(1, -1);
    this.ctx.drawImage(this.canvas, 0, -h);
    this.ctx.restore();
  },

  end() {
    this.active = false;
    if (this.canvas) this.canvas.style.display = 'none';
  },
};

window.gxLoadScreen = gxLoadScreen;
