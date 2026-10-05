// GeneralsX Web - asset storage layer.
//
// Two drivers behind one async interface:
//   - OpfsStorage:  Origin Private File System (preferred; durable, fast,
//                   and readable synchronously by the wasm side via WASMFS).
//   - IdbStorage:   IndexedDB fallback for environments where OPFS is not
//                   available. The wasm side cannot read IndexedDB directly,
//                   so at boot the loader materializes files as ArrayBuffers
//                   on window.gxFiles and the C++ side copies them into a
//                   WASMFS js-file backend mount (data lives in JS memory,
//                   not in the wasm heap).
//
// Both drivers store the game files under a flat "path -> bytes" model plus
// a small metadata record (installed manifest) used for delta updates.
//
// GeneralsX @build web-port 05/07/2026 - Web port Phase 1

'use strict';

const GX_DB_NAME = 'gx-assets';
const GX_DB_STORE = 'files';
const GX_DB_META = 'meta';

// ---------------------------------------------------------------------------
// Capability detection
// ---------------------------------------------------------------------------

function gxIsIOSLike() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function gxDetectStorage() {
  const isiOS = gxIsIOSLike();

  // ?storage=idb is useful for desktop testing, but on iPhone/iPad it is unsafe
  // for multi-GB installs: the engine must materialize every stored file into
  // JS ArrayBuffers, which can terminate Safari under memory pressure.
  const forced = new URLSearchParams(location.search).get('storage');
  if (forced === 'idb') {
    if (isiOS) {
      throw new Error('iPhone/iPad memory protection: IndexedDB mode is disabled. Reload without ?storage=idb so the game can use OPFS.');
    }
    console.warn('[storage] IndexedDB forced via ?storage=idb');
    return await IdbStorage.open();
  }
  // OPFS needs a secure context; also probe that it actually works (some
  // browsers expose navigator.storage but fail on getDirectory).
  if (window.isSecureContext && navigator.storage && navigator.storage.getDirectory) {
    try {
      // iOS can take longer to reopen an origin that owns multiple GB. Give it
      // extra time instead of incorrectly dropping into the RAM-heavy IDB path.
      const opfsTimeoutMs = isiOS ? 20000 : 8000;
      const root = await Promise.race([
        navigator.storage.getDirectory(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('OPFS open timeout')), opfsTimeoutMs)),
      ]);
      return new OpfsStorage(root);
    } catch (e) {
      console.warn('[storage] OPFS open failed/timed out:', e);
      if (isiOS) {
        throw new Error('OPFS could not be opened on this iPhone/iPad. IndexedDB fallback was blocked to prevent a multi-GB RAM spike. Close other Safari tabs, reopen Safari, then try again.');
      }
    }
  } else if (isiOS) {
    throw new Error('OPFS is unavailable on this iPhone/iPad. The RAM-heavy IndexedDB fallback is disabled for safety. Open the game in a current Safari secure tab.');
  }
  if (window.indexedDB) {
    const db = await IdbStorage.open();
    return db;
  }
  // GeneralsX @feature Lolendor 22/07/2026 Localize launch-screen storage errors.
  throw new Error(window.gxI18n.t('error.storage'));
}

// ---------------------------------------------------------------------------
// OPFS driver
// ---------------------------------------------------------------------------


// Where a manifest path lands inside the storage root. Regular assets live under
// GameData/ (the ZH install); paths already prefixed with GameDataGenerals/ are the
// optional base-game install and live as a sibling, so the engine's recursive
// primary *.big scan of GameData/ never picks them up out of order.
function gxStoragePath(path) {
  return path.startsWith('GameDataGenerals/') ? path : 'GameData/' + path;
}

class OpfsStorage {
  constructor(root) {
    this.kind = 'opfs';
    this.root = root;
  }

