'use strict';
(function () {
  const coarse = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  if (!coarse) return;

  const canvas = () => document.getElementById('canvas');
  const isUiTarget = (t) => !!(t && t.closest && (t.closest('#gx-mobile-controls') || t.closest('#gx-overlay') || t.closest('#gx-mp')));

  function focusCanvas() {
    const cv = canvas();
    if (!cv) return null;
    try { cv.focus({ preventScroll: true }); } catch { try { cv.focus(); } catch {} }
    return cv;
  }

  function mouse(type, x, y, button = 0, buttons) {
    const cv = focusCanvas(); if (!cv) return;
    const btns = buttons == null ? (type === 'mouseup' ? 0 : (button === 2 ? 2 : 1)) : buttons;
    cv.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, view: window,
      clientX: x, clientY: y, screenX: x, screenY: y,
      button, buttons: btns
    }));
  }

  function moveMouse(x, y, buttons = 0) {
    const cv = focusCanvas(); if (!cv) return;
    cv.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, cancelable: true, view: window,
      clientX: x, clientY: y, screenX: x, screenY: y,
      button: 0, buttons
    }));
  }

  function clickAt(x, y, button = 0) {
    moveMouse(x, y, 0);
    mouse('mousedown', x, y, button, button === 2 ? 2 : 1);
    mouse('mouseup', x, y, button, 0);
  }

  function wheelAt(x, y, deltaY) {
    const cv = focusCanvas(); if (!cv) return;
    moveMouse(x, y, 0);
    cv.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, view: window,
      clientX: x, clientY: y, deltaY, deltaMode: 0
    }));
  }

  function key(keyName, code) {
    const cv = focusCanvas(); if (!cv) return;
    const o = { key: keyName, code: code || keyName, bubbles: true, cancelable: true };
    cv.dispatchEvent(new KeyboardEvent('keydown', o));
    setTimeout(() => cv.dispatchEvent(new KeyboardEvent('keyup', o)), 55);
  }

  async function immersive() {
    document.documentElement.classList.add('gx-immersive');
    try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch {}
    try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch {}
    setTimeout(() => { window.scrollTo(0, 1); focusCanvas(); }, 60);
  }
  window.gxEnterMobileGameMode = immersive;

  const cvNow = canvas();
  if (cvNow) {
    cvNow.style.touchAction = 'none';
    cvNow.style.webkitUserSelect = 'none';
    cvNow.addEventListener('contextmenu', e => e.preventDefault());
  }

  let single = null;
  let drag = false;
  let longTimer = null;
  let lastTap = 0;
  let two = null;

  function clearLong() {
    if (longTimer) clearTimeout(longTimer);
    longTimer = null;
  }

  function resetSingle() {
    clearLong();
    single = null;
    drag = false;
  }

  function point(t) { return { x: t.clientX, y: t.clientY }; }
  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

  addEventListener('touchstart', e => {
    if (isUiTarget(e.target)) return;
    e.preventDefault();

    if (e.touches.length === 1) {
      const p = point(e.touches[0]);
      single = { ...p, started: performance.now() };
      drag = false;
      two = null;
      moveMouse(p.x, p.y, 0);
      clearLong();
      longTimer = setTimeout(() => {
        if (!single || drag) return;
        clickAt(single.x, single.y, 2); // long press = right click
        single.longPressed = true;
      }, 560);
      return;
    }

    if (e.touches.length === 2) {
      clearLong();
      single = null;
      drag = false;
      const a = point(e.touches[0]), b = point(e.touches[1]);
      two = { a, b, mid: mid(a, b), dist: distance(a, b), moved: false };
    }
  }, { passive: false, capture: true });

  addEventListener('touchmove', e => {
    if (isUiTarget(e.target)) return;
    e.preventDefault();

    if (e.touches.length === 1 && single) {
      const p = point(e.touches[0]);
      const dx = p.x - single.x, dy = p.y - single.y;
      if (!drag && Math.hypot(dx, dy) > 7) {
        drag = true;
        clearLong();
        moveMouse(single.x, single.y, 0);
        mouse('mousedown', single.x, single.y, 0, 1);
      }
      if (drag) moveMouse(p.x, p.y, 1);
      return;
    }

    if (e.touches.length === 2) {
      clearLong();
      const a = point(e.touches[0]), b = point(e.touches[1]);
      const m = mid(a, b), d = distance(a, b);
      if (!two) two = { a, b, mid: m, dist: d, moved: false };

      const pinchDelta = d - two.dist;
      const panX = m.x - two.mid.x, panY = m.y - two.mid.y;

      // Pinch = actual mouse wheel zoom, which Generals understands natively.
      if (Math.abs(pinchDelta) >= 10) {
        wheelAt(m.x, m.y, pinchDelta > 0 ? -120 : 120);
        two.dist = d;
        two.moved = true;
      }

      // Two-finger drag = camera pan via arrow keys.
      if (Math.abs(panX) >= 16) {
        key(panX > 0 ? 'ArrowRight' : 'ArrowLeft');
        two.mid.x = m.x;
        two.moved = true;
      }
      if (Math.abs(panY) >= 16) {
        key(panY > 0 ? 'ArrowDown' : 'ArrowUp');
        two.mid.y = m.y;
        two.moved = true;
      }
    }
  }, { passive: false, capture: true });

  addEventListener('touchend', e => {
    if (isUiTarget(e.target)) return;
    e.preventDefault();
    clearLong();

    if (e.touches.length >= 2) return;

    // Finishing a two-finger gesture: two-finger tap = right click.
    if (two && e.touches.length === 0) {
      if (!two.moved) clickAt(two.mid.x, two.mid.y, 2);
      two = null;
      resetSingle();
      return;
    }

    if (!single) return;
    const t = e.changedTouches && e.changedTouches[0];
    const p = t ? point(t) : { x: single.x, y: single.y };

    if (single.longPressed) {
      resetSingle();
      return;
    }

    if (drag) {
      moveMouse(p.x, p.y, 1);
      mouse('mouseup', p.x, p.y, 0, 0);
    } else {
      const now = performance.now();
      clickAt(p.x, p.y, 0);
      if (now - lastTap < 300) {
        // second click for double-click selection/action
        setTimeout(() => clickAt(p.x, p.y, 0), 35);
        lastTap = 0;
      } else {
        lastTap = now;
      }
    }
    resetSingle();
  }, { passive: false, capture: true });

  addEventListener('touchcancel', e => {
    clearLong();
    if (drag && single) mouse('mouseup', single.x, single.y, 0, 0);
    single = null; two = null; drag = false;
    if (e.cancelable) e.preventDefault();
  }, { passive: false, capture: true });

  addEventListener('DOMContentLoaded', () => {
    const box = document.getElementById('gx-mobile-controls'); if (!box) return;
    box.hidden = false;

    box.querySelectorAll('[data-key]').forEach(b => b.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation(); key(b.dataset.key, b.dataset.code);
    }));

    const full = box.querySelector('[data-fullscreen]');
    if (full) full.addEventListener('pointerdown', async e => {
      e.preventDefault(); e.stopPropagation(); await immersive();
    });

    const save = box.querySelector('[data-save]');
    if (save) save.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation(); key('F5', 'F5');
    });

    const load = box.querySelector('[data-load]');
    if (load) load.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation(); key('F10', 'F10');
    });

    const close = box.querySelector('[data-close]');
    if (close) close.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation(); key('Escape', 'Escape');
    });
  });
})();