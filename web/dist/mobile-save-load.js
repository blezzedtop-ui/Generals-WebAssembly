'use strict';
// Dedicated iPhone SAVE/LOAD bridge. Uses native GameState requests instead of
// keyboard F-keys, so Safari keyboard handling cannot cause LOAD FAILED.
(function () {
  if (window.__gxMobileSaveLoadInstalled) return;
  window.__gxMobileSaveLoadInstalled = true;

  const AUTO_SAVE_INTERVAL_MS = 60000;
  const AUTO_SAVE_RETRY_MS = 15000;
  const AUTO_SAVE_MIN_UPTIME_MS = 30000;
  const startedAt = Date.now();
  let lastAutoSaveAt = 0;

  function focusCanvas() {
    const cv = document.getElementById('canvas');
    if (!cv) return null;
    try { cv.focus({ preventScroll: true }); }
    catch (_) { try { cv.focus(); } catch (__) {} }
    return cv;
  }

  function nativeSaveLoad(isSave) {
    const m = window.Module;
    return isSave ? m?._gxWebQuickSave : m?._gxWebQuickLoad;
  }

  function requestQuickSave(reason) {
    const fn = nativeSaveLoad(true);
    if (typeof fn !== 'function') return false;
    try {
      fn();
      lastAutoSaveAt = Date.now();
      try { localStorage.setItem('gx-last-autosave-request', String(lastAutoSaveAt)); } catch (_) {}
      console.log('[mobile] quick save requested (' + reason + ')');
      return true;
    } catch (err) {
      console.warn('[mobile] autosave request failed', err);
      return false;
    }
  }

  function activate(button) {
    focusCanvas();
    const isSave = button.matches('[data-save],#gx-m-save');
    const fn = nativeSaveLoad(isSave);
    if (typeof fn !== 'function') {
      console.warn('[mobile] native save/load bridge is not ready yet');
      return;
    }
    try {
      fn();
      if (isSave) lastAutoSaveAt = Date.now();
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

  // iOS may terminate a memory-heavy Safari tab without giving JavaScript a
  // final callback. Keep a recent native quick-save while the game is active so
  // reopening the page and pressing LOAD can restore near the last checkpoint.
  setInterval(() => {
    const now = Date.now();
    if (document.visibilityState !== 'visible') return;
    if (now - startedAt < AUTO_SAVE_MIN_UPTIME_MS) return;
    if (now - lastAutoSaveAt < AUTO_SAVE_INTERVAL_MS) return;
    requestQuickSave('periodic');
  }, AUTO_SAVE_RETRY_MS);

  // Best effort save when Safari backgrounds the page. This is not guaranteed
  // on an OOM kill, which is why the periodic checkpoint above is the primary guard.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    if (Date.now() - startedAt < AUTO_SAVE_MIN_UPTIME_MS) return;
    if (Date.now() - lastAutoSaveAt < 15000) return;
    requestQuickSave('background');
  });

  window.addEventListener('gx-mobile-save-load-status', e => {
    const action = e.detail?.action === 1 ? 'SAVE' : 'LOAD';
    const code = e.detail?.code;
    console.log('[mobile] ' + action + ' result code=' + code);
    if (code === 0) {
      try { if (navigator.vibrate) navigator.vibrate([12, 35, 12]); } catch (_) {}
    }
  });
})();
