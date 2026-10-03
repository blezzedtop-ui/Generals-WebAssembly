'use strict';
// iPhone stability wrapper: preserve the existing touch implementation while
// reducing long-session GPU pressure and preventing display auto-lock.
(function () {
  const touchDevice = navigator.maxTouchPoints > 0;
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
      wakeLock.addEventListener('release', () => { wakeLock = null; }, {once:true});
    } catch (_) {}
  }
  window.gxKeepScreenAwake = keepScreenAwake;
  document.addEventListener('touchstart', () => { void keepScreenAwake(); }, {passive:true,capture:true});
  document.addEventListener('pointerdown', () => { void keepScreenAwake(); }, {passive:true,capture:true});
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void keepScreenAwake();
  });
  void keepScreenAwake();

  function setArg(args,name,val) {
    const i=args.findIndex(a=>String(a).toLowerCase()===name);
    if(i>=0){
      if(i+1<args.length) args[i+1]=String(val);
      else args.push(String(val));
    } else args.push(name,String(val));
  }

  // gxGameArguments can be replaced by the legacy mobile bootstrap after this
  // wrapper loads. Re-wrap whenever that happens for the first few seconds.
  const started=performance.now();
  const argGuard=setInterval(()=>{
    const current=window.gxGameArguments;
    if(typeof current!=='function'){
      if(performance.now()-started>5000) clearInterval(argGuard);
      return;
    }
    if(!current.__gxLowPressure540){
      const previous=current;
      const wrapped=function(){
        const args=previous();
        if(navigator.maxTouchPoints<1) return args;
        const v=window.visualViewport;
        const vw=Math.max(1,v?v.width:innerWidth);
        const vh=Math.max(1,v?v.height:innerHeight);
        const sw=Math.max(screen.width||0,screen.height||0,vw,vh);
        const dims=[screen.width||0,screen.height||0].filter(n=>n>0);
        const sh=Math.max(1,dims.length?Math.min(...dims):Math.min(vw,vh));
        const aspect=Math.max(1.33,Math.min(2.5,sw/sh));
        let h=540;
        let w=Math.round(h*aspect);
        w=(Math.max(864,Math.min(1440,w))&~1);
        h&=~1;
        setArg(args,'-xres',w);
        setArg(args,'-yres',h);
        if(!args.some(a=>String(a).toLowerCase()==='-forcefullviewport')) args.push('-forcefullviewport');
        console.log('[iphone-stability] render',w+'x'+h);
        return args;
      };
      wrapped.__gxLowPressure540=true;
      window.gxGameArguments=wrapped;
    }
    if(performance.now()-started>5000) clearInterval(argGuard);
  },5);

  function attachContextRecovery(){
    const cv=document.getElementById('canvas');
    if(!cv || cv.__gxContextRecoveryInstalled) return false;
    cv.__gxContextRecoveryInstalled=true;
    cv.addEventListener('webglcontextlost',e=>{
      // preventDefault tells WebKit this context is eligible for restoration.
      e.preventDefault();
      cv.dataset.gxContextLost='1';
      console.warn('[iphone-stability] WebGL context lost; waiting for restore');
    },false);
    cv.addEventListener('webglcontextrestored',()=>{
      delete cv.dataset.gxContextLost;
      try{cv.focus({preventScroll:true});}catch(_){try{cv.focus();}catch(__){}}
      console.info('[iphone-stability] WebGL context restored');
    },false);
    return true;
  }
  if(!attachContextRecovery()){
    const contextTimer=setInterval(()=>{if(attachContextRecovery()) clearInterval(contextTimer);},100);
    setTimeout(()=>clearInterval(contextTimer),10000);
  }

  loadBase();

  function loadBase(){
    const src='mobile-controls-base.js?v=41';
    if(document.readyState==='loading'){
      document.write('<script src="'+src+'"><\\/script>');
    }else{
      const s=document.createElement('script');
      s.src=src;
      s.async=false;
      (document.head||document.documentElement).appendChild(s);
    }
  }
})();
