/* ============================================================
   db.js — persistencia
   ============================================================
   El proyecto (texto, guion técnico, ajustes) y los binarios
   (audio, imágenes, video) viven en IndexedDB: sobreviven al
   cierre de la pestaña, que es la diferencia entre una prueba
   y una producción.
   ============================================================ */

import { nube } from './nube.js';

const NOMBRE = 'diezmo-estudio';
const VERSION = 1;

let _db = null;

function abrir() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NOMBRE, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('proyecto')) db.createObjectStore('proyecto');
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets');
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, modo, fn) {
  return abrir().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, modo);
    const s = t.objectStore(store);
    let resultado;
    try { resultado = fn(s); } catch (e) { reject(e); return; }
    // Una clave inexistente devuelve result === undefined: hay que propagar ese
    // undefined, no la propia petición, o quien llame recibirá un objeto vivo.
    t.oncomplete = () => resolve(resultado instanceof IDBRequest ? resultado.result : resultado);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

/* ── Proyecto (JSON) ────────────────────────────────────────── */
export const proyecto = {
  guardar: (clave, valor) => tx('proyecto', 'readwrite', (s) => s.put(valor, clave)),
  leer: (clave) => tx('proyecto', 'readonly', (s) => s.get(clave)),
  borrar: (clave) => tx('proyecto', 'readwrite', (s) => s.delete(clave)),
};

/* ── Assets (Blob) ──────────────────────────────────────────── */
const urls = new Map();

export const assets = {
  async guardar(id, blob, meta) {
    await tx('assets', 'readwrite', (s) => s.put({ blob, meta: meta || {}, ts: Date.now() }, id));
    const previa = urls.get(id);
    if (previa) { try { URL.revokeObjectURL(previa); } catch (e) { /* ya liberada */ } }
    urls.delete(id);
    return id;
  },

  async leer(id) {
    const v = await tx('assets', 'readonly', (s) => s.get(id));
    return v || null;
  },

  /**
   * El navegador es una copia rápida; el bucket es la verdad. Si algo no
   * está aquí pero sí allá, se trae y se guarda para la próxima vez.
   */
  async blob(id) {
    const v = await assets.leer(id);
    if (v) return v.blob;
    if (!nube.disponible) return null;
    try {
      const b = await nube.leer(id);
      if (b && b.size) { await assets.guardar(id, b, { deNube: true }); return b; }
    } catch (e) { /* no está en el almacén */ }
    return null;
  },

  /** URL de objeto reutilizable; se cachea para no multiplicar handles. */
  async url(id) {
    if (urls.has(id)) return urls.get(id);
    const b = await assets.blob(id);
    if (!b) return null;
    const u = URL.createObjectURL(b);
    urls.set(id, u);
    return u;
  },

  async existe(id) {
    const v = await tx('assets', 'readonly', (s) => s.getKey(id));
    return v !== undefined;
  },

  async borrar(id) {
    const previa = urls.get(id);
    if (previa) { try { URL.revokeObjectURL(previa); } catch (e) { /* ya liberada */ } }
    urls.delete(id);
    return tx('assets', 'readwrite', (s) => s.delete(id));
  },

  async claves() {
    return tx('assets', 'readonly', (s) => s.getAllKeys());
  },

  async borrarPrefijo(prefijo) {
    const ks = await assets.claves();
    let n = 0;
    for (const k of ks) {
      if (String(k).startsWith(prefijo)) { await assets.borrar(k); n++; }
    }
    return n;
  },

  async tamanoTotal() {
    const ks = await assets.claves();
    let bytes = 0;
    for (const k of ks) {
      const v = await assets.leer(k);
      if (v && v.blob) bytes += v.blob.size;
    }
    return { archivos: ks.length, bytes };
  },
};

/* ── Espacio en disco disponible ────────────────────────────── */
export async function cuota() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  const e = await navigator.storage.estimate();
  return { usado: e.usage || 0, total: e.quota || 0 };
}

/** Pide almacenamiento persistente para que el navegador no borre el trabajo. */
export async function pedirPersistencia() {
  if (!navigator.storage || !navigator.storage.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
