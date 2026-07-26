/* ============================================================
   director.js — el pase de dirección
   ============================================================
   La segmentación del texto es determinista (texto.js): ninguna
   palabra se pierde. Aquí la IA solo decide CÓMO SE VE cada toma:
   lugar, personajes en cuadro, encuadre, luz, movimiento.
   ============================================================ */

import { api } from './api.js';
import { ENCUADRES, MOVIMIENTOS } from './biblia.js';

const ESQUEMA = {
  type: 'object',
  properties: {
    tomas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer' },
          lugar: { type: 'string' },
          personajes: { type: 'array', items: { type: 'string' } },
          encuadre: { type: 'string' },
          movimiento: { type: 'string' },
          descripcion: { type: 'string' },
          luz: { type: 'string' },
          emocion: { type: 'string' },
          accionVideo: { type: 'string' },
          prioridad: { type: 'integer' },
        },
        required: ['i', 'lugar', 'personajes', 'encuadre', 'movimiento',
          'descripcion', 'luz', 'emocion', 'accionVideo', 'prioridad'],
      },
    },
  },
  required: ['tomas'],
};

const SISTEMA =
  'Eres director de fotografía y storyboarder de un anime seinen de ciencia ficción oscura. ' +
  'Recibes fragmentos consecutivos de la narración de un episodio y decides el plano visual de ' +
  'cada uno. Trabajas en español. Reglas innegociables:\n' +
  '1. Devuelves EXACTAMENTE una entrada por cada fragmento recibido, con su mismo índice "i".\n' +
  '2. "descripcion" describe SOLO lo que se ve en el fotograma: sujetos, posición, acción ' +
  'congelada, fondo. Nunca narras, nunca explicas la trama, nunca mencionas sonido ni voz.\n' +
  '3. Nunca escribas texto, carteles legibles, subtítulos ni letras dentro de la imagen. Si el ' +
  'guion menciona un cartel o una pantalla con texto, descríbelo como superficie luminosa sin letras.\n' +
  '4. "personajes" solo admite identificadores de la lista de elenco. Si en el plano no hay nadie ' +
  'reconocible, devuelve una lista vacía. Máximo tres personajes por plano.\n' +
  '5. "lugar" solo admite identificadores de la lista de localizaciones.\n' +
  '6. Varía los encuadres: una secuencia de veinte primeros planos seguidos es un error. ' +
  'Alterna escala, altura y distancia como lo haría un anime de verdad.\n' +
  '7. "accionVideo" describe el movimiento real de ocho segundos que tendría ese plano si se ' +
  'animara: qué se mueve, en qué dirección, a qué velocidad. Sin cortes ni cambios de plano.\n' +
  '8. "prioridad" de 1 a 5: cuánto gana ese plano si se anima de verdad en lugar de quedarse ' +
  'como fotograma con movimiento de cámara. 5 = movimiento imprescindible (una nave que llega, ' +
  'misiles cayendo, algo que se desvanece). 1 = una cara quieta escuchando.';

function fichaCorta(f, n) {
  const s = String(f || '').replace(/\s+/g, ' ');
  return s.length > n ? s.slice(0, n).replace(/[^ ]*$/, '') + '…' : s;
}

function armarPrompt(ctx) {
  const { episodio, elenco, lugares, tomas, resumenPrevio } = ctx;

  const elencoTxt = elenco
    .map((p) => '- ' + p.id + ' (' + p.nombre + '): ' + fichaCorta(p.ficha, 160))
    .join('\n');
  const lugaresTxt = lugares
    .map((l) => '- ' + l.id + ' (' + l.nombre + '): ' + fichaCorta(l.ficha, 130))
    .join('\n');
  const tomasTxt = tomas
    .map((t) => '[' + t.i + '] ' + t.texto.replace(/\s+/g, ' '))
    .join('\n\n');

  return [
    'SERIE: DIEZMO — anime seinen de ciencia ficción oscura. Una civilización alienígena exige diez',
    'millones de humanos entregados voluntariamente; los gobiernos de la Tierra fabrican el',
    'consentimiento con una mentira. El horror es burocrático y cortés, nunca gore.',
    '',
    'EPISODIO ' + episodio.num + ': ' + episodio.titulo,
    '',
    'ELENCO DISPONIBLE (usa solo estos identificadores):',
    elencoTxt,
    '',
    'LOCALIZACIONES DISPONIBLES (usa solo estos identificadores):',
    lugaresTxt,
    '',
    'ENCUADRES POSIBLES: ' + ENCUADRES.join(', '),
    'MOVIMIENTOS DE CÁMARA POSIBLES: ' + MOVIMIENTOS.join(', '),
    '',
    resumenPrevio ? 'DÓNDE VENÍAMOS: ' + resumenPrevio + '\n' : '',
    'FRAGMENTOS A PLANIFICAR (' + tomas.length + '). Devuelve una entrada por cada índice:',
    '',
    tomasTxt,
  ].filter(Boolean).join('\n');
}

