/* ============================================================
   main.js — el estudio
   ============================================================ */

import { proyecto as store, assets, cuota, pedirPersistencia } from './db.js';
import { nube, guardarPronto, vaciarCola, alGuardar } from './nube.js';
import { api, crearWav, extraerPCM, b64aBytes } from './api.js';
import {
  limpiarTexto, tituloDe, segmentar, verificarCobertura,
  normalizarParaVoz, REEMPLAZOS_BASE,
} from './texto.js';
import {
  CONFIG_DEFECTO, ELENCO_DEFECTO, LUGARES_DEFECTO, VOCES, IDIOMAS,
  ESTILO_DEFECTO, NEGATIVO_DEFECTO, CALIDAD_DEFECTO, BIBLIA_VERSION,
  variantesDe, vestuarioPara, normalizarConfig,
} from './biblia.js';
import { dirigirEpisodio, repartirMovimiento, promptImagen } from './director.js';
import { Motor, clave, estadoEpisodio, audioCompleto, b64toBlob, claveImagenDe, claveVideoDe } from './pipeline.js';
import { Proyector } from './player.js';
import { duracionVeo, precioSegundo, tarifaLegible } from './veo.js';
import { MODELOS_MUSICA, precioPieza, escenasDe } from './musica.js';
import {
  TONOS, TONO_POR_DEFECTO, SEMILLA_FIJA, tonoPorId, aplicarTono, coincideConTono,
  VOCES_CHIRP, VOZ_CHIRP_DEFECTO, VELOCIDAD_DEFECTO, nombreVozChirp, narraEpisodioEntero,
} from './voz.js';
import { agrupar, ahorroDe, aplicar as aplicarRepes, limpiar as limpiarRepes } from './repetidos.js';
import { exportarEpisodio, hojaDeMontaje, scriptFfmpeg, descargar, Zip } from './exportar.js';

const $ = (id) => document.getElementById(id);
const pad2 = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDur = (s) => Math.floor(s / 60) + ':' + pad2(Math.round(s % 60));

/* ── Estado ─────────────────────────────────────────────────── */

let P = null;
let motor = null;
let proyector = null;
let modelos = null;
let tomaSel = null;
let filtro = 'todas';

function proyectoNuevo() {
  return {
    version: 1,
    config: normalizarConfig(null),
    elenco: ELENCO_DEFECTO.map((p) => ({ ...p, refs: [] })),
    lugares: LUGARES_DEFECTO.map((l) => ({ ...l, ref: null })),
    episodios: [],
    sel: 1,
  };
}

async function guardar() {
  // estadoCompacto() revienta a propósito si el proyecto perdió episodios:
  // mejor no guardar nada que grabar la pérdida en los dos sitios.
  try { estadoCompacto(); } catch (e) { return; }
  await store.guardar('actual', P);
  if (nube.disponible) guardarPronto(estadoCompacto);
}

async function cargar() {
  const g = await store.leer('actual');
  P = g && g.version ? g : proyectoNuevo();
  P.config = normalizarConfig(P.config);
  if (!P.elenco || !P.elenco.length) P.elenco = ELENCO_DEFECTO.map((p) => ({ ...p, refs: [] }));
  if (!P.lugares || !P.lugares.length) P.lugares = LUGARES_DEFECTO.map((l) => ({ ...l, ref: null }));
  if (!P.episodios) P.episodios = [];
}

const epActual = () => P.episodios.find((e) => e.num === P.sel) || P.episodios[0] || null;


/**
 * Trae la dirección de arte y las fichas nuevas a un proyecto ya guardado.
 * Respeta lo que hayas editado a mano y los personajes que hayas añadido tú.
 */
function actualizarBiblia(forzar) {
  const guardada = P.config.bibliaVersion || 0;
  if (!forzar && guardada >= BIBLIA_VERSION) return 0;

  let cambios = 0;
  for (const [campo, valor] of [['estilo', ESTILO_DEFECTO], ['calidad', CALIDAD_DEFECTO],
                                ['negativo', NEGATIVO_DEFECTO]]) {
    if (!P.config[campo + 'Editado']) { P.config[campo] = valor; cambios++; }
  }

  const refrescar = (lista, defectos) => {
    for (const d of defectos) {
      const v = lista.find((x) => x.id === d.id);
      if (!v) { lista.push({ ...d, refs: [], ref: null }); cambios++; continue; }
      if (v.editada) continue;                 // ficha tocada a mano: intocable
      // Se copia TODO lo que define al personaje. Copiar campo a campo fue el
      // error anterior: los vestuarios nuevos nunca llegaban al proyecto.
      const refs = v.refs, ref = v.ref, editada = v.editada;
      for (const k of Object.keys(v)) delete v[k];
      Object.assign(v, JSON.parse(JSON.stringify(d)));
      v.refs = refs || [];
      if (ref) v.ref = ref;
      v.editada = editada;
      cambios++;
    }
  };
  refrescar(P.elenco, ELENCO_DEFECTO);
  refrescar(P.lugares, LUGARES_DEFECTO);

  P.config.bibliaVersion = BIBLIA_VERSION;
  return cambios;
}

/* ── El proyecto en Google Cloud ─────────────────────────────
   Se guarda sin los textos: el guion vive en el repositorio y las
   tomas se vuelven a cortar igual, porque el corte es determinista.
   Así el archivo pesa una fracción y viaja rápido.                  */

/*  Custodia: nunca se guarda un estado con menos episodios de los que ya se
    habían visto en esta sesión. La herramienta no tiene forma de borrar un
    episodio, así que perder uno solo puede ser un fallo, y guardar encima
    convierte un tropiezo en pérdida definitiva.                             */
let _maxEpisodios = 0;

function estadoCompacto() {
  const n = P.episodios.length;
  if (n > _maxEpisodios) _maxEpisodios = n;
  else if (n < _maxEpisodios) {
    const faltan = _maxEpisodios - n;
    log('NO se guarda: faltan ' + faltan + (faltan === 1 ? ' episodio' : ' episodios') +
      ' respecto a lo que había. Recarga la página antes de seguir.', 'err');
    throw new Error('El proyecto perdió ' + faltan + ' episodios: no se guarda encima');
  }
  return {
    version: 2,
    sel: P.sel,
    config: P.config,
    elenco: P.elenco.map((p) => ({ ...p })),
    lugares: P.lugares.map((l) => ({ ...l })),
    episodios: P.episodios.map((e) => ({
      num: e.num,
      titulo: e.titulo,
      musica: e.musica || null,
      tomas: (e.tomas || []).map((t) => ({
        i: t.i,
        plano: t.plano || null,
        audio: t.audio || null,
        imagen: t.imagen || null,
        video: t.video || null,
        segundos: t.segundos || null,
        bloqueada: !!t.bloqueada,
        reusa: t.reusa || null,
        reusaVideo: t.reusaVideo || null,
        promptImagen: t.promptEditado ? t.promptImagen : null,
        promptEditado: !!t.promptEditado,
      })),
    })),
  };
}

/*  Los doce guiones son del repositorio y no dependen de nada: se traen
    siempre, con reintentos. Un episodio que no se pueda leer se deja como
    estaba en vez de desaparecer.                                            */
async function traerGuiones(aviso) {
  let leidos = 0;
  for (let k = 1; k <= 12; k++) {
    if (aviso) aviso(k - 1, 12, 'episodio ' + k);
    let texto = null;
    for (let intento = 1; intento <= 3 && texto === null; intento++) {
      try {
        const r = await fetch('./episodios/' + 'ep' + pad2(k) + '.md', { cache: 'no-cache' });
        if (r.ok) texto = await r.text();
      } catch (e) { /* corte de red: se reintenta */ }
      if (texto === null && intento < 3) await new Promise((r) => setTimeout(r, 700 * intento));
    }
    if (texto === null) {
      log('no se pudo leer el guion del episodio ' + k + '; se conserva lo que hubiera', 'err');
      continue;
    }
    añadirEpisodio('ep' + pad2(k) + '.md', texto);
    leidos++;
  }
  return leidos;
}

/** Reconstruye el proyecto: textos del repositorio, trabajo de la nube. */
async function rehidratar(compacto) {
  P = proyectoNuevo();
  P.config = normalizarConfig(compacto.config);
  if (compacto.elenco && compacto.elenco.length) P.elenco = compacto.elenco;
  if (compacto.lugares && compacto.lugares.length) P.lugares = compacto.lugares;
  P.sel = compacto.sel || 1;
  P.episodios = [];

  /*  Antes se recorría lo GUARDADO y se hacía un fetch por episodio: si uno
      fallaba —un corte de red del móvil, que es lo que llevamos toda la
      sesión— se hacía «continue» y ese episodio desaparecía del proyecto. Y
      acto seguido se guardaba la lista recortada, en el navegador y en la
      nube, así que la pérdida quedaba grabada. Ahora la lista de episodios
      la fijan los guiones del repositorio, y lo guardado solo aporta el
      trabajo hecho encima.                                                  */
  await traerGuiones();

  const porNum = new Map(P.episodios.map((e) => [e.num, e]));
  for (const ce of (compacto.episodios || [])) {
    const ep = porNum.get(ce.num);
    if (!ep) continue;
    ep.titulo = ce.titulo || ep.titulo;
    if (ce.musica) ep.musica = ce.musica;
    (ce.tomas || []).forEach((ct, k) => {
      const t = ep.tomas[k];
      if (!t) return;
      t.plano = ct.plano || null;
      t.audio = ct.audio || null;
      t.imagen = ct.imagen || null;
      t.video = ct.video || null;
      if (ct.segundos) t.segundos = ct.segundos;
      t.bloqueada = !!ct.bloqueada;
      if (ct.reusa) t.reusa = ct.reusa;
      if (ct.reusaVideo) t.reusaVideo = ct.reusaVideo;
      if (ct.promptEditado) { t.promptImagen = ct.promptImagen; t.promptEditado = true; }
    });
  }
}

function pintarEstadoNube(estado, detalle) {
  const n = document.getElementById('estadoNube');
  if (!n) return;
  const textos = {
    guardando: ['g', 'guardando en Google Cloud'],
    guardado: ['ok', 'guardado en Google Cloud'],
    error: ['e', 'no se pudo guardar: ' + (detalle || '')],
    local: ['m', 'sin bucket: solo en este navegador'],
    leyendo: ['g', 'recuperando el proyecto'],
  };
  const par = textos[estado] || textos.guardado;
  n.className = 'chip ' + par[0];
  n.textContent = par[1];
}

/* ── Barra de trabajo ───────────────────────────────────────── */

/*  Los fallos ya no se pierden. Antes solo existían como un aviso flotante de
    unos segundos, y encima cada nuevo fallo borraba el anterior: si fallaban
    tres hojas, se veía una. Ahora quedan escritos bajo la barra de trabajo,
    donde estás mientras se genera, se pueden seleccionar y copiar, y no se van
    hasta que los descartes o empieces otro trabajo.                            */
let fallos = [];
let trabajando = false;

function pintarFallos() {
  const caja = $('jbFallos');
  if (!fallos.length) {
    caja.hidden = true;
    caja.textContent = '';
    $('jobBar').hidden = !trabajando;
    return;
  }
  caja.textContent = '';
  const cab = document.createElement('div');
  cab.className = 'jb-cab';
  const t = document.createElement('span');
  t.textContent = fallos.length + (fallos.length === 1 ? ' fallo' : ' fallos') +
    ' · mantén pulsado para copiar el texto';
  const x = document.createElement('button');
  x.type = 'button';
  x.textContent = 'Descartar';
  x.addEventListener('click', () => { fallos = []; pintarFallos(); });
  cab.appendChild(t); cab.appendChild(x);
  caja.appendChild(cab);
  for (const f of fallos.slice(-10)) {
    const d = document.createElement('div');
    d.className = 'jb-f';
    d.textContent = f;
    caja.appendChild(d);
  }
  caja.hidden = false;
  $('jobBar').hidden = false;
}

/*  El teléfono bloqueándose a mitad de una tanda es lo que produce los «Load
    failed»: el navegador congela la pestaña y todas las peticiones en vuelo
    mueren. Mientras haya trabajo, se le pide al sistema que no apague la
    pantalla. No todos los navegadores lo permiten; si no, no pasa nada.      */
let candado = null;

async function mantenerDespierto() {
  try {
    if (navigator.wakeLock && !candado && !document.hidden) {
      candado = await navigator.wakeLock.request('screen');
      candado.addEventListener('release', () => { candado = null; });
    }
  } catch (e) { /* el navegador no lo concede: se sigue igual */ }
}

function soltarDespierto() {
  if (candado) { try { candado.release(); } catch (e) { /* ya soltado */ } candado = null; }
}

// El candado se pierde al ocultar la pestaña: hay que recuperarlo al volver.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && trabajando) mantenerDespierto();
  });
}

function jobMostrar(fase) {
  trabajando = true;
  fallos = [];
  pintarFallos();
  mantenerDespierto();
  $('jobBar').hidden = false;
  $('jbFase').textContent = String(fase || 'trabajo').toUpperCase();
}
function jobAvance(hecho, total, texto) {
  $('jbTxt').textContent = texto + (total ? ' · ' + hecho + '/' + total : '');
  $('jbFill').style.width = total ? ((hecho / total) * 100).toFixed(1) + '%' : '0%';
}
function jobOcultar() {
  trabajando = false;
  soltarDespierto();
  // Si hubo fallos, la barra se queda: es el único sitio donde consta qué pasó.
  if (fallos.length) pintarFallos(); else $('jobBar').hidden = true;
}

