/*
 * COOP/COEP via Service Worker - lets the game run on ANY static host that
 * doesn't send Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy
 * headers (plain nginx, GitHub Pages, shared hosting...). Without those
 * headers the browser refuses SharedArrayBuffer and pthreads cannot start.
 */
/* eslint-env serviceworker, browser */
'use strict';

if (typeof window === 'undefined') {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener('message', (ev) => {
    if (ev.data && ev.data.type === 'deregister') {
      self.registration.unregister().then(() => self.clients.matchAll())
        .then((clients) => clients.forEach((c) => c.navigate(c.url)));
    }
  });
  self.addEventListener('fetch', (e) => {
    const r = e.request;
    const path = (() => { try { return new URL(r.url).pathname; } catch { return ''; } })();
    if (path.endsWith('.data') || path.endsWith('.wasm')) return;
    e.respondWith(fetch(r, { cache: 'no-store' }).then((res) => {
      if (res.status === 0) return res;
      const headers = new Headers(res.headers);
      headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
      headers.set('Cache-Control', 'no-store, max-age=0');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }));
  });
} else {
  (() => {
    // PWA metadata is installed at runtime too, so existing index.html builds
    // immediately become installable as a full-screen iPhone web app.
    const head = document.head || document.documentElement;
    if (!document.querySelector('link[rel="manifest"]')) {
      const link = document.createElement('link');
      link.rel = 'manifest';
      link.href = 'manifest.webmanifest?v=1';
      head.appendChild(link);
    }
    const ensureMeta = (name, content) => {
      let m = document.querySelector('meta[name="' + name + '"]');
      if (!m) { m = document.createElement('meta'); m.name = name; head.appendChild(m); }
      m.content = content;
    };
    ensureMeta('mobile-web-app-capable', 'yes');
    ensureMeta('apple-mobile-web-app-capable', 'yes');
    ensureMeta('apple-mobile-web-app-status-bar-style', 'black-translucent');
    ensureMeta('apple-mobile-web-app-title', 'Generals ZH');
    ensureMeta('theme-color', '#000000');

    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
    if (standalone) {
      document.documentElement.classList.add('gx-pwa-fullscreen');
      const style = document.createElement('style');
      style.textContent = `
        html.gx-pwa-fullscreen, html.gx-pwa-fullscreen body {
          position:fixed!important; inset:0!important; margin:0!important; padding:0!important;
          width:100dvw!important; height:100dvh!important; overflow:hidden!important; background:#000!important;
        }
        html.gx-pwa-fullscreen #canvas, html.gx-pwa-fullscreen #gx-touch-surface {
          position:fixed!important; inset:0!important; width:100dvw!important; height:100dvh!important;
          max-width:none!important; max-height:none!important; margin:0!important; padding:0!important;
        }
        html.gx-pwa-fullscreen #gx-m-full { display:none!important; }
      `;
      head.appendChild(style);
      const sync = () => {
        const vv = window.visualViewport;
        const w = Math.max(1, Math.round(vv ? vv.width : innerWidth));
        const h = Math.max(1, Math.round(vv ? vv.height : innerHeight));
        document.documentElement.style.setProperty('--gx-vw', w + 'px');
        document.documentElement.style.setProperty('--gx-vh', h + 'px');
      };
      sync();
      addEventListener('resize', sync);
      window.visualViewport?.addEventListener('resize', sync);
    }

    if (window.crossOriginIsolated) return;
    if (!window.isSecureContext || !('serviceWorker' in navigator)) return;
    const swUrl = document.currentScript && document.currentScript.src;
    if (!swUrl) return;
    window.gxCoiPending = true;
    navigator.serviceWorker.register(swUrl)
      .then((reg) => { reg.update().catch(() => {}); return navigator.serviceWorker.ready; })
      .then(() => { if (!navigator.serviceWorker.controller) window.location.reload(); })
      .catch(() => { window.gxCoiPending = false; });
  })();
}
