// GeneralsX Web - asset loader.
//
// Streams build.data (GAXD format): reads index from stream start,
// pipes compressed blob through DecompressionStream, splits decompressed
// data into files and writes them to OPFS/IDB concurrently (4 in parallel).
//
// GeneralsX @build web-port 06/07/2026

'use strict';

// GeneralsX @feature Lolendor 22/07/2026 Localize launch-screen runtime messages.
const gxText = (key, values) => window.gxI18n.t(key, values);

const gxUI = {
  overlay: null, detail: null,
  dlBar: null, dlVal: null, unBar: null, unVal: null,
  statusKey: null, statusValues: null,
  init() {
    this.overlay = document.getElementById('gx-overlay');
    this.detail = document.getElementById('gx-detail');
    this.dlBar = document.getElementById('gx-bar');
    this.dlVal = document.getElementById('gx-dl-val');
    this.unBar = document.getElementById('gx-bar2');
    this.unVal = document.getElementById('gx-un-val');
    window.addEventListener('gxlanguagechange', () => this.refreshLanguage());
  },
  error(msg) {
    console.error('[loader]', msg);
    const el = document.getElementById('gx-error');
    el.style.display = 'block';
    el.textContent = msg;
    document.getElementById('gx-progress-wrap').style.display = 'none';
  },
  download(done, total, detail) {
    const pct = total > 0 ? Math.floor((done / total) * 100) : 0;
    this.dlBar.style.width = pct + '%';
    this.dlVal.textContent = total > 0 ? gxHuman(done) + ' / ' + gxHuman(total) : gxHuman(done);
    if (detail) this.detail.textContent = detail;
  },
  unpack(done, total) {
    const pct = total > 0 ? Math.floor((done / total) * 100) : 0;
    this.unBar.style.width = pct + '%';
    this.unVal.textContent = done + ' / ' + total;
  },
  status(key, values) {
    this.statusKey = key;
    this.statusValues = values || null;
    this.detail.textContent = gxText(key, values);
  },
  refreshLanguage() {
    if (this.statusKey) this.detail.textContent = gxText(this.statusKey, this.statusValues);
  },
};

function gxHuman(b) {
  if (b > 1073741824) return (b / 1073741824).toFixed(2) + ' ' + gxText('unit.gb');
  if (b > 1048576) return (b / 1048576).toFixed(1) + ' ' + gxText('unit.mb');
  if (b > 1024) return (b / 1024).toFixed(0) + ' ' + gxText('unit.kb');
  return b + ' ' + gxText('unit.b');
}

// ── Stream extraction (worker-driven, resumable) ─────────────────────────
// The dispatcher worker fetches build.data, slices it at segment boundaries,
// decompresses segments on a parallel brotli sub-worker pool, and writes files
// to OPFS in order. The main thread relays progress, persists a resume journal
// per completed segment, and runs a watchdog: if the worker goes silent for
// 60 s (deadlock, dropped promise, killed SW...) it is terminated and
// restarted from the journaled segment — a hang becomes an automatic resume.
// Returns { files, entries }.

async function gxStreamExtract(url, storage, journalKey) {
  const ver = (window.gxEngine && window.gxEngine.buildId) || 'dev';
  const wasmUrl = new URL('brotli_bg.wasm?v=' + ver, document.baseURI).href;
  const WATCHDOG_MS = 60000;
  const MAX_RESTARTS = 4;

  let restarts = 0;
  for (;;) {
    // Resume state from the journal (OPFS mode only; the worker re-validates
    // the etag/total before honoring it).
    let resume = null;
    if (storage.kind === 'opfs' && journalKey) {
      const j = await storage.readMeta(journalKey);
      if (j && Number.isInteger(j.seg) && j.etag)
        resume = { startSeg: j.seg + 1, etag: j.etag, total: j.total };
    }

    try {
      return await gxRunUnpackWorker(url, wasmUrl, storage, journalKey, resume, ver, WATCHDOG_MS);
    } catch (e) {
      if (e && e.gxWatchdog && restarts < MAX_RESTARTS) {
        restarts++;
        console.warn('[loader] воркер молчал ' + (WATCHDOG_MS / 1000) + 'с — перезапуск ' +
          restarts + '/' + MAX_RESTARTS + ' с докачкой');
        gxUI.status('loader.stalled', { attempt: restarts });
        continue;
      }
      throw e;
    }
  }
}

