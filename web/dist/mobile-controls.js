'use strict';
// Touch-screen stability guard. The full mobile bridge lives in
// mobile-controls-core.js; this loader prevents iPhone/Android visualViewport
// churn from resizing the WebGL canvas while a finger gesture is active.
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
        // Recompute the current visual viewport once, after the gesture. Do not
        // replay an older blocked canvas size after this fresh sync.
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

  // The core bridge registers syncViewport directly on window/visualViewport.
  // Wrap only those registrations while the core loads, then restore the native
  // addEventListener methods. This keeps horizontal/vertical camera gestures
  // from resizing/repositioning the game surface mid-drag.
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

  // Emscripten exposes setCanvasSize only after the engine glue initializes.
  // Wrap it once and defer resize requests while any game touch is held.
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

  window.__gxMobileGuardCoreLoaded = function () {
    window.addEventListener = nativeWindowAdd;
    if (vv && nativeVvAdd) vv.addEventListener = nativeVvAdd;
    lockPageGestures();
    delete window.__gxMobileGuardCoreLoaded;
  };

  const src = 'mobile-controls-core.js?v=34';
  if (document.readyState === 'loading') {
    document.write('<script src="' + src + '" onload="window.__gxMobileGuardCoreLoaded&&window.__gxMobileGuardCoreLoaded()"><\\/script>');
  } else {
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = window.__gxMobileGuardCoreLoaded;
    (document.head || document.documentElement).appendChild(s);
  }
})();
