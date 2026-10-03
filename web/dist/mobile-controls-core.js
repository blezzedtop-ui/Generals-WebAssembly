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
  function releaseCameraKeys(){
    for(const name of Array.from(cameraHeld)) setHeldKey(name,false);
    cameraHeld.clear();
  }
  function updateCameraKeys(dx,dy){
    const wanted=new Set();
    const dead=12;
    if(dx>dead) wanted.add('ArrowLeft');
    else if(dx<-dead) wanted.add('ArrowRight');
    if(dy>dead) wanted.add('ArrowUp');
    else if(dy<-dead) wanted.add('ArrowDown');
    for(const name of Array.from(cameraHeld)){
      if(!wanted.has(name)){
        setHeldKey(name,false);
        cameraHeld.delete(name);
      }
    }
    for(const name of wanted){
      if(!cameraHeld.has(name)){
        setHeldKey(name,true);
        cameraHeld.add(name);
      }
    }
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
      if(cameraDragging && one){
        move(one.last,2);
        mouse('mouseup',one.last,2,0);
      }
      releaseCameraKeys();
      selectArmed=false;
      document.getElementById('gx-m-select')?.classList.remove('gx-active');
      one=null;dragging=false;cameraDragging=true;
      const a=touchPoint(e.touches[0]),b=touchPoint(e.touches[1]);
      two={startMid:midpoint(a,b),mid:midpoint(a,b),dist:dist(a,b),moved:false};
    }
  }

  function onMove(e){
    if(uiTarget(e.target)) return;
    claimTouch(e);
    if(e.touches.length===1 && one){
      const p=touchPoint(e.touches[0]);
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
        // Physical touch is isolated on #gx-touch-surface, so normal map pan can
        // use the game's native RMB drag without SDL synthesizing a left drag.
        releaseCameraKeys();
        if(!cameraDragging && moved>9){
          cameraDragging=true;
          move(one.start,0);
          mouse('mousedown',one.start,2,2);
        }
        if(cameraDragging) move(p,2);
      }
      return;
    }
    if(e.touches.length===2){
      clearLong();
      const a=touchPoint(e.touches[0]),b=touchPoint(e.touches[1]);
      const m=midpoint(a,b),d=dist(a,b);
      if(!two) two={startMid:m,mid:m,dist:d,moved:false};
      const pinch=d-two.dist;
      if(Math.abs(pinch)>=7){
        wheel(m,pinch>0?-100:100);
        two.dist=d;
        two.moved=true;
      }
      const dx=m.x-two.startMid.x,dy=m.y-two.startMid.y;
      if(Math.hypot(dx,dy)>9){
        updateCameraKeys(dx,dy);
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
      move(p,2);
      mouse('mouseup',p,2,0);
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
    if(cameraDragging&&one){
      move(one.last,2);
      mouse('mouseup',one.last,2,0);
    }
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
    addEventListener('orientationchange',()=>{
      releaseCameraKeys();
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
      box.querySelector('[data-close]')?.addEventListener('pointerdown',e=>{
        e.preventDefault();e.stopPropagation();sendEscape();
      });
    }
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind,{once:true});
  else bind();
})();