/** Mensaje flotante: lo que falla se ve donde estás, no en una consola aparte. */
let _avisoTimer = null;
function aviso(txt, tipo, ms) {
  let n = $('avisoFlotante');
  if (!n) {
    n = document.createElement('div');
    n.id = 'avisoFlotante';
    document.body.appendChild(n);
  }
  n.className = 'aviso ' + (tipo || 'info');
  n.textContent = txt;
  n.hidden = false;
  requestAnimationFrame(() => n.classList.add('visible'));
  clearTimeout(_avisoTimer);
  _avisoTimer = setTimeout(() => {
    n.classList.remove('visible');
    setTimeout(() => { n.hidden = true; }, 300);
  }, ms || 5000);
  n.onclick = () => { n.classList.remove('visible'); setTimeout(() => { n.hidden = true; }, 300); };
}

function log(txt, tipo) {
  if (tipo === 'err') {
    fallos.push(new Date().toTimeString().slice(0, 5) + '  ' + txt);
    pintarFallos();
    aviso(txt, 'err', 9000);
  } else if (tipo === 'aviso') aviso(txt, 'aviso', 7000);
  const c = $('consola');
  const d = document.createElement('div');
  d.className = tipo || 'info';
  const h = new Date();
  d.textContent = pad2(h.getHours()) + ':' + pad2(h.getMinutes()) + ':' + pad2(h.getSeconds()) + '  ' + txt;
  c.appendChild(d);
  while (c.children.length > 300) c.firstElementChild.remove();
  c.scrollTop = c.scrollHeight;
}

function estado(id, txt, tipo) {
  const n = $(id);
  if (!txt) { n.className = 'estado'; n.textContent = ''; return; }
  n.className = 'estado ' + (tipo || 'info');
  n.textContent = txt;
}

function nuevoMotor() {
  motor = new Motor(P, {
    progreso: ({ hecho, total, texto }) => jobAvance(hecho, total, texto),
    log,
    cambio: () => { pintarRejillaProd(); pintarListaEps(); },
    fin: () => { jobOcultar(); guardar(); pintarTodo(); },
  });
  return motor;
}

/* ── Conexión ───────────────────────────────────────────────── */

async function comprobarConexion() {
  const t = $('tablaConexion');
  t.innerHTML = '<tr><td>Comprobando…</td><td></td></tr>';
  try {
    const r = await api.ping();
    // Solo el estado de cada pieza. Ni identificadores, ni correos, ni nombres
    // de bucket: eso vive en las variables de entorno y ahí se queda.
    const fila = (k, v, ok) =>
      '<tr><td>' + k + '</td><td><span class="chip ' + (ok ? 'ok' : 'e') + '">' + esc(v) + '</span></td></tr>';
    t.innerHTML =
      fila('Proyecto de Google Cloud', r.proyecto ? 'configurado' : 'falta configurar', r.proyecto) +
      fila('Cuenta de servicio', r.cuentaServicio ? 'configurada' : 'falta configurar', r.cuentaServicio) +
      fila('Autenticación', r.token ? 'correcta' : 'falla', r.token) +
      fila('API de Vertex AI', r.vertex ? 'responde' : 'no responde', r.vertex) +
      fila('Bucket para video', r.bucket ? 'configurado' : 'sin bucket — los clips vendrán en línea', !!r.bucket);
    const problema = (!r.token && r.errorToken) || (!r.vertex && r.errorVertex);
    if (problema) {
      t.innerHTML += '<tr><td colspan="2" style="padding-top:12px">' +
        '<div class="estado err" style="display:block;margin:0">' + esc(problema) + '</div></td></tr>';
    }
    nube.marcarDisponible(!!r.bucket);
    if (!r.bucket) pintarEstadoNube('local');
    const ok = r.proyecto && r.cuentaServicio && r.token && r.vertex;
    if (!ok && problema) aviso(problema, 'err', 9000);
    marcarConexion(ok ? 'ok' : 'mal');
  } catch (e) {
    t.innerHTML = '<tr><td>Error</td><td><span class="chip e">' + esc(e.message) + '</span></td></tr>';
    marcarConexion('mal');
  }
}

/** El botón de la cabecera lleva un punto de color con el estado. */
function marcarConexion(estado) {
  const b = $('btnConexion');
  if (!b) return;
  const previo = b.querySelector('.punto');
  if (previo) previo.remove();
  const p = document.createElement('span');
  p.className = 'punto';
  p.style.background = estado === 'ok' ? 'var(--verde)' : 'var(--rojo)';
  p.title = estado === 'ok' ? 'Vertex conectado' : 'Revisa la conexión';
  b.appendChild(p);
  b.setAttribute('aria-label', p.title);
}

/* ── Catálogo de modelos ────────────────────────────────────
   Lista cerrada. Solo generación de imagen nativa de Gemini: es la
   única que acepta imágenes de referencia, y por tanto la única que
   mantiene el mismo rostro en los doce episodios.                   */

const MODELOS = {
  imagen: [
    ['gemini-2.5-flash-image', 'Nano Banana — estable y rápido'],
    ['gemini-3.1-flash-image', 'Nano Banana 2 — nuevo y rápido'],
    ['gemini-3-pro-image', 'Nano Banana Pro — máxima calidad'],
  ],
  video: [
    ['veo-3.1-lite-generate-001', 'Veo 3.1 Lite — el más económico'],
    ['veo-3.1-fast-generate-001', 'Veo 3.1 Fast — equilibrado'],
    ['veo-3.1-generate-001', 'Veo 3.1 — máxima calidad'],
    ['veo-2.0-generate-001', 'Veo 2 — generación anterior'],
  ],
  texto: [
    ['gemini-3.1-pro-preview', 'Gemini 3.1 Pro — el mejor director'],
    ['gemini-2.5-pro', 'Gemini 2.5 Pro'],
    ['gemini-2.5-flash', 'Gemini 2.5 Flash — rápido y barato'],
  ],
  voz: [
    ['gemini-3.1-flash-tts-preview', 'Gemini 3.1 Flash TTS — el más nuevo, más contexto'],
    ['gemini-2.5-flash-preview-tts', 'Gemini 2.5 Flash TTS'],
    ['gemini-2.5-pro-preview-tts', 'Gemini 2.5 Pro TTS'],
  ],
  musica: MODELOS_MUSICA,
};

const RESOLUCIONES = {
  'gemini-3-pro-image': [['1K', '1K — rápida'], ['2K', '2K — recomendada'], ['4K', '4K — máxima']],
  'gemini-3.1-flash-image': [['1K', '1K — rápida'], ['2K', '2K — recomendada'], ['4K', '4K — máxima']],
  'gemini-2.5-flash-image': [['1K', '1K — es la única que entrega este modelo']],
};

const NOTA_MODELO = {
  'gemini-2.5-flash-image': 'El más rápido y barato, pero entrega siempre en torno a 1K: para máxima calidad no es este.',
  'gemini-3.1-flash-image': 'Rápido y admite 2K y 4K. Buen término medio entre precio y detalle.',
  'gemini-3-pro-image': 'La mejor calidad y el mejor detalle. Admite 2K y 4K. Más caro y más lento; es el que conviene para las hojas de referencia y los fotogramas que importan.',
  'veo-3.1-lite-generate-001': 'El más barato. Suficiente para planos de movimiento contenido.',
  'veo-3.1-fast-generate-001': 'Equilibrio entre precio y calidad. Recomendado para la mayoría de las tomas.',
  'veo-3.1-generate-001': 'Máxima calidad de animación. Resérvalo para los planos que llevan el peso del episodio.',
  'veo-2.0-generate-001': 'Generación anterior. Más barata, sin audio y con menos control de cámara.',
  'lyria-3-pro-preview': 'Pieza completa de hasta tres minutos, suficiente para una escena entera. Cobra por pieza, no por segundo: 0,08 $ cada una dure lo que dure.',
  'lyria-3-clip-preview': 'Clips de treinta segundos a 0,04 $. Para una escena hay que repetirlo, así que sale peor que el Pro salvo para probar.',
  'gemini-3.1-flash-tts-preview': 'El más reciente: contexto de 32 mil tokens frente a 8 mil, y el audio gasta 25 tokens por segundo en vez de 32, así que caben escenas más largas. En vista previa: si da error de modelo no encontrado, tu proyecto aún no tiene acceso.',
  'gemini-2.5-flash-preview-tts': 'El estable. Ocho mil tokens de entrada y hasta unos ocho minutos de audio por llamada, de sobra para una escena.',
};

/*  Un modelo guardado puede haber desaparecido del catálogo. El desplegable se
    corregía solo y la configuración se quedaba con el nombre muerto: se veía un
    modelo y el motor pedía otro —o pedía el retirado, y Google devolvía 404.
    Ahora la corrección se DEVUELVE, para que quien llame la escriba.

    @returns {*} el valor que ha quedado seleccionado de verdad               */
function llenarSelect(sel, pares, valor, preferido) {
  // Sin elemento no hay nada que corregir: se devuelve lo que había.
  if (!sel) return valor;
  const validos = pares.map((p) => (Array.isArray(p) ? p[0] : p));
  sel.innerHTML = '';
  for (const par of pares) {
    const [v, etiqueta] = Array.isArray(par) ? par : [par, par];
    const o = document.createElement('option');
    o.value = v;
    o.textContent = etiqueta;
    sel.appendChild(o);
  }
  if (validos.indexOf(valor) !== -1) { sel.value = valor; return valor; }
  // Se cae al valor por defecto del repositorio si sigue existiendo, y solo si
  // no, al primero de la lista: caer siempre al primero degradaba la calidad.
  sel.value = validos.indexOf(preferido) !== -1 ? preferido : validos[0];
  return sel.value;
}

/*  El motor decide qué mandos tienen sentido: con una locución por episodio no
    hay tono ni semilla que valgan —Chirp no admite instrucción de estilo—, y
    con Gemini no hay velocidad exacta que aplicar.                          */
function pintarMotorVoz() {
  const sel = $('cfgMotorVoz');
  if (!sel) return;
  const largo = narraEpisodioEntero(P.config);
  sel.value = largo ? 'largo' : 'gemini';

  llenarSelect($('cfgVozChirp'), VOCES_CHIRP, P.config.vozChirp, VOZ_CHIRP_DEFECTO);
  const v = Number(P.config.velocidadVoz) || VELOCIDAD_DEFECTO;
  $('cfgVelocidadVoz').value = v;
  $('valVelocidadVoz').textContent = v.toFixed(2) + 'x';

  $('bloqueVozLarga').hidden = !largo;
  $('bloqueTonoGemini').hidden = largo;
  $('pistaMotorVoz').textContent = largo
    ? 'El episodio entero se narra de una vez y la herramienta lo reparte después entre las ' +
      'tomas por los silencios. Sin costuras: es una única locución.'
    : 'Cada 45 segundos es una llamada nueva, y cada llamada es una actuación nueva. Más ' +
      'expresivo, pero el narrador cambia de tono a lo largo del episodio.';
}

function pintarTonos() {
  const sel = $('cfgTono');
  if (!sel) return;
  const propio = coincideConTono(P.config);
  sel.innerHTML = '';
  for (const t of TONOS) {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = t.nombre;
    sel.appendChild(o);
  }
  if (!propio) {
    const o = document.createElement('option');
    o.value = '__propio';
    o.textContent = 'Personalizado — ajustado a mano';
    sel.appendChild(o);
  }
  sel.value = propio ? P.config.tono : '__propio';
  $('pistaTono').textContent = propio
    ? tonoPorId(P.config.tono).resumen
    : 'La voz está ajustada a mano. Elige un tono de la lista para volver a uno calibrado.';
}

/*  Vuelca la configuración en los mandos que viven FUERA del diálogo de
    Ajustes. Estaba escrito a pelo dentro de iniciar(), antes de recuperar el
    proyecto de la nube: al recuperarlo, P.config se sustituía entero y estos
    mandos seguían enseñando lo de la copia local. Y como «Guardar ajustes» y
    «Guardar precios» escriben LO QUE MUESTRAN los mandos, bastaba con abrir y
    guardar para subir al bucket los valores viejos sin haber tocado nada.   */
function pintarConfig() {
  const c = P.config;
  const pct = (v, d) => Math.round((v ?? d) * 100);
  $('cfgEstilo').value = c.estilo;
  $('cfgCalidad').value = c.calidad;
  $('cfgNegativo').value = c.negativo;
  $('cfgFormato').value = c.formato;
  $('cfgMaxRefs').value = String(c.maxReferencias);
  $('cfgSegToma').value = c.segundosPorToma;
  $('valSegToma').textContent = c.segundosPorToma + ' s';
  $('cfgIntensidad').value = pct(c.intensidadCamara, 1);
  $('valIntensidad').textContent = pct(c.intensidadCamara, 1) + ' %';
  $('cfgVolMusica').value = pct(c.volumenMusica, 0.3);
  $('valVolMusica').textContent = pct(c.volumenMusica, 0.3) + ' %';
  $('cfgMovim').value = pct(c.proporcionMovimiento, 0.35);
  $('valMovim').textContent = pct(c.proporcionMovimiento, 0.35) + ' %';
  $('pxImagen').value = c.precios.imagen;
  $('pxVoz').value = c.precios.vozMil;
  $('pxTexto').value = c.precios.episodio;
  poblarModelos();
}

