/* ============================================================
   nube.js — el proyecto vive en Google Cloud
   ============================================================
   El navegador es solo una copia rápida. La verdad está en el
   bucket: entras desde cualquier aparato y el trabajo está ahí.
   ============================================================ */

const ENDPOINT = '/api/ep-gemini';

let _disponible = null;   // null = sin comprobar

async function pedir(cuerpo) {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'nube', ...cuerpo }),
  });
  if (!r.ok) {
    let j = {};
    try { j = await r.json(); } catch (e) { /* respuesta no-JSON */ }
    const err = new Error(j.error || ('El almacén respondió ' + r.status));
    err.status = r.status;
    throw err;
  }
  return r;
}

export const nube = {
  get disponible() { return _disponible === true; },

  marcarDisponible(v) { _disponible = !!v; },

  /** Guarda el proyecto entero. Es la operación que hace que nada se pierda. */
  async guardarEstado(estado) {
    const r = await pedir({ action: 'estadoGuardar', estado });
    return (await r.json()).guardado === true;
  },

  async leerEstado() {
    const r = await pedir({ action: 'estadoLeer' });
    return (await r.json()).estado;
  },

  /** Inventario de lo generado que hay en el bucket. */
  async listar() {
    const r = await pedir({ action: 'listar' });
    const j = await r.json();
    const mapa = new Map();
    for (const it of (j.material || [])) mapa.set(it.clave, it.bytes);
    return mapa;
  },

  /** Trae un archivo del bucket como Blob. */
  async leer(clave) {
    const r = await pedir({ action: 'leer', clave });
    return r.blob();
  },

  /** Mueve el clip que produjo Veo a su sitio definitivo. */
  async archivarClip(clip, clave) {
    const r = await pedir({ action: 'archivarClip', clip, clave });
    return (await r.json()).guardado === true;
  },

  async vaciar() {
    const r = await pedir({ action: 'vaciar' });
    return (await r.json()).borrados || 0;
  },
};

/* ── Guardado con freno ──────────────────────────────────────
   Guardar en cada tecla sería absurdo: se espera a que amaine.  */

let _timer = null;
let _pendiente = null;
let _enCurso = false;
let _aviso = null;

export function alGuardar(fn) { _aviso = fn; }

export function guardarPronto(construirEstado, ms) {
  _pendiente = construirEstado;
  clearTimeout(_timer);
  _timer = setTimeout(vaciarCola, ms || 2500);
}

export async function vaciarCola() {
  if (!_pendiente || _enCurso || !nube.disponible) return false;
  const construir = _pendiente;
  _pendiente = null;
  _enCurso = true;
  if (_aviso) _aviso('guardando');
  try {
    await nube.guardarEstado(construir());
    if (_aviso) _aviso('guardado');
    return true;
  } catch (e) {
    if (_aviso) _aviso('error', e.message);
    return false;
  } finally {
    _enCurso = false;
  }
}
