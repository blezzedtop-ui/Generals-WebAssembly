'use strict';
// iPhone/iPad runtime fixes: keep the touch UI compact and avoid retaining a
// second full WASM copy in JavaScript before Emscripten starts.
(function () {
  const isTouch = navigator.maxTouchPoints > 0;
  if (!isTouch) return;

  // UI-only override. Keep SAVE/LOAD at the upper-right and shrink the rest.
  const style = document.createElement('style');
  style.id = 'gx-mobile-compact-20261006';
  style.textContent = `
    #gx-mobile-controls button{width:44px!important;height:44px!important;font-size:16px!important}
    #gx-m-esc{left:max(12px,env(safe-area-inset-left))!important;top:max(12px,env(safe-area-inset-top))!important;width:40px!important;height:32px!important;border-radius:8px!important;font-size:10px!important}
    #gx-m-close{left:max(58px,calc(env(safe-area-inset-left) + 46px))!important;top:max(12px,env(safe-area-inset-top))!important;width:40px!important;height:32px!important;border-radius:8px!important;font-size:15px!important}
    #gx-m-full{right:max(12px,env(safe-area-inset-right))!important;top:max(12px,env(safe-area-inset-top))!important;width:40px!important;height:32px!important;border-radius:8px!important;font-size:15px!important}
    #gx-m-load{left:auto!important;right:max(58px,calc(env(safe-area-inset-right) + 46px))!important;top:max(12px,env(safe-area-inset-top))!important;bottom:auto!important;width:50px!important;height:32px!important;border-radius:8px!important;font-size:9px!important;padding:0!important}
    #gx-m-save{left:auto!important;right:max(114px,calc(env(safe-area-inset-right) + 102px))!important;top:max(12px,env(safe-area-inset-top))!important;bottom:auto!important;width:50px!important;height:32px!important;border-radius:8px!important;font-size:9px!important;padding:0!important}
    #gx-m-select{right:max(12px,env(safe-area-inset-right))!important;bottom:max(64px,calc(env(safe-area-inset-bottom) + 54px))!important;width:50px!important;height:38px!important;border-radius:9px!important;font-size:10px!important}
  `;
  document.head.appendChild(style);

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
      return result;
    };
  }
})();