function poblarModelos() {
  // La voz sí se puede descubrir en tu Vertex; imagen y video son lista cerrada.
  const voces = (modelos && Array.isArray(modelos.tts) && modelos.tts.length)
    ? modelos.tts.map((m) => [m, m]) : MODELOS.voz;

  /*  Lo que quede seleccionado se escribe en la configuración. Sin esto, un
      modelo retirado seguía vivo en P.config mientras el desplegable enseñaba
      otro: el usuario veía Nano Banana Pro y el motor pedía un modelo muerto.
      Y con el modelo desconocido, RESOLUCIONES no encontraba lista, se caía a
      la del modelo de 1K y esa caída SÍ se guardaba: la resolución quedaba
      degradada a 1K para siempre sin que nadie lo dijera.                    */
  const antes = { ...P.config };
  const C = CONFIG_DEFECTO;

  P.config.modeloTts = llenarSelect($('cfgModeloTts'), voces, P.config.modeloTts, C.modeloTts);
  P.config.modeloTexto = llenarSelect($('cfgModeloTexto'), MODELOS.texto, P.config.modeloTexto, C.modeloTexto);
  for (const id of ['cfgModeloImagen', 'selModImgProd', 'selModImgBiblia']) {
    P.config.modeloImagen = llenarSelect($(id), MODELOS.imagen, P.config.modeloImagen, C.modeloImagen);
  }
  for (const id of ['cfgModeloVideo', 'selModVidProd']) {
    P.config.modeloVideo = llenarSelect($(id), MODELOS.video, P.config.modeloVideo, C.modeloVideo);
  }
  P.config.modeloMusica = llenarSelect($('selModMusProd'), MODELOS.musica, P.config.modeloMusica, C.modeloMusica);

  const res = RESOLUCIONES[P.config.modeloImagen] || RESOLUCIONES[C.modeloImagen];
  for (const id of ['selResImgProd', 'selResImgBiblia']) {
    P.config.imageSize = llenarSelect($(id), res, P.config.imageSize, C.imageSize);
  }

  /*  Cambiar un modelo por su cuenta cambia lo que cuesta y lo que sale, así
      que no puede pasar en silencio.                                         */
  for (const campo of ['modeloTts', 'modeloTexto', 'modeloImagen', 'modeloVideo',
                       'modeloMusica', 'imageSize']) {
    if (antes[campo] !== undefined && antes[campo] !== P.config[campo]) {
      log('«' + antes[campo] + '» ya no está disponible; se usa «' + P.config[campo] + '»', 'aviso');
    }
  }
  pintarNotasModelo();
}

function pintarNotasModelo() {
  const n = (id, modelo) => { if ($(id)) $(id).textContent = NOTA_MODELO[modelo] || ''; };
  n('pistaModImg', P.config.modeloImagen);
  n('pistaModImgBiblia', P.config.modeloImagen);
  n('pistaModVid', P.config.modeloVideo);
  n('pistaModMus', P.config.modeloMusica);
  if ($('tarifaVid')) {
    $('tarifaVid').textContent = 'Tarifa aplicada: ' +
      tarifaLegible(P.config.modeloVideo, P.config.resolucionVideo, P.config.audioVeo);
  }
  if ($('cuentaMovim')) {
    let clips = 0, segundos = 0;
    for (const ep of P.episodios) {
      for (const t of ep.tomas || []) {
        if (!(t.plano && t.plano.tipo === 'movimiento') || t.reusaVideo) continue;
        clips++;
        segundos += duracionVeo(P.config.modeloVideo, t.segundos || t.segEstimados || 8);
      }
    }
    const usd = segundos * precioSegundo(P.config.modeloVideo, P.config.resolucionVideo, P.config.audioVeo);
    $('cuentaMovim').textContent = clips
      ? 'En la temporada: ' + clips + ' clips · ' + segundos + ' s de video · $' + usd.toFixed(2)
      : 'Todavía no hay episodios dirigidos, así que no hay nada repartido.';
  }
}

/** Un cambio en cualquier selector de modelo se refleja en todos. */
function fijarModelo(tipo, valor) {
  if (tipo === 'imagen') P.config.modeloImagen = valor;
  else if (tipo === 'video') P.config.modeloVideo = valor;
  else if (tipo === 'texto') P.config.modeloTexto = valor;
  else if (tipo === 'musica') P.config.modeloMusica = valor;
  else if (tipo === 'voz') P.config.modeloTts = valor;
  poblarModelos();
  guardar();
  pintarCoste();
}

async function descubrirModelos() {
  $('notaModelos').textContent = 'consultando tu Vertex…';
  try {
    const r = await api.modelos();
    modelos = r;
    await store.guardar('modelos', r);
    poblarModelos();
    $('notaModelos').textContent = (r.tts || []).length +
      ' modelos de voz disponibles en tu proyecto — fuente: ' + (r.fuente || '?');
  } catch (e) {
    $('notaModelos').textContent = 'no se pudo consultar (' + e.message + '); se usa la lista base';
  }
}

/* ── Episodios ──────────────────────────────────────────────── */

function recalcularTomas(ep) {
  const limpio = limpiarTexto(ep.texto);
  const nuevas = segmentar(limpio, P.config);
  const previas = ep.tomas || [];

  // Si el número de tomas no cambia, conservamos planos y material generado.
  ep.tomas = nuevas.map((t, i) => {
    const v = previas[i];
    const mismoTexto = v && v.texto === t.texto;
    return mismoTexto ? { ...v, ...t } : { ...t };
  });

  const cob = verificarCobertura(limpio, ep.tomas);
  ep.cobertura = cob;
  return cob;
}

async function cargarSerie() {
  jobMostrar('carga');
  const n = await traerGuiones(jobAvance);
  jobOcultar();
  await guardar();
  pintarTodo();
  estado('estadoGuion', n + ' episodios cargados desde el repositorio.', 'ok');
}

function añadirEpisodio(nombre, texto) {
  const { num, titulo } = tituloDe(nombre, texto);
  const n = num || (P.episodios.reduce((m, e) => Math.max(m, e.num), 0) + 1);
  let ep = P.episodios.find((e) => e.num === n);
  if (!ep) {
    ep = { num: n, titulo, texto, tomas: [] };
    P.episodios.push(ep);
  } else {
    ep.titulo = titulo;
    ep.texto = texto;
  }
  P.episodios.sort((a, b) => a.num - b.num);
  recalcularTomas(ep);
  return ep;
}

function pintarListaEps() {
  const ul = $('listaEps');
  if (!P.episodios.length) {
    ul.innerHTML = '<li class="nota">Sin episodios todavía. Pulsa «Cargar los doce episodios».</li>';
    return;
  }
  ul.innerHTML = '';
  for (const ep of P.episodios) {
    const s = estadoEpisodio(ep);
    const li = document.createElement('li');
    li.className = 'card' + (ep.num === P.sel ? ' sel' : '');
    const barra = (n, cls) =>
      '<div class="m ' + cls + '"><i style="width:' + (s.tomas ? (n / s.tomas) * 100 : 0) + '%"></i></div>';
    li.innerHTML =
      '<span class="num">EP ' + pad2(ep.num) + '</span>' +
      '<div class="cm"><strong>' + esc(ep.titulo) + '</strong>' +
      '<span class="sub2">' + s.tomas + ' tomas · ' + fmtDur(s.segundos) + ' · ' +
      ep.texto.length.toLocaleString('es') + ' car.</span>' +
      '<div class="medidor">' + barra(s.dirigido, 'dir') + barra(s.voz, 'voz') +
      barra(s.imagen, 'img') + barra(s.video, 'vid') + '</div></div>' +
      '<div class="chips">' +
      (s.dirigido === s.tomas && s.tomas ? '<span class="chip ok">dirigido</span>' :
        s.dirigido ? '<span class="chip g">' + s.dirigido + '/' + s.tomas + ' dirigido</span>' :
          '<span class="chip m">sin dirigir</span>') +
      (s.voz ? '<span class="chip ' + (s.voz === s.tomas ? 'ok' : 'g') + '">voz ' + s.voz + '/' + s.tomas + '</span>' : '') +
      (s.imagen ? '<span class="chip ' + (s.imagen === s.tomas ? 'ok' : 'g') + '">img ' + s.imagen + '/' + s.tomas + '</span>' : '') +
      (s.movimiento ? '<span class="chip ' + (s.video === s.movimiento ? 'ok' : 'g') + '">mov ' + s.video + '/' + s.movimiento + '</span>' : '') +
      (s.errores ? '<span class="chip e">' + s.errores + ' con error</span>' : '') +
      '</div>';
    li.addEventListener('click', () => { P.sel = ep.num; guardar(); pintarTodo(); });
    ul.appendChild(li);
  }
}

function pintarSelectores() {
  for (const id of ['selEpGuion', 'selEpSala', 'selEpExport']) {
    const s = $(id);
    s.innerHTML = '';
    for (const ep of P.episodios) {
      const o = document.createElement('option');
      o.value = String(ep.num);
      o.textContent = 'EP ' + pad2(ep.num) + ' · ' + ep.titulo;
      s.appendChild(o);
    }
    s.value = String(P.sel);
  }
}

/* ── Biblia ─────────────────────────────────────────────────── */

async function pintarFichas() {
  const cont = $('fichasElenco');
  cont.innerHTML = '';
  for (const per of P.elenco) {
    const d = document.createElement('div');
    d.className = 'ficha';
    const vars = variantesDe(per);
    const hechas = (per.refs || []).length;
    const faltan = vars.length - hechas;
    d.innerHTML =
      '<div class="lienzos">' + vars.map((v) =>
        '<div class="lienzo" data-var="' + v.id + '"><span class="vacio">—</span>' +
        '<span class="etiqueta">' + esc(v.nombre) + '</span></div>').join('') + '</div>' +
      '<div class="cuerpo"><strong>' + esc(per.nombre) +
      (per.principal ? ' <span class="chip g">principal</span>' : '') +
      (per.vestuarios && per.vestuarios.length > 1
        ? ' <span class="chip">' + per.vestuarios.length + ' vestuarios</span>' : '') + '</strong>' +
      '<p>' + esc(per.ficha) + '</p></div>' +
      '<div class="acc">' +
      '<button class="btn chico" data-acc="gen">' + (hechas
        ? (faltan ? 'Completar las ' + faltan + ' que faltan' : 'Sus ' + vars.length + ' hojas están hechas')
        : 'Generar sus ' + vars.length + ' hojas') + '</button>' +
      (hechas ? '<button class="btn fantasma chico" data-acc="rehacer">Rehacer todas</button>' : '') +
      '<button class="btn fantasma chico" data-acc="editar">Editar ficha</button>' +
      '</div>';
    cont.appendChild(d);

    for (const v of vars) {
      const u = await assets.url(clave.refPersonaje(per.id, v.id));
      if (!u) continue;
      const caja = d.querySelector('.lienzo[data-var="' + v.id + '"]');
      if (caja) {
        caja.querySelector('.vacio').remove();
        ponerImagen(caja, clave.refPersonaje(per.id, v.id), per.nombre);
      }
    }
    const bGen = d.querySelector('[data-acc=gen]');
    // Completar, no rehacer: la hoja que ya salió es la que fija el rostro, y las
    // que falten se generan con ella adjunta. Rehacer todas cambia la cara.
    if (hechas && !faltan) bGen.disabled = true;
    bGen.addEventListener('click', async () => {
      jobMostrar('referencias');
      await nuevoMotor().generarReferencias([per.id], true);
      await guardar(); pintarFichas();
    });
    const bReh = d.querySelector('[data-acc=rehacer]');
    if (bReh) bReh.addEventListener('click', async () => {
      jobMostrar('referencias');
      await nuevoMotor().generarReferencias([per.id]);
      await guardar(); pintarFichas();
    });
    d.querySelector('[data-acc=editar]').addEventListener('click', () => abrirFicha('personaje', per));
  }

  const cl = $('fichasLugares');
  cl.innerHTML = '';
  for (const lug of P.lugares) {
    const d = document.createElement('div');
    d.className = 'ficha';
    d.innerHTML =
      '<div class="lienzos"><div class="lienzo" style="aspect-ratio:16/9"><span class="vacio">SIN FONDO</span></div></div>' +
      '<div class="cuerpo"><strong>' + esc(lug.nombre) + '</strong><p>' + esc(lug.ficha) + '</p></div>' +
      '<div class="acc">' +
      '<button class="btn chico" data-acc="gen">Generar fondo</button>' +
      '<button class="btn fantasma chico" data-acc="editar">Editar</button>' +
      '</div>';
    cl.appendChild(d);
    if (lug.ref) {
      const u = await assets.url(lug.ref);
      if (u) ponerImagen(d.querySelector('.lienzo'), clave.refLugar(lug.id), lug.nombre, 'unico');
    }
    d.querySelector('[data-acc=gen]').addEventListener('click', async () => {
      jobMostrar('fondos');
      await nuevoMotor().generarFondos([lug.id]);
      await guardar(); pintarFichas();
    });
    d.querySelector('[data-acc=editar]').addEventListener('click', () => abrirFicha('lugar', lug));
  }
}

let fichaEditando = null;
function abrirFicha(tipo, obj) {
  fichaEditando = { tipo, obj };
  $('fichaTitulo').textContent = obj ? 'Editar ' + tipo : 'Nuevo ' + tipo;
  $('fichaNombre').value = obj ? obj.nombre : '';
  $('fichaAlias').value = obj && obj.alias ? obj.alias.join(', ') : '';
  $('fichaTexto').value = obj ? obj.ficha : '';
  $('fichaPrincipal').checked = !!(obj && obj.principal);
  $('fichaPrincipal').parentElement.style.display = tipo === 'personaje' ? '' : 'none';
  $('btnFichaBorrar').style.display = obj ? '' : 'none';
  $('dlgFicha').showModal();
}

/* ── Guion técnico ──────────────────────────────────────────── */

