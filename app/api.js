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

/*  Cuando el fallo lo devuelve la plataforma y no nuestro backend, el cuerpo no
    es JSON y lo único que queda es el código. Traducirlo aquí evita que el
    usuario tenga que interpretar un "HTTP 413" para poder contarnos qué pasó. */
const POR_CODIGO = {
  400: 'La petición iba mal formada. Es un fallo de la herramienta, no de tu cuenta.',
  401: 'Google rechazó las credenciales. Revisa la cuenta de servicio en las variables de entorno.',
  403: 'Google denegó el permiso. Suele ser la API de Vertex sin habilitar o un rol que falta.',
  404: 'Google no encontró el modelo. Puede que ese modelo no exista en la región que se está usando.',
  413: 'Se pidió más de lo que cabe en una llamada (4,5 MB de ida o de vuelta). ' +
       'Ocurre con imágenes de referencia muy grandes o con demasiada voz de una vez.',
  429: 'Se ha agotado la cuota de Google por ahora. Espera unos minutos y reintenta.',
  500: 'Error interno del servidor.',
  502: 'Google respondió, pero sin imagen. Casi siempre es el filtro de contenido.',
  503: 'Google no tiene capacidad en este momento. Suele resolverse reintentando.',
  504: 'El servidor cortó la espera al minuto, que es su máximo. Casi siempre significa ' +
       'que se pidió demasiado de una vez: menos texto por llamada, o menos resolución.',
};

/*  Mientras la pestaña está en segundo plano, el navegador del móvil congela
    las peticiones en curso y rechaza las nuevas: se ve como «Load failed», que
    no dice nada. No sirve de nada reintentar contra una pestaña dormida, así
    que se espera a que vuelva a estar delante.                               */
function esperarVisible(señal) {
  if (typeof document === 'undefined' || !document.hidden) return Promise.resolve();
  return new Promise((listo) => {
    const mirar = () => {
      if (document.hidden && !(señal && señal.aborted)) return;
      document.removeEventListener('visibilitychange', mirar);
      listo();
    };
    document.addEventListener('visibilitychange', mirar);
    if (señal) señal.addEventListener('abort', mirar, { once: true });
  });
}