function gxRunUnpackWorker(url, wasmUrl, storage, journalKey, resume, ver, watchdogMs) {
  // The workers are tiny — always fetch fresh so a redeploy is never served a
  // stale cached Worker script. brotli_bg.wasm (~1 MB) is versioned by buildId.
  const bust = ver + '.' + (Date.now() >>> 0);
  const worker = new Worker('unpack-worker.js?v=' + bust);

  return new Promise((resolve, reject) => {
    let watchdog = null;
    const arm = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        try { worker.terminate(); } catch {}
        const err = new Error('unpack worker silent for ' + watchdogMs + 'ms');
        err.gxWatchdog = true;
        reject(err);
      }, watchdogMs);
    };
    const done = (fn) => (v) => { if (watchdog) clearTimeout(watchdog); try { worker.terminate(); } catch {} fn(v); };
    const ok = done(resolve), fail = done(reject);
    arm();

    worker.addEventListener('message', (ev) => {
      const m = ev.data;
      arm();                                          // any message = alive
      if (m.type === 'download') {
        gxUI.download(m.received, m.total);
      } else if (m.type === 'index') {
        gxUI.unpack(0, m.entries.length);
      } else if (m.type === 'progress') {
        gxUI.unpack(m.done, m.total);
        if (m.verifying) gxUI.status('loader.verifying');
      } else if (m.type === 'journal') {
        // Persist resume state; fire-and-forget (journal loss only costs re-work).
        if (storage.kind === 'opfs' && journalKey)
          storage.writeMeta(journalKey, { seg: m.seg, etag: m.etag, total: m.total }).catch(() => {});
      } else if (m.type === 'reconnect') {
        gxUI.status('loader.reconnecting', { attempt: m.attempt });
      } else if (m.type === 'complete') {
        ok({ files: m.files, entries: m.entries });
      } else if (m.type === 'error') {
        fail(new Error(m.message));
      }
    });
    worker.addEventListener('error', (e) => {
      const where = e.filename ? (' @ ' + e.filename + ':' + e.lineno) : '';
      console.error('[loader] worker error event:', e);
      fail(new Error('Worker: ' + (e.message || gxText('error.workerLoad')) + where));
    });
    worker.addEventListener('messageerror', (e) => {
      console.error('[loader] worker messageerror:', e);
      fail(new Error('Worker: ' + gxText('error.workerMessage')));
    });
    worker.postMessage({ type: 'start', url, wasmUrl, mode: storage.kind, resume, ver: bust });
  });
}

// ── Checks & init ────────────────────────────────────────────────────────────

async function gxCheckEnvironment() {
  if (!crossOriginIsolated) {
    if (window.gxCoiPending) {
      gxUI.status('loader.environment');
      await new Promise((r) => setTimeout(r, 4000));
    }
    if (!crossOriginIsolated) throw new Error(gxText('error.sharedArrayBuffer'));
  }
  if (typeof WebAssembly === 'undefined') throw new Error(gxText('error.webAssembly'));
}

// IndexedDB mode: load every stored file into window.gxFiles for the engine
// (OPFS mode reads the mounted filesystem directly, so this is a no-op there).
async function gxMaterializeIdb(storage) {
  const paths = (await storage.listPaths()).filter(k => typeof k === 'string');
  const assetPaths = paths.filter(k => !k.startsWith('meta/'));
  const files = [];
  for (let i = 0; i < assetPaths.length; i++) {
    files.push({ path: assetPaths[i], data: await storage.readBytes(assetPaths[i]) });
    if (i % 20 === 0) gxUI.unpack(i, assetPaths.length);
  }
  gxUI.unpack(assetPaths.length, assetPaths.length);
  window.gxFiles = files;
  window.gxIdbPutUserFile = (path, bytes) => {
    storage.writeBlob('userdata/' + path, new Blob([bytes])).catch(e =>
      console.warn('[loader] userdata write-back failed:', path, e));
  };
}