async function dirigir(ep) {
  if (!ep) return;
  const ctx = {
    episodio: ep,
    elenco: P.elenco,
    lugares: P.lugares,
    tomas: ep.tomas,
    modelo: P.config.modeloTexto,
  };
  jobMostrar('dirección');
  estado('estadoGuion', 'El director está planificando ' + ep.tomas.length + ' tomas…', 'info');
  try {
    const planos = await dirigirEpisodio(ctx, {
      progreso: (h, t, txt) => jobAvance(h, t, txt),
      aviso: (m) => log('EP' + pad2(ep.num) + ': ' + m),
      señal: undefined,
    });
    const conTipo = repartirMovimiento(planos, P.config.proporcionMovimiento);
    ep.tomas.forEach((t, i) => {
      t.plano = conTipo[i];
      // El prompt se regenera salvo que lo hayas editado a mano.
      if (!t.promptEditado) t.promptImagen = null;
    });
    const respaldos = conTipo.filter((p) => p.respaldo).length;
    estado('estadoGuion',
      'Listo: ' + ep.tomas.length + ' tomas planificadas, ' +
      conTipo.filter((p) => p.tipo === 'movimiento').length + ' con movimiento real' +
      (respaldos ? ' · ' + respaldos + ' tomas quedaron con plano de respaldo, revísalas' : ''),
      respaldos ? 'info' : 'ok');
  } catch (e) {
    estado('estadoGuion', 'La dirección falló: ' + e.message, 'err');
  }
  jobOcultar();
  await guardar();
  pintarTodo();
}

function resumenGuion(ep) {
  if (!ep) return '—';
  const s = estadoEpisodio(ep);
  const cob = ep.cobertura;
  return s.tomas + ' tomas · ' + fmtDur(s.segundos) + ' estimados · ' +
    s.movimiento + ' con movimiento · ' + (s.tomas - s.movimiento) + ' fijas' +
    (cob ? ' · cobertura de texto ' + (cob.ok ? 'exacta' : 'DESAJUSTADA (' + cob.diferencia + ' caracteres)') : '');
}

/*  Un blob URL muere si el archivo se regeneró mientras la imagen seguía en
    pantalla, y entonces se ve el icono de imagen rota. En vez de dejarlo así,
    se pide la URL otra vez saltándose la caché; si tampoco vale, se quita la
    imagen en lugar de enseñar un roto.                                       */
function ponerImagen(caja, id, alt, modo) {
  if (!caja) return;
  assets.url(id).then((u) => {
    if (!u) return;
    const img = document.createElement('img');
    img.alt = alt || '';
    let reintentado = false;
    img.addEventListener('error', async () => {
      if (reintentado) { img.remove(); return; }
      reintentado = true;
      const otra = await assets.url(id, true).catch(() => null);
      if (otra) img.src = otra; else img.remove();
    });
    img.src = u;
    if (modo === 'unico') { caja.innerHTML = ''; caja.appendChild(img); }
    else caja.insertAdjacentElement('afterbegin', img);
  }).catch(() => { /* el almacén no responde: se queda sin miniatura */ });
}

function tarjetaToma(ep, t, conAcciones) {
  const d = document.createElement('div');
  const p = t.plano || {};
  const hayErr = (t.audio && t.audio.ok === false) || (t.imagen && t.imagen.ok === false) ||
    (t.video && t.video.ok === false);
  d.className = 'toma' + (tomaSel === t.i ? ' sel' : '') + (hayErr ? ' err' : '') +
    (P.config.formato === '9:16' ? ' v916' : '');
  d.innerHTML =
    '<div class="lienzo"><div class="ph">' + (p.encuadre ? esc(p.encuadre) : 'SIN DIRIGIR') + '</div>' +
    '<span class="n">' + pad2(t.i + 1) + '</span>' +
    '<span class="marcas">' +
    '<i class="voz' + (t.audio && t.audio.ok ? ' on' : '') + '"></i>' +
    '<i class="img' + (t.imagen && t.imagen.ok ? ' on' : '') + '"></i>' +
    '<i class="vid' + (t.video && t.video.ok ? ' on' : '') + '"></i>' +
    '</span></div>' +
    '<div class="txt">' + esc(t.texto.slice(0, 150)) + '</div>' +
    '<div class="meta"><span>esc ' + t.escena + ' · ' + (t.segundos || t.segEstimados).toFixed(1) + ' s</span>' +
    '<span class="' + (p.tipo === 'movimiento' ? 'mov' : '') + '">' +
    (p.tipo === 'movimiento' ? 'movimiento' : 'fijo') + '</span></div>';

  d.addEventListener('click', () => seleccionarToma(ep, t));

  if (t.imagen && t.imagen.ok) {
    ponerImagen(d.querySelector('.lienzo'), claveImagenDe(ep.num, t), 'toma ' + (t.i + 1));
  }
  return d;
}

function pintarRejillaProd() {
  const ep = epActual();
  const c = $('rejillaProd');
  c.innerHTML = '';
  $('resumenGuion').textContent = resumenGuion(ep);
  if (!ep) return;
  const lista = ep.tomas.filter((t) => {
    if (filtro === 'faltan') {
      return !(t.audio && t.audio.ok) || !(t.imagen && t.imagen.ok) ||
        (t.plano && t.plano.tipo === 'movimiento' && !(t.video && t.video.ok));
    }
    if (filtro === 'err') {
      return (t.audio && t.audio.ok === false) || (t.imagen && t.imagen.ok === false) ||
        (t.video && t.video.ok === false);
    }
    if (filtro === 'mov') return t.plano && t.plano.tipo === 'movimiento';
    return true;
  });
  for (const t of lista) c.appendChild(tarjetaToma(ep, t, true));
}

/* ── Detalle de toma ────────────────────────────────────────── */

async function seleccionarToma(ep, t) {
  tomaSel = t.i;
  $('detalle').hidden = false;
  $('detTexto').textContent = t.texto;

  const p = t.plano || {};
  const ctx = {
    estilo: P.config.estilo, calidad: P.config.calidad, negativo: P.config.negativo,
    formato: P.config.formato, elenco: P.elenco, lugares: P.lugares,
  };
  $('detPrompt').value = t.promptImagen || (t.plano ? promptImagen(p, ctx) : '');
  $('detAccion').value = p.accionVideo || '';
  $('detMeta').textContent =
    'Toma ' + (t.i + 1) + '/' + ep.tomas.length + ' · escena ' + t.escena +
    ' · ' + (t.segundos ? t.segundos.toFixed(1) + ' s reales' : t.segEstimados.toFixed(1) + ' s estimados') +
    ' · ' + (p.encuadre || 'sin encuadre') + ' · ' + (p.movimiento || '—') +
    ' · lugar: ' + (p.lugar || '—') +
    ' · en cuadro: ' + ((p.personajes && p.personajes.length) ? p.personajes.join(', ') : 'nadie') +
    (t.imagen && t.imagen.refs !== undefined ? ' · ' + t.imagen.refs + ' referencias usadas' : '') +
    (t.bloqueada ? ' · BLOQUEADA' : '') +
    (t.imagen && t.imagen.error ? ' · error de imagen: ' + t.imagen.error : '') +
    (t.video && t.video.error ? ' · error de video: ' + t.video.error : '');

  const v = $('detVista');
  v.innerHTML = '';
  if (t.video && t.video.ok) {
    const u = await assets.url(claveVideoDe(ep.num, t));
    if (u) {
      const el = document.createElement('video');
      el.src = u; el.controls = true; el.playsInline = true; el.muted = true;
      v.appendChild(el);
    }
  } else if (t.imagen && t.imagen.ok) {
    ponerImagen(v, claveImagenDe(ep.num, t), 'toma ' + (t.i + 1), 'unico');
  } else {
    v.innerHTML = '<p class="nota" style="padding:26px;text-align:center">Sin fotograma todavía.</p>';
  }
  if (t.audio && t.audio.ok) {
    const u = await assets.url(clave.audio(ep.num, t.i));
    if (u) { const a = document.createElement('audio'); a.src = u; a.controls = true; a.style.width = '100%'; v.appendChild(a); }
  }
  $('btnBloquear').textContent = t.bloqueada ? 'Desbloquear' : 'Bloquear';
  pintarRejillaProd();
}

/* ── Sala ───────────────────────────────────────────────────── */

function prepararSala() {
  if (!proyector) {
    proyector = new Proyector({
      img: $('salaImg'), vid: $('salaVid'), aud: $('salaAud'), mus: $('salaMus'),
      cfg: P.config,
      pie: $('salaSub'), barra: $('salaBarra'), info: $('salaInfo'),
    });
  }
  $('sala').className = 'sala' + (P.config.formato === '9:16' ? ' v916' : '');
}

/* ── Entrega ────────────────────────────────────────────────── */

function pintarResumenTemporada() {
  const c = $('resumenTemporada');
  if (!P.episodios.length) { c.innerHTML = '<p class="nota">Sin episodios.</p>'; return; }
  let filas = '<table class="cfg"><tr><td>Episodio</td><td>Tomas</td><td>Voz</td><td>Fotogramas</td><td>Movimiento</td><td>Duración</td></tr>';
  let tot = { t: 0, v: 0, i: 0, m: 0, s: 0 };
  for (const ep of P.episodios) {
    const s = estadoEpisodio(ep);
    tot.t += s.tomas; tot.v += s.voz; tot.i += s.imagen; tot.m += s.video; tot.s += s.segundos;
    filas += '<tr><td>EP ' + pad2(ep.num) + ' · ' + esc(ep.titulo) + '</td><td>' + s.tomas +
      '</td><td>' + s.voz + '</td><td>' + s.imagen + '</td><td>' + s.video + '/' + s.movimiento +
      '</td><td>' + fmtDur(s.segundos) + '</td></tr>';
  }
  filas += '<tr><td><strong>Temporada</strong></td><td><strong>' + tot.t + '</strong></td><td><strong>' +
    tot.v + '</strong></td><td><strong>' + tot.i + '</strong></td><td><strong>' + tot.m +
    '</strong></td><td><strong>' + fmtDur(tot.s) + '</strong></td></tr></table>';
  c.innerHTML = filas;
}

/* ── Panel ──────────────────────────────────────────────────── */

const ICONO = {
  libro: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 012-2h13v18H6a2 2 0 01-2-2z"/><path d="M9 3v18"/></svg>',
  pluma: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 4C11 5 6 10 5 19l3-3c6-1 10-5 12-12z"/></svg>',
  gente: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/></svg>',
  mapa: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6l7-3 6 3 7-3v15l-7 3-6-3-7 3z"/><path d="M9 3v15M15 6v15"/></svg>',
  bandera: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
  flecha: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  check: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#12B76A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>',
  play: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563EB" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M10.5 9l5 3-5 3z"/></svg>',
  chispa: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#F79009"><path d="M12 2l2.1 6.1L20 10l-5.4 3.8L16.5 20 12 16.6 7.5 20l1.9-6.2L4 10l5.9-1.9z"/></svg>',
  tilde: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  candado: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
};

/** Fracción terminada de un episodio, contando las tres fases. */
function avanceEpisodio(ep) {
  const s = estadoEpisodio(ep);
  if (!s.tomas) return 0;
  const partes = [s.voz / s.tomas, s.imagen / s.tomas];
  if (s.movimiento) partes.push(s.video / s.movimiento);
  return partes.reduce((a, b) => a + b, 0) / partes.length;
}

/** Los cuatro pasos, en orden, con el que toca resaltado. */
function pintarGuia() {
  const ul = $('panelGuia');
  if (!ul) return;
  const conRefs = P.elenco.filter((p) => p.principal && p.refs && p.refs.length).length;
  const totRefs = P.elenco.filter((p) => p.principal).length;
  const dirigidos = P.episodios.filter((e) => e.tomas.length && e.tomas.every((t) => t.plano)).length;
  const conVoz = P.episodios.filter((e) => estadoEpisodio(e).voz > 0).length;
  const conImg = P.episodios.filter((e) => estadoEpisodio(e).imagen > 0).length;

  const pasos = [
    ['Dibujar a los personajes',
      'Una vez en toda la serie. Se genera la cara de cada personaje y se guarda. Después, cada imagen del episodio lleva esa cara adjunta, y por eso Sōta se ve igual en el episodio uno y en el doce.',
      conRefs + ' de ' + totRefs + ' principales listos', conRefs >= totRefs && totRefs > 0],
    ['Dirigir el episodio',
      'El guion ya está partido en tomas. Aquí una IA decide, para cada toma, qué se ve: si es un primer plano o un plano general, quién sale, dónde ocurre y cómo está iluminado. No toca ni una palabra del texto.',
      dirigidos + ' de ' + P.episodios.length + ' episodios dirigidos', dirigidos >= P.episodios.length && P.episodios.length > 0],
    ['Producir',
      'Tres cosas, en este orden: la voz que narra cada toma, la imagen de cada toma, y el movimiento de las tomas que lo merecen. Se puede parar y seguir cuando quieras.',
      conVoz + ' con voz · ' + conImg + ' con imagen', conVoz > 0 && conImg > 0],
    ['Ver y exportar',
      'En la Sala ves el episodio montado como quedará. En el Archivo lo descargas todo en un .zip con un script que arma el video final.',
      'cuando lo anterior esté hecho', false],
  ];

  const actual = pasos.findIndex((p) => !p[3]);
  ul.innerHTML = pasos.map(([tit, des, dato, hecho], i) =>
    '<li class="' + (hecho ? 'hecho' : '') + '"><div><strong>' + esc(tit) +
    (i === actual ? ' <span class="chip g">te toca</span>' : '') + '</strong>' +
    '<span>' + esc(des) + '</span>' +
    '<span style="display:block;margin-top:5px;color:var(--tinta-3s)">' + esc(dato) + '</span></div></li>'
  ).join('');
}

