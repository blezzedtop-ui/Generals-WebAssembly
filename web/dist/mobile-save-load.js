'use strict';
// Dedicated iPhone SAVE/LOAD bridge. Intentionally isolated from camera/SELECT touch logic.
(function () {
  if (window.__gxMobileSaveLoadInstalled) return;
  window.__gxMobileSaveLoadInstalled = true;

  const QUICK_SAVE = 1073741886; // SDL F5
  const QUICK_LOAD = 1073741891; // SDL F10
  let releaseTimer = null;
  let pressedCode = 0;

  function focusCanvas() {
    const cv = document.getElementById('canvas');
    if (!cv) return null;
    try { cv.focus({ preventScroll: true }); }
    catch (_) { try { cv.focus(); } catch (__) {} }
    return cv;
  }

  function releasePressed() {
    if (releaseTimer !== null) clearTimeout(releaseTimer);
    releaseTimer = null;
    if (pressedCode && window.Module?._gxWebSendKeyState) {
      try { Module._gxWebSendKeyState(pressedCode, 0); } catch (_) {}
    }
    pressedCode = 0;
  }

  function pulseNativeKey(code, keyName) {
    const cv = focusCanvas();
    const m = window.Module;

    releasePressed();

    if (m?._gxWebSendKeyState) {
      pressedCode = code;
      m._gxWebSendKeyState(code, 1);
      releaseTimer = setTimeout(() => {
        if (window.Module?._gxWebSendKeyState && pressedCode === code) {
          try { Module._gxWebSendKeyState(code, 0); } catch (_) {}
        }
        if (pressedCode === code) pressedCode = 0;
        releaseTimer = null;
      }, 110);
      return true;
    }

    if (m?._gxWebSendKey) {
      m._gxWebSendKey(code);
      return true;
    }

    // Last-resort fallback while the native bridge is unavailable.
    if (cv) {
      const opts = { key: keyName, code: keyName, bubbles: true, cancelable: true, composed: true };
      cv.dispatchEvent(new KeyboardEvent('keydown', opts));
      setTimeout(() => cv.dispatchEvent(new KeyboardEvent('keyup', opts)), 110);
      return true;
    }
    return false;
  }

  function activate(button) {
    const isSave = button.matches('[data-save],#gx-m-save');
    const ok = pulseNativeKey(isSave ? QUICK_SAVE : QUICK_LOAD, isSave ? 'F5' : 'F10');
    if (ok) {
      button.dataset.gxPressed = '1';
      setTimeout(() => { delete button.dataset.gxPressed; }, 180);
      try { if (navigator.vibrate) navigator.vibrate(10); } catch (_) {}
      console.log(isSave ? '[mobile] quick save (F5)' : '[mobile] quick load (F10)');
    }
  }

  // Capture only SAVE/LOAD. This prevents the older target-level handler from
  // double-firing while leaving SELECT, fullscreen and map gestures untouched.
  document.addEventListener('pointerdown', e => {
    const button = e.target?.closest?.('#gx-m-save,#gx-m-load,[data-save],[data-load]');
    if (!button) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    activate(button);
  }, { capture: true, passive: false });

  // Very old iOS fallback where Pointer Events are unavailable.
  if (!('PointerEvent' in window)) {
    document.addEventListener('touchstart', e => {
      const button = e.target?.closest?.('#gx-m-save,#gx-m-load,[data-save],[data-load]');
      if (!button) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      activate(button);
    }, { capture: true, passive: false });
  }

  addEventListener('blur', releasePressed);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releasePressed(); });
})();
