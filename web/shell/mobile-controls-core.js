'use strict';
// iPhone-first touch bridge for the Emscripten/SDL canvas.
// One finger: tap/select; drag = direct map grab/pan; SELECT-only drag = box selection.
// Two fingers: camera pan + pinch zoom. Long press: right click.
(function () {
  const isiPhone = /iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!isiPhone && navigator.maxTouchPoints < 1) return;

  const canvas = () => document.getElementById('canvas');
  const uiTarget = t => !!(t && t.closest && (t.closest('#gx-mobile-controls') || t.closest('#gx-overlay') || t.closest('#gx-mp')));

  function focusCanvas() {
    const cv=canvas();
    if(!cv) return null;
    try { cv.focus({preventScroll:true}); } catch { try { cv.focus(); } catch {} }
    return cv;
  }

  function clampPoint(p){
    const cv=canvas();
    if(!cv) return p;
    const r=cv.getBoundingClientRect();
    return {
      x:Math.max(r.left+1,Math.min(r.right-1,p.x)),
      y:Math.max(r.top+1,Math.min(r.bottom-1,p.y))
    };
  }
  const touchPoint=t=>clampPoint({x:t.clientX,y:t.clientY});
  const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const midpoint=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});

  function mouse(type,p,button=0,buttons=0){
    const cv=focusCanvas(); if(!cv) return;
    p=clampPoint(p);
    const r=cv.getBoundingClientRect();
    const x=(p.x-r.left)*cv.width/Math.max(1,r.width);
    const y=(p.y-r.top)*cv.height/Math.max(1,r.height);
    if(window.Module?._gxWebSendMouse){
      const nativeType=type==='mousemove'?0:(type==='mousedown'?1:2);
      const sdlButton=button===2?3:1;
      const sdlButtons=(buttons&1?1:0)|(buttons&2?4:0);
      Module._gxWebSendMouse(nativeType,x,y,sdlButton,sdlButtons);
      return;
    }
    cv.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,composed:true,view:window,
      clientX:p.x,clientY:p.y,screenX:p.x,screenY:p.y,button,buttons}));
  }
  function move(p,buttons=0){ mouse('mousemove',p,0,buttons); }
  function click(p,button=0){
    move(p,0);
    mouse('mousedown',p,button,button===2?2:1);
    mouse('mouseup',p,button,0);
  }
  function wheel(p,deltaY){
    const cv=focusCanvas(); if(!cv) return;
    p=clampPoint(p); move(p,0);
    cv.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,composed:true,view:window,
      clientX:p.x,clientY:p.y,deltaY,deltaMode:0}));
  }

  const sdlKeys={Escape:27,ArrowRight:1073741903,ArrowLeft:1073741904,ArrowDown:1073741905,ArrowUp:1073741906,F5:1073741886,F10:1073741891};
  const pulseReleases=new Map();
  function key(name,code=name){
    const cv=focusCanvas(); if(!cv) return;
    const nativeKey=sdlKeys[name]||sdlKeys[code];
    if(nativeKey && window.Module?._gxWebSendKeyState){
      Module._gxWebSendKeyState(nativeKey,1);
      const old=pulseReleases.get(nativeKey); if(old) clearTimeout(old);
      const timer=setTimeout(()=>{
        if(window.Module?._gxWebSendKeyState) Module._gxWebSendKeyState(nativeKey,0);
        pulseReleases.delete(nativeKey);
      },90);
      pulseReleases.set(nativeKey,timer);
      return;
    }
    if(nativeKey && window.Module?._gxWebSendKey){ Module._gxWebSendKey(nativeKey); return; }
    const opts={key:name,code,bubbles:true,cancelable:true,composed:true};
    cv.dispatchEvent(new KeyboardEvent('keydown',opts));
    setTimeout(()=>cv.dispatchEvent(new KeyboardEvent('keyup',opts)),90);
  }

  const cameraHeld=new Set();
  let cameraWanted=new Set();
  let cameraPulseTimer=null;
  let cameraKeyUpTimer=null;
  let cameraLastMotion=0;
  const CAMERA_DEAD_PX=1.0;
  const CAMERA_PULSE_ON_MS=48;
  const CAMERA_PULSE_GAP_MS=34;
  const CAMERA_IDLE_GRACE_MS=180;

  function setHeldKey(name,down){
    const cv=focusCanvas(); if(!cv) return;
    const nativeKey=sdlKeys[name];
    if(nativeKey && window.Module?._gxWebSendKeyState){
      Module._gxWebSendKeyState(nativeKey,down?1:0);
      return;
    }
    cv.dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',{
      key:name,code:name,bubbles:true,cancelable:true,composed:true
    }));
  }
  function releaseHeldCameraKeys(){
    for(const name of Array.from(cameraHeld)) setHeldKey(name,false);
    cameraHeld.clear();
  }
  function stopCameraPulse(){
    if(cameraPulseTimer!==null) clearTimeout(cameraPulseTimer);
    if(cameraKeyUpTimer!==null) clearTimeout(cameraKeyUpTimer);
    cameraPulseTimer=null;
    cameraKeyUpTimer=null;
    releaseHeldCameraKeys();
  }
  function releaseCameraKeys(){
    stopCameraPulse();
    cameraWanted.clear();
    cameraLastMotion=0;
  }
  const sameCameraKeys=(a,b)=>a.size===b.size && Array.from(a).every(k=>b.has(k));
  function cameraPulseStep(){
    cameraPulseTimer=null;
    if(!cameraWanted.size || performance.now()-cameraLastMotion>CAMERA_IDLE_GRACE_MS){
      releaseCameraKeys();
      return;
    }
    releaseHeldCameraKeys();
    for(const name of cameraWanted){
      setHeldKey(name,true);
      cameraHeld.add(name);
    }
    cameraKeyUpTimer=setTimeout(()=>{
      cameraKeyUpTimer=null;
      releaseHeldCameraKeys();
      if(cameraWanted.size && performance.now()-cameraLastMotion<=CAMERA_IDLE_GRACE_MS){
        cameraPulseTimer=setTimeout(cameraPulseStep,CAMERA_PULSE_GAP_MS);
      }else{
        releaseCameraKeys();
      }
    },CAMERA_PULSE_ON_MS);
  }
  function updateCameraKeys(dx,dy){
    const wanted=new Set();
    if(dx>CAMERA_DEAD_PX) wanted.add('ArrowLeft');
    else if(dx<-CAMERA_DEAD_PX) wanted.add('ArrowRight');
    if(dy>CAMERA_DEAD_PX) wanted.add('ArrowUp');
    else if(dy<-CAMERA_DEAD_PX) wanted.add('ArrowDown');
    if(!wanted.size){
      releaseCameraKeys();
      return;
    }
    const changed=!sameCameraKeys(cameraWanted,wanted);
    cameraWanted=wanted;
    cameraLastMotion=performance.now();
    if(changed) stopCameraPulse();
    if(cameraPulseTimer===null && cameraKeyUpTimer===null) cameraPulseStep();
  }

  // Stable iPhone pan: short repeated key pulses avoid touchmove stalls and run ~25% slower than a held arrow key.
  function panCamera(previous,current){
    const cv=canvas();
    if(!cv) return;
    const r=cv.getBoundingClientRect();
    // Keep the engine cursor away from edge-scroll zones during camera gestures.
    move({x:r.left+r.width/2,y:r.top+r.height/2},0);
    updateCameraKeys(current.x-previous.x,current.y-previous.y);
  }

  function sendEscape(){ key('Escape','Escape'); }
  const landscape=()=>{
    const vv=window.visualViewport;
    const w=vv?vv.width:innerWidth,h=vv?vv.height:innerHeight;
    return w>h;
  };

  function syncViewport(){
    const html=document.documentElement,body=document.body,cv=canvas();
    html.classList.add('gx-immersive','gx-iphone');
    const vv=window.visualViewport;
    const w=Math.max(1,Math.round(vv?vv.width:innerWidth));
    const h=Math.max(1,Math.round(vv?vv.height:innerHeight));
    html.style.setProperty('--gx-vw',w+'px');
    html.style.setProperty('--gx-vh',h+'px');
    for(const el of [html,body]){
      if(!el) continue;
      el.style.setProperty('position','fixed','important');
      el.style.setProperty('inset','0','important');
      el.style.setProperty('width',w+'px','important');
      el.style.setProperty('height',h+'px','important');
      el.style.setProperty('margin','0','important');
      el.style.setProperty('padding','0','important');
      el.style.setProperty('overflow','hidden','important');
    }
    if(cv){
      cv.style.setProperty('position','fixed','important');
      cv.style.setProperty('left','0','important');
      cv.style.setProperty('top','0','important');
      cv.style.setProperty('right','auto','important');
      cv.style.setProperty('bottom','auto','important');
      cv.style.setProperty('width','100vw','important');
      cv.style.setProperty('height','100dvh','important');
      cv.style.setProperty('max-width','none','important');
      cv.style.setProperty('max-height','none','important');
      cv.style.setProperty('margin','0','important');
      cv.style.setProperty('padding','0','important');
      cv.style.setProperty('border','0','important');
      cv.style.setProperty('object-fit','fill','important');
    }
    try{scrollTo(0,0);}catch{}
    focusCanvas();
  }

  async function immersive(){
    syncViewport();
    const cv=canvas();
    let fsPromise=null;
    try{
      if(!document.fullscreenElement && !document.webkitFullscreenElement){
        if(cv?.requestFullscreen) fsPromise=cv.requestFullscreen({navigationUI:'hide'});
        else if(cv?.webkitRequestFullscreen) cv.webkitRequestFullscreen();
        else if(document.documentElement.requestFullscreen) fsPromise=document.documentElement.requestFullscreen({navigationUI:'hide'});
      }
    }catch{}
    try{if(fsPromise) await fsPromise;}catch{}
    try{if(screen.orientation?.lock) await screen.orientation.lock('landscape');}catch{}
    syncViewport();
    setTimeout(syncViewport,80);
    setTimeout(syncViewport,250);
    setTimeout(syncViewport,700);
  }
  window.gxEnterMobileGameMode=immersive;

  function prepareCanvas(){
    const cv=canvas(); if(!cv) return;
    cv.style.touchAction='none';
    cv.style.webkitUserSelect='none';
    cv.style.webkitTouchCallout='none';
    cv.addEventListener('contextmenu',e=>e.preventDefault());
  }

  let one=null,dragging=false,cameraDragging=false,longTimer=null,two=null,lastTap={t:0,p:null},selectArmed=false;
  let landscapeFullscreenTried=false;
  const clearLong=()=>{if(longTimer) clearTimeout(longTimer);longTimer=null;};
  function resetOne(){clearLong();releaseCameraKeys();one=null;dragging=false;cameraDragging=false;}
  function claimTouch(e){
    if(e.cancelable) e.preventDefault();
    e.stopImmediatePropagation();
  }

  function onStart(e){
    if(uiTarget(e.target)) return;
    if(!landscapeFullscreenTried && landscape()){
      landscapeFullscreenTried=true;
      void immersive();
    }
    claimTouch(e);
    if(e.touches.length===1){
      releaseCameraKeys();
      const p=touchPoint(e.touches[0]);
      one={start:p,last:p,longPressed:false,moved:false};
      dragging=false;cameraDragging=false;two=null;
      move(p,0);
      clearLong();
      longTimer=setTimeout(()=>{
        if(!one||dragging||cameraDragging||one.moved) return;
        click(one.last,2);
        one.longPressed=true;
        if(navigator.vibrate) navigator.vibrate(18);
      },520);
    }else if(e.touches.length===2){
      clearLong();
      if(dragging && one) mouse('mouseup',one.last,0,0);
      if(cameraDragging) releaseCameraKeys();
      releaseCameraKeys();
      selectArmed=false;
      document.getElementById('gx-m-select')?.classList.remove('gx-active');
      one=null;dragging=false;cameraDragging=true;
      const a=touchPoint(e.touches[0]),b=touchPoint(e.touches[1]);
      two={startMid:midpoint(a,b),mid:midpoint(a,b),dist:dist(a,b),zoomCarry:0,moved:false};
    }
  }

  function onMove(e){
    if(uiTarget(e.target)) return;
    claimTouch(e);
    if(e.touches.length===1 && one){
      const p=touchPoint(e.touches[0]);
      const previous=one.last;
      one.last=p;
      const moved=dist(p,one.start);
      if(moved>7){one.moved=true;clearLong();}
      if(selectArmed){
        releaseCameraKeys();
        if(!dragging && moved>9){
          dragging=true;
          move(one.start,0);
          mouse('mousedown',one.start,0,1);
        }
        if(dragging) move(p,1);
      }else{
        if(!cameraDragging && moved>9) cameraDragging=true;
        if(cameraDragging) panCamera(previous,p);
      }
      return;
    }
    if(e.touches.length===2){
      clearLong();
      const a=touchPoint(e.touches[0]),b=touchPoint(e.touches[1]);
      const m=midpoint(a,b),d=dist(a,b);
      if(!two) two={startMid:m,mid:m,dist:d,zoomCarry:0,moved:false};
      const pinch=d-two.dist;
      two.dist=d;
      two.zoomCarry=(two.zoomCarry||0)+pinch;
      if(Math.abs(two.zoomCarry)>=2.2){
        const step=Math.max(-16,Math.min(16,-two.zoomCarry*3.2));
        wheel(m,step);
        two.zoomCarry*=0.18;
        two.moved=true;
      }
      const dx=m.x-two.startMid.x,dy=m.y-two.startMid.y;
      if(Math.hypot(dx,dy)>9){
        panCamera(two.mid,m);
        two.moved=true;
      }
      two.mid=m;
    }
  }

  function onEnd(e){
    if(uiTarget(e.target)) return;
    claimTouch(e);
    clearLong();
    if(two){
      if(e.touches.length<2){
        releaseCameraKeys();
        two=null;
        one=null;dragging=false;cameraDragging=false;
      }
      return;
    }
    if(!one||e.touches.length) return;
    const t=e.changedTouches?.[0],p=t?touchPoint(t):one.last;
    if(one.longPressed){resetOne();return;}
    if(dragging){
      move(p,1);
      mouse('mouseup',p,0,0);
      selectArmed=false;
      document.getElementById('gx-m-select')?.classList.remove('gx-active');
    }else if(cameraDragging){
      releaseCameraKeys();
    }else if(!one.moved){
      const now=performance.now();
      click(p,0);
      if(lastTap.p && now-lastTap.t<300 && dist(p,lastTap.p)<24) lastTap={t:0,p:null};
      else lastTap={t:now,p};
    }
    resetOne();
  }

  function onCancel(e){
    if(uiTarget(e.target)) return;
    claimTouch(e);
    clearLong();
    if(dragging&&one) mouse('mouseup',one.last,0,0);
    if(cameraDragging) releaseCameraKeys();
    releaseCameraKeys();
    one=null;two=null;dragging=false;cameraDragging=false;
  }

  function cancelGesture(){
    clearLong();
    if(dragging&&one) mouse('mouseup',one.last,0,0);
    releaseCameraKeys();
    one=null;two=null;dragging=false;cameraDragging=false;
  }

  function bind(){
    prepareCanvas();
    syncViewport();
    document.addEventListener('touchstart',onStart,{passive:false,capture:true});
    document.addEventListener('touchmove',onMove,{passive:false,capture:true});
    document.addEventListener('touchend',onEnd,{passive:false,capture:true});
    document.addEventListener('touchcancel',onCancel,{passive:false,capture:true});
    document.addEventListener('gesturestart',e=>e.preventDefault(),{passive:false});
    document.addEventListener('gesturechange',e=>e.preventDefault(),{passive:false});
    document.addEventListener('dblclick',e=>{if(e.target===canvas())e.preventDefault();},{passive:false});
    addEventListener('blur',cancelGesture);
    document.addEventListener('visibilitychange',()=>{if(document.hidden) cancelGesture();});
    addEventListener('orientationchange',()=>{
      cancelGesture();
      landscapeFullscreenTried=false;
      setTimeout(syncViewport,50);
      setTimeout(syncViewport,250);
      setTimeout(syncViewport,700);
    });
    addEventListener('resize',syncViewport);
    if(window.visualViewport){
      visualViewport.addEventListener('resize',syncViewport);
      visualViewport.addEventListener('scroll',syncViewport);
    }
    document.addEventListener('fullscreenchange',syncViewport);
    document.addEventListener('webkitfullscreenchange',syncViewport);

    const box=document.getElementById('gx-mobile-controls');
    if(box){
      box.hidden=false;
      box.querySelectorAll('[data-key]').forEach(b=>b.addEventListener('pointerdown',e=>{
        e.preventDefault();e.stopPropagation();
        if(b.dataset.key==='Escape') sendEscape(); else key(b.dataset.key,b.dataset.code);
      }));
      box.querySelector('[data-select]')?.addEventListener('pointerdown',e=>{
        e.preventDefault();e.stopPropagation();
        releaseCameraKeys();
        selectArmed=!selectArmed;
        e.currentTarget.classList.toggle('gx-active',selectArmed);
      });
      box.querySelector('[data-fullscreen]')?.addEventListener('pointerdown',async e=>{
        e.preventDefault();e.stopPropagation();await immersive();
      });
      box.querySelector('[data-save]')?.addEventListener('pointerdown',e=>{
        e.preventDefault();e.stopPropagation();key('F5','F5');
      });
      box.querySelector('[data-load]')?.addEventListener('pointerdown',e=>{
        e.preventDefault();e.stopPropagation();key('F10','F10');
      });
      // X is a mobile cancel control, not ESC. Its behavior is handled
      // by mobile-controls.js so it can never open/close the in-game ESC menu.
    }
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind,{once:true});
  else bind();
})();