// Wipe every browser-side store this app uses: OPFS (game files, meta,
// userdata), IndexedDB (gx-assets fallback + any others on the origin),
// Cache Storage, localStorage/sessionStorage settings, and the COI service
// worker registration. Used by the settings "Очистить все данные" button.
async function gxWipeAllStorage() {
  const jobs = [];

  // OPFS: remove every top-level entry.
  if (navigator.storage && navigator.storage.getDirectory) {
    jobs.push((async () => {
      try {
        const root = await navigator.storage.getDirectory();
        const names = [];
        for await (const [name] of root.entries()) names.push(name);
        for (const name of names) {
          await root.removeEntry(name, { recursive: true }).catch(() => {});
        }
      } catch (e) { console.warn('[wipe] OPFS:', e); }
    })());
  }

  // IndexedDB: delete every database on the origin (or at least ours).
  jobs.push((async () => {
    try {
      let names = ['gx-assets'];
      if (indexedDB.databases) {
        try {
          const dbs = await indexedDB.databases();
          names = dbs.map((d) => d.name).filter(Boolean);
        } catch {}
      }
      await Promise.all(names.map((n) => new Promise((res) => {
        const req = indexedDB.deleteDatabase(n);
        req.onsuccess = req.onerror = req.onblocked = () => res();
      })));
    } catch (e) { console.warn('[wipe] IDB:', e); }
  })());

  // Cache Storage (anything a SW or the browser cached under our origin).
  if (window.caches && caches.keys) {
    jobs.push((async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (e) { console.warn('[wipe] caches:', e); }
    })());
  }

  // Service workers (the COI worker re-registers itself on next load).
  if ('serviceWorker' in navigator) {
    jobs.push((async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      } catch (e) { console.warn('[wipe] sw:', e); }
    })());
  }

  await Promise.all(jobs);

  // Settings and per-tab identity last (sync, can't fail meaningfully).
  try { localStorage.clear(); } catch {}
  try { sessionStorage.clear(); } catch {}
}

async function gxLoadNetConfig() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const r = await fetch('ice.json', { cache: 'no-cache', signal: controller.signal });
    if (!r.ok) return;
    const cfg = await r.json();
    if (cfg && Array.isArray(cfg.iceServers) && cfg.iceServers.length)
      window.gxNetConfig.iceServers = cfg.iceServers;
    if (cfg && Array.isArray(cfg.mqttBrokers) && cfg.mqttBrokers.length)
      window.gxNetConfig.mqttBrokers = cfg.mqttBrokers;
  } catch (e) {
    console.warn('[loader] ice.json не прочитан:', e);
  } finally {
    clearTimeout(timer);
  }
}

// ── Local owned-game import ──────────────────────────────────────────────────
// iOS Safari 18.4+ supports directory selection via webkitdirectory. Importing
// writes the user's own installation directly to OPFS/IndexedDB; nothing is
// uploaded to this origin or committed to the repository.
function gxLocalRelativePath(file) {
  const raw = (file.webkitRelativePath || file.name || '').replace(/\\/g, '/');
  const parts = raw.split('/').filter(Boolean);
  if (parts.length > 1) parts.shift(); // strip the selected root directory
  return parts.join('/');
}

