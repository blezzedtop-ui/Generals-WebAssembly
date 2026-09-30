'use strict';
(function () {
  const coarse = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  if (!coarse) return;

  function mouse(type, x, y, button) {
    const cv = document.getElementById('canvas');
    if (!cv) return;
    cv.dispatchEvent(new MouseEvent(type, {bubbles:true,cancelable:true,clientX:x,clientY:y,button,buttons:type==='mouseup'?0:(1<<button),view:window}));
  }
  function key(key, code) {
    const cv=document.getElementById('canvas');
    if(!cv)return;
    const o={key,code:code||key,bubbles:true,cancelable:true};
    cv.dispatchEvent(new KeyboardEvent('keydown',o));
    setTimeout(()=>cv.dispatchEvent(new KeyboardEvent('keyup',o)),30);
  }
  async function immersive() {
    document.documentElement.classList.add('gx-immersive');
    try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch {}
    try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({navigationUI:'hide'}); } catch {}
    setTimeout(()=>window.scrollTo(0,1),50);
  }
  window.gxEnterMobileGameMode=immersive;

  let start=null, moved=false, longTimer=null, lastTap=0;
  addEventListener('touchstart',e=>{
    if(e.target.closest('#gx-mobile-controls') || e.target.closest('#gx-overlay')) return;
    if(e.touches.length===1){
      const t=e.touches[0]; start={x:t.clientX,y:t.clientY}; moved=false;
      longTimer=setTimeout(()=>{ mouse('mousedown',t.clientX,t.clientY,2); mouse('mouseup',t.clientX,t.clientY,2); start=null; },520);
    }
  },{passive:false});
  addEventListener('touchmove',e=>{
    if(!start || e.touches.length!==1)return;
    const t=e.touches[0], dx=t.clientX-start.x, dy=t.clientY-start.y;
    if(Math.hypot(dx,dy)>8){moved=true;clearTimeout(longTimer);mouse('mousemove',t.clientX,t.clientY,0);}
    e.preventDefault();
  },{passive:false});
  addEventListener('touchend',e=>{
    clearTimeout(longTimer); if(!start)return;
    const t=e.changedTouches[0], now=Date.now();
    if(moved){ mouse('mouseup',t.clientX,t.clientY,0); }
    else if(now-lastTap<280){ mouse('mousedown',t.clientX,t.clientY,0);mouse('mouseup',t.clientX,t.clientY,0);mouse('mousedown',t.clientX,t.clientY,0);mouse('mouseup',t.clientX,t.clientY,0);lastTap=0; }
    else { mouse('mousedown',t.clientX,t.clientY,0);mouse('mouseup',t.clientX,t.clientY,0);lastTap=now; }
    start=null; e.preventDefault();
  },{passive:false});

  let pinch=0;
  addEventListener('touchmove',e=>{
    if(e.touches.length!==2)return;
    const a=e.touches[0],b=e.touches[1],d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
    if(pinch && Math.abs(d-pinch)>18){ key(d>pinch?'+':'-'); pinch=d; }
    else if(!pinch) pinch=d;
    e.preventDefault();
  },{passive:false});
  addEventListener('touchend',e=>{if(e.touches.length<2)pinch=0;},{passive:true});

  addEventListener('DOMContentLoaded',()=>{
    const box=document.getElementById('gx-mobile-controls'); if(!box)return;
    box.hidden=false;
    box.querySelectorAll('[data-key]').forEach(b=>b.addEventListener('pointerdown',e=>{e.preventDefault();key(b.dataset.key,b.dataset.code);}));
    box.querySelector('[data-fullscreen]').addEventListener('pointerdown',async e=>{e.preventDefault();await immersive();});
    box.querySelector('[data-right]').addEventListener('pointerdown',e=>{e.preventDefault();const r=document.getElementById('canvas').getBoundingClientRect();mouse('mousedown',r.width/2,r.height/2,2);mouse('mouseup',r.width/2,r.height/2,2);});
  });
})();