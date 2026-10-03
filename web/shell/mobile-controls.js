'use strict';
// Mobile touch isolation + viewport stability wrapper.
// Physical finger input lands on #gx-touch-surface instead of the SDL canvas;
// gameplay input is then forwarded only by mobile-controls-core.js.
(function () {
  if (window.__gxTouchScreenGuardInstalled) return;
  window.__gxTouchScreenGuardInstalled = true;

  let activeTouches = 0;
  let pendingViewportSync = null;
  const vv = window.visualViewport;

  const isUiTarget = t => !!(t && t.closest &&
    (t.closest('#gx-mobile-controls') || t.closest('#gx-overlay') || t.closest('#gx-mp')));

  function installTouchSurface() {
    const cv = document.getElementById('canvas');
    if (!cv || !document.body) return null;

    let surface = document.getElementById('gx-touch-surface');
    if (!surface) {
      surface = document.createElement('div');
      surface.id = 'gx-touch-surface';
      surface.setAttribute('aria-hidden', 'true');
      surface.style.cssText = [
        'position:fixed','inset:0','z-index:8','background:transparent',
        'pointer-events:auto','touch-action:none','overscroll-behavior:none',
        '-webkit-user-select:none','-webkit-touch-callout:none'
      ].join(';');
      document.body.appendChild(surface);
    }

    cv.style.setProperty('pointer-events', 'none', 'important');
    cv.style.setProperty('touch-action', 'none', 'important');

    try {
      if (document.documentElement.requestFullscreen && cv.requestFullscreen && !cv.__gxRootFsRedirect) {
        cv.__gxRootFsRedirect = true;
        cv.requestFullscreen = opts => document.documentElement.requestFullscreen(opts);
      }
      if (document.documentElement.webkitRequestFullscreen && cv.webkitRequestFullscreen && !cv.__gxRootWebkitFsRedirect) {
        cv.__gxRootWebkitFsRedirect = true;
        cv.webkitRequestFullscreen = () => document.documentElement.webkitRequestFullscreen();
      }
    } catch {}
    return surface;
  }

  function lockPageGestures() {
    installTouchSurface();
    for (const el of [document.documentElement, document.body]) {
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
      if (sync) { try { sync(); } catch {} }
      try { scrollTo(0, 0); } catch {}
    });
  }

  document.addEventListener('touchstart', e => {
    updateTouchCount(e);
    lockPageGestures();
    if (!isUiTarget(e.target) && e.cancelable) e.preventDefault();
  }, { passive:false, capture:true });
  document.addEventListener('touchmove', e => {
    updateTouchCount(e);
    if (!isUiTarget(e.target) && e.cancelable) e.preventDefault();
  }, { passive:false, capture:true });
  document.addEventListener('touchend', e => {
    updateTouchCount(e);
    if (!isUiTarget(e.target) && e.cancelable) e.preventDefault();
    flushAfterGesture();
  }, { passive:false, capture:true });
  document.addEventListener('touchcancel', e => {
    updateTouchCount(e);
    if (!isUiTarget(e.target) && e.cancelable) e.preventDefault();
    flushAfterGesture();
  }, { passive:false, capture:true });

  const nativeWindowAdd = window.addEventListener;
  const nativeVvAdd = vv && vv.addEventListener;
  function guardedViewportListener(listener) {
    return function(event) {
      if (activeTouches > 0) { pendingViewportSync = listener; return; }
      return listener.call(this, event);
    };
  }
  window.addEventListener = function(type, listener, options) {
    if (type === 'resize' && listener && listener.name === 'syncViewport')
      return nativeWindowAdd.call(window, type, guardedViewportListener(listener), options);
    return nativeWindowAdd.call(window, type, listener, options);
  };
  if (vv && nativeVvAdd) {
    vv.addEventListener = function(type, listener, options) {
      if ((type === 'resize' || type === 'scroll') && listener && listener.name === 'syncViewport')
        return nativeVvAdd.call(vv, type, guardedViewportListener(listener), options);
      return nativeVvAdd.call(vv, type, listener, options);
    };
  }

  window.__gxMobileGuardCoreLoaded = function() {
    window.addEventListener = nativeWindowAdd;
    if (vv && nativeVvAdd) vv.addEventListener = nativeVvAdd;
    lockPageGestures();
    delete window.__gxMobileGuardCoreLoaded;
  };

  lockPageGestures();
  const src = 'mobile-controls-core.js?v=37';
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