async function gxImportCombinedZip(storage, zipFile) {
  if (!zipFile) throw new Error('Select a ZIP file.');
  if (!('DecompressionStream' in window)) throw new Error('This Safari version cannot unpack ZIP files.');
  const u8=new Uint8Array(await zipFile.arrayBuffer());
  const dv=new DataView(u8.buffer); const entries=[]; let p=0;
  while(p+30<=u8.length && dv.getUint32(p,true)===0x04034b50){
    const flags=dv.getUint16(p+6,true), method=dv.getUint16(p+8,true), csize=dv.getUint32(p+18,true), usize=dv.getUint32(p+22,true), nl=dv.getUint16(p+26,true), xl=dv.getUint16(p+28,true);
    if(flags&8) throw new Error('ZIP uses data descriptors; recreate it with standard ZIP settings.');
    const name=new TextDecoder().decode(u8.subarray(p+30,p+30+nl)).replace(/\\/g,'/'); const start=p+30+nl+xl;
    if(!name.endsWith('/')) entries.push({name,method,csize,usize,start}); p=start+csize;
  }
  const rootFor=re=>{const e=entries.find(x=>re.test(x.name)); if(!e)return null; return e.name.slice(0,e.name.lastIndexOf('/')+1);};
  const zhRoot=rootFor(/(^|\/)INIZH\.big$/i), baseRoot=rootFor(/(^|\/)(Terrain|Textures|W3D)\.big$/i);
  if(zhRoot===null||baseRoot===null||zhRoot===baseRoot) throw new Error('ZIP must contain separate Generals and Zero Hour folders.');
  const chosen=entries.filter(x=>x.name.startsWith(zhRoot)||x.name.startsWith(baseRoot)); let done=0,zhCount=0,baseCount=0; const total=chosen.reduce((n,x)=>n+x.usize,0); gxUI.download(0,total); if(storage.requestPersist) await storage.requestPersist();
  for(let i=0;i<chosen.length;i++){const e=chosen[i]; let path=e.name.startsWith(zhRoot)?e.name.slice(zhRoot.length):'GameDataGenerals/'+e.name.slice(baseRoot.length); if(!path||path.includes('../'))continue; let blob=new Blob([u8.slice(e.start,e.start+e.csize)]); if(e.method===8){blob=await new Response(blob.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();} else if(e.method!==0) throw new Error('Unsupported ZIP compression method '+e.method+' for '+e.name); await storage.writeBlob(path,blob); done+=blob.size; e.name.startsWith(zhRoot)?zhCount++:baseCount++; gxUI.download(done,total,'Unpacking ZIP '+(i+1)+' / '+chosen.length+': '+path); gxUI.unpack(i+1,chosen.length); if((i&3)===3)await new Promise(r=>setTimeout(r,0));}
  await storage.writeMeta('installed-default_ru',{complete:true,files:zhCount,ts:Date.now(),source:'combined-zip'}); await storage.writeMeta('installed-base-generals',{complete:true,files:baseCount,ts:Date.now(),source:'combined-zip'}); return {files:chosen.length,bytes:done,zhCount,baseCount};
}

async function gxImportCombinedFolder(storage, files) {
  const list = Array.from(files || []).filter(f => f && f.size >= 0);
  if (!list.length) throw new Error('No files selected.');
  const items = list.map(file => ({ file, rel: gxLocalRelativePath(file).replace(/\\/g, '/') }));
  const rootFor = re => {
    const hit = items.find(x => re.test(x.rel));
    if (!hit) return null;
    const parts = hit.rel.split('/'); parts.pop();
    return parts.length ? parts.join('/') + '/' : '';
  };
  const zhRoot = rootFor(/(^|\/)INIZH\.big$/i);
  const baseRoot = rootFor(/(^|\/)Terrain\.big$/i) || rootFor(/(^|\/)Textures\.big$/i) || rootFor(/(^|\/)W3D\.big$/i);
  if (zhRoot === null || baseRoot === null || zhRoot === baseRoot)
    throw new Error('Select one parent folder containing BOTH separate Generals and Zero Hour folders.');

  const selected = items.filter(x => x.rel.startsWith(zhRoot) || x.rel.startsWith(baseRoot));
  const total = selected.reduce((n,x)=>n+x.file.size,0);
  if (storage.requestPersist) await storage.requestPersist();
  gxUI.download(0,total); let done=0, zhCount=0, baseCount=0;
  for (let i=0;i<selected.length;i++) {
    const x=selected[i]; let path;
    if (x.rel.startsWith(zhRoot)) { path=x.rel.slice(zhRoot.length); zhCount++; }
    else { path='GameDataGenerals/'+x.rel.slice(baseRoot.length); baseCount++; }
    if (!path || path.includes('../')) continue;
    await storage.writeBlob(path,x.file); done+=x.file.size;
    gxUI.download(done,total,'Importing all game files '+(i+1)+' / '+selected.length+': '+path);
    gxUI.unpack(i+1,selected.length);
    if ((i&7)===7) await new Promise(r=>setTimeout(r,0));
  }
  await storage.writeMeta('installed-default_ru',{complete:true,files:zhCount,ts:Date.now(),source:'combined-local-folder'});
  await storage.writeMeta('installed-base-generals',{complete:true,files:baseCount,ts:Date.now(),source:'combined-local-folder'});
  return {files:selected.length,bytes:done,zhCount,baseCount};
}

async function gxAssetPreflight(storage) {
  // Do not recursively enumerate a multi-GB OPFS tree on iOS Safari. Checking
  // the known root archives directly is dramatically faster and avoids the
  // launcher appearing frozen at “Initializing…”.
  const checks = await Promise.all([
    storage.has('INIZH.big'),
    storage.has('W3DZH.big'),
    storage.has('TexturesZH.big'),
    storage.has('TerrainZH.big'),
    storage.has('GameDataGenerals/Terrain.big'),
    storage.has('GameDataGenerals/Textures.big'),
    storage.has('GameDataGenerals/W3D.big')
  ]);
  const missingZH=[];
  if(!checks[0]) missingZH.push('inizh.big');
  if(!checks[1]) missingZH.push('w3dzh.big');
  if(!checks[2]) missingZH.push('textureszh.big');
  if(!checks[3]) missingZH.push('terrainzh.big');
  const missingBase=[];
  if(!checks[4]) missingBase.push('terrain.big');
  if(!checks[5]) missingBase.push('textures.big');
  if(!checks[6]) missingBase.push('w3d.big');
  return {ok:!missingZH.length&&!missingBase.length,missingZH,missingBase,count:'verified'};
}

async function gxImportBaseGeneralsFolder(storage, files) {
  const list = Array.from(files || []).filter(f => f && f.size >= 0);
  if (!list.length) throw new Error('No files selected.');

  const rel = list.map(gxLocalRelativePath);
  const bigNames = new Set(rel.filter(p => /(^|\/)[^/]+\.big$/i.test(p)).map(p => p.split('/').pop().toLowerCase()));
  const requiredAny = ['terrain.big', 'textures.big', 'w3d.big'];
  if (!requiredAny.some(n => bigNames.has(n))) {
    throw new Error('This does not look like the base C&C Generals install folder (Terrain.big / Textures.big / W3D.big not found).');
  }

  const estimate = storage.estimate ? await storage.estimate() : null;
  const total = list.reduce((n, f) => n + f.size, 0);
  if (estimate && Number.isFinite(estimate.quota) && Number.isFinite(estimate.usage)) {
    const free = estimate.quota - estimate.usage;
    if (free < total) throw new Error('Not enough browser storage for base Generals. Need ' + gxHuman(total) + ', available about ' + gxHuman(Math.max(0, free)) + '.');
  }

  if (storage.requestPersist) await storage.requestPersist();
  let doneBytes = 0;
  gxUI.download(0, total);
  for (let i = 0; i < list.length; i++) {
    const file = list[i];
    const relPath = gxLocalRelativePath(file);
    if (!relPath || relPath.startsWith('../')) continue;
    const path = 'GameDataGenerals/' + relPath;
    await storage.writeBlob(path, file);
    doneBytes += file.size;
    gxUI.download(doneBytes, total, 'Importing base Generals ' + (i + 1) + ' / ' + list.length + ': ' + relPath);
    gxUI.unpack(i + 1, list.length);
    if ((i & 7) === 7) await new Promise(r => setTimeout(r, 0));
  }
  await storage.writeMeta('installed-base-generals', { complete: true, files: list.length, ts: Date.now(), source: 'local-folder' });
  return { files: list.length, bytes: doneBytes };
}

async function gxImportLocalFolder(storage, files) {
  const list = Array.from(files || []).filter(f => f && f.size >= 0);
  if (!list.length) throw new Error('No files selected.');

  const rel = list.map(gxLocalRelativePath);
  const hasBig = rel.some(p => /(^|\/)[^/]+\.big$/i.test(p));
  const hasIni = rel.some(p => /(^|\/)INIZH\.big$/i.test(p));
  if (!hasBig || !hasIni) {
    throw new Error('This does not look like a Zero Hour install folder (INIZH.big was not found).');
  }

  const estimate = storage.estimate ? await storage.estimate() : null;
  const total = list.reduce((n, f) => n + f.size, 0);
  if (estimate && Number.isFinite(estimate.quota) && Number.isFinite(estimate.usage)) {
    const free = estimate.quota - estimate.usage;
    if (free < total) {
      throw new Error('Not enough browser storage. Need ' + gxHuman(total) +
        ', available about ' + gxHuman(Math.max(0, free)) + '.');
    }
  }

  if (storage.requestPersist) await storage.requestPersist();
  let doneBytes = 0;
  gxUI.status('loader.files');
  gxUI.download(0, total);

  for (let i = 0; i < list.length; i++) {
    const file = list[i];
    const path = gxLocalRelativePath(file);
    if (!path || path.startsWith('../')) continue;
    await storage.writeBlob(path, file);
    doneBytes += file.size;
    gxUI.download(doneBytes, total, 'Importing ' + (i + 1) + ' / ' + list.length + ': ' + path);
    gxUI.unpack(i + 1, list.length);
    // Yield periodically so iOS does not consider the page unresponsive.
    if ((i & 7) === 7) await new Promise(r => setTimeout(r, 0));
  }

  await storage.writeMeta('installed-default_ru', {
    complete: true, files: list.length, ts: Date.now(), source: 'local-folder'
  });
  return { files: list.length, bytes: doneBytes };
}

// ── Boot ─────────────────────────────────────────────────────────────────────

async function gxBoot() {
  gxUI.init();

  try {
    gxUI.detail.textContent = '1/4 Browser tekshirilmoqda…';
    await gxCheckEnvironment();

    // Multiplayer config must never block the launcher. Load it in parallel.
    void gxLoadNetConfig();

    gxUI.detail.textContent = '2/4 Xotira ochilmoqda…';
    const storage = await gxDetectStorage();
    gxUI.detail.textContent = '3/4 Launcher tayyorlanmoqda…';
    console.log('[loader] хранилище:', storage.kind);
    window.gxStorageKind = storage.kind;
    document.getElementById('gx-storage-kind').textContent =
      storage.kind === 'opfs' ? 'OPFS' : 'IndexedDB (fallback)';

    // Show settings + play immediately
    document.getElementById('gx-progress-wrap').style.display = 'none';
    gxUI.status('loader.ready');

    const btn = document.getElementById('gx-play');
    btn.style.display = 'inline-block';

    const zipBtn=document.getElementById('gx-zip-import'), zipFile=document.getElementById('gx-zip-file');
    if(zipBtn&&zipFile){ zipFile.addEventListener('change',async()=>{zipBtn.disabled=true;btn.disabled=true;document.getElementById('gx-progress-wrap').style.display='block';try{const r=await gxImportCombinedZip(storage,zipFile.files[0]);gxUI.detail.textContent='ZIP ready: Zero Hour '+r.zhCount+' + Generals '+r.baseCount+' files ('+gxHuman(r.bytes)+').';zipBtn.textContent='✓ ZIP imported';btn.disabled=false;}catch(e){gxUI.error(e&&e.message?e.message:String(e));zipBtn.disabled=false;btn.disabled=false;}});}

    const combinedBtn = document.getElementById('gx-combined-import');
    const combinedFolder = document.getElementById('gx-combined-folder');
    if (combinedBtn && combinedFolder) {
      combinedBtn.addEventListener('click', () => combinedFolder.click());
      combinedFolder.addEventListener('change', async () => {
        combinedBtn.disabled=true; btn.disabled=true;
        document.getElementById('gx-progress-wrap').style.display='block';
        try {
          const r=await gxImportCombinedFolder(storage,combinedFolder.files);
          gxUI.detail.textContent='All files ready: Zero Hour '+r.zhCount+' + Generals '+r.baseCount+' files ('+gxHuman(r.bytes)+').';
          combinedBtn.textContent='✓ Generals + Zero Hour imported'; btn.disabled=false;
        } catch(e) { gxUI.error(e&&e.message?e.message:String(e)); combinedBtn.disabled=false; btn.disabled=false; }
      });
    }

    const localImportBtn = document.getElementById('gx-local-import');
    const localFolder = document.getElementById('gx-local-folder');
    if (localImportBtn && localFolder) {
      localImportBtn.addEventListener('click', () => localFolder.click());
      localFolder.addEventListener('change', async () => {
        localImportBtn.disabled = true;
        btn.disabled = true;
        document.getElementById('gx-progress-wrap').style.display = 'block';
        try {
          const imported = await gxImportLocalFolder(storage, localFolder.files);
          gxUI.status('loader.ready');
          gxUI.detail.textContent = 'Local Zero Hour files ready: ' + imported.files +
            ' files (' + gxHuman(imported.bytes) + '). Tap Play.';
          btn.disabled = false;
          localImportBtn.textContent = '✓ Zero Hour folder imported';
        } catch (e) {
          gxUI.error(e && e.message ? e.message : String(e));
          btn.disabled = false;
          localImportBtn.disabled = false;
        }
      });
    }

    const baseImportBtn = document.getElementById('gx-base-import');
    const baseFolder = document.getElementById('gx-base-folder');
    if (baseImportBtn && baseFolder) {
      baseImportBtn.addEventListener('click', () => baseFolder.click());
      baseFolder.addEventListener('change', async () => {
        baseImportBtn.disabled = true;
        btn.disabled = true;
        document.getElementById('gx-progress-wrap').style.display = 'block';
        try {
          const imported = await gxImportBaseGeneralsFolder(storage, baseFolder.files);
          gxUI.detail.textContent = 'Base Generals files ready: ' + imported.files + ' files (' + gxHuman(imported.bytes) + ').';
          btn.disabled = false;
          baseImportBtn.textContent = '✓ Base Generals folder imported';
        } catch (e) {
          gxUI.error(e && e.message ? e.message : String(e));
          btn.disabled = false;
          baseImportBtn.disabled = false;
        }
      });
    }

    const quickGame=document.getElementById('gx-game-select');
    if(quickGame){quickGame.value=localStorage.getItem('gx-game')||'default_ru';quickGame.addEventListener('change',()=>localStorage.setItem('gx-game',quickGame.value));}
    const quickFps=document.getElementById('gx-fps-quick');
    if(quickFps){quickFps.value=localStorage.getItem('gx-fps')||'30';quickFps.addEventListener('change',()=>{localStorage.setItem('gx-fps',quickFps.value);const full=document.getElementById('gx-fps');if(full)full.value=quickFps.value;});}
    const quickWipe=document.getElementById('gx-wipe-quick');
    if(quickWipe){let armed=false;quickWipe.addEventListener('click',async()=>{if(!armed){armed=true;quickWipe.textContent='⚠️ Yana bosing: hammasini o‘chirish';setTimeout(()=>{armed=false;quickWipe.textContent='🗑 Очистить все данные';},4000);return;}quickWipe.disabled=true;quickWipe.textContent='Tozalanmoqda…';try{await gxWipeAllStorage();location.reload();}catch(e){gxUI.error(e&&e.message?e.message:String(e));quickWipe.disabled=false;}});}

    const settingsBtn = document.getElementById('gx-settings-btn');
    const settingsBox = document.getElementById('gx-settings');
    const fpsSel = document.getElementById('gx-fps');
    fpsSel.value = localStorage.getItem('gx-fps') || '30';
    if (![...fpsSel.options].some(o => o.value === fpsSel.value)) fpsSel.value = '30';
    fpsSel.addEventListener('change', () => { localStorage.setItem('gx-fps', fpsSel.value); if(quickFps) quickFps.value=fpsSel.value; });

    const buildSel = document.getElementById('gx-build');
    buildSel.value = localStorage.getItem('gx-build') || 'default_ru';
    if (![...buildSel.options].some(o => o.value === buildSel.value)) buildSel.value = 'default_ru';
    buildSel.addEventListener('change', () => localStorage.setItem('gx-build', buildSel.value));

    settingsBtn.style.display = 'inline-block';
    settingsBtn.addEventListener('click', () => { settingsBox.hidden = !settingsBox.hidden; });

    // Wipe-everything button: OPFS, IndexedDB, Cache Storage, local/session
    // storage, and the COI service worker. Two clicks to confirm.
    const wipeBtn = document.getElementById('gx-wipe');
    let wipeArmed = false;
    let wipeTextKey = 'shell.wipe';
    const renderWipeText = () => { wipeBtn.textContent = gxText(wipeTextKey); };
    window.addEventListener('gxlanguagechange', renderWipeText);
    wipeBtn.addEventListener('click', async () => {
      if (!wipeArmed) {
        wipeArmed = true;
        wipeTextKey = 'loader.wipeConfirm';
        renderWipeText();
        setTimeout(() => {
          wipeArmed = false;
          wipeTextKey = 'shell.wipe';
          renderWipeText();
        }, 4000);
        return;
      }
      wipeBtn.disabled = true;
      wipeTextKey = 'loader.wiping';
      renderWipeText();
      try {
        await gxWipeAllStorage();
        wipeTextKey = 'loader.wipeDone';
        renderWipeText();
        setTimeout(() => location.reload(), 600);
      } catch (e) {
        console.error('[loader] wipe failed:', e);
        wipeBtn.disabled = false;
        wipeTextKey = 'loader.wipeError';
        renderWipeText();
        wipeArmed = false;
      }
    });

    const preflight = await gxAssetPreflight(storage);
    if (!preflight.ok) {
      const problems = [];
      if (preflight.missingZH.length) problems.push('Zero Hour: ' + preflight.missingZH.join(', '));
      if (preflight.missingBase.length) problems.push('C&C Generals: ' + preflight.missingBase.join(', '));
      gxUI.error('Game files incomplete. Import both folders first. Missing: ' + problems.join(' | '));
      if (localImportBtn) localImportBtn.style.display = '';
      if (baseImportBtn) baseImportBtn.style.display = '';
      btn.disabled = true;
    } else {
      gxUI.detail.textContent = 'Assets verified: Zero Hour + base Generals (' + preflight.count + ' stored files).';
    }

    await new Promise((resolve) => btn.addEventListener('click', async () => {
      if (window.gxEnterMobileGameMode) await window.gxEnterMobileGameMode();
      resolve();
    }, { once: true }));
    btn.style.display = 'none';
    if (localImportBtn) localImportBtn.style.display = 'none';
    if (baseImportBtn) baseImportBtn.style.display = 'none';
    const localNote = document.getElementById('gx-local-note');
    if (localNote) localNote.style.display = 'none';
    settingsBtn.style.display = 'none';
    settingsBox.hidden = true;

    const selectedGame = localStorage.getItem('gx-game') || 'default_ru';
    const build = selectedGame === 'generals' ? 'default_ru' : (localStorage.getItem('gx-build') || 'default_ru');
    const markerKey = 'installed-' + build;

    // Stage 1: download the engine (wasm) into memory, with progress. Always
    // needed — done before resources so a fresh install and a cached reload both
    // fetch the engine here, and the engine never fetches its own wasm later.
    document.getElementById('gx-progress-wrap').style.display = 'block';
    gxUI.download(0, 0);
    gxUI.unpack(0, 0);
    gxUI.status('loader.engine');
    await gxPreloadEngine((received, total) => gxUI.download(received, total));

    // Already installed? Skip the resource download/unpack and go straight to play.
    const marker = await storage.readMeta(markerKey);
    if (marker && marker.complete) {
      console.log('[loader] сборка ' + build + ' уже установлена (' + marker.files + ' файлов) — пропускаю загрузку');
      if (storage.kind === 'idb') {
        gxUI.status('loader.files');
        await gxMaterializeIdb(storage);
      }
      gxUI.status('loader.starting');
      document.getElementById('gx-progress-wrap').style.display = 'none';
      await gxStartGame();
      gxUI.overlay.style.display = 'none';
      return;
    }

    // Stage 2: download + unpack game resources.
    gxUI.download(0, 0);
    gxUI.unpack(0, 0);

    // The dispatcher worker fetches, slices segments, decompresses them on a
    // parallel pool, and writes files — download and unpack run concurrently.
    // NOTE: a STABLE url (no cache-buster) so Range resume across page reloads
    // targets the same resource; freshness is validated by the server ETag in
    // the resume journal.
    const url = 'assets/' + encodeURIComponent(build) + '/build.data';
    const journalKey = 'unpack-journal-' + build;
    gxUI.status('loader.assets');
    const result = await gxStreamExtract(url, storage, journalKey);
    console.log('[loader] распаковано ' + result.files + ' файлов');

    // IndexedDB mode: materialize files into window.gxFiles for the engine.
    if (storage.kind === 'idb') {
      gxUI.status('loader.files');
      await gxMaterializeIdb(storage);
    }

    // Mark installed; drop the resume journal (it's for interrupted installs).
    await storage.writeMeta(markerKey, { complete: true, files: result.files, ts: Date.now() });
    if (storage.kind === 'opfs') await storage.writeMeta(journalKey, {}).catch(() => {});

    gxUI.status('loader.starting');
    document.getElementById('gx-progress-wrap').style.display = 'none';
    await gxStartGame();
    gxUI.overlay.style.display = 'none';
  } catch (e) {
    gxUI.error(e && e.message ? e.message : String(e));
  }
}

window.addEventListener('DOMContentLoaded', gxBoot);
