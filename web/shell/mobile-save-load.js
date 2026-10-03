'use strict';
// Dedicated iPhone SAVE/LOAD bridge. Uses native GameState requests instead of
// keyboard F-keys, so Safari keyboard handling cannot cause LOAD FAILED.
(function () {
  if (window.__gxMobileSaveLoadInstalled) return;
  window.__gxMobileSaveLoadInstalled = true;

  function focusCanvas() {
    const cv = document.getElementById('canvas');
    if (!cv) return null;
    try { cv.focus({ preventScroll: true }); }
    catch (_) { try { cv.focus(); } catch (__) {} }
    return cv;
  }

  function activate(button) {
    focusCanvas();
    const isSave = button.matches('[data-save],#gx-m-save');
    const m = window.Module;
    const fn = isSave ? m?._gxWebQuickSave : m?._gxWebQuickLoad;
    if (typeof fn !== 'function') {
      console.warn('[mobile] native save/load bridge is not ready yet');
      return;
    }
    try {
      fn();
      button.dataset.gxPressed = '1';
      setTimeout(() => { delete button.dataset.gxPressed; }, 180);
      try { if (navigator.vibrate) navigator.vibrate(10); } catch (_) {}
      console.log(isSave ? '[mobile] native quick save requested' : '[mobile] native quick load requested');
    } catch (err) {
      console.error('[mobile] save/load request failed', err);
    }
  }

  document.addEventListener('pointerdown', e => {
    const button = e.target?.closest?.('#gx-m-save,#gx-m-load,[data-save],[data-load]');
    if (!button) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    activate(button);
  }, { capture: true, passive: false });

  if (!('PointerEvent' in window)) {
    document.addEventListener('touchstart', e => {
      const button = e.target?.closest?.('#gx-m-save,#gx-m-load,[data-save],[data-load]');
      if (!button) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      activate(button);
    }, { capture: true, passive: false });
  }

  window.addEventListener('gx-mobile-save-load-status', e => {
    const action = e.detail?.action === 1 ? 'SAVE' : 'LOAD';
    const code = e.detail?.code;
    console.log('[mobile] ' + action + ' result code=' + code);
    if (code === 0) {
      try { if (navigator.vibrate) navigator.vibrate([12, 35, 12]); } catch (_) {}
    }
  });
})();
