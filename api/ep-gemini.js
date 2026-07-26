// ============================================================
// api/ep-gemini.js — DIEZMO · Estudio de Anime
// Runtime: Node.js (crypto para firmar el JWT RS256 y las URLs V4).
//
// Modos:
//   ping     → diagnóstico de configuración
//   models   → descubre modelos TTS / imagen / video en tu Vertex
//   tts      → audio de narración (Gemini TTS)
//   text     → director de IA, JSON estructurado (Gemini)
//   image    → fotogramas clave, con imágenes de referencia de personaje
//   video    → Veo: action "start" (predictLongRunning) y "poll"
//   signurl  → URL firmada V4 para leer un objeto de GCS desde el navegador
//   fetchgcs → proxy base64 de un objeto pequeño de GCS (respaldo sin CORS)
//
// Variables de entorno en Vercel:
//   GCP_SERVICE_ACCOUNT  (JSON completo de la cuenta de servicio)
//   GCP_PROJECT_ID
//   GCS_BUCKET           (opcional pero recomendado — necesario para Veo largo)
// ============================================================

const crypto = require('crypto');

/* ── Token OAuth2 (cacheado en memoria del proceso) ────────── */
let _tok = { v: null, exp: 0 };

function serviceAccount() {
  const raw = process.env.GCP_SERVICE_ACCOUNT;
  if (!raw) throw new Error('GCP_SERVICE_ACCOUNT no configurado en Vercel');
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error('GCP_SERVICE_ACCOUNT no es un JSON válido');
  }
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (_tok.v && now < _tok.exp - 120) return _tok.v;

  const sa = serviceAccount();
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = b64u({ alg: 'RS256', typ: 'JWT' });
  const payload = b64u({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(header + '.' + payload);
  const sig = signer.sign(sa.private_key).toString('base64url');
  const jwt = header + '.' + payload + '.' + sig;

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:
      'grant_type=' +
      encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') +
      '&assertion=' + jwt,
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('OAuth2 falló: ' + JSON.stringify(j).slice(0, 300));
  _tok = { v: j.access_token, exp: now + (j.expires_in || 3600) };
  return _tok.v;
}

/* ── Helpers Vertex ─────────────────────────────────────────── */
function host(location) {
  return location === 'global'
    ? 'aiplatform.googleapis.com'
    : location + '-aiplatform.googleapis.com';
}

function vertexUrl(location, project, model, metodo) {
  return (
    'https://' + host(location) + '/v1/projects/' + project +
    '/locations/' + location + '/publishers/google/models/' +
    model + ':' + (metodo || 'generateContent')
  );
}

async function callVertex(url, token, body, project) {
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  if (project) headers['X-Goog-User-Project'] = project;
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const raw = await r.text();
  let json = null;
  try { json = JSON.parse(raw); } catch (e) { /* respuesta no-JSON */ }
  return { ok: r.ok, status: r.status, json, raw };
}

function pickInlinePart(json) {
  const parts = json && json.candidates && json.candidates[0] &&
    json.candidates[0].content && json.candidates[0].content.parts;
  if (!parts) return null;
  for (const p of parts) {
    if (p.inlineData && p.inlineData.data) return p.inlineData;
    if (p.inline_data && p.inline_data.data) {
      return { data: p.inline_data.data, mimeType: p.inline_data.mime_type };
    }
  }
  return null;
}

function textoDe(json) {
  const parts = json && json.candidates && json.candidates[0] &&
    json.candidates[0].content && json.candidates[0].content.parts;
  return (parts || []).map((p) => p.text || '').join('');
}

// Motivo humano de un bloqueo del filtro de seguridad, si lo hubo.
function motivoBloqueo(json) {
  if (!json) return null;
  if (json.promptFeedback && json.promptFeedback.blockReason) {
    return 'El prompt fue bloqueado por el filtro (' + json.promptFeedback.blockReason + ')';
  }
  const c = json.candidates && json.candidates[0];
  if (c && c.finishReason && ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'RECITATION', 'IMAGE_SAFETY']
      .indexOf(c.finishReason) !== -1) {
    return 'La respuesta fue bloqueada por el filtro (' + c.finishReason + ')';
  }
  return null;
}

