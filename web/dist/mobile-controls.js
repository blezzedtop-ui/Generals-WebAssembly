'use strict';
// iPhone stability + touch-direction guard.
(function () {
  const touchDevice = navigator.maxTouchPoints > 0;

  function loadBase() {
    const src = 'mobile-controls-base.js?v=42';
    if (document.readyState === 'loading') {
      document.write('<script src="' + src + '"><\/script>');
    } else {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      (document.head || document.documentElement).appendChild(s);
    }
  }

  if (!touchDevice) {
    loadBase();
    return;
  }

  // Keep the display awake during long game sessions.
  let wakeLock = null;
  async function keepScreenAwake() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    if (wakeLock && !wakeLock.released) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; }, { once: true });
    } catch (_) {}
  }
  window.gxKeepScreenAwake = keepScreenAwake;
  document.addEventListener('touchstart', () => { void keepScreenAwake(); }, { passive: true, capture: true });
  document.addEventListener('pointerdown', () => { void keepScreenAwake(); }, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void keepScreenAwake();
  });
  void keepScreenAwake();

  function setArg(args, name, val) {
    const i = args.findIndex(a => String(a).toLowerCase() === name);
    if (i >= 0) {
      if (i + 1 < args.length) args[i + 1] = String(val);
      else args.push(String(val));
    } else args.push(name, String(val));
  }

  // Lower iPhone render pressure while preserving the visible aspect ratio.
  const started = performance.now();
  const argGuard = setInterval(() => {
    const current = window.gxGameArguments;
    if (typeof current !== 'function') {
      if (performance.now() - started > 5000) clearInterval(argGuard);
      return;
    }
    if (!current.__gxLowPressure540) {
      const previous = current;
      const wrapped = function () {
        const args = previous();
        if (navigator.maxTouchPoints < 1) return args;
        const v = window.visualViewport;
        const vw = Math.max(1, v ? v.width : innerWidth);
        const vh = Math.max(1, v ? v.height : innerHeight);
        const sw = Math.max(screen.width || 0, screen.height || 0, vw, vh);
        const dims = [screen.width || 0, screen.height || 0].filter(n => n > 0);
        const sh = Math.max(1, dims.length ? Math.min(...dims) : Math.min(vw, vh));
        const aspect = Math.max(1.33, Math.min(2.5, sw / sh));
        let h = 540;
        let w = Math.round(h * aspect);
        w = (Math.max(864, Math.min(1440, w)) & ~1);
        h &= ~1;
        setArg(args, '-xres', w);
        setArg(args, '-yres', h);
        if (!args.some(a => String(a).toLowerCase() === '-forcefullviewport')) args.push('-forcefullviewport');
        return args;
      };
      wrapped.__gxLowPressure540 = true;
      window.gxGameArguments = wrapped;
    }
    if (performance.now() - started > 5000) clearInterval(argGuard);
  }, 5);

  // Let WebKit restore a lost WebGL context instead of leaving a black canvas.
  function attachContextRecovery() {
    const cv = document.getElementById('canvas');
    if (!cv || cv.__gxContextRecoveryInstalled) return false;
    cv.__gxContextRecoveryInstalled = true;
    cv.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      cv.dataset.gxContextLost = '1';
      console.warn('[iphone-stability] WebGL context lost; waiting for restore');
    }, false);
    cv.addEventListener('webglcontextrestored', () => {
      delete cv.dataset.gxContextLost;
      try { cv.focus({ preventScroll: true }); } catch (_) { try { cv.focus(); } catch (__) {} }
    }, false);
    return true;
  }
  if (!attachContextRecovery()) {
    const contextTimer = setInterval(() => { if (attachContextRecovery()) clearInterval(contextTimer); }, 100);
    setTimeout(() => clearInterval(contextTimer), 10000);
  }

  // Native SDL arrow codes used by the camera bridge.
  const RIGHT = 1073741903;
  const LEFT  = 1073741904;
  const DOWN  = 1073741905;
  const UP    = 1073741906;
  const arrowCodes = new Set([RIGHT, LEFT, DOWN, UP]);

  // Drive camera arrows from a filtered touch vector. The legacy core still
  // detects gestures/select/pinch, but its 62ms/22ms arrow pulses are ignored
  // while a touch-pan is active. This removes stop/start stutter and prevents
  // 1px coordinate noise from briefly steering in the opposite direction.
  const isUiTarget = t => !!(t && t.closest &&
    (t.closest('#gx-mobile-controls') || t.closest('#gx-overlay') || t.closest('#gx-mp')));
  const selectionActive = () => !!document.querySelector('#gx-m-select.gx-active');
  const centerOf = touches => {
    if (!touches || !touches.length) return null;
    let x = 0, y = 0;
    for (let i = 0; i < touches.length; i++) { x += touches[i].clientX; y += touches[i].clientY; }
    return { x: x / touches.length, y: y / touches.length };
  };

  let nativeModule = null;
  let nativeSend = null;
  let panTouchActive = false;
  let lastPoint = null;
  let filtX = 0;
  let filtY = 0;
  let desired = new Set();
  const held = new Set();
  let idleRelease = null;

  function clearIdleRelease() {
    if (idleRelease !== null) clearTimeout(idleRelease);
    idleRelease = null;
  }
  function applyDesired() {
    if (!nativeSend) return;
    for (const code of Array.from(held)) {
      if (!desired.has(code)) {
        nativeSend(code, 0);
        held.delete(code);
      }
    }
    for (const code of desired) {
      if (!held.has(code)) {
        nativeSend(code, 1);
        held.add(code);
      }
    }
  }
  function releaseAllArrows() {
    clearIdleRelease();
    desired = new Set();
    if (nativeSend) {
      for (const code of Array.from(held)) nativeSend(code, 0);
    }
    held.clear();
  }
  function resetPan(keepTouch = false) {
    releaseAllArrows();
    if (!keepTouch) panTouchActive = false;
    lastPoint = null;
    filtX = 0;
    filtY = 0;
  }
  function updateIntent(dx, dy) {
    // Clamp occasional Safari coordinate jumps and low-pass normal finger jitter.
    dx = Math.max(-24, Math.min(24, dx));
    dy = Math.max(-24, Math.min(24, dy));
    filtX = filtX * 0.58 + dx;
    filtY = filtY * 0.58 + dy;

    const ax = Math.abs(filtX);
    const ay = Math.abs(filtY);
    const DEAD = 1.9;
    const SECONDARY = 0.68;
    const next = new Set();

    // Map-grab semantics: finger right => camera left; finger down => camera up.
    if (ax >= DEAD && (ay < DEAD || ax >= ay * SECONDARY)) next.add(filtX > 0 ? LEFT : RIGHT);
    if (ay >= DEAD && (ax < DEAD || ay >= ax * SECONDARY)) next.add(filtY > 0 ? UP : DOWN);

    desired = next;
    applyDesired();

    clearIdleRelease();
    // If WebKit drops touchmove events briefly, keep motion alive long enough to
    // bridge the gap, but stop promptly once the finger actually stops moving.
    idleRelease = setTimeout(() => {
      desired = new Set();
      applyDesired();
      filtX *= 0.35;
      filtY *= 0.35;
    }, 135);
  }

  document.addEventListener('touchstart', e => {
    if (isUiTarget(e.target)) return;
    panTouchActive = true;
    lastPoint = centerOf(e.touches);
    filtX = 0;
    filtY = 0;
    desired = new Set();
    releaseAllArrows();
  }, { passive: true, capture: true });

  document.addEventListener('touchmove', e => {
    if (!panTouchActive || isUiTarget(e.target)) return;
    const p = centerOf(e.touches);
    if (!p) return;
    if (selectionActive()) {
      resetPan(true);
      lastPoint = p;
      return;
    }
    if (!lastPoint) {
      lastPoint = p;
      return;
    }
    const dx = p.x - lastPoint.x;
    const dy = p.y - lastPoint.y;
    lastPoint = p;
    if (Math.hypot(dx, dy) < 0.35) return;
    updateIntent(dx, dy);
  }, { passive: true, capture: true });

  document.addEventListener('touchend', e => {
    if (!panTouchActive) return;
    if (e.touches && e.touches.length) {
      lastPoint = centerOf(e.touches);
      filtX = 0;
      filtY = 0;
      desired = new Set();
      applyDesired();
    } else {
      resetPan(false);
    }
  }, { passive: true, capture: true });
  document.addEventListener('touchcancel', () => resetPan(false), { passive: true, capture: true });
  window.addEventListener('blur', () => resetPan(false));
  document.addEventListener('visibilitychange', () => { if (document.hidden) resetPan(false); });

  function installTouchIntentBridge() {
    const m = window.Module;
    const current = m && m._gxWebSendKeyState;
    if (typeof current !== 'function') return false;
    if (current.__gxTouchIntentBridge) return true;

    if (nativeModule !== m) {
      releaseAllArrows();
      nativeModule = m;
    }
    nativeSend = current.bind(m);

    const wrapped = function (code, down) {
      if (!arrowCodes.has(code)) return nativeSend(code, down);
      // During an active touch gesture our filtered vector is the single source
      // of truth. Ignore the old pulse generator so it cannot inject stale or
      // opposite arrows. Outside touch-pan, preserve normal native behavior.
      if (panTouchActive) return;
      return nativeSend(code, down);
    };
    wrapped.__gxTouchIntentBridge = true;
    wrapped.__gxOriginal = current;
    m._gxWebSendKeyState = wrapped;
    applyDesired();
    console.log('[touch-filter] direct filtered camera pan enabled');
    return true;
  }
  const bridgeTimer = setInterval(installTouchIntentBridge, 50);
  setTimeout(() => { if (installTouchIntentBridge()) clearInterval(bridgeTimer); }, 12000);

  loadBase();
})();
