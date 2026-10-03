'use strict';
// Mobile touch isolation + viewport/full-fill bootstrap.
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
      surface.setAttribute('aria-hidden','true');
      surface.style.cssText = [
        'position:fixed','inset:0','z-index:8','background:transparent',
        'pointer-events:auto','touch-action:none','overscroll-behavior:none',
        '-webkit-user-select:none','-webkit-touch-callout:none'
      ].join(';');
      document.body.appendChild(surface);
    }
    // Physical touch must not reach Emscripten/SDL canvas directly.
    cv.style.setProperty('pointer-events','none','important');
    cv.style.setProperty('touch-action','none','important');

    // Keep touch surface + controls inside fullscreen by redirecting canvas
    // fullscreen requests to the document root.
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
      el.style.setProperty('touch-action','none','important');
      el.style.setProperty('overscroll-behavior','none','important');
      el.style.setProperty('-webkit-user-select','none','important');
      el.style.setProperty('-webkit-touch-callout','none','important');
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
      try { scrollTo(0,0); } catch {}
    });
  }

  for (const type of ['touchstart','touchmove','touchend','touchcancel']) {
    document.addEventListener(type, e => {
      updateTouchCount(e);
      lockPageGestures();
      if (!isUiTarget(e.target) && e.cancelable) e.preventDefault();
      if (type === 'touchend' || type === 'touchcancel') flushAfterGesture();
    }, {passive:false,capture:true});
  }

  const nativeWindowAdd = window.addEventListener;
  const nativeVvAdd = vv && vv.addEventListener;
  function guardedViewportListener(listener) {
    return function(event) {
      if (activeTouches > 0) { pendingViewportSync = listener; return; }
      return listener.call(this,event);
    };
  }
  window.addEventListener = function(type,listener,options) {
    if (type === 'resize' && listener && listener.name === 'syncViewport')
      return nativeWindowAdd.call(window,type,guardedViewportListener(listener),options);
    return nativeWindowAdd.call(window,type,listener,options);
  };
  if (vv && nativeVvAdd) {
    vv.addEventListener = function(type,listener,options) {
      if ((type === 'resize' || type === 'scroll') && listener && listener.name === 'syncViewport')
        return nativeVvAdd.call(vv,type,guardedViewportListener(listener),options);
      return nativeVvAdd.call(vv,type,listener,options);
    };
  }

  // game.js is loaded after this file. Once available, replace only its mobile
  // resolution values. Generals gets a stable ~600px-tall widescreen render;
  // CSS then scales that frame to the exact visible phone viewport.
  const fullFillTimer = setInterval(() => {
    if (typeof window.gxGameArguments !== 'function') return;
    const originalArgs = window.gxGameArguments;
    window.gxGameArguments = function() {
      const args = originalArgs();
      if (navigator.maxTouchPoints < 1) return args;
      const v = window.visualViewport;
      const vw = Math.max(1, v ? v.width : innerWidth);
      const vh = Math.max(1, v ? v.height : innerHeight);
      const sw = Math.max(screen.width || 0, screen.height || 0, vw, vh);
      const shCandidates = [screen.width || 0, screen.height || 0].filter(n => n > 0);
      const sh = Math.max(1, shCandidates.length ? Math.min(...shCandidates) : Math.min(vw,vh));
      const aspect = Math.max(1.33, Math.min(2.5, sw / sh));
      let h = 600;
      let w = Math.round(h * aspect);
      w = Math.max(960, Math.min(1600, w)) & ~1;
      h &= ~1;
      const setArg = (name,val) => {
        const i = args.findIndex(a => String(a).toLowerCase() === name);
        if (i >= 0) {
          if (i + 1 < args.length) args[i+1] = String(val);
          else args.push(String(val));
        } else args.push(name,String(val));
      };
      setArg('-xres',w);
      setArg('-yres',h);
      if (!args.some(a => String(a).toLowerCase() === '-forcefullviewport')) args.push('-forcefullviewport');
      console.log('[mobile-fullfill]',w+'x'+h,'aspect='+aspect.toFixed(3));
      return args;
    };
    clearInterval(fullFillTimer);
  }, 10);

  window.__gxMobileGuardCoreLoaded = function() {
    window.addEventListener = nativeWindowAdd;
    if (vv && nativeVvAdd) vv.addEventListener = nativeVvAdd;
    lockPageGestures();
    delete window.__gxMobileGuardCoreLoaded;
  };

  lockPageGestures();
  const src='mobile-controls-core.js?v=37';
  if (document.readyState === 'loading') {
    document.write('<script src="'+src+'" onload="window.__gxMobileGuardCoreLoaded&&window.__gxMobileGuardCoreLoaded()"><\/script>');
  } else {
    const s=document.createElement('script');
    s.src=src;s.async=false;s.onload=window.__gxMobileGuardCoreLoaded;
    (document.head||document.documentElement).appendChild(s);
  }
})();
