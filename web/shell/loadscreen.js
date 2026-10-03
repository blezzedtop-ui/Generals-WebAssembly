// GeneralsX Web - load-screen frame receiver (main thread).
//
// During map load the game pthread is blocked and OffscreenCanvas frames are
// never composited (browsers only push them when the worker yields). The
// engine-side pump (LoadScreen.cpp, gxWebPumpLoadFrame) hands the rendered
// RGBA frame to the main thread. The current WebGL path already presents the
// frame in top-down display order, so applying a second Y flip here makes the
// whole loading screen appear upside down.
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

  // px: Uint8Array RGBA already in display orientation for the current WebGL path.
  frameRGBA(px, w, h) {
    if (!this.active) return;
    this._ensure();
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const img = new ImageData(new Uint8ClampedArray(px.buffer, px.byteOffset, w * h * 4), w, h);
    // Do not flip vertically here. The renderer/readback path already supplies
    // the frame in the orientation expected by the 2D canvas.
    this.ctx.putImageData(img, 0, 0);
  },

  end() {
    this.active = false;
    if (this.canvas) this.canvas.style.display = 'none';
  },
};

window.gxLoadScreen = gxLoadScreen;
