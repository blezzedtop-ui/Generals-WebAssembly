'use strict';
// iPhone-first touch bridge for the Emscripten/SDL canvas.
// One finger: tap/click, SELECT-only box drag, long press/right-click.
// Two fingers: right-drag camera pan; pinch: zoom; two-finger tap: right-click.
(function () {
  const isiPhone = /iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!isiPhone && navigator.maxTouchPoints < 1) return;

  const canvas = () => document.getElementById('canvas');
  const uiTarget = t => !!(t && t.closest && (t.closest('#gx-mobile-controls') || t.closest('#gx-overlay') || t.closest('#gx-mp')));

  function focusCanvas() {
    const cv = canvas();
    if (!cv) return null;
    try { cv.focus({preventScroll:true}); } catch { try { cv.focus(); } catch {} }
    return cv;
  }

  // Clamp coordinates to the visible canvas. Safari's dynamic bars/safe areas can
  // otherwise create events just outside the SDL target after an orientation change.
  function clampPoint(p) {
    const cv = canvas();
    if (!cv) return p;
    const r = cv.getBoundingClientRect();
    return {
      x: Math.max(r.left + 1, Math.min(r.right - 1, p.x)),
      y: Math.max(r.top + 1, Math.min(r.bottom - 1, p.y))
    };
  }
  const touchPoint = t => clampPoint({x:t.clientX, y:t.clientY});
  const dist = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
  const midpoint = (a,b) => ({x:(a.x+b.x)/2,y:(a.y+b.y)/2});

  function mouse(type,p,button=0,buttons=0) {
    const cv=focusCanvas(); if(!cv) return;
    p=clampPoint(p);
    const r=cv.getBoundingClientRect();
    const x=(p.x-r.left)*cv.width/Math.max(1,r.width);
    const y=(p.y-r.top)*cv.height/Math.max(1,r.height);
    if(window.Module?._gxWebSendMouse){
      const nativeType=type==='mousemove'?0:(type==='mousedown'?1:2);
      const sdlButton=button===2?3:1;
      // DOM MouseEvent buttons uses RMB=2; SDL uses SDL_BUTTON_RMASK=4.
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
  const nativeKeyReleases=new Map();
  function key(name,code=name){
    focusCanvas();
    // Keep native keys down across at least one render/input tick.
    const nativeKey=sdlKeys[name]||sdlKeys[code];
    if(nativeKey && window.Module?._gxWebSendKeyState){
      Module._gxWebSendKeyState(nativeKey,1);
      const previous=nativeKeyReleases.get(nativeKey);
      if(previous) clearTimeout(previous);
      const timer=setTimeout(()=>{
        if(window.Module?._gxWebSendKeyState) Module._gxWebSendKeyState(nativeKey,0);
        nativeKeyReleases.delete(nativeKey);
      },90);
      nativeKeyReleases.set(nativeKey,timer);
      return;
    }
    if(nativeKey && window.Module?._gxWebSendKey){ Module._gxWebSendKey(nativeKey); return; }
    const cv=canvas(); if(!cv) return;
    const opts={key:name,code,bubbles:true,cancelable:true,composed:true};
    cv.dispatchEvent(new KeyboardEvent('keydown',opts));
    setTimeout(()=>cv.dispatchEvent(new KeyboardEvent('keyup',opts)),90);
  }

  function sendEscape(){ key('Escape','Escape'); }

  function syncViewport(){
    document.documentElement.classList.add('gx-immersive','gx-iphone');
    const vv=window.visualViewport;
    const w=Math.max(1,Math.round(vv?vv.width:innerWidth));
    const h=Math.max(1,Math.round(vv?vv.height:innerHeight));
    document.documentElement.style.setProperty('--gx-vw',w+'px');
    document.documentElement.style.setProperty('--gx-vh',h+'px');
    const cv=canvas();
    if(cv){
      cv.style.width=w+'px'; cv.style.height=h+'px';
      if(window.Module?.calledRun){
        try { Module.setCanvasSize(w,h,false); } catch {}
      }
    }
    scrollTo(0,0); focusCanvas();
  }

  async function immersive(){
    try { if(screen.orientation?.lock) await screen.orientation.lock('landscape'); } catch {}
    try {
      const cv=canvas();
      if(!document.fullscreenElement){
        if(cv?.requestFullscreen) await cv.requestFullscreen({navigationUI:'hide'});
        else if(cv?.webkitRequestFullscreen) cv.webkitRequestFullscreen();
        else if(document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({navigationUI:'hide'});
      }
    } catch {}
    syncViewport(); setTimeout(syncViewport,150); setTimeout(syncViewport,500);
  }
  window.gxEnterMobileGameMode=immersive;

  function prepareCanvas(){
    const cv=canvas(); if(!cv) return;
    cv.style.touchAction='none';
    cv.style.webkitUserSelect='none';
    cv.style.webkitTouchCallout='none';
    cv.addEventListener('contextmenu',e=>e.preventDefault());
  }

  let one=null, dragging=false, longTimer=null, two=null, lastTap={t:0,p:null}, selectArmed=false;
  const clearLong=()=>{ if(longTimer) clearTimeout(longTimer); longTimer=null; };
  function resetOne(){ clearLong(); one=null; dragging=false; }
  function claimTouch(e){
    if(e.cancelable) e.preventDefault();
    e.stopPropagation();
  }
  function beginTwoFingerPan(a,b){
    const m=midpoint(a,b);
    move(m,0);
    mouse('mousedown',m,2,2);
    two={mid:m,dist:dist(a,b),moved:false,rightDown:true};
  }
  function endTwoFingerPan(){
    if(!two) return;
    if(two.rightDown){
      move(two.mid,2);
      mouse('mouseup',two.mid,2,0);
    }
    two=null;
  }

  function onStart(e){
    if(uiTarget(e.target)) return;
    claimTouch(e);
    if(e.touches.length===1){
      const p=touchPoint(e.touches[0]);
      one={start:p,last:p,longPressed:false,moved:false}; dragging=false; two=null; move(p,0);
      clearLong();
      longTimer=setTimeout(()=>{
        if(!one||dragging||one.moved) return;
        click(one.last,2); one.longPressed=true;
        if(navigator.vibrate) navigator.vibrate(18);
      },520);
    } else if(e.touches.length===2){
      clearLong();
      // Never leave a SELECT mouse-down held when a second finger starts camera pan.
      if(dragging && one) mouse('mouseup',one.last,0,0);
      selectArmed=false;
      document.getElementById('gx-m-select')?.classList.remove('gx-active');
      one=null; dragging=false;
      const a=touchPoint(e.touches[0]),b=touchPoint(e.touches[1]);
      beginTwoFingerPan(a,b);
    }
  }

  function onMove(e){
    if(uiTarget(e.target)) return;
    claimTouch(e);
    if(e.touches.length===1 && one){
      const p=touchPoint(e.touches[0]);
      one.last=p;
      const moved=dist(p,one.start);
      if(moved>7){ one.moved=true; clearLong(); }
      if(selectArmed && !dragging && moved>9){
        dragging=true;
        move(one.start,0);
        mouse('mousedown',one.start,0,1);
      }
      if(dragging) move(p,1);
      else if(one.moved) move(p,0);
      return;
    }
    if(e.touches.length===2){
      clearLong();
      const a=touchPoint(e.touches[0]),b=touchPoint(e.touches[1]),m=midpoint(a,b),d=dist(a,b);
      if(!two) beginTwoFingerPan(a,b);
      const pinch=d-two.dist;
      const pan=dist(m,two.mid);
      if(Math.abs(pinch)>=7){
        wheel(m,pinch>0?-100:100);
        two.dist=d;
        two.moved=true;
      }
      // Match the engine's native touch scheme: two-finger camera movement is
      // a held right-button drag at the fingers' centroid, not arrow-key pulses.
      if(pan>=2){
        move(m,2);
        two.mid=m;
        two.moved=true;
      }
    }
  }

  function onEnd(e){
    if(uiTarget(e.target)) return;
    claimTouch(e);
    clearLong();
    if(two){
      // As soon as either finger leaves, release RMB so camera pan can never stick.
      if(e.touches.length<2){
        endTwoFingerPan();
        resetOne();
      }
      return;
    }
    if(!one || e.touches.length) return;
    const t=e.changedTouches?.[0], p=t?touchPoint(t):one.last;
    if(one.longPressed){ resetOne(); return; }
    if(dragging){
      move(p,1);
      mouse('mouseup',p,0,0);
      selectArmed=false;
      document.getElementById('gx-m-select')?.classList.remove('gx-active');
    } else if(!one.moved) {
      const now=performance.now();
      click(p,0);
      // Two taps already produce the two clicks the game needs; do not inject a third click.
      if(lastTap.p && now-lastTap.t<300 && dist(p,lastTap.p)<24) lastTap={t:0,p:null};
      else lastTap={t:now,p};
    } else {
      move(p,0);
    }
    resetOne();
  }

  function onCancel(e){
    if(uiTarget(e.target)) return;
    claimTouch(e);
    clearLong();
    if(dragging && one) mouse('mouseup',one.last,0,0);
    endTwoFingerPan();
    one=null; dragging=false;
  }

  function bind(){
    prepareCanvas();
    syncViewport();
    // Capture touch before SDL/browser synthesis, then stop propagation so each
    // finger gesture reaches the game exactly once through this bridge.
    document.addEventListener('touchstart',onStart,{passive:false,capture:true});
    document.addEventListener('touchmove',onMove,{passive:false,capture:true});
    document.addEventListener('touchend',onEnd,{passive:false,capture:true});
    document.addEventListener('touchcancel',onCancel,{passive:false,capture:true});
    document.addEventListener('gesturestart',e=>e.preventDefault(),{passive:false});
    document.addEventListener('gesturechange',e=>e.preventDefault(),{passive:false});
    document.addEventListener('dblclick',e=>{ if(e.target===canvas()) e.preventDefault(); },{passive:false});
    addEventListener('orientationchange',()=>setTimeout(syncViewport,180));
    if(window.visualViewport) visualViewport.addEventListener('resize',syncViewport);

    const box=document.getElementById('gx-mobile-controls');
    if(box){
      box.hidden=false;
      box.querySelectorAll('[data-key]').forEach(b=>b.addEventListener('pointerdown',e=>{
        e.preventDefault();e.stopPropagation();
        if(b.dataset.key==='Escape') sendEscape(); else key(b.dataset.key,b.dataset.code);
      }));
      box.querySelector('[data-select]')?.addEventListener('pointerdown',e=>{
        e.preventDefault();e.stopPropagation();selectArmed=!selectArmed;e.currentTarget.classList.toggle('gx-active',selectArmed);
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