async function pintarPanel() {
  pintarGuia();
  if (!P.episodios.length) {
    $('panelStats').innerHTML = '';
    $('panelCarrusel').innerHTML = '<p class="nota">Cargando los guiones…</p>';
    return;
  }

  const avances = P.episodios.map(avanceEpisodio);
  const general = Math.round((avances.reduce((a, b) => a + b, 0) / avances.length) * 100);
  const listos = avances.filter((a) => a >= 0.999).length;

  // ── Tarjetas de cifra
  const circ = 2 * Math.PI * 19;
  $('panelStats').innerHTML =
    '<div class="stat"><div class="ico az">' + ICONO.libro + '</div><div class="txt">' +
    '<div class="rot">Episodios</div><div class="val">' + P.episodios.length + '</div>' +
    '<div class="pie2">' + listos + ' terminados</div></div></div>' +

    '<div class="stat"><div class="anillo"><svg width="46" height="46">' +
    '<circle cx="23" cy="23" r="19" fill="none" stroke="#EAECF0" stroke-width="5"/>' +
    '<circle cx="23" cy="23" r="19" fill="none" stroke="#2563EB" stroke-width="5" stroke-linecap="round" ' +
    'stroke-dasharray="' + circ.toFixed(1) + '" stroke-dashoffset="' +
    (circ * (1 - general / 100)).toFixed(1) + '"/></svg><span>' + general + '%</span></div>' +
    '<div class="txt"><div class="rot">Progreso general</div><div class="pie2">de la temporada</div></div></div>' +

    '<div class="stat"><div class="ico vd">' + ICONO.pluma + '</div><div class="txt">' +
    '<div class="rot">Tomas</div><div class="val">' +
    P.episodios.reduce((a, e) => a + e.tomas.length, 0).toLocaleString('es') + '</div>' +
    '<div class="pie2">' + fmtDur(P.episodios.reduce((a, e) =>
      a + e.tomas.reduce((x, t) => x + (t.segundos || t.segEstimados || 0), 0), 0)) + ' de serie</div></div></div>';

  // ── Carrusel de episodios
  const c = $('panelCarrusel');
  c.innerHTML = '';
  P.episodios.forEach((ep, k) => {
    const a = avances[k];
    const pct = Math.round(a * 100);
    const estado = a >= 0.999 ? 'done' : (a > 0 ? 'wip' : 'lock');
    const d = document.createElement('div');
    d.className = 'ep-card' + (ep.num === P.sel ? ' sel' : '');
    d.innerHTML =
      '<div class="velo"></div>' +
      '<div class="num">' + pad2(ep.num) + '</div>' +
      '<div class="cuerpo"><div class="tit">' + esc(ep.titulo) + '</div>' +
      (estado === 'done'
        ? '<span class="badge done">' + ICONO.tilde + ' TERMINADO</span>'
        : estado === 'wip'
          ? '<span class="badge wip">EN PROGRESO</span>' +
            '<div class="barra"><i style="width:' + pct + '%"></i></div>' +
            '<div class="pct">' + pct + ' %</div>'
          : '<span class="badge lock">' + ICONO.candado + ' SIN EMPEZAR</span>') +
      '</div>';
    d.addEventListener('click', () => { P.sel = ep.num; guardar(); pintarTodo(); irA('episodios'); });
    c.appendChild(d);

    // La carátula es el primer fotograma que exista del episodio.
    const conImagen = ep.tomas.find((t) => t.imagen && t.imagen.ok);
    if (conImagen) {
      ponerImagen(d, claveImagenDe(ep.num, conImagen), '');
    }
  });

  // ── Línea de progreso
  const pasos = $('panelPasos');
  pasos.innerHTML = '';
  P.episodios.forEach((ep, k) => {
    const a = avances[k];
    const cls = a >= 0.999 ? 'hecho' : (a > 0 ? 'curso' : '');
    const d = document.createElement('div');
    d.className = 'paso ' + cls;
    d.innerHTML = '<div class="linea"></div><div class="bolita">' +
      (cls === 'hecho' ? ICONO.tilde : (cls === '' ? ICONO.candado : '')) +
      '</div><div class="n">' + ep.num + '</div>';
    d.addEventListener('click', () => { P.sel = ep.num; guardar(); pintarTodo(); irA('episodios'); });
    pasos.appendChild(d);
  });

  // ── Siguiente paso: lo primero que falta, en orden
  // Cualquiera del elenco, no solo los principales: una toma con un personaje
  // sin hoja ya no se genera, así que también bloquea la producción.
  const sinRefs = P.elenco.filter((p) => !p.refs || !p.refs.length);
  const k = avances.findIndex((a) => a < 0.999);
  const ep = k >= 0 ? P.episodios[k] : null;
  let texto, destino, accion;
  if (sinRefs.length) {
    texto = 'Faltan las hojas de referencia de ' + sinRefs.length + ' personaje' +
      (sinRefs.length === 1 ? '' : 's') + '. Sin su hoja, sus tomas no se generan: ' +
      'saldrían con otra cara.';
    destino = 'biblia'; accion = 'Ir a la biblia';
  } else if (ep && !ep.tomas.some((t) => t.plano)) {
    texto = 'El episodio ' + pad2(ep.num) + ' aún no está dirigido.';
    destino = 'episodios'; accion = 'Dirigirlo';
  } else if (ep) {
    texto = 'Continúa la producción del episodio ' + pad2(ep.num) + ' · ' + ep.titulo + '.';
    destino = 'episodios'; accion = 'Continuar';
  } else {
    texto = 'La temporada está completa. Ve al archivo y exporta los doce episodios.';
    destino = 'archivo'; accion = 'Exportar';
  }
  $('panelSiguiente').textContent = texto;
  $('btnPanelContinuar').textContent = accion;
  $('btnPanelContinuar').dataset.destino = destino;
  if (ep) P.sel = P.sel || ep.num;

  // ── Accesos a la biblia
  const conRef = P.elenco.filter((p) => p.refs && p.refs.length);
  const conFondo = P.lugares.filter((l) => l.ref);
  const miniaturas = async (nodo, lista, campo) => {
    const caja = nodo.querySelector('.miniaturas');
    for (const it of lista.slice(0, 4)) {
      const s = document.createElement('span');
      s.textContent = it.nombre.slice(0, 1);
      caja.appendChild(s);
      const idAsset = campo === 'refs'
        ? ((it.refs || []).find((k) => k.endsWith('/rostro')) || (it.refs || [])[0])
        : it.ref;
      if (idAsset) ponerImagen(s, idAsset, '', 'unico');
    }
  };
  const acc = $('panelAccesos');
  acc.innerHTML =
    ['<div class="acceso" data-ir="biblia"><div class="cab">' + ICONO.gente + ' Personajes <span class="n">' +
      P.elenco.length + '</span></div><div class="miniaturas"></div>' +
      '<div class="des">' + conRef.length + ' con hoja de referencia' + ICONO.flecha + '</div></div>',
     '<div class="acceso" data-ir="biblia"><div class="cab">' + ICONO.mapa + ' Lugares <span class="n">' +
      P.lugares.length + '</span></div><div class="miniaturas"></div>' +
      '<div class="des">' + conFondo.length + ' con fondo maestro' + ICONO.flecha + '</div></div>',
     '<div class="acceso" data-ir="sala"><div class="cab">' + ICONO.bandera + ' Arcos <span class="n">3</span></div>' +
      '<div class="miniaturas"></div>' +
      '<div class="des">La Llegada · El Puente · El Rebaño' + ICONO.flecha + '</div></div>',
    ].join('');
  const cajas = acc.querySelectorAll('.acceso');
  miniaturas(cajas[0], conRef.length ? conRef : P.elenco, 'refs');
  miniaturas(cajas[1], conFondo.length ? conFondo : P.lugares, 'ref');
  cajas.forEach((n) => n.addEventListener('click', () => irA(n.dataset.ir)));

  // ── Actividad reciente
  const act = [];
  for (const e of P.episodios) {
    const s = estadoEpisodio(e);
    if (s.video) act.push([ICONO.play, 'Episodio ' + pad2(e.num) + ': ' + s.video + ' clips animados', s.video]);
    if (s.imagen) act.push([ICONO.chispa, 'Episodio ' + pad2(e.num) + ': ' + s.imagen + ' fotogramas', s.imagen]);
    if (s.voz) act.push([ICONO.check, 'Episodio ' + pad2(e.num) + ': voz de ' + s.voz + ' tomas', s.voz]);
  }
  const ul = $('panelActividad');
  ul.innerHTML = act.length
    ? act.sort((a, b) => b[2] - a[2]).slice(0, 6)
      .map(([ico, txt]) => '<li><span class="ico">' + ico + '</span><span class="qu">' + esc(txt) + '</span></li>').join('')
    : '<li><span class="ico">' + ICONO.chispa + '</span><span class="qu">Todavía no hay material generado. Empieza por la biblia visual.</span></li>';

  // ── Cabecera: nombre y portada
  $('heroNombre').textContent = P.config.nombre || 'Estudio';
  const tokio = P.lugares.find((l) => l.id === 'tokio' && l.ref) || P.lugares.find((l) => l.ref);
  if (tokio) {
    const u = await assets.url(tokio.ref);
    if (u) {
      $('hero').style.backgroundImage =
        'linear-gradient(180deg, rgba(5,8,15,.20) 0%, rgba(5,8,15,.55) 46%, rgba(5,8,15,.92) 82%, var(--fondo) 100%), ' +
        'url(' + u + ')';
    }
  }
}

function irA(fase) {
  const b = document.querySelector('nav.abajo button[data-fase="' + fase + '"]');
  if (b) b.click();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ── Presupuesto ────────────────────────────────────────────── */

function costeEpisodio(ep) {
  const pr = P.config.precios;
  const s = estadoEpisodio(ep);
  const caracteres = (ep.tomas || []).reduce((a, t) => a + t.chars, 0);
  // Los mismos segundos que se le van a pedir a Veo, no una estimación aparte.
  const segundosVideo = (ep.tomas || [])
    .filter((t) => t.plano && t.plano.tipo === 'movimiento')
    .reduce((a, t) => a + duracionVeo(P.config.modeloVideo, t.segundos || t.segEstimados || 8), 0);
  const porSegundo = precioSegundo(P.config.modeloVideo, P.config.resolucionVideo, P.config.audioVeo);
  const escenas = escenasDe(ep).length;
  return {
    imagen: s.tomas * pr.imagen,
    video: segundosVideo * porSegundo,
    voz: (caracteres / 1000) * pr.vozMil,
    director: pr.episodio,
    // Lyria cobra por pieza generada, no por segundo: una por escena.
    musica: escenas * precioPieza(P.config.modeloMusica),
    get total() { return this.imagen + this.video + this.voz + this.director + this.musica; },
    tomas: s.tomas,
    segundosVideo,
    escenas,
  };
}

/* ── Planos repetidos ───────────────────────────────────────── */

let repes = [];          // los grupos encontrados en la última búsqueda
const repesFuera = new Set();  // los que el usuario ha desmarcado

function contarReusadas() {
  let n = 0;
  for (const ep of P.episodios) for (const t of ep.tomas || []) if (t.reusa) n++;
  return n;
}

function pintarRepes() {
  const caja = $('listaRepes');
  const ya = contarReusadas();
  $('estRepes').textContent = ya ? ya + ' tomas reutilizan otra' : (repes.length ? 'sin aplicar' : '—');
  $('estRepes').className = 'pg-est' + (ya ? ' hecho' : '');
  $('btnDeshacerRepes').hidden = !ya;
  $('btnAplicarRepes').hidden = !repes.length;

  if (!repes.length) { caja.innerHTML = ''; return; }
  const a = ahorroDe(repes.filter((g) => !repesFuera.has(g.huella + g.maestro.i)));
  caja.innerHTML = '<p class="nota chica" style="margin:0 0 8px">' +
    a.grupos + (a.grupos === 1 ? ' plano repetido' : ' planos repetidos') +
    ' · se ahorrarían <strong>' + a.repetidas + '</strong> imágenes · ' +
    a.entreEpisodios + ' cruzan más de un episodio</p>';

  for (const g of repes) {
    const id = g.huella + g.maestro.i;
    const d = document.createElement('div');
    d.className = 'repe';
    d.innerHTML =
      '<input type="checkbox"' + (repesFuera.has(id) ? '' : ' checked') + '>' +
      '<div class="rt"><b>' + esc(g.encuadre) + ' en ' + esc(g.lugar) +
      (g.personajes.length ? ' · ' + esc(g.personajes.join(', ')) : ' · sin personajes') + '</b>' +
      '<span>' + esc(g.descripcion.slice(0, 150)) + '</span>' +
      '<span style="color:var(--tinta-3s)">EP ' + g.episodios.map(pad2).join(', EP ') +
      ' · se genera la toma ' + (g.maestro.i + 1) + ' del EP ' + pad2(g.maestro.ep) + '</span></div>' +
      '<span class="rn">' + g.miembros.length + ' veces</span>';
    d.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) repesFuera.delete(id); else repesFuera.add(id);
      pintarRepes();
    });
    caja.appendChild(d);
  }
}

function pintarPasos() {
  const ep = epActual();
  const marca = (n, txt, clase) => {
    const e = $('estPaso' + n);
    if (!e) return;
    e.textContent = txt;
    e.className = 'pg-est' + (clase ? ' ' + clase : '');
    const caja = e.closest('.paso-gen');
    if (caja) caja.classList.toggle('listo', clase === 'hecho');
  };
  if (!ep) { for (let n = 1; n <= 5; n++) marca(n, 'sin episodio', ''); return; }

  const s = estadoEpisodio(ep);
  const linea = (hechas, total, palabra) => {
    if (!total) return ['—', ''];
    if (hechas >= total) return [total + ' ' + palabra + ' · completo', 'hecho'];
    if (hechas === 0) return ['0 de ' + total + ' ' + palabra, ''];
    return [hechas + ' de ' + total + ' ' + palabra, 'parcial'];
  };
  marca(1, ...linea(s.dirigido, s.tomas, 'tomas'));
  marca(2, ...linea(s.voz, s.tomas, 'voces'));
  marca(3, ...linea(s.imagen, s.tomas, 'fotogramas'));
  // El movimiento solo aplica a las tomas que el director marcó como tal.
  marca(4, ...(s.movimiento
    ? linea(s.video, s.movimiento, 'clips')
    : ['ninguna toma marcada con movimiento', '']));
  marca(5, ...linea(s.musica, s.escenas, 'escenas'));
}

