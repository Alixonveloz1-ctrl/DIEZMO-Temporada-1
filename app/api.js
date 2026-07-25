/* ============================================================
   api.js — cliente de /api/ep-gemini
   ============================================================
   Todas las llamadas pasan por aquí: reintentos con espera
   creciente, cancelación y errores en castellano.
   ============================================================ */

const ENDPOINT = '/api/ep-gemini';

export class Cancelado extends Error {
  constructor() { super('__CANCELADO__'); this.cancelado = true; }
}

async function crudo(cuerpo, señal) {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
    signal: señal,
  });
  let j = {};
  try { j = await r.json(); } catch (e) { /* respuesta vacía o no-JSON */ }
  if (!r.ok) {
    const msg = j.error || ('HTTP ' + r.status);
    const det = j.detail ? ' — ' + String(j.detail).slice(0, 240) : '';
    const err = new Error(msg + det);
    err.status = r.status;
    throw err;
  }
  return j;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Llama al backend reintentando los fallos transitorios.
 * Los errores de cuota (429) y capacidad (503) esperan más.
 */
export async function llamar(cuerpo, opciones) {
  const o = opciones || {};
  const intentos = o.intentos || 3;
  const señal = o.señal;
  let ultimo = null;

  for (let n = 1; n <= intentos; n++) {
    if (señal && señal.aborted) throw new Cancelado();
    try {
      return await crudo(cuerpo, señal);
    } catch (e) {
      if (e.name === 'AbortError') throw new Cancelado();
      ultimo = e;
      const transitorio = !e.status || e.status === 429 || e.status === 503 ||
        e.status === 500 || e.status === 502 || e.status === 504;
      if (!transitorio || n === intentos) break;
      const espera = (e.status === 429 ? 8000 : 2000) * n;
      if (o.aviso) o.aviso('reintento ' + (n + 1) + '/' + intentos + ' en ' + Math.round(espera / 1000) + ' s');
      await esperar(espera);
    }
  }
  throw ultimo || new Error('La llamada falló');
}

/* ── Atajos por modo ────────────────────────────────────────── */

export const api = {
  ping: () => llamar({ mode: 'ping' }, { intentos: 1 }),

  modelos: () => llamar({ mode: 'models' }, { intentos: 2 }),

  tts: (p, o) => llamar({ mode: 'tts', ...p }, o),

  texto: (p, o) => llamar({ mode: 'text', ...p }, o),

  imagen: (p, o) => llamar({ mode: 'image', ...p }, o),

  videoIniciar: (p, o) => llamar({ mode: 'video', action: 'start', ...p }, o),

  videoConsultar: (p, o) => llamar({ mode: 'video', action: 'poll', ...p }, { intentos: 2, ...o }),

  firmar: (gcsUri) => llamar({ mode: 'signurl', gcsUri }, { intentos: 2 }),

  bajarGcs: (gcsUri) => llamar({ mode: 'fetchgcs', gcsUri }, { intentos: 2 }),
};

/**
 * Lanza un clip en Veo y espera a que termine.
 * Veo tarda entre uno y varios minutos: se consulta cada 10 s.
 */
export async function generarVideo(params, opciones) {
  const o = opciones || {};
  const inicio = await api.videoIniciar(params, o);
  if (o.aviso) o.aviso('en cola en Veo…');

  const limite = Date.now() + (o.tiempoMaximo || 12 * 60 * 1000);
  let vuelta = 0;

  while (Date.now() < limite) {
    if (o.señal && o.señal.aborted) throw new Cancelado();
    await esperar(vuelta === 0 ? 12000 : 10000);
    vuelta++;
    const est = await api.videoConsultar({
      operationName: inicio.operationName,
      model: inicio.model,
      location: inicio.location,
    }, { señal: o.señal });
    if (est.done) {
      if (est.error) throw new Error(est.error);
      return est;
    }
    if (o.aviso) o.aviso('renderizando en Veo… ' + (vuelta * 10) + ' s');
  }
  throw new Error('Veo no respondió dentro del tiempo máximo. La operación puede seguir viva: ' + inicio.operationName);
}

/* ── Audio: base64 → PCM → WAV ──────────────────────────────── */

export function b64aBytes(b64) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

export function bytesAb64(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

/** Acepta WAV (extrae "data" y la tasa real) o PCM crudo de 16 bits. */
export function extraerPCM(bytes, tasaPorDefecto) {
  let rate = tasaPorDefecto || 24000;
  let pcm = bytes;
  if (bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let i = 12, data = null;
    while (i + 8 <= bytes.length) {
      const id = String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]);
      const size = dv.getUint32(i + 4, true);
      if (id === 'fmt ' && i + 16 <= bytes.length) rate = dv.getUint32(i + 12, true);
      if (id === 'data') { data = bytes.subarray(i + 8, Math.min(i + 8 + size, bytes.length)); break; }
      i += 8 + size + (size % 2);
    }
    pcm = data || bytes.subarray(44);
  }
  if (pcm.length % 2) pcm = pcm.subarray(0, pcm.length - 1);
  return { pcm, rate };
}

export function silencioPCM(rate, segundos) {
  return new Uint8Array(Math.round(rate * segundos) * 2);
}

export function crearWav(partes, rate) {
  let total = 0;
  for (const p of partes) total += p.length;
  const h = new ArrayBuffer(44);
  const dv = new DataView(h);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); dv.setUint32(4, 36 + total, true); ws(8, 'WAVE');
  ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  ws(36, 'data'); dv.setUint32(40, total, true);
  return new Blob([h, ...partes], { type: 'audio/wav' });
}

export function duracionPCM(bytes, rate) {
  return bytes.length / 2 / rate;
}

/** Convierte un Blob en base64 sin cabecera, para mandarlo a Vertex. */
export function blobAb64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result);
      resolve(s.slice(s.indexOf(',') + 1));
    };
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}
