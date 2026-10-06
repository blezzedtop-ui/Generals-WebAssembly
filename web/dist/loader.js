'use strict';
// Safari dependency guard: keep the original loader in loader-core.js and
// re-fetch game.js if an old/mixed tab reached the loader without gxPreloadEngine.
(function () {
  const v = 'ios-ram-clean-20261006-03';
  function write(src) {
    document.write('<script src="' + src + '"><\/script>');
  }
  if (typeof window.gxPreloadEngine !== 'function') {
    console.warn('[loader-guard] gxPreloadEngine missing; reloading game.js');
    write('game.js?v=' + v);
  }
  // Keep mobile SAVE/LOAD in a separate bridge so camera/SELECT gesture code
  // is not changed by quick-save/quick-load fixes.
  write('mobile-save-load.js?v=' + v);
  // iPhone/iPad: compact controls + streamed WASM startup + live RAM cleanup.
  write('mobile-runtime-fixes.js?v=' + v);
  write('loader-core.js?v=' + v);
})();