function pintarCoste() {
  const c = $('tablaCoste');
  if (!c) return;
  if (!P.episodios.length) { c.innerHTML = '<p class="nota">Sin episodios.</p>'; return; }
  const ep = epActual();
  const usd = (n) => '$' + n.toFixed(2);

  let temporada = 0, tomas = 0, segVid = 0, escenas = 0;
  for (const e of P.episodios) {
    const k = costeEpisodio(e);
    temporada += k.total; tomas += k.tomas; segVid += k.segundosVideo; escenas += k.escenas;
  }
  const k = ep ? costeEpisodio(ep) : null;

  c.innerHTML =
    '<table class="cfg">' +
    (k ? '<tr><td>EP ' + pad2(ep.num) + ' — ' + k.tomas + ' fotogramas</td><td>' + usd(k.imagen) + '</td></tr>' +
      '<tr><td>EP ' + pad2(ep.num) + ' — ' + k.segundosVideo + ' s de video</td><td>' + usd(k.video) + '</td></tr>' +
      '<tr><td>EP ' + pad2(ep.num) + ' — voz</td><td>' + usd(k.voz) + '</td></tr>' +
      '<tr><td>EP ' + pad2(ep.num) + ' — ' + k.escenas + ' piezas de música</td><td>' + usd(k.musica) + '</td></tr>' +
      '<tr><td>EP ' + pad2(ep.num) + ' — dirección</td><td>' + usd(k.director) + '</td></tr>' +
      '<tr><td><strong>Este episodio</strong></td><td><strong>' + usd(k.total) + '</strong></td></tr>' : '') +
    '<tr><td><strong>Temporada completa</strong> — ' + tomas + ' fotogramas, ' + segVid +
    ' s de video, ' + escenas + ' piezas de música</td>' +
    '<td><strong>' + usd(temporada) + '</strong></td></tr>' +
    '</table>' +
    '<p class="nota chica">Solo se cobra lo que se genera: si detienes a mitad, pagas la mitad. Bajar la ' +
    'proporción de tomas con movimiento es, de lejos, la palanca que más cambia esta cifra.</p>';
}

async function pintarAlmacen() {
  const t = await assets.tamanoTotal();
  const q = await cuota();
  $('infoAlmacen').textContent =
    t.archivos + ' archivos generados · ' + (t.bytes / 1048576).toFixed(1) + ' MB' +
    (q ? ' · el navegador te da ' + (q.total / 1073741824).toFixed(1) + ' GB en total' : '');
}

/* ── Pintado global ─────────────────────────────────────────── */

function pintarTodo() {
  pintarListaEps();
  pintarSelectores();
  pintarRejillaProd();
  pintarPasos();
  pintarRepes();
  pintarNotasModelo();
  pintarCoste();
  pintarResumenTemporada();
  pintarAlmacen();
  pintarPanel();
  const ep = epActual();
  $('cuentaProd').textContent = ep ? ep.tomas.length + ' tomas' : '';
  $('cuentaElenco').textContent = P.elenco.length;
  $('cuentaLugares').textContent = P.lugares.length;
}

/* ── Ajustes ────────────────────────────────────────────────── */

function abrirAjustes() {
  const c = P.config;
  const opciones = (sel, lista, val) => {
    sel.innerHTML = '';
    for (const [v, txt] of lista) {
      const o = document.createElement('option');
      o.value = v; o.textContent = v ? v + ' — ' + txt : txt;
      sel.appendChild(o);
    }
    sel.value = val;
  };
  opciones($('cfgVoz'), VOCES, c.voz);
  pintarMotorVoz();
  pintarTonos();
  opciones($('cfgIdioma'), IDIOMAS, c.idioma);
  poblarModelos();
  $('cfgResVideo').value = c.resolucionVideo;
  $('cfgTempVoz').value = c.temperaturaVoz;
  $('valTempVoz').textContent = Number(c.temperaturaVoz).toFixed(2);
  $('valSemilla').textContent = c.semillaVoz || SEMILLA_FIJA;
  $('cfgNombre').value = c.nombre || '';
  $('cfgInstruccionVoz').value = c.instruccionVoz;
  $('cfgNormalizar').checked = c.normalizarVoz;
  $('cfgAnunciar').checked = c.anunciarTitulo;
  $('cfgAudioVeo').checked = c.audioVeo;
  $('cfgSilencio').value = c.silencioEscena;
  $('dlgAjustes').showModal();
}

function guardarAjustes() {
  const c = P.config;
  c.voz = $('cfgVoz').value;
  c.idioma = $('cfgIdioma').value;
  // Los cinco modelos ya se fijaron al cambiarlos (fijarModelo): volver a
  // leerlos aquí solo servía para reintroducir lo que hubiera en pantalla.
  c.resolucionVideo = $('cfgResVideo').value;
  c.temperaturaVoz = parseFloat($('cfgTempVoz').value);
  // La semilla no se teclea: se conserva la que ya tiene la configuración.
  c.nombre = $('cfgNombre').value.trim();
  c.instruccionVoz = $('cfgInstruccionVoz').value.trim();
  c.normalizarVoz = $('cfgNormalizar').checked;
  c.anunciarTitulo = $('cfgAnunciar').checked;
  c.audioVeo = $('cfgAudioVeo').checked;
  c.silencioEscena = Math.min(3, Math.max(0, parseFloat($('cfgSilencio').value) || 0));
  guardar();
  $('dlgAjustes').close();
  pintarTodo();
}

/* ── Texto normalizado: comparación ─────────────────────────── */

function mostrarDiferencias() {
  const ep = epActual();
  if (!ep) return;
  const reemplazos = P.config.reemplazos || REEMPLAZOS_BASE;
  const filas = [];
  for (const t of ep.tomas) {
    const n = normalizarParaVoz(t.texto, reemplazos);
    if (n.replace(/\s+/g, ' ') !== t.texto.replace(/\s+/g, ' ')) {
      filas.push(
        '<div style="border-bottom:1px dashed var(--linea);padding:8px 0">' +
        '<div style="color:var(--ceniza)">toma ' + (t.i + 1) + ' — original</div>' +
        '<div>' + esc(t.texto) + '</div>' +
        '<div style="color:var(--ambar);margin-top:5px">se leerá como</div>' +
        '<div>' + esc(n) + '</div></div>');
    }
  }
  $('difTexto').innerHTML = filas.length
    ? '<p style="color:var(--ceniza);margin:0 0 8px">' + filas.length + ' de ' + ep.tomas.length +
      ' tomas cambian al normalizar.</p>' + filas.join('')
    : '<p style="color:var(--mar);margin:0">Ninguna toma necesita normalización en este episodio.</p>';
  $('dlgTexto').showModal();
}

/* ── Eventos ────────────────────────────────────────────────── */