async function crudo(cuerpo, señal) {
  let r;
  try {
    r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: señal,
    });
  } catch (e) {
    // fetch falla antes de que exista respuesta: no hay código de estado.
    if (e && e.name === 'AbortError') throw e;
    const err = new Error('Se cortó la conexión con el servidor. Suele pasar cuando el ' +
      'teléfono se bloquea o cambias de aplicación mientras genera.');
    err.red = true;
    throw err;
  }
  let j = {};
  try { j = await r.json(); } catch (e) { /* respuesta vacía o no-JSON */ }
  if (!r.ok) {
    // El backend pone la causa en "error" y el volcado crudo en "detail". Si no
    // hay ninguno de los dos, el fallo es de la plataforma y solo queda el código.
    const msg = j.error || POR_CODIGO[r.status] || ('Error ' + r.status);
    const pista = j.error && POR_CODIGO[r.status] ? ' · ' + POR_CODIGO[r.status] : '';
    const det = j.detail ? ' — ' + String(j.detail).slice(0, 400) : '';
    const err = new Error('[' + r.status + '] ' + msg + pista + det);
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
  let n = 0;

  while (true) {
    n++;
    if (señal && señal.aborted) throw new Cancelado();
    // Si la app está en segundo plano, esperar aquí en vez de fallar fuera.
    await esperarVisible(señal);
    if (señal && señal.aborted) throw new Cancelado();
    try {
      return await crudo(cuerpo, señal);
    } catch (e) {
      if (e.name === 'AbortError') throw new Cancelado();
      ultimo = e;
      const red = !!e.red || !e.status;
      /*  Hay llamadas que saben recuperarse mejor que reintentando lo mismo:
          la voz, ante un 504, parte el texto en dos en vez de volver a esperar
          otro minuto entero. Quien lo sepa lo dice en "finales".             */
      const final = !red && o.finales && o.finales.indexOf(e.status) !== -1;
      const transitorio = !final && (red || e.status === 429 || e.status === 503 ||
        e.status === 500 || e.status === 502 || e.status === 504);
      /*  Un corte de red no es lo mismo que un rechazo del servidor: no hay
          nada que corregir, solo esperar a tener conexión otra vez. Se le da
          más margen y esperas más largas, porque tres intentos en seis
          segundos caen todos dentro del mismo bache.                        */
      const limite = red ? intentos + 4 : intentos;
      if (!transitorio || n >= limite) break;
      const espera = red
        ? Math.min(45000, 4000 * n)
        : (e.status === 429 ? 8000 : 2000) * n;
      if (o.aviso) {
        o.aviso((red ? 'sin conexión; ' : '') + 'reintento ' + (n + 1) + '/' + limite +
          ' en ' + Math.round(espera / 1000) + ' s');
      }
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

  musica: (p, o) => llamar({ mode: 'musica', ...p }, o),

  videoIniciar: (p, o) => llamar({ mode: 'video', action: 'start', ...p }, o),

  videoConsultar: (p, o) => llamar({ mode: 'video', action: 'poll', ...p }, { intentos: 2, ...o }),

  vozLargaIniciar: (p, o) => llamar({ mode: 'vozlarga', action: 'start', ...p }, o),

  vozLargaConsultar: (p, o) => llamar({ mode: 'vozlarga', action: 'poll', ...p }, { intentos: 2, ...o }),

  vozLargaProbar: (p, o) => llamar({ mode: 'vozlarga', action: 'prueba', ...p }, { intentos: 2, ...o }),

  vozLargaVoces: (o) => llamar({ mode: 'vozlarga', action: 'voces' }, { intentos: 2, ...o }),

  montarIniciar: (p, o) => llamar({ mode: 'montar', action: 'start', ...p }, o),

  montarConsultar: (p, o) => llamar({ mode: 'montar', action: 'poll', ...p }, { intentos: 2, ...o }),

};

/**
 * Manda montar el episodio en la nube y espera al MP4.
 * Dieciséis minutos de 1080p tardan lo suyo: se consulta cada 15 s.
 *
 * @returns {string} referencia opaca del MP4, para descargarlo con bajarClip
 */
export async function montarEpisodio(params, opciones) {
  const o = opciones || {};
  const inicio = await api.montarIniciar(params, o);
  if (o.aviso) o.aviso('encargo enviado al montador…');

  const limite = Date.now() + (o.tiempoMaximo || 90 * 60 * 1000);
  let vuelta = 0;

  while (Date.now() < limite) {
    if (o.señal && o.señal.aborted) throw new Cancelado();
    await esperar(vuelta === 0 ? 20000 : 15000);
    vuelta++;
    // El episodio viaja también en la consulta: si el montador dejó escrito por
    // qué murió, el backend sabe en qué carpeta buscar la nota.
    const est = await api.montarConsultar(
      { operationName: inicio.operationName, episodio: params.episodio },
      { señal: o.señal }
    );
    if (est.done) {
      if (est.error) throw new Error(est.error);
      return inicio.salida;
    }
    if (o.aviso) o.aviso('montando… ' + Math.round(vuelta * 15 / 60) + ' min');
  }
  throw new Error('El montaje tardó más de lo previsto. Mira las ejecuciones del ' +
    'montador en Cloud Run: si terminó, el MP4 ya está en el bucket.');
}

/**
 * Narra un episodio entero de una vez y espera a que Cloud TTS lo escriba en
 * el bucket. Quince minutos de audio tardan un rato: se consulta cada 8 s.
 *
 * @returns {string} la referencia opaca del WAV, para descargarlo con bajarClip
 */
export async function generarVozLarga(params, opciones) {
  const o = opciones || {};
  /*  Long Audio Synthesis es un servicio por lotes: un episodio de dieciséis
      minutos puede tardar HORAS, no minutos. Si ya había una operación en
      marcha se retoma en vez de empezar otra —y de pagarla otra vez—.       */
  const inicio = o.operacion
    ? { operationName: o.operacion, destino: o.destino }
    : await api.vozLargaIniciar(params, o);
  if (!o.operacion && o.alEmpezar) await o.alEmpezar(inicio);
  if (o.aviso) o.aviso(o.operacion ? 'retomando la narración en curso…' : 'en cola…');

  const limite = Date.now() + (o.tiempoMaximo || 5 * 60 * 60 * 1000);
  const arranque = Date.now();
  let vuelta = 0;

  while (Date.now() < limite) {
    if (o.señal && o.señal.aborted) throw new Cancelado();
    await esperar(vuelta === 0 ? 10000 : 20000);
    vuelta++;
    const est = await api.vozLargaConsultar(
      { operationName: inicio.operationName },
      { señal: o.señal }
    );
    if (est.done) {
      if (est.error) throw new Error(est.error);
      return inicio.destino;
    }
    if (o.aviso) {
      /*  Con el porcentaje se puede estimar lo que falta, y saber si faltan
          diez minutos o dos horas cambia lo que uno hace con el teléfono.   */
      const min = (Date.now() - arranque) / 60000;
      const queda = est.progreso > 1
        ? ' · quedan unos ' + Math.max(1, Math.round(min * (100 - est.progreso) / est.progreso)) + ' min'
        : '';
      o.aviso('narrando… ' + Math.round(est.progreso || 0) + ' %' + queda);
    }
  }
  throw new Error('La narración sigue en marcha en Google, pero se dejó de esperar. ' +
    'Vuelve a pulsar «Generar la voz» y se retoma donde iba, sin pagarla otra vez.');
}

/** Descarga el clip por su referencia opaca. El navegador nunca ve el origen. */
export async function bajarClip(clip, señal) {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'clip', clip }),
    signal: señal,
  });
  if (!r.ok) {
    let j = {};
    try { j = await r.json(); } catch (e) { /* respuesta no-JSON */ }
    throw new Error(j.error || ('No se pudo descargar el clip (' + r.status + ')'));
  }
  return r.blob();
}

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

