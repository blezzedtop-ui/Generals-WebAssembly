'use strict';
// Touch-screen stability/input guard. The full mobile bridge lives in
// mobile-controls-core.js. This loader keeps viewport churn stable and makes
// ordinary one-finger map dragging camera-only (never a selection drag).
(function () {
  if (window.__gxTouchScreenGuardInstalled) return;
  window.__gxTouchScreenGuardInstalled = true;

  let activeTouches = 0;
  let pendingViewportSync = null;
  let pendingCanvasResize = null;
  const vv = window.visualViewport;

  const isUiTarget = t => !!(t && t.closest &&
    (t.closest('#gx-mobile-controls') || t.closest('#gx-overlay') || t.closest('#gx-mp')));

  function lockPageGestures() {
    const cv = document.getElementById('canvas');
    for (const el of [document.documentElement, document.body, cv]) {
      if (!el) continue;
      el.style.setProperty('touch-action', 'none', 'important');
      el.style.setProperty('overscroll-behavior', 'none', 'important');
      el.style.setProperty('-webkit-user-select', 'none', 'important');
      el.style.setProperty('-webkit-touch-callout', 'none', 'important');
    }
  }

  function updateTouchCount(e) {
    if (isUiTarget(e.target)) return;
    activeTouches = e.touches ? e.touches.length : 0;
  }

  function flushAfterGesture() {
    if (activeTouches !== 0) return;
    const sync = pendingViewportSync;
    pendingViewportSync = null;

    requestAnimationFrame(() => {
      if (activeTouches !== 0) return;
      if (sync) {
        pendingCanvasResize = null;
        try { sync(); } catch {}
      } else if (window.Module?.__gxFlushTouchCanvasResize) {
        try { Module.__gxFlushTouchCanvasResize(); } catch {}
      }
      try { scrollTo(0, 0); } catch {}
    });
  }

  document.addEventListener('touchstart', e => {
    updateTouchCount(e);
    lockPageGestures();
  }, { passive: true, capture: true });

  document.addEventListener('touchmove', e => {
    updateTouchCount(e);
    if (!isUiTarget(e.target) && e.cancelable) e.preventDefault();
  }, { passive: false, capture: true });

  document.addEventListener('touchend', e => {
    updateTouchCount(e);
    flushAfterGesture();
  }, { passive: true, capture: true });

  document.addEventListener('touchcancel', e => {
    updateTouchCount(e);
    flushAfterGesture();
  }, { passive: true, capture: true });

  const nativeWindowAdd = window.addEventListener;
  const nativeVvAdd = vv && vv.addEventListener;

  function guardedViewportListener(listener) {
    return function (event) {
      if (activeTouches > 0) {
        pendingViewportSync = listener;
        return;
      }
      return listener.call(this, event);
    };
  }

  window.addEventListener = function (type, listener, options) {
    if (type === 'resize' && listener && listener.name === 'syncViewport') {
      return nativeWindowAdd.call(window, type, guardedViewportListener(listener), options);
    }
    return nativeWindowAdd.call(window, type, listener, options);
  };

  if (vv && nativeVvAdd) {
    vv.addEventListener = function (type, listener, options) {
      if ((type === 'resize' || type === 'scroll') && listener && listener.name === 'syncViewport') {
        return nativeVvAdd.call(vv, type, guardedViewportListener(listener), options);
      }
      return nativeVvAdd.call(vv, type, listener, options);
    };
  }

  // Keep runtime canvas resize away from an active gesture.
  const wrapTimer = setInterval(() => {
    const mod = window.Module;
    if (!mod || typeof mod.setCanvasSize !== 'function' || mod.__gxTouchCanvasResizeGuard) return;

    const nativeSetCanvasSize = mod.setCanvasSize.bind(mod);
    mod.__gxTouchCanvasResizeGuard = true;
    mod.setCanvasSize = function (w, h, noUpdates) {
      if (activeTouches > 0) {
        pendingCanvasResize = [w, h, noUpdates];
        return;
      }
      return nativeSetCanvasSize(w, h, noUpdates);
    };
    mod.__gxFlushTouchCanvasResize = function () {
      if (!pendingCanvasResize || activeTouches > 0) return;
      const args = pendingCanvasResize;
      pendingCanvasResize = null;
      return nativeSetCanvasSize(args[0], args[1], args[2]);
    };
    clearInterval(wrapTimer);
  }, 50);

  // The core previously implemented normal one-finger camera drag as RMB drag.
  // Generals can interpret that mouse drag as selection on some mobile builds.
  // Intercept ONLY one-finger RMB drag and convert it to camera arrow keys.
  // Left-button drag is untouched, so box selection still works only when the
  // explicit SELECT mode in mobile-controls-core.js is armed. Two-finger RMB
  // camera pan is also untouched.
  const inputWrapTimer = setInterval(() => {
    const mod = window.Module;
    if (!mod || typeof mod._gxWebSendMouse !== 'function' || mod.__gxOneFingerCameraGuard) return;

    const nativeMouse = mod._gxWebSendMouse.bind(mod);
    const keyTimers = new Map();
    let pendingRmb = null;
    const KEY_RIGHT = 1073741903;
    const KEY_LEFT  = 1073741904;
    const KEY_DOWN  = 1073741905;
    const KEY_UP    = 1073741906;

    function pulseKey(code) {
      if (typeof mod._gxWebSendKeyState === 'function') {
        mod._gxWebSendKeyState(code, 1);
        const old = keyTimers.get(code);
        if (old) clearTimeout(old);
        keyTimers.set(code, setTimeout(() => {
          try { mod._gxWebSendKeyState(code, 0); } catch {}
          keyTimers.delete(code);
        }, 95));
      } else if (typeof mod._gxWebSendKey === 'function') {
        mod._gxWebSendKey(code);
      }
    }

    function releaseCameraKeys() {
      if (typeof mod._gxWebSendKeyState === 'function') {
        for (const code of [KEY_RIGHT, KEY_LEFT, KEY_DOWN, KEY_UP]) {
          const timer = keyTimers.get(code);
          if (timer) clearTimeout(timer);
          try { mod._gxWebSendKeyState(code, 0); } catch {}
        }
      }
      keyTimers.clear();
    }

    mod.__gxOneFingerCameraGuard = true;
    mod._gxWebSendMouse = function (type, x, y, button, buttons) {
      // Start of a one-finger RMB gesture: hold it pending so a stationary
      // long-press can still become a real right-click on release.
      if (activeTouches === 1 && type === 1 && button === 3) {
        pendingRmb = { startX:x, startY:y, lastX:x, lastY:y, moved:false };
        return;
      }

      if (pendingRmb && type === 0 && (buttons & 4)) {
        const dx = x - pendingRmb.lastX;
        const dy = y - pendingRmb.lastY;
        if (Math.abs(x - pendingRmb.startX) > 7 || Math.abs(y - pendingRmb.startY) > 7) {
          pendingRmb.moved = true;
        }
        if (pendingRmb.moved) {
          // Grab-map semantics: dragging content right moves camera left, etc.
          if (dx > 2) pulseKey(KEY_LEFT);
          else if (dx < -2) pulseKey(KEY_RIGHT);
          if (dy > 2) pulseKey(KEY_UP);
          else if (dy < -2) pulseKey(KEY_DOWN);
        }
        pendingRmb.lastX = x;
        pendingRmb.lastY = y;
        return;
      }

      if (pendingRmb && type === 2 && button === 3) {
        if (!pendingRmb.moved) {
          // Preserve stationary long-press/right-click behavior.
          nativeMouse(1, pendingRmb.startX, pendingRmb.startY, 3, 4);
          nativeMouse(2, x, y, 3, 0);
        }
        releaseCameraKeys();
        pendingRmb = null;
        return;
      }

      return nativeMouse(type, x, y, button, buttons);
    };

    clearInterval(inputWrapTimer);
  }, 50);

  window.__gxMobileGuardCoreLoaded = function () {
    window.addEventListener = nativeWindowAdd;
    if (vv && nativeVvAdd) vv.addEventListener = nativeVvAdd;
    lockPageGestures();
    delete window.__gxMobileGuardCoreLoaded;
  };

  const src = 'mobile-controls-core.js?v=35';
  if (document.readyState === 'loading') {
    document.write('<script src="' + src + '" onload="window.__gxMobileGuardCoreLoaded&&window.__gxMobileGuardCoreLoaded()"><\/script>');
  } else {
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = window.__gxMobileGuardCoreLoaded;
    (document.head || document.documentElement).appendChild(s);
  }
})();
