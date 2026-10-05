'use strict';
// iPhone Safari runtime fixes: lower temporary WASM peak memory and keep the
// touch UI compact without changing game/control logic.
(function () {
  const isTouch = navigator.maxTouchPoints > 0;
  if (!isTouch) return;

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

  if (typeof window.gxPreloadEngine === 'function') {
    window.gxPreloadEngine = async function gxPreloadEngineLowPeak(onProgress) {
      let buildId = 'dev';
      try {
        const r = await fetch('build.json', { cache: 'no-cache' });
        if (r.ok) buildId = (await r.json()).buildId || 'dev';
      } catch {}
      window.gxEngine.buildId = buildId;

      const resp = await fetch('GeneralsXZH.wasm?v=' + buildId);
      if (!resp.ok) {
        const msg = window.gxI18n?.t
          ? window.gxI18n.t('error.engineHttp', { status: resp.status })
          : ('Engine HTTP ' + resp.status);
        throw new Error(msg);
      }

      const total = parseInt(resp.headers.get('Content-Length') || '0', 10) || 0;
      const reader = resp.body.getReader();
      let received = 0;

      if (total > 0) {
        let bin = new Uint8Array(total);
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (received + value.byteLength > bin.byteLength) {
            const grown = new Uint8Array(Math.max(received + value.byteLength, bin.byteLength * 2));
            grown.set(bin.subarray(0, received));
            bin = grown;
          }
          bin.set(value, received);
          received += value.byteLength;
          if (onProgress) onProgress(received, total);
        }
        window.gxEngine.wasmBinary = received === bin.byteLength ? bin : bin.slice(0, received);
      } else {
        const chunks = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.byteLength;
          if (onProgress) onProgress(received, 0);
        }
        const bin = new Uint8Array(received);
        let pos = 0;
        for (const c of chunks) { bin.set(c, pos); pos += c.byteLength; }
        window.gxEngine.wasmBinary = bin;
      }
    };
  }

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