  async _dir(path, create) {
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop();
    let dir = this.root;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create });
    }
    return { dir, name };
  }

  async readMeta(key) {
    try {
      const { dir, name } = await this._dir('meta/' + key + '.json', false);
      const fh = await dir.getFileHandle(name);
      const f = await fh.getFile();
      return JSON.parse(await f.text());
    } catch {
      return null;
    }
  }

  async writeMeta(key, value) {
    const { dir, name } = await this._dir('meta/' + key + '.json', true);
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(value));
    await w.close();
  }

  async has(path) {
    try {
      const { dir, name } = await this._dir(gxStoragePath(path), false);
      await dir.getFileHandle(name);
      return true;
    } catch {
      return false;
    }
  }

  async fileSize(path) {
    try {
      const { dir, name } = await this._dir(gxStoragePath(path), false);
      const fh = await dir.getFileHandle(name);
      const f = await fh.getFile();
      return f.size;
    } catch {
      return -1;
    }
  }

  // Streams a Response body into the file, reporting progress. Returns bytes written.
  async writeStream(path, response, onProgress) {
    const { dir, name } = await this._dir(gxStoragePath(path), true);
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    const reader = response.body.getReader();
    let written = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await w.write(value);
      written += value.byteLength;
      if (onProgress) onProgress(value.byteLength);
    }
    await w.close();
    return written;
  }

  async readBytes(path) {
    const { dir, name } = await this._dir(gxStoragePath(path), false);
    const fh = await dir.getFileHandle(name);
    const f = await fh.getFile();
    return await f.arrayBuffer();
  }

  async listPaths() {
    const paths = [];
    async function walk(dir, prefix) {
      for await (const [name, handle] of dir) {
        const full = prefix ? prefix + '/' + name : name;
        if (handle.kind === 'file') paths.push(full);
        else await walk(handle, full);
      }
    }
    await walk(this.root, '');
    // Filter out meta/ and userdata/ for the caller's convenience.
    return paths.filter(p => !p.startsWith('meta/'));
  }

  async remove(path) {
    try {
      const { dir, name } = await this._dir(gxStoragePath(path), false);
      await dir.removeEntry(name);
    } catch {}
  }

  async requestPersist() {
    try {
      if (navigator.storage.persist) {
        const ok = await navigator.storage.persist();
        console.log('[storage] navigator.storage.persist() ->', ok);
      }
    } catch {}
  }

  async writeBlob(path, blob) {
    const { dir, name } = await this._dir(gxStoragePath(path), true);
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
  }

  async estimate() {
    try {
      return await navigator.storage.estimate();
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// IndexedDB driver (fallback)
// ---------------------------------------------------------------------------

class IdbStorage {
  constructor(db) {
    this.kind = 'idb';
    this.db = db;
  }

  static open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(GX_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(GX_DB_STORE)) db.createObjectStore(GX_DB_STORE);
        if (!db.objectStoreNames.contains(GX_DB_META)) db.createObjectStore(GX_DB_META);
      };
      req.onsuccess = () => resolve(new IdbStorage(req.result));
      req.onerror = () => reject(req.error);
    });
  }

  _tx(store, mode) {
    return this.db.transaction(store, mode).objectStore(store);
  }

  _req(r) {
    return new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  async readMeta(key) {
    const v = await this._req(this._tx(GX_DB_META, 'readonly').get(key));
    return v === undefined ? null : v;
  }

  async writeMeta(key, value) {
    await this._req(this._tx(GX_DB_META, 'readwrite').put(value, key));
  }

  async has(path) {
    const keys = await this._req(this._tx(GX_DB_STORE, 'readonly').getKey(path));
    return keys !== undefined;
  }

  async fileSize(path) {
    const blob = await this._req(this._tx(GX_DB_STORE, 'readonly').get(path));
    return blob ? blob.size : -1;
  }

  // IDB has no streaming writes: buffer the response, then put() the Blob.
  async writeStream(path, response, onProgress) {
    const reader = response.body.getReader();
    const chunks = [];
    let written = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      written += value.byteLength;
      if (onProgress) onProgress(value.byteLength);
    }
    const blob = new Blob(chunks);
    await this._req(this._tx(GX_DB_STORE, 'readwrite').put(blob, path));
    return written;
  }

  async readBytes(path) {
    const blob = await this._req(this._tx(GX_DB_STORE, 'readonly').get(path));
    if (!blob) throw new Error('missing in IndexedDB: ' + path);
    return await blob.arrayBuffer();
  }

  async remove(path) {
    await this._req(this._tx(GX_DB_STORE, 'readwrite').delete(path));
  }

  // Direct blob write (userdata write-back path).
  async writeBlob(path, blob) {
    await this._req(this._tx(GX_DB_STORE, 'readwrite').put(blob, path));
  }

  async listPaths() {
    return await this._req(this._tx(GX_DB_STORE, 'readonly').getAllKeys());
  }

  async requestPersist() {
    try {
      if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
    } catch {}
  }

  async estimate() {
    try {
      return navigator.storage && navigator.storage.estimate
        ? await navigator.storage.estimate()
        : null;
    } catch {
      return null;
    }
  }
}

window.gxDetectStorage = gxDetectStorage;