function cablear() {
  // Navegación inferior
  document.querySelectorAll('nav.abajo button').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('nav.abajo button').forEach((x) => x.classList.remove('on'));
      document.querySelectorAll('section.fase').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      $('fase-' + b.dataset.fase).classList.add('on');
      if (b.dataset.fase === 'panel') pintarPanel();
      if (b.dataset.fase === 'biblia') pintarFichas();
      if (b.dataset.fase === 'sala') { prepararSala(); const ep = epActual(); if (ep) proyector.cargar(ep); }
    });
  });
  $('btnVerEpisodios').addEventListener('click', () => irA('episodios'));
  $('btnGuiaMas').addEventListener('click', () => {
    const b = $('btnPanelContinuar');
    aviso('Paso actual: ' + $('panelSiguiente').textContent, 'info', 7000);
    b.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  $('btnConexion').addEventListener('click', () => { irA('archivo'); comprobarConexion(); });
  $('btnPanelContinuar').addEventListener('click', (ev) => irA(ev.currentTarget.dataset.destino || 'episodios'));

  // Selectores de modelo: los tres puntos de generación comparten valor
  for (const id of ['cfgModeloImagen', 'selModImgProd', 'selModImgBiblia']) {
    $(id).addEventListener('change', (e) => fijarModelo('imagen', e.target.value));
  }
  for (const id of ['cfgModeloVideo', 'selModVidProd']) {
    $(id).addEventListener('change', (e) => fijarModelo('video', e.target.value));
  }
  $('cfgModeloTexto').addEventListener('change', (e) => fijarModelo('texto', e.target.value));
  /*  El de voz era el único que no se fijaba al cambiarlo: se leía al pulsar
      «Guardar». Pero cambiar el modelo de imagen o de video llama a
      poblarModelos(), que repinta TODOS los desplegables desde P.config, así
      que la elección de voz aún sin guardar se perdía sin decir nada.       */
  $('cfgModeloTts').addEventListener('change', (e) => fijarModelo('voz', e.target.value));
  for (const id of ['selResImgProd', 'selResImgBiblia']) {
    $(id).addEventListener('change', (e) => {
      P.config.imageSize = e.target.value;
      poblarModelos(); guardar(); pintarCoste();
    });
  }

  // Proyecto
  $('btnPing').addEventListener('click', comprobarConexion);
  $('btnDescubrir').addEventListener('click', descubrirModelos);
  $('btnCargarSerie').addEventListener('click', cargarSerie);
  $('btnRecalcular').addEventListener('click', async () => {
    for (const ep of P.episodios) recalcularTomas(ep);
    await guardar(); pintarTodo();
    estado('estadoGuion', 'Tomas recalculadas en los ' + P.episodios.length + ' episodios.', 'ok');
  });
  $('fileInput').addEventListener('change', async (ev) => {
    for (const f of Array.from(ev.target.files || [])) {
      añadirEpisodio(f.name, await f.text());
    }
    ev.target.value = '';
    await guardar(); pintarTodo();
  });
  $('btnPersistir').addEventListener('click', async () => {
    const ok = await pedirPersistencia();
    $('infoAlmacen').textContent = ok
      ? 'Almacenamiento protegido: el navegador ya no borrará el proyecto por falta de espacio.'
      : 'El navegador no concedió almacenamiento persistente. Exporta a menudo.';
  });
  $('btnVaciar').addEventListener('click', async () => {
    if (!confirm('Esto borra TODO el material generado (voces, fotogramas y clips), tanto en este navegador como en Google Cloud. Los guiones y el guion técnico se conservan. ¿Seguir?')) return;
    const ks = await assets.claves();
    for (const k of ks) await assets.borrar(k);
    if (nube.disponible) { try { await nube.vaciar(); } catch (e) { /* seguimos */ } }
    for (const ep of P.episodios) {
      for (const t of ep.tomas) { t.audio = null; t.imagen = null; t.video = null; t.segundos = null; }
    }
    for (const p of P.elenco) p.refs = [];
    for (const l of P.lugares) l.ref = null;
    await guardar(); pintarTodo(); pintarFichas();
  });

  // Biblia
  $('btnRestaurarArte').addEventListener('click', async () => {
    if (!confirm('Esto devuelve el estilo, el acabado y todas las fichas a la versión del ' +
      'repositorio. Se pierde lo que hayas escrito tú. ¿Seguir?')) return;
    for (const c of ['estiloEditado', 'calidadEditado', 'negativoEditado']) P.config[c] = false;
    for (const x of P.elenco.concat(P.lugares)) x.editada = false;
    const n = actualizarBiblia(true);
    await guardar();
    $('cfgEstilo').value = P.config.estilo;
    $('cfgCalidad').value = P.config.calidad;
    $('cfgNegativo').value = P.config.negativo;
    pintarFichas(); pintarTodo();
    aviso(n + ' elementos restaurados. Vuelve a generar las hojas para verlo.', 'ok', 7000);
  });
  $('btnGuardarArte').addEventListener('click', async () => {
    P.config.estilo = $('cfgEstilo').value.trim() || ESTILO_DEFECTO;
    P.config.estiloEditado = P.config.estilo !== ESTILO_DEFECTO;
    P.config.calidadEditado = $('cfgCalidad').value.trim() !== CALIDAD_DEFECTO;
    P.config.negativoEditado = $('cfgNegativo').value.trim() !== NEGATIVO_DEFECTO;
    P.config.negativo = $('cfgNegativo').value.trim() || NEGATIVO_DEFECTO;
    P.config.calidad = $('cfgCalidad').value.trim() || CALIDAD_DEFECTO;
    P.config.maxReferencias = parseInt($('cfgMaxRefs').value, 10) || 3;
    await guardar(); pintarTodo();
  });
  $('btnRefsPrincipales').addEventListener('click', async () => {
    jobMostrar('referencias');
    await nuevoMotor().generarReferencias(P.elenco.filter((p) => p.principal).map((p) => p.id));
    await guardar(); pintarFichas();
    // Contar quién tiene TODAS sus hojas, no quién tiene alguna: antes salía
    // un cartel verde de éxito aunque hubieran fallado tres de cada cuatro.
    const dianas = P.elenco.filter((p) => p.principal);
    const enteros = dianas.filter((p) => (p.refs || []).length === variantesDe(p).length).length;
    aviso(enteros === dianas.length
      ? 'Los ' + dianas.length + ' personajes principales tienen ya todas sus hojas.'
      : enteros + ' de ' + dianas.length + ' quedaron completos. Lo que falló está anotado abajo.',
      enteros === dianas.length ? 'ok' : 'err', 8000);
  });
  $('btnRefsTodos').addEventListener('click', async () => {
    jobMostrar('referencias');
    await nuevoMotor().generarReferencias(null, true);
    await guardar(); pintarFichas();
  });
  $('btnFondos').addEventListener('click', async () => {
    jobMostrar('fondos');
    await nuevoMotor().generarFondos(P.lugares.filter((l) => !l.ref).map((l) => l.id));
    await guardar(); pintarFichas();
  });
  $('btnNuevoPersonaje').addEventListener('click', () => abrirFicha('personaje', null));
  $('btnNuevoLugar').addEventListener('click', () => abrirFicha('lugar', null));
  $('btnFichaCancelar').addEventListener('click', () => $('dlgFicha').close());
  $('btnFichaGuardar').addEventListener('click', async () => {
    const { tipo, obj } = fichaEditando;
    const nombre = $('fichaNombre').value.trim();
    if (!nombre) { alert('Hace falta un nombre.'); return; }
    const alias = $('fichaAlias').value.split(',').map((s) => s.trim()).filter(Boolean);
    const ficha = $('fichaTexto').value.trim();
    if (obj) {
      obj.nombre = nombre; obj.alias = alias; obj.ficha = ficha;
      obj.editada = true;                        // a partir de aquí, no se sobrescribe
      if (tipo === 'personaje') obj.principal = $('fichaPrincipal').checked;
    } else {
      const id = nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]/g, '').slice(0, 18) || ('x' + Date.now().toString(36));
      if (tipo === 'personaje') {
        P.elenco.push({ id, nombre, alias, ficha, principal: $('fichaPrincipal').checked, refs: [] });
      } else {
        P.lugares.push({ id, nombre, alias, ficha, ref: null });
      }
    }
    await guardar(); $('dlgFicha').close(); pintarFichas();
  });
  $('btnFichaBorrar').addEventListener('click', async () => {
    const { tipo, obj } = fichaEditando;
    if (!obj || !confirm('¿Eliminar «' + obj.nombre + '» de la biblia?')) return;
    if (tipo === 'personaje') P.elenco = P.elenco.filter((p) => p !== obj);
    else P.lugares = P.lugares.filter((l) => l !== obj);
    await guardar(); $('dlgFicha').close(); pintarFichas();
  });

  // Guion
  $('selEpGuion').addEventListener('change', (e) => { P.sel = Number(e.target.value); guardar(); pintarTodo(); });
  $('btnDirigir').addEventListener('click', () => dirigir(epActual()));
  $('btnDirigirTodo').addEventListener('click', async () => {
    if (!confirm('Se planificarán los ' + P.episodios.length + ' episodios. Puede tardar bastante. ¿Seguir?')) return;
    for (const ep of P.episodios) { P.sel = ep.num; pintarSelectores(); await dirigir(ep); }
  });
  $('btnRepartir').addEventListener('click', async () => {
    const ep = epActual();
    if (!ep) return;
    const planos = ep.tomas.map((t) => t.plano).filter(Boolean);
    if (planos.length !== ep.tomas.length) { alert('Dirige el episodio primero.'); return; }
    const conTipo = repartirMovimiento(planos, P.config.proporcionMovimiento);
    ep.tomas.forEach((t, i) => { t.plano = conTipo[i]; });
    await guardar(); pintarTodo();
  });
  $('btnVerTexto').addEventListener('click', mostrarDiferencias);
  $('btnTextoCerrar').addEventListener('click', () => $('dlgTexto').close());
  $('cfgSegToma').addEventListener('input', (e) => { $('valSegToma').textContent = e.target.value + ' s'; });
  $('cfgSegToma').addEventListener('change', async (e) => {
    P.config.segundosPorToma = Number(e.target.value);
    for (const ep of P.episodios) recalcularTomas(ep);
    await guardar(); pintarTodo();
  });
  $('cfgIntensidad').addEventListener('input', (e) => { $('valIntensidad').textContent = e.target.value + ' %'; });
  $('cfgIntensidad').addEventListener('change', async (e) => {
    P.config.intensidadCamara = Number(e.target.value) / 100;
    await guardar();
    aviso('Movimiento de cámara al ' + e.target.value + ' %. Se aplica al ver la Sala y al montar; ' +
      'no hay que regenerar nada.', 'ok', 6000);
  });
  $('cfgVolMusica').addEventListener('input', (e) => { $('valVolMusica').textContent = e.target.value + ' %'; });
  $('cfgVolMusica').addEventListener('change', async (e) => {
    P.config.volumenMusica = Number(e.target.value) / 100;
    await guardar();
    if (proyector) proyector.cfg = P.config;
    aviso('Música al ' + e.target.value + ' %. Se aplica al instante; no hay que regenerarla.', 'ok', 6000);
  });
  $('btnNuevaSemilla').addEventListener('click', async () => {
    // Un número cualquiera vale; lo único que importa es que no cambie después.
    P.config.semillaVoz = Math.floor(Math.random() * 900000000) + 1000;
    $('valSemilla').textContent = P.config.semillaVoz;
    await guardar();
    aviso('Semilla nueva. Escucha el tono para oírla; si te gusta, rehaz la voz.', 'ok', 7000);
  });
  $('cfgMotorVoz').addEventListener('change', async (e) => {
    P.config.motorVoz = e.target.value;
    pintarMotorVoz();
    await guardar();
    aviso(!narraEpisodioEntero(P.config)
      ? 'Vuelves al modo por bloques. Si ya hay voz generada, hay que rehacerla para oír el cambio.'
      : 'El episodio se narrará de una vez, con el mismo narrador de principio a fin. ' +
        'Hay que rehacer la voz para oírlo.', 'ok', 8000);
  });
  $('cfgVozChirp').addEventListener('change', async (e) => {
    P.config.vozChirp = e.target.value;
    await guardar();
    aviso('Narrador: ' + nombreVozChirp(e.target.value) + '. Rehaz la voz para oírlo.', 'ok', 6000);
  });
  $('cfgVelocidadVoz').addEventListener('input', (e) => {
    $('valVelocidadVoz').textContent = Number(e.target.value).toFixed(2) + 'x';
  });
  $('cfgVelocidadVoz').addEventListener('change', async (e) => {
    P.config.velocidadVoz = Number(e.target.value);
    await guardar();
    aviso('Velocidad ' + P.config.velocidadVoz.toFixed(2) + 'x. Se aplica al narrar: ' +
      'hay que rehacer la voz.', 'ok', 7000);
  });
  $('cfgTono').addEventListener('change', async (e) => {
    if (e.target.value === '__propio') { pintarTonos(); return; }
    const t = aplicarTono(P.config, e.target.value);
    // Los campos de ajuste fino reflejan el tono elegido, por si se quiere mirar.
    $('cfgVoz').value = t.voz;
    $('cfgTempVoz').value = t.temperatura;
    $('valTempVoz').textContent = Number(t.temperatura).toFixed(2);
    $('cfgInstruccionVoz').value = t.instruccion;
    await guardar();
    pintarTonos();
    aviso('Tono «' + t.nombre + '» aplicado. Escúchalo antes de generar; si ya hay voz ' +
      'generada, hay que rehacerla para que cambie.', 'ok', 8000);
  });
  // Tocar el ajuste fino desengancha del tono: hay que decirlo.
  for (const id of ['cfgVoz', 'cfgTempVoz', 'cfgInstruccionVoz']) {
    $(id).addEventListener('change', () => { P.config.tono = null; pintarTonos(); });
  }
  $('cfgMovim').addEventListener('input', (e) => { $('valMovim').textContent = e.target.value + ' %'; });
  $('cfgMovim').addEventListener('change', async (e) => {
    P.config.proporcionMovimiento = Number(e.target.value) / 100;
    // Mover el mando tiene que hacer algo. Antes solo guardaba el número y no
    // se repartía nada hasta pulsar otro botón, así que bajar el porcentaje
    // parecía funcionar y seguías pagando el anterior.
    let tocados = 0;
    for (const ep of P.episodios) {
      const planos = ep.tomas.map((x) => x.plano);
      if (planos.some((p) => !p)) continue;
      const conTipo = repartirMovimiento(planos, P.config.proporcionMovimiento);
      ep.tomas.forEach((x, i) => { x.plano = conTipo[i]; });
      tocados++;
    }
    await guardar(); pintarTodo();
    if (tocados) {
      log('movimiento repartido de nuevo en ' + tocados +
        (tocados === 1 ? ' episodio dirigido' : ' episodios dirigidos'), 'ok');
    }
  });
  $('cfgFormato').addEventListener('change', async (e) => {
    P.config.formato = e.target.value;
    await guardar(); pintarTodo();
  });

  // Producción
  const producir = async (fases, etiqueta) => {
    const ep = epActual();
    if (!ep) return;
    if (!ep.tomas.some((t) => t.plano) && (fases.imagen || fases.video)) {
      estado('estadoProd', 'Este episodio no está dirigido: pulsa antes el paso 1, «Dirigir este episodio».', 'err');
      return;
    }
    estado('estadoProd', '');
    jobMostrar(etiqueta);
    await nuevoMotor().producirEpisodio(ep, fases);
    await guardar();

    /*  Una tanda larga desde el móvil deja fallos de conexión por el camino.
        Reintentar lo que falta es gratis en atención del usuario y casi
        siempre los recupera, así que se hace solo: hasta dos pasadas más, y
        solo mientras se siga avanzando. Si una pasada no arregla nada, parar
        y decirlo, en vez de dar vueltas.                                     */
    let antes = estadoEpisodio(ep).errores;
    for (let vuelta = 0; vuelta < 2 && antes > 0; vuelta++) {
      if (motor && motor.abort && motor.abort.signal.aborted) break;
      log('quedan ' + antes + ' con error; pasada de recuperación ' + (vuelta + 1) + ' de 2', 'aviso');
      jobMostrar(etiqueta + ' · recuperando');
      await nuevoMotor().producirEpisodio(ep, fases);
      await guardar();
      const ahora = estadoEpisodio(ep).errores;
      if (ahora >= antes) { antes = ahora; break; }
      antes = ahora;
    }

    const s = estadoEpisodio(ep);
    estado('estadoProd',
      'EP ' + pad2(ep.num) + ' — voz ' + s.voz + '/' + s.tomas + ' · fotogramas ' + s.imagen + '/' + s.tomas +
      ' · movimiento ' + s.video + '/' + s.movimiento +
      (s.errores ? ' · ' + s.errores + ' sin terminar: vuelve a pulsar el mismo botón, ' +
        'solo se genera lo que falta' : ''),
      s.errores ? 'info' : 'ok');
  };
  $('btnProdTodo').addEventListener('click', () =>
    producir({ voz: true, imagen: true, video: true, musica: true }, 'producción'));
  $('btnProdVoz').addEventListener('click', () => producir({ voz: true }, 'voz'));
  $('btnProdImg').addEventListener('click', () => producir({ imagen: true }, 'fotogramas'));
  $('btnProdVid').addEventListener('click', () => producir({ video: true }, 'movimiento'));
  $('btnProdMus').addEventListener('click', () => producir({ musica: true }, 'música'));

  /*  «Generar» completa lo que falta; «Rehacer» tira lo hecho y lo vuelve a
      generar. Hace falta cuando lo que cambia no es el resultado sino la
      receta: otra voz, otro modelo de imagen, otra dirección de arte.        */
  const rehacer = async (fase, etiqueta, contarCoste) => {
    const ep = epActual();
    if (!ep) return;
    const n = fase === 'musica' ? escenasDe(ep).length
      : fase === 'video' ? ep.tomas.filter((t) => t.plano && t.plano.tipo === 'movimiento').length
        : ep.tomas.length;
    if (!n) { estado('estadoProd', 'No hay nada que rehacer en este episodio.', 'info'); return; }
    if (!confirm('Se va a rehacer ' + etiqueta + ' del episodio ' + pad2(ep.num) + ': ' + n +
      (contarCoste ? ' generaciones que ya están hechas y se van a pagar otra vez' : ' elementos') +
      '. ¿Seguir?')) return;
    jobMostrar('rehacer ' + etiqueta);
    const m = nuevoMotor();
    if (fase === 'voz') await m.generarVozDe(ep, false);
    else if (fase === 'imagen') await m.generarImagenes(ep, false);
    else if (fase === 'video') await m.generarVideos(ep, false);
    else if (fase === 'musica') await m.generarMusica(ep, false);
    await guardar(); pintarTodo();
  };
  $('btnRehacerVoz').addEventListener('click', () => rehacer('voz', 'la voz', true));
  $('btnRehacerImg').addEventListener('click', () => rehacer('imagen', 'los fotogramas', true));
  $('btnRehacerVid').addEventListener('click', () => rehacer('video', 'el movimiento', true));
  $('btnRehacerMus').addEventListener('click', () => rehacer('musica', 'la música', true));
  $('btnBuscarRepes').addEventListener('click', () => {
    const dirigidos = P.episodios.filter((e) => (e.tomas || []).some((t) => t.plano));
    if (!dirigidos.length) {
      estado('estadoProd', 'Primero hay que dirigir: sin planos no hay nada que comparar.', 'err');
      return;
    }
    repes = agrupar(P.episodios, { umbral: parseFloat($('selRigor').value) });
    repesFuera.clear();
    pintarRepes();
    const a = ahorroDe(repes);
    log(a.grupos ? 'encontrados ' + a.grupos + ' planos repetidos en ' + dirigidos.length +
      ' episodios dirigidos: ' + a.repetidas + ' imágenes de menos' : 'no hay planos repetidos', 'ok');
  });
  $('selRigor').addEventListener('change', () => { if (repes.length) $('btnBuscarRepes').click(); });
  $('btnAplicarRepes').addEventListener('click', async () => {
    const elegidos = repes.filter((g) => !repesFuera.has(g.huella + g.maestro.i));
    const n = aplicarRepes(P.episodios, elegidos, {
      imagen: clave.imagen, video: clave.video,
      duracion: (t) => duracionVeo(P.config.modeloVideo, t.segundos || t.segEstimados || 8),
    });
    await guardar(); pintarTodo();
    aviso(n + ' tomas reutilizarán el fotograma de otra. No se generarán por su cuenta.', 'ok', 7000);
  });
  $('btnDeshacerRepes').addEventListener('click', async () => {
    const n = limpiarRepes(P.episodios);
    await guardar(); pintarTodo();
    aviso(n + ' tomas vuelven a generarse por su cuenta.', 'info', 6000);
  });
  $('selModMusProd').addEventListener('change', (e) => fijarModelo('musica', e.target.value));
  const detener = () => { if (motor) motor.detener(); log('detención solicitada', 'err'); };
  $('btnDetenerProd').addEventListener('click', detener);
  $('btnDetenerGlobal').addEventListener('click', detener);

  for (const [id, f] of [['filtroTodas', 'todas'], ['filtroFaltan', 'faltan'], ['filtroErr', 'err'], ['filtroMov', 'mov']]) {
    $(id).addEventListener('click', () => { filtro = f; pintarRejillaProd(); });
  }

  // Presupuesto
  $('btnGuardarPrecios').addEventListener('click', async () => {
    P.config.precios = {
      imagen: parseFloat($('pxImagen').value) || 0,
      vozMil: parseFloat($('pxVoz').value) || 0,
      episodio: parseFloat($('pxTexto').value) || 0,
    };
    await guardar(); pintarCoste();
  });

  // Detalle
  const conToma = (fn) => async () => {
    const ep = epActual();
    if (!ep || tomaSel == null) return;
    const t = ep.tomas[tomaSel];
    await fn(ep, t);
    await guardar();
    await seleccionarToma(ep, t);
  };
  $('btnRegenImg').addEventListener('click', conToma(async (ep, t) => {
    jobMostrar('fotograma');
    t.bloqueada = false;
    await nuevoMotor().generarImagenes(ep, false, [t.i]);
  }));
  $('btnRegenVoz').addEventListener('click', conToma(async (ep, t) => {
    /*  Con una locución por episodio no existe «rehacer solo esta toma»: el
        audio es una pieza y la toma es un recorte suyo. Se dice antes de
        gastar, en vez de rehacer el episodio entero por sorpresa.          */
    if (narraEpisodioEntero(P.config) &&
        !confirm('La voz de este episodio es una sola locución continua, así que esta toma no ' +
          'se puede rehacer por separado: se vuelve a narrar el episodio entero.\n\n' +
          '¿Lo narro otra vez?')) return;
    jobMostrar('voz');
    // Sin soloFaltantes: rehacer significa rehacer, aunque ya exista.
    await nuevoMotor().generarVozDe(ep, false, [t.i]);
  }));
  $('btnRegenMus').addEventListener('click', conToma(async (ep, t) => {
    jobMostrar('música · escena ' + t.escena);
    await nuevoMotor().generarMusica(ep, false, [t.escena]);
  }));
  $('btnRegenVid').addEventListener('click', conToma(async (ep, t) => {
    if (!t.imagen || !t.imagen.ok) { alert('Genera antes el fotograma de esta toma.'); return; }
    jobMostrar('movimiento');
    await nuevoMotor().generarVideos(ep, false, [t.i]);
  }));
  $('btnAlternarTipo').addEventListener('click', conToma(async (ep, t) => {
    if (!t.plano) return;
    t.plano.tipo = t.plano.tipo === 'movimiento' ? 'fijo' : 'movimiento';
  }));
  $('btnBloquear').addEventListener('click', conToma(async (ep, t) => { t.bloqueada = !t.bloqueada; }));
  $('btnGuardarToma').addEventListener('click', conToma(async (ep, t) => {
    t.promptImagen = $('detPrompt').value.trim();
    t.promptEditado = true;
    if (t.plano) t.plano.accionVideo = $('detAccion').value.trim();
  }));

  // Sala
  $('selEpSala').addEventListener('change', async (e) => {
    P.sel = Number(e.target.value); await guardar(); pintarTodo();
    prepararSala(); await proyector.cargar(epActual());
  });
  $('btnSalaPlay').addEventListener('click', async () => {
    prepararSala();
    if (!proyector.ep) await proyector.cargar(epActual());
    if (proyector.reproduciendo) { proyector.pausar(); $('btnSalaPlay').textContent = 'Reproducir'; }
    else { await proyector.reproducir(); $('btnSalaPlay').textContent = 'Pausa'; }
  });
  $('btnSalaAtras').addEventListener('click', () => {
    if (proyector && proyector.pos > 0) proyector.irA(proyector.orden[proyector.pos - 1].i);
  });
  $('btnSalaAdelante').addEventListener('click', () => {
    if (proyector && proyector.pos + 1 < proyector.orden.length) proyector.irA(proyector.orden[proyector.pos + 1].i);
  });
  $('cfgSubs').addEventListener('change', (e) => { $('salaSub').style.display = e.target.checked ? '' : 'none'; });

  // Entrega
  $('selEpExport').addEventListener('change', (e) => { P.sel = Number(e.target.value); guardar(); pintarTodo(); });
  $('btnExportEp').addEventListener('click', async () => {
    const ep = epActual();
    if (!ep) return;
    jobMostrar('empaquetado');
    estado('estadoExport', 'Reuniendo el material…', 'info');
    try {
      const r = await exportarEpisodio(ep, P.config, (h, t, txt) => jobAvance(h, t, txt));
      descargar(r.blob, 'DIEZMO-EP' + pad2(ep.num) + '.zip');
      estado('estadoExport',
        'Listo: ' + (r.blob.size / 1048576).toFixed(1) + ' MB · ' + r.hoja.tomas.length + ' tomas · ' +
        fmtDur(r.hoja.duracionTotal), 'ok');
    } catch (e) {
      estado('estadoExport', 'La exportación falló: ' + e.message, 'err');
    }
    jobOcultar();
  });
  $('btnExportAudio').addEventListener('click', async () => {
    const ep = epActual();
    const b = ep && await audioCompleto(ep);
    if (!b) { estado('estadoExport', 'Este episodio no tiene voz generada.', 'err'); return; }
    descargar(b, 'DIEZMO-EP' + pad2(ep.num) + '-voz.wav');
  });
  $('btnExportGuion').addEventListener('click', () => {
    const ep = epActual();
    if (!ep) return;
    const hoja = hojaDeMontaje(ep, P.config);
    descargar(new Blob([scriptFfmpeg(hoja)], { type: 'text/plain' }), 'montar-ep' + pad2(ep.num) + '.sh');
    descargar(new Blob([JSON.stringify(hoja, null, 2)], { type: 'application/json' }), 'montaje-ep' + pad2(ep.num) + '.json');
  });
  // Ajustes
  $('btnAjustes').addEventListener('click', abrirAjustes);
  $('btnAjCancelar').addEventListener('click', () => $('dlgAjustes').close());
  $('btnAjGuardar').addEventListener('click', guardarAjustes);
  $('cfgTempVoz').addEventListener('input', (e) => { $('valTempVoz').textContent = Number(e.target.value).toFixed(2); });
  $('btnProbarTono').addEventListener('click', async () => {
    const btn = $('btnProbarTono');
    btn.disabled = true; btn.textContent = 'generando…';
    try {
      const muestra = 'Así llegó la especie humana al mundo-astillero: descargando cajas. ' +
        'Nadie dio un discurso. Quedaban seis ciclos.';
      const r = await api.tts({
        text: $('cfgNormalizar').checked ? normalizarParaVoz(muestra, REEMPLAZOS_BASE) : muestra,
        voice: $('cfgVoz').value,
        model: $('cfgModeloTts').value,
        styleInstruction: $('cfgInstruccionVoz').value,
        temperature: parseFloat($('cfgTempVoz').value),
        languageCode: $('cfgIdioma').value || undefined,
        seed: Number(P.config.semillaVoz) || undefined,
      });
      const ex = extraerPCM(b64aBytes(r.audio), r.sampleRate || 24000);
      const a = $('audioPrueba');
      a.src = URL.createObjectURL(crearWav([ex.pcm], ex.rate));
      a.style.display = 'block';
      a.play().catch(() => { /* el navegador pedirá un gesto */ });
    } catch (e) {
      alert('La prueba falló: ' + e.message);
    }
    btn.disabled = false; btn.textContent = 'Escuchar este tono';
  });

  window.addEventListener('beforeunload', (ev) => {
    vaciarCola();
    if (motor && motor.activo) { ev.preventDefault(); ev.returnValue = ''; }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') vaciarCola();
  });
}