// Filtros permisivos dentro de lo que Vertex permite configurar. La serie es
// seinen oscuro: sin esto, describir una bodega de esclavos dispara falsos positivos.
const SEGURIDAD = [
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_HARASSMENT',
].map((category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' }));

// Los Gemini 3.x solo responden en el endpoint global; el 2.5, en regiones.
function regionesPara(model, location) {
  if (location) return [location];
  if (model.indexOf('gemini-3') === 0) return ['global'];
  return ['us-central1', 'europe-west4', 'us-east4'];
}

// Acepta GCS_BUCKET o GCS_OUTPUT_BUCKET, con o sin el prefijo gs://.
function nombreBucket() {
  const raw = process.env.GCS_BUCKET || process.env.GCS_OUTPUT_BUCKET || '';
  return raw.replace(/^gs:\/\//, '').replace(/\/.*$/, '').trim();
}

/* ── URL firmada V4 para Google Cloud Storage ───────────────── */
function rutaGs(uri) {
  const m = String(uri || '').match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!m) throw new Error('URI de GCS inválida: ' + uri);
  return { bucket: m[1], objeto: m[2] };
}

function encodeObjeto(objeto) {
  return objeto.split('/').map(encodeURIComponent).join('/');
}

function urlFirmadaV4(gsUri, segundos) {
  const sa = serviceAccount();
  const { bucket, objeto } = rutaGs(gsUri);
  const exp = Math.min(Math.max(parseInt(segundos, 10) || 3600, 60), 604800);

  const ahora = new Date();
  const iso = ahora.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const fecha = iso.slice(0, 8);
  const scope = fecha + '/auto/storage/goog4_request';

  const query = [
    ['X-Goog-Algorithm', 'GOOG4-RSA-SHA256'],
    ['X-Goog-Credential', sa.client_email + '/' + scope],
    ['X-Goog-Date', iso],
    ['X-Goog-Expires', String(exp)],
    ['X-Goog-SignedHeaders', 'host'],
  ]
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
    .sort()
    .join('&');

  const canonical = [
    'GET',
    '/' + bucket + '/' + encodeObjeto(objeto),
    query,
    'host:storage.googleapis.com',
    '',
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const hash = crypto.createHash('sha256').update(canonical).digest('hex');
  const stringToSign = ['GOOG4-RSA-SHA256', iso, scope, hash].join('\n');
  const firma = crypto.createSign('RSA-SHA256').update(stringToSign).sign(sa.private_key).toString('hex');

  return 'https://storage.googleapis.com/' + bucket + '/' + encodeObjeto(objeto) +
    '?' + query + '&X-Goog-Signature=' + firma;
}

/* ── Almacén en Google Cloud Storage ────────────────────────── */
/*  El proyecto y todo lo generado viven en el bucket, no en el
    navegador. Se entra desde cualquier aparato y el trabajo está ahí.  */

const RAIZ = 'diezmo/';

function objUrl(bucket, objeto, sufijo) {
  return 'https://storage.googleapis.com/storage/v1/b/' + encodeURIComponent(bucket) +
    '/o/' + encodeURIComponent(objeto) + (sufijo || '');
}

async function gcsSubir(token, bucket, objeto, cuerpo, mime) {
  const u = 'https://storage.googleapis.com/upload/storage/v1/b/' + encodeURIComponent(bucket) +
    '/o?uploadType=media&name=' + encodeURIComponent(objeto);
  const r = await fetch(u, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': mime || 'application/octet-stream' },
    body: cuerpo,
  });
  if (!r.ok) throw new Error('No se pudo guardar en el almacén (' + r.status + ')');
  return true;
}

async function gcsBajar(token, bucket, objeto) {
  const r = await fetch(objUrl(bucket, objeto, '?alt=media'), {
    headers: { Authorization: 'Bearer ' + token },
  });
  return r;
}

async function gcsListar(token, bucket, prefijo) {
  const salida = [];
  let pageToken = '';
  for (let p = 0; p < 40; p++) {
    const u = 'https://storage.googleapis.com/storage/v1/b/' + encodeURIComponent(bucket) +
      '/o?prefix=' + encodeURIComponent(prefijo) + '&maxResults=1000&fields=items(name,size,updated),nextPageToken' +
      (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    const r = await fetch(u, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error('No se pudo listar el almacén (' + r.status + ')');
    const j = await r.json();
    for (const it of (j.items || [])) {
      salida.push({
        clave: String(it.name).slice(prefijo.length),
        bytes: Number(it.size) || 0,
        // Fecha de la última escritura: sirve para saber cuál es la generación
        // más reciente cuando el navegador tiene una copia vieja.
        ts: it.updated ? Date.parse(it.updated) || 0 : 0,
      });
    }
    pageToken = j.nextPageToken || '';
    if (!pageToken) break;
  }
  return salida;
}

async function gcsCopiar(token, bucket, origen, destino) {
  const u = 'https://storage.googleapis.com/storage/v1/b/' + encodeURIComponent(bucket) +
    '/o/' + encodeURIComponent(origen) + '/copyTo/b/' + encodeURIComponent(bucket) +
    '/o/' + encodeURIComponent(destino);
  const r = await fetch(u, { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('No se pudo copiar en el almacén (' + r.status + ')');
  return true;
}

/** Guarda lo recién generado en el bucket, sin interrumpir si falla. */
async function archivar(token, clave, base64, mime) {
  const bucket = nombreBucket();
  if (!bucket || !clave) return false;
  try {
    await gcsSubir(token, bucket, RAIZ + 'material/' + clave, Buffer.from(base64, 'base64'), mime);
    return true;
  } catch (e) {
    return false;
  }
}

/* ── Referencia opaca a un clip ─────────────────────────────── */
/*  El enlace firmado de Google lleva dentro el bucket y el correo de
    la cuenta. En vez de dárselo al navegador, se cifra la ruta con la
    propia llave privada y se entrega un identificador sin sentido.    */

function claveInterna() {
  return crypto.createHash('sha256').update(serviceAccount().private_key).digest();
}

function cifrarRuta(gsUri) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', claveInterna(), iv);
  const dato = Buffer.concat([c.update(String(gsUri), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), dato]).toString('base64url');
}

function descifrarRuta(token) {
  const b = Buffer.from(String(token), 'base64url');
  const d = crypto.createDecipheriv('aes-256-gcm', claveInterna(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

/* ── Censura de salida ──────────────────────────────────────── */
/*  Google incluye el identificador del proyecto en sus mensajes de
    error, y esos mensajes acababan en el navegador. Toda respuesta
    pasa por aquí antes de salir: ningún dato de la cuenta cruza.     */

function censor() {
  const secretos = [];
  const meter = (v) => { if (v && String(v).length > 3) secretos.push(String(v)); };
  meter(process.env.GCP_PROJECT_ID);
  meter(nombreBucket());
  try {
    const sa = serviceAccount();
    meter(sa.client_email);
    meter(sa.client_id);
    meter(sa.private_key_id);
    if (sa.client_email) meter(String(sa.client_email).split('@')[0]);
  } catch (e) { /* sin cuenta configurada: nada que ocultar */ }

  return (texto) => {
    let t = String(texto);
    for (const s of secretos) t = t.split(s).join('\u00ABoculto\u00BB');
    return t
      .replace(/projects?[/=]\s*[^/\s"'&,}]+/gi, 'projects/\u00ABoculto\u00BB')
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.iam\.gserviceaccount\.com/g, '\u00ABcuenta oculta\u00BB')
      .replace(/gs:\/\/[^\s"',}]+/g, 'gs://\u00ABoculto\u00BB')
      .replace(/[?&]project=[^&\s"'}]+/gi, '')
      .replace(/\b\d{10,14}\b/g, '\u00ABoculto\u00BB');
  };
}

// Los campos de carga útil son base64: no contienen secretos y recorrerlos
// costaría megabytes de proceso, además de poder corromperlos.
const SIN_CENSURA = new Set(['audio', 'image', 'video', 'data', 'clip']);

function limpiarProfundo(valor, limpiar, clave) {
  if (SIN_CENSURA.has(clave)) return valor;
  if (typeof valor === 'string') return limpiar(valor);
  if (Array.isArray(valor)) return valor.map((v) => limpiarProfundo(v, limpiar, clave));
  if (valor && typeof valor === 'object') {
    const out = {};
    for (const k of Object.keys(valor)) out[k] = limpiarProfundo(valor[k], limpiar, k);
    return out;
  }
  return valor;
}

/* ── Duraciones que admite cada Veo ─────────────────────────── */
/*  Debe coincidir con DURACIONES en app/veo.js; la auditoría lo comprueba.
    Vertex rechaza la petición si el valor no está en la lista, así que aquí
    se ajusta al más cercano en vez de dejar pasar un 5 o un 7 a un modelo 3.x. */
const DURACIONES_VEO = {
  'veo-3.1-generate-001': [4, 6, 8],
  'veo-3.1-fast-generate-001': [4, 6, 8],
  'veo-3.1-lite-generate-001': [4, 6, 8],
  'veo-2.0-generate-001': [5, 6, 7, 8],
};

function duracionValida(model, pedida) {
  const lista = DURACIONES_VEO[model] || [4, 6, 8];
  const d = Number(pedida);
  if (!isFinite(d) || d <= 0) return lista[lista.length - 1];
  let mejor = lista[0];
  for (const v of lista) {
    const dif = Math.abs(v - d), difMejor = Math.abs(mejor - d);
    if (dif < difMejor || (dif === difMejor && v > mejor)) mejor = v;
  }
  return mejor;
}

/* ── Handler ────────────────────────────────────────────────── */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });

  // Punto único de salida: nada sale sin pasar por la censura.
  const limpiar = censor();
  const jsonOriginal = res.json.bind(res);
  res.json = (cuerpo) => jsonOriginal(limpiarProfundo(cuerpo, limpiar));

  try {
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const mode = body.mode;

    /* ════════ PING — diagnóstico de configuración ════════ */
    // Devuelve solo si cada pieza está bien o mal. Nunca el identificador del
    // proyecto, ni el correo de la cuenta de servicio, ni el nombre del bucket:
    // son datos privados del usuario y no tienen por qué llegar al navegador.
    if (mode === 'ping') {
      const estado = {
        proyecto: !!process.env.GCP_PROJECT_ID,
        cuentaServicio: !!process.env.GCP_SERVICE_ACCOUNT,
        bucket: !!nombreBucket(),
        token: false,
        vertex: false,
      };
      if (estado.proyecto && estado.cuentaServicio) {
        let tk = null;
        try {
          tk = await getAccessToken();
          estado.token = true;
        } catch (e) {
          // El mensaje de error de Google puede incluir el correo de la cuenta.
          estado.errorToken = 'La autenticación con Google Cloud falló. ' +
            'Revisa que GCP_SERVICE_ACCOUNT contenga el JSON completo y sin recortar.';
        }
        // Autenticar no basta: hay que comprobar que Vertex responda de verdad.
        // Una consulta gratuita al catálogo delata la API apagada o sin permisos.
        if (tk) {
          try {
            const r = await fetch(
              'https://us-central1-aiplatform.googleapis.com/v1beta1/publishers/google/models?pageSize=1',
              { headers: { Authorization: 'Bearer ' + tk, 'X-Goog-User-Project': process.env.GCP_PROJECT_ID } }
            );
            if (r.ok) {
              estado.vertex = true;
            } else if (r.status === 403) {
              const cuerpo = await r.text();
              estado.errorVertex = /SERVICE_DISABLED|has not been used in project|is disabled/i.test(cuerpo)
                ? 'La API de Vertex AI (aiplatform.googleapis.com) está apagada en tu proyecto. ' +
                  'Actívala en Google Cloud: menú, APIs y servicios, Biblioteca, busca «Vertex AI API» y pulsa Habilitar. ' +
                  'Tarda un par de minutos en surtir efecto.'
                : 'Vertex AI rechazó la petición por permisos. Revisa que la cuenta de servicio ' +
                  'tenga el rol de Usuario de Vertex AI o Propietario en el proyecto.';
            } else {
              estado.errorVertex = 'Vertex AI respondió con el código ' + r.status + '.';
            }
          } catch (e) {
            estado.errorVertex = 'No se pudo contactar con Vertex AI.';
          }
        }
      }
      return res.status(200).json(estado);
    }

    const project = process.env.GCP_PROJECT_ID;
    if (!project) {
      return res.status(500).json({ error: 'GCP_PROJECT_ID no configurado en Vercel' });
    }
    const token = await getAccessToken();

    /* ════════ TTS — narración por toma ════════ */
    if (mode === 'tts') {
      if (!body.text) return res.status(400).json({ error: 'Falta "text"' });

      const model = body.model || 'gemini-2.5-flash-preview-tts';
      const location =
        body.location || (model.indexOf('gemini-3') === 0 ? 'global' : 'us-central1');

      const texto =
        (body.styleInstruction ? String(body.styleInstruction).trim() + '\n\n' : '') +
        String(body.text);

      const vBody = {
        contents: [{ role: 'user', parts: [{ text: texto }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          temperature: typeof body.temperature === 'number' ? body.temperature : 1.0,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: body.voice || 'Charon' } },
          },
        },
      };
      if (body.languageCode) {
        vBody.generationConfig.speechConfig.languageCode = String(body.languageCode);
      }
      const seedNum = Number(body.seed);
      if (body.seed !== undefined && body.seed !== null && body.seed !== '' && isFinite(seedNum)) {
        vBody.generationConfig.seed = Math.round(seedNum);
      }

      const out = await callVertex(vertexUrl(location, project, model), token, vBody);
      if (!out.ok) {
        return res.status(out.status).json({
          error: 'Vertex TTS ' + out.status,
          detail: (out.raw || '').slice(0, 800),
        });
      }
      const inline = pickInlinePart(out.json);
      if (!inline) {
        return res.status(502).json({
          error: motivoBloqueo(out.json) || 'Respuesta de Vertex sin audio',
          detail: JSON.stringify(out.json).slice(0, 800),
        });
      }
      const mime = inline.mimeType || 'audio/L16;codec=pcm;rate=24000';
      const m = mime.match(/rate=(\d+)/);
      const guardado = await archivar(token, body.guardarComo, inline.data, 'audio/wav');
      return res.status(200).json({
        audio: inline.data,
        mimeType: mime,
        sampleRate: m ? parseInt(m[1], 10) : 24000,
        guardado,
      });
    }

    /* ════════ TEXT — director de IA / JSON estructurado ════════ */
    if (mode === 'text') {
      if (!body.prompt) return res.status(400).json({ error: 'Falta "prompt"' });

      const model = body.model || 'gemini-2.5-pro';
      const location =
        body.location || (model.indexOf('gemini-3') === 0 ? 'global' : 'us-central1');

      const gen = {
        temperature: typeof body.temperature === 'number' ? body.temperature : 0.6,
        maxOutputTokens: body.maxOutputTokens || 32768,
      };
      if (body.json) gen.responseMimeType = 'application/json';
      if (body.schema) gen.responseSchema = body.schema;

      const vBody = {
        contents: [{ role: 'user', parts: [{ text: String(body.prompt) }] }],
        generationConfig: gen,
        safetySettings: SEGURIDAD,
      };
      if (body.system) vBody.systemInstruction = { parts: [{ text: String(body.system) }] };

      const out = await callVertex(vertexUrl(location, project, model), token, vBody);
      if (!out.ok) {
        return res.status(out.status).json({
          error: 'Vertex texto ' + out.status,
          detail: (out.raw || '').slice(0, 800),
        });
      }
      const text = textoDe(out.json);
      if (!text) {
        return res.status(502).json({
          error: motivoBloqueo(out.json) || 'Respuesta de Vertex sin texto',
          detail: JSON.stringify(out.json).slice(0, 800),
        });
      }
      return res.status(200).json({ text, finishReason: (out.json.candidates || [{}])[0].finishReason });
    }

    /* ════════ IMAGE — fotograma clave con referencias ════════ */
    if (mode === 'image') {
      if (!body.prompt) return res.status(400).json({ error: 'Falta "prompt"' });

      const model = body.model || 'gemini-2.5-flash-image';
      const esG3 = model.indexOf('gemini-3') === 0;

      // Solo Gemini genera imagen aceptando referencias visuales. Imagen quedó
      // retirado y además nunca admitió imágenes de personaje como entrada.
      if (!/^gemini-/.test(model)) {
        return res.status(400).json({
          error: 'Modelo de imagen no admitido: ' + model,
          detail: 'Usa un modelo Gemini de imagen (gemini-3-pro-image, ' +
            'gemini-3.1-flash-image o gemini-2.5-flash-image). Son los únicos que ' +
            'aceptan imágenes de referencia, que es lo que mantiene el mismo rostro ' +
            'en todos los episodios.',
        });
      }

      // Primero el enunciado, después las referencias de personaje y lugar.
      const parts = [{ text: String(body.prompt) }];
      for (const ref of (body.images || []).slice(0, 4)) {
        if (ref && ref.data) {
          parts.push({ inlineData: { mimeType: ref.mimeType || 'image/png', data: ref.data } });
        }
      }

      const imageConfig = { aspectRatio: body.aspectRatio || '16:9' };
      // Nano Banana Pro y Nano Banana 2 generan en 1K, 2K y 4K. El 2.5 no
      // acepta el parámetro y siempre entrega en torno a 1K.
      if (body.imageSize && esG3) imageConfig.imageSize = String(body.imageSize);

      const vBody = {
        contents: [{ role: 'user', parts }],
        generationConfig: {
          // El 3.x exige TEXT+IMAGE; el 2.5 solo acepta IMAGE.
          responseModalities: esG3 ? ['TEXT', 'IMAGE'] : ['IMAGE'],
          imageConfig,
          temperature: typeof body.temperature === 'number' ? body.temperature : 1.0,
        },
        safetySettings: SEGURIDAD,
      };

      let last = null;
      for (const loc of regionesPara(model, body.location)) {
        const out = await callVertex(vertexUrl(loc, project, model), token, vBody, project);
        if (out.ok) {
          const inline = pickInlinePart(out.json);
          if (inline) {
            const guardado = await archivar(token, body.guardarComo, inline.data,
              inline.mimeType || 'image/png');
            return res.status(200).json({
              image: inline.data,
              mimeType: inline.mimeType || 'image/png',
              region: loc,
              guardado,
              nota: textoDe(out.json).slice(0, 400) || undefined,
            });
          }
          // Un bloqueo del filtro es determinista: reintentarlo solo hace
          // esperar al usuario para volver a fallar igual. 422 para que el
          // cliente no lo trate como un fallo pasajero.
          const bloqueo = motivoBloqueo(out.json);
          last = bloqueo
            ? { status: 422, motivo: bloqueo, raw: JSON.stringify(out.json).slice(0, 600) }
            : { status: 502, raw: 'Vertex respondió sin imagen: ' + JSON.stringify(out.json).slice(0, 600) };
          break;
        }
        last = out;
        if (out.status !== 429 && out.status !== 503) break; // solo rotar por cuota/capacidad
      }
      return res.status((last && last.status) || 500).json({
        error: (last && last.motivo) || ('Vertex rechazó la imagen (' + ((last && last.status) || '?') + ')'),
        detail: ((last && last.raw) || '').slice(0, 800),
      });
    }

    /* ════════ MUSICA — Lyria 3 ════════ */
    /*  Se llama igual que un modelo de imagen: generateContent con las dos
        modalidades. Devuelve el audio en una parte inlineData (MP3 a 44,1 kHz)
        y, aparte, texto describiendo la estructura de la pieza.               */
    if (mode === 'musica') {
      if (!body.prompt) return res.status(400).json({ error: 'Falta "prompt"' });

      const model = body.model || 'lyria-3-pro-preview';
      if (!/^lyria-/.test(model)) {
        return res.status(400).json({
          error: 'Modelo de música no admitido: ' + model,
          detail: 'Usa lyria-3-pro-preview (pieza de hasta tres minutos) o ' +
            'lyria-3-clip-preview (treinta segundos).',
        });
      }

      const partes = [{ text: String(body.prompt) }];
      // Admite una imagen como inspiración: el fotograma de la escena.
      if (body.image && body.image.data) {
        partes.push({ inlineData: { mimeType: body.image.mimeType || 'image/png', data: body.image.data } });
      }

      const vBody = {
        contents: [{ role: 'user', parts: partes }],
        generationConfig: { responseModalities: ['AUDIO', 'TEXT'] },
        safetySettings: SEGURIDAD,
      };

      // Lyria 3 vive en el endpoint global, como los Gemini 3.
      const out = await callVertex(vertexUrl('global', project, model), token, vBody, project);
      if (!out.ok) {
        return res.status(out.status).json({
          error: 'Vertex música ' + out.status,
          detail: (out.raw || '').slice(0, 800),
        });
      }
      const inline = pickInlinePart(out.json);
      if (!inline) {
        const bloqueo = motivoBloqueo(out.json);
        return res.status(bloqueo ? 422 : 502).json({
          error: bloqueo || 'Lyria respondió sin audio',
          detail: JSON.stringify(out.json).slice(0, 600),
        });
      }
      const guardado = await archivar(token, body.guardarComo, inline.data,
        inline.mimeType || 'audio/mpeg');
      return res.status(200).json({
        audio: inline.data,
        mimeType: inline.mimeType || 'audio/mpeg',
        guardado,
        nota: textoDe(out.json).slice(0, 600) || undefined,
      });
    }

    /* ════════ VIDEO — Veo (operación de larga duración) ════════ */
    if (mode === 'video') {
      const model = body.model || 'veo-3.1-fast-generate-001';
      const location = body.location || 'us-central1';
      const accion = body.action || 'start';

      if (accion === 'start') {
        if (!body.prompt) return res.status(400).json({ error: 'Falta "prompt"' });

        const instancia = { prompt: String(body.prompt) };
        if (body.image && body.image.data) {
          instancia.image = {
            bytesBase64Encoded: body.image.data,
            mimeType: body.image.mimeType || 'image/png',
          };
        }
        if (body.lastFrame && body.lastFrame.data) {
          instancia.lastFrame = {
            bytesBase64Encoded: body.lastFrame.data,
            mimeType: body.lastFrame.mimeType || 'image/png',
          };
        }

        const parameters = {
          aspectRatio: body.aspectRatio || '16:9',
          durationSeconds: duracionValida(model, body.durationSeconds),
          sampleCount: 1,
          generateAudio: body.generateAudio === true,
          personGeneration: body.personGeneration || 'allow_adult',
        };
        if (body.resolution) parameters.resolution = String(body.resolution);
        if (body.negativePrompt) parameters.negativePrompt = String(body.negativePrompt);

        // Con bucket, Veo escribe en GCS y el navegador lo lee con URL firmada:
        // así no chocamos con el límite de tamaño de respuesta de la función.
        const bucket = nombreBucket();
        if (bucket && body.storage !== 'inline') {
          const carpeta = (body.storagePrefix || 'diezmo/video').replace(/^\/+|\/+$/g, '');
          parameters.storageUri = 'gs://' + bucket + '/' + carpeta + '/';
        }

        const out = await callVertex(
          vertexUrl(location, project, model, 'predictLongRunning'),
          token,
          { instances: [instancia], parameters },
          project
        );
        if (!out.ok) {
          return res.status(out.status).json({
            error: 'Veo inicio ' + out.status,
            detail: (out.raw || '').slice(0, 800),
          });
        }
        if (!out.json || !out.json.name) {
          return res.status(502).json({
            error: 'Veo no devolvió operación',
            detail: (out.raw || '').slice(0, 800),
          });
        }
        return res.status(200).json({ operationName: out.json.name, model, location });
      }

      if (accion === 'poll') {
        if (!body.operationName) return res.status(400).json({ error: 'Falta "operationName"' });

        // La región y el modelo se derivan del propio nombre de la operación:
        // así la consulta funciona con cualquier Veo, sin depender del cliente.
        const op = String(body.operationName);
        const recurso = op.split('/operations/')[0];
        const mReg = /\/locations\/([^/]+)\//.exec(op);
        const region = mReg ? mReg[1] : location;
        const url = 'https://' + host(region) + '/v1/' + recurso + ':fetchPredictOperation';

        const out = await callVertex(url, token, { operationName: op }, project);
        if (!out.ok) {
          return res.status(out.status).json({
            error: 'Veo consulta ' + out.status,
            detail: (out.raw || '').slice(0, 800),
          });
        }
        const j = out.json || {};
        if (!j.done) return res.status(200).json({ done: false });

        if (j.error) {
          return res.status(200).json({
            done: true,
            error: j.error.message || JSON.stringify(j.error).slice(0, 400),
          });
        }

        const resp = j.response || {};
        const videos = resp.videos || resp.generatedSamples || [];
        if (!videos.length) {
          const filtrado = resp.raiMediaFilteredReasons || resp.raiMediaFilteredCount;
          return res.status(200).json({
            done: true,
            error: filtrado
              ? 'Veo filtró el clip: ' + JSON.stringify(filtrado).slice(0, 300)
              : 'Operación terminada sin video',
            detail: JSON.stringify(resp).slice(0, 600),
          });
        }

        const v = videos[0];
        const gcsUri = v.gcsUri || (v.video && v.video.uri) || null;
        const salida = { done: true, mimeType: v.mimeType || 'video/mp4' };
        if (gcsUri) {
          salida.clip = cifrarRuta(gcsUri);          // referencia opaca
        } else if (v.bytesBase64Encoded) {
          salida.video = v.bytesBase64Encoded;
        }
        return res.status(200).json(salida);
      }

      return res.status(400).json({ error: 'Acción de video desconocida: ' + accion });
    }

    /* ════════ NUBE — proyecto y material en el bucket ════════ */
    if (mode === 'nube') {
      const bucket = nombreBucket();
      if (!bucket) {
        return res.status(400).json({
          error: 'No hay bucket configurado. Define GCS_BUCKET en Vercel para guardar el ' +
            'proyecto en Google Cloud y poder continuar desde cualquier aparato.',
        });
      }
      const accion = body.action;

      if (accion === 'estadoGuardar') {
        if (!body.estado) return res.status(400).json({ error: 'Falta el estado' });
        await gcsSubir(token, bucket, RAIZ + 'proyecto.json',
          Buffer.from(JSON.stringify(body.estado), 'utf8'), 'application/json');
        return res.status(200).json({ guardado: true });
      }

      if (accion === 'estadoLeer') {
        const r = await gcsBajar(token, bucket, RAIZ + 'proyecto.json');
        if (r.status === 404) return res.status(200).json({ estado: null });
        if (!r.ok) return res.status(r.status).json({ error: 'No se pudo leer el proyecto guardado' });
        return res.status(200).json({ estado: await r.json() });
      }

      if (accion === 'listar') {
        return res.status(200).json({ material: await gcsListar(token, bucket, RAIZ + 'material/') });
      }

      if (accion === 'subir') {
        // La voz se termina de montar en el navegador —se le añade el silencio
        // del corte de escena—, así que el archivo bueno solo existe allí.
        if (!body.clave || !body.datos) return res.status(400).json({ error: 'Faltan clave o datos' });
        const guardado = await archivar(token, body.clave, String(body.datos),
          body.mime || 'application/octet-stream');
        return res.status(200).json({ guardado: !!guardado });
      }

      if (accion === 'leer') {
        if (!body.clave) return res.status(400).json({ error: 'Falta la clave' });
        const r = await gcsBajar(token, bucket, RAIZ + 'material/' + body.clave);
        if (!r.ok) return res.status(r.status).json({ error: 'No se encontró el material' });
        res.setHeader('Content-Type', r.headers.get('content-type') || 'application/octet-stream');
        res.setHeader('Cache-Control', 'private, max-age=86400');
        const lector = r.body.getReader();
        for (;;) {
          const { done, value } = await lector.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
        return res.end();
      }

      if (accion === 'archivarClip') {
        if (!body.clip || !body.clave) return res.status(400).json({ error: 'Faltan datos del clip' });
        let gsUri;
        try { gsUri = descifrarRuta(body.clip); } catch (e) {
          return res.status(400).json({ error: 'Referencia de clip inválida' });
        }
        const { objeto } = rutaGs(gsUri);
        await gcsCopiar(token, bucket, objeto, RAIZ + 'material/' + body.clave);
        return res.status(200).json({ guardado: true });
      }

      if (accion === 'vaciar') {
        const lista = await gcsListar(token, bucket, RAIZ + 'material/');
        let n = 0;
        for (const it of lista) {
          const r = await fetch(objUrl(bucket, RAIZ + 'material/' + it.clave), {
            method: 'DELETE', headers: { Authorization: 'Bearer ' + token },
          });
          if (r.ok) n++;
        }
        return res.status(200).json({ borrados: n });
      }

      return res.status(400).json({ error: 'Acción de nube desconocida: ' + accion });
    }

    /* ════════ CLIP — entrega el video sin revelar su origen ════════ */
    if (mode === 'clip') {
      if (!body.clip) return res.status(400).json({ error: 'Falta la referencia del clip' });
      let gsUri;
      try { gsUri = descifrarRuta(body.clip); } catch (e) {
        return res.status(400).json({ error: 'Referencia de clip inválida o caducada' });
      }
      const { bucket, objeto } = rutaGs(gsUri);
      const u = 'https://storage.googleapis.com/storage/v1/b/' + encodeURIComponent(bucket) +
        '/o/' + encodeURIComponent(objeto) + '?alt=media';
      const r = await fetch(u, { headers: { Authorization: 'Bearer ' + token } });
      if (!r.ok) {
        return res.status(r.status).json({ error: 'No se pudo leer el clip (' + r.status + ')' });
      }
      // Se transmite por partes: así no choca con el límite de respuesta
      // y el navegador jamás ve el bucket ni el enlace firmado.
      res.setHeader('Content-Type', r.headers.get('content-type') || 'video/mp4');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      const lector = r.body.getReader();
      for (;;) {
        const { done, value } = await lector.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      return res.end();
    }

    /* ════════ MODELS — descubrimiento en Model Garden ════════ */
    if (mode === 'models') {
      // Sin Imagen: quedó retirado y nunca aceptó imágenes de referencia,
      // que es justo lo que sostiene la consistencia de los personajes.
      const base = {
        tts: ['gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts'],
        image: ['gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image'],
        video: ['veo-3.1-generate-001', 'veo-3.1-fast-generate-001',
                'veo-3.1-lite-generate-001', 'veo-2.0-generate-001'],
        text: ['gemini-3.1-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'],
      };
      const sets = {
        tts: new Set(base.tts), image: new Set(base.image),
        video: new Set(base.video), text: new Set(base.text),
      };
      let fuente = 'lista base (no se pudo consultar Model Garden)';
      try {
        let pageToken = '';
        let alguna = false;
        for (let pag = 0; pag < 8; pag++) {
          const u = 'https://us-central1-aiplatform.googleapis.com/v1beta1/publishers/google/models?pageSize=200' +
            (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
          const r = await fetch(u, { headers: { Authorization: 'Bearer ' + token } });
          if (!r.ok) break;
          alguna = true;
          const j = await r.json();
          for (const m of (j.publisherModels || [])) {
            const id = String(m.name || '').split('/').pop();
            const l = id.toLowerCase();
            if (l.indexOf('imagen') === 0) continue;              // retirado
            if (l.indexOf('tts') !== -1) sets.tts.add(id);
            else if (l.indexOf('veo') === 0) sets.video.add(id);
            else if (l.indexOf('gemini') === 0 && l.indexOf('image') !== -1) sets.image.add(id);
            else if (l.indexOf('gemini') === 0) sets.text.add(id);
          }
          pageToken = j.nextPageToken || '';
          if (!pageToken) break;
        }
        if (alguna) fuente = 'Vertex Model Garden + lista base';
      } catch (e) { /* silencioso: cae a la lista base */ }

      return res.status(200).json({
        fuente,
        tts: Array.from(sets.tts).sort(),
        image: Array.from(sets.image).sort(),
        video: Array.from(sets.video).sort(),
        text: Array.from(sets.text).sort(),
      });
    }

    return res.status(400).json({ error: 'Modo desconocido: ' + mode });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
