'use strict';
// iPhone stability + smooth touch-direction guard.
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

  const RIGHT = 1073741903;
  const LEFT  = 1073741904;
  const DOWN  = 1073741905;
  const UP    = 1073741906;
  const ESC   = 27;
  const arrowCodes = new Set([RIGHT, LEFT, DOWN, UP]);

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
  let pwmFrame = 0;
  let panStrength = 0;
  const PWM_PERIOD_MS = 72;
  const emptySet = new Set();

  function clearIdleRelease() {
    if (idleRelease !== null) clearTimeout(idleRelease);
    idleRelease = null;
  }

  function setHeld(target) {
    if (!nativeSend) return;
    for (const code of Array.from(held)) {
      if (!target.has(code)) {
        nativeSend(code, 0);
        held.delete(code);
      }
    }
    for (const code of target) {
      if (!held.has(code)) {
        nativeSend(code, 1);
        held.add(code);
      }
    }
  }

  function stopPwm() {
    if (pwmFrame) cancelAnimationFrame(pwmFrame);
    pwmFrame = 0;
  }

  function pwmStep(now) {
    pwmFrame = 0;
    if (!panTouchActive || !desired.size || !nativeSend || panStrength <= 0) {
      setHeld(emptySet);
      return;
    }
    const duty = Math.min(1, 0.45 + panStrength * 0.55);
    const phase = (now % PWM_PERIOD_MS) / PWM_PERIOD_MS;
    setHeld(phase < duty ? desired : emptySet);
    pwmFrame = requestAnimationFrame(pwmStep);
  }

  function applyDesired() {
    if (!nativeSend) return;
    if (!desired.size || panStrength <= 0) {
      stopPwm();
      setHeld(emptySet);
      return;
    }
    if (!pwmFrame) pwmFrame = requestAnimationFrame(pwmStep);
  }

  function releaseAllArrows() {
    clearIdleRelease();
    stopPwm();
    desired = new Set();
    panStrength = 0;
    setHeld(emptySet);
  }

  function resetPan(keepTouch = false) {
    releaseAllArrows();
    if (!keepTouch) panTouchActive = false;
    lastPoint = null;
    filtX = 0;
    filtY = 0;
  }

  function updateIntent(dx, dy) {
    dx = Math.max(-22, Math.min(22, dx));
    dy = Math.max(-22, Math.min(22, dy));
    filtX = filtX * 0.72 + dx * 0.28;
    filtY = filtY * 0.72 + dy * 0.28;

    const ax = Math.abs(filtX);
    const ay = Math.abs(filtY);
    const speed = Math.hypot(filtX, filtY);
    const DEAD = 0.72;
    const SECONDARY = 0.58;
    const next = new Set();

    if (ax >= DEAD && (ay < DEAD || ax >= ay * SECONDARY)) next.add(filtX > 0 ? LEFT : RIGHT);
    if (ay >= DEAD && (ax < DEAD || ay >= ax * SECONDARY)) next.add(filtY > 0 ? UP : DOWN);

    desired = next;
    panStrength = next.size ? Math.max(0.10, Math.min(1, (speed - DEAD) / 5.8)) : 0;
    applyDesired();

    clearIdleRelease();
    idleRelease = setTimeout(() => {
      filtX *= 0.35;
      filtY *= 0.35;
      panStrength *= 0.35;
      applyDesired();
      idleRelease = setTimeout(() => {
        desired = new Set();
        panStrength = 0;
        applyDesired();
      }, 55);
    }, 105);
  }

  document.addEventListener('touchstart', e => {
    if (isUiTarget(e.target)) return;
    panTouchActive = true;
    lastPoint = centerOf(e.touches);
    filtX = 0;
    filtY = 0;
    desired = new Set();
    panStrength = 0;
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
    if (Math.hypot(dx, dy) < 0.18) return;
    updateIntent(dx, dy);
  }, { passive: true, capture: true });

  document.addEventListener('touchend', e => {
    if (!panTouchActive) return;
    if (e.touches && e.touches.length) {
      lastPoint = centerOf(e.touches);
      filtX = 0;
      filtY = 0;
      desired = new Set();
      panStrength = 0;
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
      if (panTouchActive) return;
      return nativeSend(code, down);
    };
    wrapped.__gxTouchIntentBridge = true;
    wrapped.__gxOriginal = current;
    m._gxWebSendKeyState = wrapped;
    applyDesired();
    console.log('[touch-filter] smooth variable-speed camera pan enabled');
    return true;
  }
  const bridgeTimer = setInterval(installTouchIntentBridge, 50);
  setTimeout(() => { if (installTouchIntentBridge()) clearInterval(bridgeTimer); }, 12000);

  function pulseEscape() {
    const m = window.Module;
    try {
      if (m?._gxWebSendKeyState) {
        m._gxWebSendKeyState(ESC, 1);
        setTimeout(() => { try { window.Module?._gxWebSendKeyState?.(ESC, 0); } catch (_) {} }, 90);
        return;
      }
      if (m?._gxWebSendKey) {
        m._gxWebSendKey(ESC);
        return;
      }
    } catch (_) {}
    const cv = document.getElementById('canvas');
    if (!cv) return;
    const opts = { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true, composed: true };
    cv.dispatchEvent(new KeyboardEvent('keydown', opts));
    setTimeout(() => cv.dispatchEvent(new KeyboardEvent('keyup', opts)), 90);
  }

  function installCancelButton() {
    const btn = document.getElementById('gx-m-close');
    if (!btn || btn.__gxCancelPolished) return !!btn;
    btn.__gxCancelPolished = true;
    btn.setAttribute('aria-label', 'Cancel current selection or command');
    btn.setAttribute('title', 'Cancel');
    // Keep X far away from SELECT: X stays at the top-left next to ESC,
    // while SELECT remains on the lower-right side of the game screen.
    btn.style.left = '76px';
    btn.style.top = '18px';
    btn.style.right = 'auto';
    btn.style.bottom = 'auto';
    btn.style.width = '52px';
    btn.style.height = '46px';
    btn.style.borderRadius = '10px';
    btn.style.background = 'rgba(145,35,35,.78)';
    btn.style.borderColor = 'rgba(255,170,170,.85)';
    btn.style.fontSize = '22px';
    return true;
  }

  document.addEventListener('pointerdown', e => {
    const btn = e.target?.closest?.('#gx-m-close,[data-close]');
    if (!btn) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    resetPan(false);

    const selectBtn = document.getElementById('gx-m-select');
    if (selectBtn?.classList.contains('gx-active')) {
      try {
        selectBtn.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, pointerType: 'touch'
        }));
      } catch (_) {
        selectBtn.classList.remove('gx-active');
      }
    }
    pulseEscape();
    try { if (navigator.vibrate) navigator.vibrate(10); } catch (_) {}
  }, { capture: true, passive: false });

  if (!installCancelButton()) {
    const cancelTimer = setInterval(() => {
      if (installCancelButton()) clearInterval(cancelTimer);
    }, 100);
    setTimeout(() => clearInterval(cancelTimer), 10000);
  }

  loadBase();
})();
