'use strict';
// iPhone/iPad runtime fixes: keep the touch UI compact, avoid retaining a
// second full WASM copy before Emscripten starts, and provide safe live cache cleanup.
(function () {
  const isTouch = navigator.maxTouchPoints > 0;
  if (!isTouch) return;

  const MB = 1024 * 1024;
  const AUTO_CLEAN_CACHE_MB = 96;
  const AUTO_CLEAN_COOLDOWN_MS = 15000;
  let lastAutoCleanAt = 0;
  let cleanupResetTimer = 0;

  // UI-only override. Keep SAVE/LOAD at the upper-right and shrink the rest.
  const style = document.createElement('style');
  style.id = 'gx-mobile-compact-20261006';
  style.textContent = `
    #gx-mobile-controls button{width:44px!important;height:44px!important;font-size:16px!important}
    #gx-m-esc{left:max(12px,env(safe-area-inset-left))!important;top:max(12px,env(safe-area-inset-top))!important;width:40px!important;height:32px!important;border-radius:8px!important;font-size:10px!important}
    #gx-m-close{left:max(58px,calc(env(safe-area-inset-left) + 46px))!important;top:max(12px,env(safe-area-inset-top))!important;width:40px!important;height:32px!important;border-radius:8px!important;font-size:15px!important}
    #gx-m-ram-clean{position:fixed!important;left:max(104px,calc(env(safe-area-inset-left) + 92px))!important;top:max(12px,env(safe-area-inset-top))!important;width:54px!important;height:32px!important;border-radius:8px!important;font-size:9px!important;padding:0!important;z-index:10012!important}
    #gx-m-ram-status{position:fixed;left:max(164px,calc(env(safe-area-inset-left) + 152px));top:max(12px,env(safe-area-inset-top));height:30px;min-width:112px;padding:0 7px;border:1px solid rgba(255,255,255,.25);border-radius:8px;background:rgba(0,0,0,.58);color:#fff;font:600 9px/30px system-ui,-apple-system,sans-serif;text-align:center;white-space:nowrap;pointer-events:none;z-index:10012}
    #gx-m-full{right:max(12px,env(safe-area-inset-right))!important;top:max(12px,env(safe-area-inset-top))!important;width:40px!important;height:32px!important;border-radius:8px!important;font-size:15px!important}
    #gx-m-load{left:auto!important;right:max(58px,calc(env(safe-area-inset-right) + 46px))!important;top:max(12px,env(safe-area-inset-top))!important;bottom:auto!important;width:50px!important;height:32px!important;border-radius:8px!important;font-size:9px!important;padding:0!important}
    #gx-m-save{left:auto!important;right:max(114px,calc(env(safe-area-inset-right) + 102px))!important;top:max(12px,env(safe-area-inset-top))!important;bottom:auto!important;width:50px!important;height:32px!important;border-radius:8px!important;font-size:9px!important;padding:0!important}
    #gx-m-select{right:max(12px,env(safe-area-inset-right))!important;bottom:max(64px,calc(env(safe-area-inset-bottom) + 54px))!important;width:50px!important;height:38px!important;border-radius:9px!important;font-size:10px!important}
  `;
  document.head.appendChild(style);

  function nativeFunction(name) {
    const mod = window.Module;
    if (mod && typeof mod[name] === 'function') return mod[name].bind(mod);
    if (typeof window[name] === 'function') return window[name];
    return null;
  }

  function wasmCapacityMB() {
    try {
      const heap = window.Module && window.Module.HEAPU8;
      return heap && heap.buffer ? Math.round(heap.buffer.byteLength / MB) : 0;
    } catch {
      return 0;
    }
  }

  function unusedTextureMB() {
    const getter = nativeFunction('_gxWebGetUnusedTextureMB');
    if (!getter) return -1;
    try {
      return getter() >>> 0;
    } catch {
      return -1;
    }
  }

  function ensureRamControls() {
    const host = document.getElementById('gx-mobile-controls');
    if (!host) return null;

    let clean = document.getElementById('gx-m-ram-clean');
    if (!clean) {
      clean = document.createElement('button');
      clean.id = 'gx-m-ram-clean';
      clean.type = 'button';
      clean.textContent = 'RAM CLEAN';
      clean.setAttribute('aria-label', 'Release unused game assets');
      ['pointerdown', 'pointerup', 'touchstart', 'touchend'].forEach((eventName) => {
        clean.addEventListener(eventName, (event) => event.stopPropagation(), { passive: false });
      });
      clean.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        runCleanup(false);
      });
      host.appendChild(clean);
    }

    let status = document.getElementById('gx-m-ram-status');
    if (!status) {
      status = document.createElement('div');
      status.id = 'gx-m-ram-status';
      status.textContent = 'WASM -- | CACHE --';
      host.appendChild(status);
    }

    return { clean, status };
  }

  function updateRamStatus() {
    const ui = ensureRamControls();
    if (!ui) return;

    const heapMB = wasmCapacityMB();
    const cacheMB = unusedTextureMB();
    const nativeReady = !!nativeFunction('_gxWebReleaseUnusedAssets');
    ui.clean.disabled = !nativeReady;
    ui.clean.style.opacity = nativeReady ? '1' : '.55';
    ui.status.textContent = `WASM ${heapMB || '--'}M | CACHE ${cacheMB >= 0 ? cacheMB + 'M' : '--'}`;

    // Native code also checks every 300 frames. This timer is a backup for
    // cases where rendering gets slow but the browser event loop still runs.
    if (nativeReady && cacheMB >= AUTO_CLEAN_CACHE_MB && Date.now() - lastAutoCleanAt >= AUTO_CLEAN_COOLDOWN_MS) {
      runCleanup(true);
    }
  }

  function runCleanup(isAuto) {
    const ui = ensureRamControls();
    const release = nativeFunction('_gxWebReleaseUnusedAssets');
    if (!ui || !release) return false;

    let candidateMB = 0;
    try {
      candidateMB = release() >>> 0;
      lastAutoCleanAt = Date.now();
      console.log(`[memory] ${isAuto ? 'auto' : 'manual'} unused-asset cleanup; candidate cache=${candidateMB} MB`);
    } catch (error) {
      console.warn('[memory] unused-asset cleanup failed', error);
      return false;
    }

    clearTimeout(cleanupResetTimer);
    ui.clean.textContent = candidateMB ? `CLEAN ${candidateMB}M` : 'CLEAN ✓';
    cleanupResetTimer = setTimeout(() => {
      const button = document.getElementById('gx-m-ram-clean');
      if (button) button.textContent = 'RAM CLEAN';
    }, 1400);
    setTimeout(updateRamStatus, 0);
    return true;
  }

  function startRamMonitor() {
    ensureRamControls();
    updateRamStatus();
    setInterval(updateRamStatus, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startRamMonitor, { once: true });
  } else {
    startRamMonitor();
  }

  // Do not pre-download GeneralsXZH.wasm into a JS Uint8Array on mobile.
  // The generated Emscripten glue already uses WebAssembly.instantiateStreaming
  // when Module.wasmBinary is absent. That avoids keeping an ~80 MB source-WASM
  // buffer alive at the same time as the 512 MB shared linear memory.
  if (typeof window.gxPreloadEngine === 'function') {
    window.gxPreloadEngine = async function gxPreloadEngineStreaming(onProgress) {
      let buildId = 'dev';
      try {
        const r = await fetch('build.json', { cache: 'no-cache' });
        if (r.ok) buildId = (await r.json()).buildId || 'dev';
      } catch {}

      if (!window.gxEngine) window.gxEngine = { wasmBinary: null, buildId: 'dev' };
      window.gxEngine.buildId = buildId;
      window.gxEngine.wasmBinary = null;

      // Loader-core expects this callback, but the actual WASM transfer now
      // happens inside Emscripten during gxStartGame().
      if (onProgress) onProgress(0, 0);
      console.log('[memory] mobile WASM preload skipped; using instantiateStreaming');
    };
  }

  // Keep the release guard as a fallback for stale tabs/mixed cached scripts.
  if (typeof window.gxStartGame === 'function') {
    const startGame = window.gxStartGame;
    window.gxStartGame = async function gxStartGameLowPeak() {
      const result = await startGame();
      try {
        if (window.gxEngine) window.gxEngine.wasmBinary = null;
        if (window.Module) window.Module.wasmBinary = null;
      } catch {}
      updateRamStatus();
      return result;
    };
  }
})();