function respaldo(t, lugares) {
  return {
    i: t.i,
    lugar: (lugares[0] && lugares[0].id) || 'tokio',
    personajes: [],
    encuadre: 'plano general',
    movimiento: 'travelling de acercamiento lento',
    descripcion: 'Plano atmosférico del entorno de la escena, sin figuras en primer término.',
    luz: 'contraluz frío',
    emocion: 'tensión contenida',
    accionVideo: 'Deriva muy lenta de la cámara hacia delante; partículas suspendidas en el aire.',
    prioridad: 2,
    respaldo: true,
  };
}

/**
 * Planifica un episodio entero. Trabaja por lotes para no saturar la respuesta
 * y avisa del progreso por callback.
 *
 * @returns {Array} una entrada de plano por cada toma, en orden
 */
export async function dirigirEpisodio(ctx, opciones) {
  const o = opciones || {};
  const lote = o.lote || 18;
  const { tomas, elenco, lugares } = ctx;
  const idsLugar = new Set(lugares.map((l) => l.id));
  const idsElenco = new Set(elenco.map((p) => p.id));

  const planos = new Array(tomas.length).fill(null);
  let resumenPrevio = '';

  for (let inicio = 0; inicio < tomas.length; inicio += lote) {
    if (o.señal && o.señal.aborted) throw new Error('__CANCELADO__');
    const grupo = tomas.slice(inicio, inicio + lote);
    if (o.progreso) {
      o.progreso(inicio, tomas.length, 'planificando tomas ' + (inicio + 1) + '–' + (inicio + grupo.length));
    }

    const prompt = armarPrompt({ ...ctx, tomas: grupo, resumenPrevio });

    let datos = null;
    try {
      const r = await api.texto({
        prompt,
        system: SISTEMA,
        model: ctx.modelo,
        json: true,
        schema: ESQUEMA,
        temperature: 0.7,
        maxOutputTokens: 32768,
      }, { intentos: 3, señal: o.señal, aviso: o.aviso });
      datos = JSON.parse(r.text);
    } catch (e) {
      if (e && e.cancelado) throw e;
      if (o.aviso) o.aviso('lote ' + (inicio + 1) + ': ' + (e.message || e) + ' — se usa respaldo');
    }

    const porIndice = new Map();
    for (const p of ((datos && datos.tomas) || [])) {
      if (typeof p.i === 'number') porIndice.set(p.i, p);
    }

    for (const t of grupo) {
      const p = porIndice.get(t.i);
      if (!p) { planos[t.i] = respaldo(t, lugares); continue; }
      planos[t.i] = {
        i: t.i,
        lugar: idsLugar.has(p.lugar) ? p.lugar : (lugares[0] && lugares[0].id),
        personajes: (p.personajes || []).filter((x) => idsElenco.has(x)).slice(0, 3),
        encuadre: String(p.encuadre || 'plano medio'),
        movimiento: String(p.movimiento || 'cámara fija'),
        descripcion: String(p.descripcion || '').trim(),
        luz: String(p.luz || '').trim(),
        emocion: String(p.emocion || '').trim(),
        accionVideo: String(p.accionVideo || '').trim(),
        prioridad: Math.min(5, Math.max(1, parseInt(p.prioridad, 10) || 2)),
      };
    }

    const ultimo = planos[grupo[grupo.length - 1].i];
    resumenPrevio = ultimo
      ? 'último plano planificado — ' + ultimo.encuadre + ' en ' + ultimo.lugar + ': ' + ultimo.descripcion
      : '';
  }

  return planos;
}

/**
 * Decide qué tomas se animan de verdad con Veo y cuáles se quedan como
 * fotograma con movimiento de cámara. Respeta la proporción configurada
 * y siempre anima los planos de prioridad 5.
 */
export function repartirMovimiento(planos, proporcion) {
  const n = planos.length;
  const cupo = Math.round(n * Math.min(Math.max(proporcion, 0), 1));
  const orden = planos
    .map((p, i) => ({ i, prio: p ? p.prioridad : 1 }))
    .sort((a, b) => b.prio - a.prio || a.i - b.i);

  const animadas = new Set();
  for (const { i, prio } of orden) {
    if (prio === 5) { animadas.add(i); continue; }
    if (animadas.size < cupo) animadas.add(i);
  }
  return planos.map((p, i) => ({ ...p, tipo: animadas.has(i) ? 'movimiento' : 'fijo' }));
}

/* ── Ensamblado de prompts finales ──────────────────────────── */

/**
 * Construye el prompt de imagen de una toma. El estilo y las fichas se
 * añaden aquí, del lado del cliente, para que sean idénticos en las mil
 * tomas de la temporada.
 */
