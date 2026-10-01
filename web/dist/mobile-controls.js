'use strict';
// iPhone-first touch bridge for the Emscripten/SDL canvas.
// One finger: tap/click, drag/box-select, long press/right-click.
// Two fingers: pan camera; pinch: zoom; two-finger tap: right-click.
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
  function key(name,code=name){
    const cv=focusCanvas(); if(!cv) return;
    const opts={key:name,code,bubbles:true,cancelable:true,composed:true};
    cv.dispatchEvent(new KeyboardEvent('keydown',opts));
    setTimeout(()=>cv.dispatchEvent(new KeyboardEvent('keyup',opts)),70);
  }

  async function immersive(){
    document.documentElement.classList.add('gx-immersive','gx-iphone');
    // iPhone Safari normally does not expose arbitrary page fullscreen/orientation
    // locking. Keep these as progressive enhancement, then force viewport sizing.
    try { if(screen.orientation?.lock) await screen.orientation.lock('landscape'); } catch {}
    try { if(!document.fullscreenElement && document.documentElement.requestFullscreen)
      await document.documentElement.requestFullscreen({navigationUI:'hide'}); } catch {}
    const settle=()=>{
      const vv=window.visualViewport;
      const w=Math.max(1,Math.round(vv?vv.width:innerWidth));
      const h=Math.max(1,Math.round(vv?vv.height:innerHeight));
      document.documentElement.style.setProperty('--gx-vw',w+'px');
      document.documentElement.style.setProperty('--gx-vh',h+'px');
      // GeneralsX @bugfix OpenAI 01/10/2026 Keep the visible iPhone canvas and SDL/WebGL backing store in sync after landscape rotation.
      const cv=canvas();
      if(cv){
        cv.style.width=w+'px'; cv.style.height=h+'px';
        if(window.Module?.calledRun){
          try { Module.setCanvasSize(w,h,false); } catch {}
        }
      }
      scrollTo(0,0); focusCanvas();
      dispatchEvent(new Event('resize'));
    };
    settle(); setTimeout(settle,150); setTimeout(settle,500);
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

  function onStart(e){
    if(uiTarget(e.target)) return;
    if(e.cancelable) e.preventDefault();
    if(e.touches.length===1){
      const p=touchPoint(e.touches[0]);
      one={start:p,last:p,longPressed:false}; dragging=false; two=null; move(p,0);
      clearLong();
      longTimer=setTimeout(()=>{
        if(!one||dragging) return;
        click(one.last,2); one.longPressed=true;
        if(navigator.vibrate) navigator.vibrate(18);
      },520);
    } else if(e.touches.length===2){
      clearLong(); one=null; dragging=false;
      const a=touchPoint(e.touches[0]),b=touchPoint(e.touches[1]),m=midpoint(a,b);
      two={mid:m,dist:dist(a,b),moved:false};
    }
  }

  function onMove(e){
    if(uiTarget(e.target)) return;
    if(e.cancelable) e.preventDefault();
    if(e.touches.length===1 && one){
      const p=touchPoint(e.touches[0]); one.last=p;
      if(selectArmed && !dragging && dist(p,one.start)>9){
        dragging=true; clearLong(); move(one.start,0); mouse('mousedown',one.start,0,1);
      }
      if(dragging) move(p,1);
      return;
    }
    if(e.touches.length===2){
      clearLong();
      const a=touchPoint(e.touches[0]),b=touchPoint(e.touches[1]),m=midpoint(a,b),d=dist(a,b);
      if(!two) two={mid:m,dist:d,moved:false};
      const pinch=d-two.dist, dx=m.x-two.mid.x, dy=m.y-two.mid.y;
      if(Math.abs(pinch)>=8){ wheel(m,pinch>0?-100:100); two.dist=d; two.moved=true; }
      // Repeated key pulses are more reliable than synthetic mouse-edge scrolling in SDL.
      if(Math.abs(dx)>=13){ key(dx>0?'ArrowRight':'ArrowLeft'); two.mid.x=m.x; two.moved=true; }
      if(Math.abs(dy)>=13){ key(dy>0?'ArrowDown':'ArrowUp'); two.mid.y=m.y; two.moved=true; }
    }
  }

  function onEnd(e){
    if(uiTarget(e.target)) return;
    if(e.cancelable) e.preventDefault(); clearLong();
    if(two){
      if(e.touches.length===0){
        if(!two.moved) click(two.mid,2);
        two=null; resetOne();
      }
      return;
    }
    if(!one || e.touches.length) return;
    const t=e.changedTouches?.[0], p=t?touchPoint(t):one.last;
    if(one.longPressed){ resetOne(); return; }
    if(dragging){ move(p,1); mouse('mouseup',p,0,0); selectArmed=false; document.getElementById('gx-m-select')?.classList.remove('gx-active'); }
    else {
      const now=performance.now();
      click(p,0);
      if(lastTap.p && now-lastTap.t<300 && dist(p,lastTap.p)<24){
        setTimeout(()=>click(p,0),45); lastTap={t:0,p:null};
      } else lastTap={t:now,p};
    }
    resetOne();
  }

  function onCancel(e){
    clearLong();
    if(dragging && one) mouse('mouseup',one.last,0,0);
    one=null; two=null; dragging=false;
    if(e.cancelable) e.preventDefault();
  }

  function bind(){
    prepareCanvas();
    // Capture on document so SDL's own touch listeners cannot consume the gesture first.
    document.addEventListener('touchstart',onStart,{passive:false,capture:true});
    document.addEventListener('touchmove',onMove,{passive:false,capture:true});
    document.addEventListener('touchend',onEnd,{passive:false,capture:true});
    document.addEventListener('touchcancel',onCancel,{passive:false,capture:true});
    document.addEventListener('gesturestart',e=>e.preventDefault(),{passive:false});
    document.addEventListener('gesturechange',e=>e.preventDefault(),{passive:false});
    document.addEventListener('dblclick',e=>{ if(e.target===canvas()) e.preventDefault(); },{passive:false});
    addEventListener('orientationchange',()=>setTimeout(immersive,180));
    if(window.visualViewport) visualViewport.addEventListener('resize',()=>immersive());

    const box=document.getElementById('gx-mobile-controls');
    if(box){
      box.hidden=false;
      box.querySelectorAll('[data-key]').forEach(b=>b.addEventListener('pointerdown',e=>{
        e.preventDefault();e.stopPropagation();key(b.dataset.key,b.dataset.code);
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
        e.preventDefault();e.stopPropagation();key('Escape','Escape');
      });
    }
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind,{once:true});
  else bind();
})();