/** Trae el proyecto del bucket y reconcilia lo que ya hay generado. */
async function recuperarDeNube() {
  let hayBucket = false;
  try {
    const r = await api.ping();
    hayBucket = !!r.bucket;
    nube.marcarDisponible(hayBucket);
  } catch (e) { nube.marcarDisponible(false); }

  if (!hayBucket) { pintarEstadoNube('local'); return; }

  pintarEstadoNube('leyendo');
  try {
    const remoto = await nube.leerEstado();
    if (remoto && remoto.episodios && remoto.episodios.length) {
      await rehidratar(remoto);
      // La configuración que manda ahora es la del bucket: los mandos tienen
      // que enseñarla, o el primer «Guardar» devolvería la local encima.
      pintarConfig();
      await store.guardar('actual', P);
      log('proyecto recuperado de Google Cloud', 'ok');
    }
    // Lo que exista en el bucket cuenta como generado, aunque este
    // navegador no lo tenga: se descargará cuando haga falta verlo.
    const inventario = await nube.listar();
    if (inventario.size) {
      let recuperados = 0;

      /*  El bucket es la verdad. Si una copia local es más VIEJA que la del
          bucket, es que se regeneró desde otro sitio: se tira la local para
          que la próxima lectura traiga la buena. Siempre gana la más reciente. */
      let refrescados = 0;
      for (const [k, info] of inventario) {
        if (!info || !info.ts) continue;
        const local = await assets.leer(k).catch(() => null);
        /*  Margen amplio a propósito: lo que se genera aquí se guarda primero
            en local y se sube después, así que la copia del bucket siempre
            queda unos segundos por delante. Solo cuenta como «más nueva» una
            regeneración de verdad, hecha desde otro sitio.                   */
        if (local && local.ts && info.ts > local.ts + 300000) {
          await assets.borrar(k).catch(() => {});
          refrescados++;
        }
      }
      if (refrescados) log(refrescados + ' archivos tenían una versión más nueva en la nube', 'ok');

      for (const ep of P.episodios) {
        for (const t of ep.tomas) {
          if (!(t.audio && t.audio.ok) && inventario.has(clave.audio(ep.num, t.i))) {
            t.audio = { ok: true, dur: t.segundos || t.segEstimados }; recuperados++;
          }
          if (!t.reusa && !(t.imagen && t.imagen.ok) && inventario.has(clave.imagen(ep.num, t.i))) {
            t.imagen = { ok: true }; recuperados++;
          }
          if (!t.reusaVideo && !(t.video && t.video.ok) && inventario.has(clave.video(ep.num, t.i))) {
            t.video = { ok: true, local: false }; recuperados++;
          }
        }
        // La música iba por escena y no se recuperaba: aparecía como no generada
        // aunque estuviera en el bucket.
        ep.musica = ep.musica || {};
        for (const esc of new Set(ep.tomas.map((t) => t.escena))) {
          if (!(ep.musica[esc] && ep.musica[esc].ok) && inventario.has(clave.musica(ep.num, esc))) {
            ep.musica[esc] = { ok: true }; recuperados++;
          }
        }
      }
      for (const per of P.elenco) {
        // Las hojas dependen del vestuario del personaje, no son dos fijas: hay que
        // recorrer sus variantes reales o se borran las que sí están generadas.
        const posibles = variantesDe(per).map((v) => clave.refPersonaje(per.id, v.id));
        const previas = per.refs || [];
        per.refs = posibles.filter((k) => inventario.has(k) || previas.indexOf(k) !== -1);
      }
      for (const lug of P.lugares) {
        lug.ref = inventario.has(clave.refLugar(lug.id)) ? clave.refLugar(lug.id) : lug.ref;
      }
      if (recuperados) log(inventario.size + ' archivos encontrados en Google Cloud', 'ok');
    }
    pintarEstadoNube('guardado');
  } catch (e) {
    pintarEstadoNube('error', e.message);
    log('no se pudo leer el proyecto de Google Cloud: ' + e.message, 'err');
  }
}

/* ── Arranque ───────────────────────────────────────────────── */

async function iniciar() {
  await cargar();
  modelos = await store.leer('modelos');

  pintarConfig();
  alGuardar(pintarEstadoNube);
  cablear();
  pintarTodo();
  pintarFichas();
  comprobarConexion();

  // El proyecto vive en Google Cloud: al abrir se recupera de ahí, y el
  // navegador queda solo como copia rápida.
  await recuperarDeNube();

  // La dirección de arte del repositorio manda sobre la copia guardada, salvo
  // en lo que hayas editado tú: si no, las mejoras nunca llegarían al proyecto.
  const refrescadas = actualizarBiblia(false);
  if (refrescadas) {
    await guardar();
    log('dirección de arte y fichas actualizadas a la versión ' + BIBLIA_VERSION, 'ok');
    aviso('La biblia visual se actualizó. Vuelve a generar las hojas para ver el cambio.', 'ok', 8000);
  }

  // Los guiones viven en el repositorio: no tiene sentido pedir un clic para algo
  // que siempre hay que hacer. La primera vez se cargan solos.
  if (!P.episodios.length) {
    await cargarSerie();
  } else {
    log('proyecto cargado: ' + P.episodios.length + ' episodios, ' +
      P.episodios.reduce((a, e) => a + e.tomas.length, 0) + ' tomas');
  }
}

iniciar().catch((e) => {
  // Un fallo aquí dejaría la página muda y sin botones. Mejor decirlo.
  jobOcultar();
  const aviso = document.createElement('div');
  aviso.className = 'estado err';
  aviso.style.cssText = 'display:block;margin:16px;position:relative;z-index:50';
  aviso.textContent = 'El estudio no pudo arrancar: ' + ((e && e.message) || e) +
    '. Recarga la página; si sigue, pulsa «Vaciar todo lo generado» para empezar limpio.';
  document.querySelector('main').prepend(aviso);
  console.error(e);
});