export function promptImagen(plano, ctx) {
  const { estilo, elenco, lugares, negativo } = ctx;
  const lugar = lugares.find((l) => l.id === plano.lugar);
  const personajes = (plano.personajes || [])
    .map((id) => elenco.find((p) => p.id === id))
    .filter(Boolean);

  const partes = [
    'FOTOGRAMA DE ANIME. ' + estilo,
    '',
    'ENCUADRE: ' + plano.encuadre + '.',
    'LO QUE SE VE: ' + plano.descripcion,
  ];

  if (lugar) partes.push('LUGAR: ' + lugar.nombre + '. ' + lugar.ficha);

  if (personajes.length) {
    const conRef = personajes.filter((p) => p.refs && p.refs.length);
    if (conRef.length) {
      partes.push(
        'PERSONAJES EN CUADRO — las imágenes de referencia adjuntas definen su aspecto exacto: ' +
        conRef.map((p, k) => 'la imagen ' + (k + 1) + ' es ' + p.nombre).join('; ') + '. ' +
        'Conserva sus rasgos faciales, peinado, ropa y proporciones sin variación alguna.'
      );
    }
    partes.push(personajes.map((p) => p.nombre + ': ' + p.ficha).join(' '));
  } else {
    partes.push('Sin personajes identificables en primer término.');
  }

  partes.push('ILUMINACIÓN: ' + plano.luz + '.');
  partes.push('ATMÓSFERA: ' + plano.emocion + '.');
  partes.push('Composición pensada para ' + (ctx.formato || '16:9') + '.');
  if (ctx.calidad) partes.push(ctx.calidad);
  partes.push('EVITAR: ' + negativo);

  return partes.join('\n');
}

/** Prompt de movimiento para Veo, partiendo del fotograma ya aprobado. */
export function promptVideo(plano, ctx) {
  return [
    'Anima este fotograma de anime manteniendo intactos el estilo de dibujo, la paleta y el diseño ' +
    'de los personajes. Animación 2D japonesa, cadencia de anime, sin cambiar de plano.',
    'MOVIMIENTO: ' + (plano.accionVideo || 'movimiento mínimo y contenido en la escena'),
    'CÁMARA: ' + plano.movimiento + '.',
    'ATMÓSFERA: ' + plano.emocion + '.',
    'No introduzcas cortes, ni texto, ni personajes nuevos. No cambies la ropa ni el peinado.',
  ].join('\n');
}

/** Prompt de hoja de referencia de un personaje. */
export function promptReferencia(personaje, ctx, variante) {
  const base = [
    'HOJA DE REFERENCIA DE PERSONAJE para un anime. ' + ctx.estilo,
    '',
    'PERSONAJE: ' + personaje.nombre + '. ' + personaje.ficha,
  ];

  if (variante === 'hoja') {
    base.push(
      'Composición: UN SOLO personaje, el mismo, mostrado tres veces sobre un fondo gris neutro y ' +
      'liso: de frente, de perfil y de espaldas. Las tres figuras de cuerpo entero, grandes, ' +
      'alineadas a la misma altura y ocupando todo el alto del encuadre. Iluminación plana y ' +
      'uniforme de estudio, sin sombras dramáticas, sin escenario, sin objetos. Expresión neutra.'
    );
  } else if (variante === 'rostro') {
    base.push(
      'Composición: primer plano del rostro de UN SOLO personaje sobre fondo gris neutro y liso, ' +
      'de frente, mirando a cámara, expresión neutra. Iluminación plana y uniforme. Máximo detalle ' +
      'facial, de mirada y de peinado.'
    );
  } else {
    base.push(
      'Composición: plano medio de UN SOLO personaje sobre fondo gris neutro, en tres cuartos, en ' +
      'su postura característica. Iluminación suave de estudio.'
    );
  }

  // Salvaguarda anatómica: los modelos de imagen duplican miembros con facilidad,
  // y en una hoja de referencia con tres vistas el riesgo se multiplica.
  base.push(
    'ANATOMÍA: cada figura es un cuerpo completo y correcto, con una única cabeza, un único ' +
    'rostro, dos brazos, dos piernas y manos de cinco dedos. Constitución esbelta y adulta, de ' +
    'piernas largas y torso proporcionado; nada de cuerpos achaparrados ni cabezas grandes.'
  );

  if (ctx.calidad) base.push(ctx.calidad);
  base.push('EVITAR: ' + ctx.negativo + ', varios personajes distintos, escenario de fondo.');
  return base.join('\n');
}

/** Prompt de referencia de una localización. */
export function promptLugar(lugar, ctx) {
  return [
    'FONDO DE ANIME (background art). ' + ctx.estilo,
    '',
    'LUGAR: ' + lugar.nombre + '. ' + lugar.ficha,
    'Composición: plano general amplio y establecedor del espacio vacío, sin personajes. ' +
    'Máximo detalle arquitectónico y de materiales. Este fondo servirá de referencia para todas ' +
    'las tomas que ocurran aquí.',
    ctx.calidad || '',
    'EVITAR: ' + ctx.negativo + ', personas, figuras humanas.',
  ].join('\n');
}
