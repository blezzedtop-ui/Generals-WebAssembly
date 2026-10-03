// GeneralsX Web - load-screen frame receiver (main thread).
'use strict';

const gxLoadScreen = {
  canvas: null,
  ctx: null,
  staging: null,
  stagingCtx: null,
  active: false,

  _ensure() {
    if (this.canvas) return;
    const cv = document.createElement('canvas');
    cv.id = 'gx-loadframe';
    cv.style.cssText =
      'position:fixed;inset:0;width:100vw;height:100dvh;z-index:9;' +
      'display:none;background:#000;pointer-events:none;';
    document.body.appendChild(cv);

    const staging = document.createElement('canvas');
    this.canvas = cv;
    this.ctx = cv.getContext('2d');
    this.staging = staging;
    this.stagingCtx = staging.getContext('2d');
  },

  begin() {
    this._ensure();
    this.active = true;
    this.canvas.style.display = 'block';
  },

  // glReadPixels() rows are bottom-up. Put the raw frame on a separate staging
  // canvas, then flip exactly once onto the visible canvas. Drawing a canvas
  // onto itself while transformed is unreliable on Safari and caused inverted
  // menu/load frames on some iPhones.
  frameRGBA(px, w, h) {
    if (!this.active) return;
    this._ensure();
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.staging.width = w;
      this.staging.height = h;
    }

    const img = new ImageData(
      new Uint8ClampedArray(px.buffer, px.byteOffset, w * h * 4),
      w, h
    );
    this.stagingCtx.putImageData(img, 0, 0);

    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, -1, 0, h);
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(this.staging, 0, 0);
    ctx.restore();
  },

  end() {
    this.active = false;
    if (this.canvas) this.canvas.style.display = 'none';
  },
};

window.gxLoadScreen = gxLoadScreen;
