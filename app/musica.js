/* ============================================================
   musica.js — la música de fondo, escena por escena
   ============================================================
   Lyria 3 se llama igual que un modelo de imagen: generateContent
   con responseModalities ['AUDIO','TEXT']. Devuelve el audio en
   una parte inlineData y, aparte, texto describiendo la
   estructura de la pieza.

   Una pieza por escena. Cobra por pieza y no por segundo, así que
   una de tres minutos cuesta lo mismo que una de treinta: no hay
   ningún motivo para escatimar.
   ============================================================ */

import { api } from './api.js';

export const MODELOS_MUSICA = [
  ['lyria-3-pro-preview', 'Lyria 3 Pro — pieza completa de hasta tres minutos'],
  ['lyria-3-clip-preview', 'Lyria 3 — clip de treinta segundos'],
];

export const DURACION_MAXIMA = { 'lyria-3-pro-preview': 184, 'lyria-3-clip-preview': 30 };

// Dólares por pieza generada, de la tarifa oficial. No depende de la duración.
export const TARIFA_MUSICA = { 'lyria-3-pro-preview': 0.08, 'lyria-3-clip-preview': 0.04 };

export function precioPieza(modelo) {
  return TARIFA_MUSICA[modelo] || 0.08;
}

export function duracionMaxima(modelo) {
  return DURACION_MAXIMA[modelo] || 184;
}

/* ── Escenas ────────────────────────────────────────────────── */

/**
 * Agrupa las tomas de un episodio por escena, con su duración real y su texto.
 * La música se hace por escena, no por toma: una pieza que cambiara cada ocho
 * segundos sería ruido, no banda sonora.
 */
export function escenasDe(ep) {
  const mapa = new Map();
  for (const t of ep.tomas || []) {
    const n = t.escena;
    if (!mapa.has(n)) mapa.set(n, { escena: n, desde: t.i, hasta: t.i, segundos: 0, textos: [], emociones: [] });
    const e = mapa.get(n);
    e.hasta = t.i;
    e.segundos += t.segundos || t.segEstimados || 0;
    e.textos.push(t.texto);
    if (t.plano && t.plano.emocion) e.emociones.push(t.plano.emocion);
  }
  return [...mapa.values()].sort((a, b) => a.escena - b.escena);
}

/** La emoción que más se repite en la escena, que es la que manda en el tono. */
function emocionDominante(emociones) {
  const cuenta = new Map();
  for (const e of emociones) cuenta.set(e, (cuenta.get(e) || 0) + 1);
  let mejor = '', n = 0;
  for (const [k, v] of cuenta) if (v > n) { mejor = k; n = v; }
  return mejor;
}

/* ── El encargo musical ─────────────────────────────────────── */

const SISTEMA_MUSICA =
  'Eres el compositor de la banda sonora de DIEZMO, un anime seinen de ciencia ficción oscura. ' +
  'Una civilización alienígena exige diez millones de humanos entregados voluntariamente y los ' +
  'gobiernos de la Tierra fabrican el consentimiento con una mentira. El horror es burocrático y ' +
  'cortés, nunca gore. Recibes las escenas de un episodio y escribes el encargo musical de cada ' +
  'una. Reglas innegociables:\n' +
  '1. La música es SIEMPRE instrumental. Nunca voces, nunca coros con letra, nunca palabras ' +
  'cantadas: encima va la voz de un narrador y cualquier voz cantada competiría con ella.\n' +
  '2. Escribe para acompañar, no para protagonizar. Registro medio y grave, sin agudos ' +
  'penetrantes, sin percusión seca que se coma la dicción.\n' +
  '3. Describe género, instrumentación concreta, tempo aproximado, y cómo evoluciona a lo largo ' +
  'de la escena: si crece, si se sostiene o si se apaga.\n' +
  '4. Varía entre escenas. Doce episodios con la misma cuerda sombría es un error.\n' +
  '5. Escribes en español, en dos o tres frases por escena. Nada de títulos ni de explicaciones.';

const ESQUEMA_MUSICA = {
  type: 'object',
  properties: {
    escenas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          escena: { type: 'integer' },
          encargo: { type: 'string' },
        },
        required: ['escena', 'encargo'],
      },
    },
  },
  required: ['escenas'],
};

function recorte(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ');
  return t.length > n ? t.slice(0, n).replace(/[^ ]*$/, '') + '…' : t;
}

/**
 * Pide al modelo de texto un encargo musical por escena. Una sola llamada por
 * episodio: doce en toda la temporada, que es calderilla al lado de la música.
 */
export async function encargarMusica(ep, ctx, opciones) {
  const o = opciones || {};
  const escenas = escenasDe(ep);
  const prompt = [
    'EPISODIO ' + ep.num + ': ' + ep.titulo,
    '',
    'ESCENAS (' + escenas.length + '). Devuelve un encargo por cada número de escena:',
    '',
    escenas.map((e) =>
      '[' + e.escena + '] ' + Math.round(e.segundos) + ' s' +
      (emocionDominante(e.emociones) ? ' · tono dominante: ' + emocionDominante(e.emociones) : '') +
      '\n' + recorte(e.textos.join(' '), 700)).join('\n\n'),
  ].join('\n');

  let datos = null;
  try {
    const r = await api.texto({
      prompt, system: SISTEMA_MUSICA, model: ctx.modeloTexto,
      json: true, schema: ESQUEMA_MUSICA, temperature: 0.9, maxOutputTokens: 16384,
    }, { intentos: 3, señal: o.señal, aviso: o.aviso });
    datos = JSON.parse(r.text);
  } catch (e) {
    if (e && e.cancelado) throw e;
    if (o.aviso) o.aviso('no se pudo encargar la música: ' + e.message + ' — se usa un encargo genérico');
  }

  const porEscena = new Map();
  for (const x of ((datos && datos.escenas) || [])) porEscena.set(x.escena, x.encargo);

  return escenas.map((e) => ({
    ...e,
    encargo: porEscena.get(e.escena) ||
      'Ambiente instrumental sombrío y contenido, cuerdas graves sostenidas y un pulso electrónico ' +
      'muy lento al fondo, sin percusión marcada. Se mantiene igual de principio a fin.',
  }));
}

/** El prompt final que recibe Lyria, con las salvaguardas que no se negocian. */
export function promptMusica(escena, ctx) {
  const seg = Math.max(20, Math.min(duracionMaxima(ctx.modeloMusica), Math.round(escena.segundos)));
  return [
    'Pieza instrumental para la banda sonora de un anime seinen de ciencia ficción oscura.',
    '',
    escena.encargo,
    '',
    'Duración objetivo: alrededor de ' + seg + ' segundos.',
    'ESTRICTAMENTE INSTRUMENTAL: sin voces, sin coro con letra, sin palabras cantadas ni habladas. ' +
    'Encima de esta música va la voz de un narrador, así que deja sitio: registro medio y grave, ' +
    'sin agudos punzantes, dinámica contenida y sin silencios bruscos.',
    'Producción limpia, estéreo amplio, sin distorsión.',
  ].join('\n');
}

/** Cuántas piezas y cuánto cuesta poner música a un episodio. */
export function costeMusica(ep, modelo) {
  const piezas = escenasDe(ep).length;
  return { piezas, dolares: piezas * precioPieza(modelo) };
}