/* ── Referencias visuales: ligeras a propósito ───────────────── */

/*  Una hoja de 2K en PNG pesa unos 2,3 MB, y en base64 dentro del JSON
    pasa de 3 MB. El cuerpo de una petición no puede pasar de 4,5 MB, así
    que una sola referencia ya va en el filo y tres (un fotograma con
    varios personajes) es imposible.

    Reducirlas no cuesta calidad: el modelo mira las referencias a través
    de su codificador visual, que trabaja en torno a mil píxeles de lado.
    Todo lo que sobra de ahí se descarta antes de que el modelo lo vea.
    La imagen que se GENERA sigue saliendo a la resolución configurada. */

export const LADO_REFERENCIA = 1024;

function lienzo(w, h) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function aBlob(c, tipo, calidad) {
  if (c.convertToBlob) return c.convertToBlob({ type: tipo, quality: calidad });
  return new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('el lienzo no devolvió imagen'))), tipo, calidad));
}

async function mapaDeBits(blob) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  // Safari antiguo: se pasa por un <img>, que siempre está.
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('no se pudo leer la imagen'));
      im.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/**
 * Prepara un Blob de imagen como referencia para Vertex: lo reduce al lado
 * máximo indicado y lo recodifica en JPEG. Si algo del camino no está
 * disponible en este navegador, devuelve la imagen original sin tocar.
 *
 * @returns {{data:string, mimeType:string}} listo para el campo images
 */
export async function comoReferencia(blob, maxLado) {
  const lim = maxLado || LADO_REFERENCIA;
  try {
    const bmp = await mapaDeBits(blob);
    const w = bmp.width || bmp.naturalWidth;
    const h = bmp.height || bmp.naturalHeight;
    if (!w || !h) throw new Error('imagen sin dimensiones');

    const f = Math.min(1, lim / Math.max(w, h));
    const nw = Math.max(1, Math.round(w * f));
    const nh = Math.max(1, Math.round(h * f));

    const c = lienzo(nw, nh);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, nw, nh);
    if (bmp.close) bmp.close();

    const jpg = await aBlob(c, 'image/jpeg', 0.92);
    // Si por lo que sea no adelgaza, no merece la pena perder el original.
    if (jpg.size < blob.size) return { data: await blobAb64(jpg), mimeType: 'image/jpeg' };
  } catch (e) { /* navegador sin lienzo: se manda tal cual */ }
  return { data: await blobAb64(blob), mimeType: blob.type || 'image/png' };
}
