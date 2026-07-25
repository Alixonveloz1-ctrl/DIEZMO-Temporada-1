/* ============================================================
   main.js — el estudio
   ============================================================ */

import { proyecto as store, assets, cuota, pedirPersistencia } from './db.js';
import { api, crearWav, extraerPCM, b64aBytes } from './api.js';
import {
  limpiarTexto, tituloDe, segmentar, verificarCobertura,
  normalizarParaVoz, REEMPLAZOS_BASE,
} from './texto.js';
import {
  CONFIG_DEFECTO, ELENCO_DEFECTO, LUGARES_DEFECTO, VOCES, IDIOMAS,
  ESTILO_DEFECTO, NEGATIVO_DEFECTO,
} from './biblia.js';
import { dirigirEpisodio, repartirMovimiento, promptImagen } from './director.js';
import { Motor, clave, estadoEpisodio, audioCompleto, b64toBlob } from './pipeline.js';
import { Proyector } from './player.js';
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
    config: { ...CONFIG_DEFECTO },
    elenco: ELENCO_DEFECTO.map((p) => ({ ...p, refs: [] })),
    lugares: LUGARES_DEFECTO.map((l) => ({ ...l, ref: null })),
    episodios: [],
    sel: 1,
  };
}

async function guardar() {
  await store.guardar('actual', P);
}

async function cargar() {
  const g = await store.leer('actual');
  P = g && g.version ? g : proyectoNuevo();
  // Fusionamos con los valores por defecto por si el proyecto viene de una versión anterior.
  P.config = { ...CONFIG_DEFECTO, ...(P.config || {}) };
  if (!P.elenco || !P.elenco.length) P.elenco = ELENCO_DEFECTO.map((p) => ({ ...p, refs: [] }));
  if (!P.lugares || !P.lugares.length) P.lugares = LUGARES_DEFECTO.map((l) => ({ ...l, ref: null }));
  if (!P.episodios) P.episodios = [];
}

const epActual = () => P.episodios.find((e) => e.num === P.sel) || P.episodios[0] || null;

/* ── Barra de trabajo ───────────────────────────────────────── */

function jobMostrar(fase) {
  $('jobBar').hidden = false;
  $('jbFase').textContent = String(fase || 'trabajo').toUpperCase();
}
function jobAvance(hecho, total, texto) {
  $('jbTxt').textContent = texto + (total ? ' · ' + hecho + '/' + total : '');
  $('jbFill').style.width = total ? ((hecho / total) * 100).toFixed(1) + '%' : '0%';
}
function jobOcultar() { $('jobBar').hidden = true; }

function log(txt, tipo) {
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
    const fila = (k, v, ok) =>
      '<tr><td>' + k + '</td><td><span class="chip ' + (ok ? 'ok' : 'e') + '">' + esc(v) + '</span></td></tr>';
    t.innerHTML =
      fila('Proyecto de Google Cloud', r.proyecto ? 'configurado' : 'FALTA GCP_PROJECT_ID', r.proyecto) +
      fila('Cuenta de servicio', r.cuentaServicio ? 'configurada' : 'FALTA GCP_SERVICE_ACCOUNT', r.cuentaServicio) +
      fila('Autenticación', r.token ? 'correcta' : (r.errorToken || 'falla'), r.token) +
      fila('Bucket para video', r.bucket || 'sin GCS_BUCKET — Veo devolverá clips pequeños en línea', !!r.bucket) +
      (r.cuenta ? '<tr><td>Identidad</td><td class="mono" style="font-size:11px">' + esc(r.cuenta) + '</td></tr>' : '');
    const ok = r.proyecto && r.cuentaServicio && r.token;
    $('chipConexion').className = 'chip ' + (ok ? 'ok' : 'e');
    $('chipConexion').textContent = ok ? 'Vertex conectado' : 'revisar conexión';
  } catch (e) {
    t.innerHTML = '<tr><td>Error</td><td><span class="chip e">' + esc(e.message) + '</span></td></tr>';
    $('chipConexion').className = 'chip e';
    $('chipConexion').textContent = 'sin conexión';
  }
}

async function descubrirModelos() {
  $('notaModelos').textContent = 'consultando tu Vertex…';
  try {
    modelos = await api.modelos();
    await store.guardar('modelos', modelos);
    poblarModelos();
    $('notaModelos').textContent =
      'voz ' + modelos.tts.length + ' · imagen ' + modelos.image.length +
      ' · video ' + modelos.video.length + ' · texto ' + modelos.text.length +
      ' — fuente: ' + modelos.fuente;
  } catch (e) {
    $('notaModelos').textContent = 'no se pudo consultar (' + e.message + '); se usan las listas base';
  }
}

function llenarSelect(sel, lista, valor) {
  sel.innerHTML = '';
  const vistos = new Set();
  for (const m of lista) {
    if (vistos.has(m)) continue;
    vistos.add(m);
    const o = document.createElement('option');
    o.value = m; o.textContent = m;
    sel.appendChild(o);
  }
  if (valor && !vistos.has(valor)) {
    const o = document.createElement('option');
    o.value = valor; o.textContent = valor + ' (guardado)';
    sel.insertBefore(o, sel.firstChild);
  }
  sel.value = valor || sel.value;
}

function poblarModelos() {
  const m = modelos || {
    tts: ['gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts'],
    image: ['gemini-2.5-flash-image', 'gemini-3-pro-image-preview'],
    video: ['veo-3.1-fast-generate-preview', 'veo-3.1-generate-preview', 'veo-3.0-generate-001'],
    text: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  };
  llenarSelect($('cfgModeloTts'), m.tts, P.config.modeloTts);
  llenarSelect($('cfgModeloImagen'), m.image, P.config.modeloImagen);
  llenarSelect($('cfgModeloVideo'), m.video, P.config.modeloVideo);
  llenarSelect($('cfgModeloTexto'), m.text, P.config.modeloTexto);
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
  let n = 0;
  for (let k = 1; k <= 12; k++) {
    jobAvance(k - 1, 12, 'episodio ' + k);
    try {
      const r = await fetch('./episodios/ep' + pad2(k) + '.md');
      if (!r.ok) continue;
      const texto = await r.text();
      añadirEpisodio('ep' + pad2(k) + '.md', texto);
      n++;
    } catch (e) { /* episodio ausente: se ignora */ }
  }
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
  for (const id of ['selEpGuion', 'selEpProd', 'selEpSala', 'selEpExport']) {
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
    d.innerHTML =
      '<div class="lienzo"><span class="vacio">SIN REFERENCIA</span></div>' +
      '<div class="cuerpo"><strong>' + esc(per.nombre) +
      (per.principal ? ' <span class="chip g">principal</span>' : '') + '</strong>' +
      '<p>' + esc(per.ficha) + '</p></div>' +
      '<div class="acc">' +
      '<button class="btn chico" data-acc="gen">Generar hoja</button>' +
      '<button class="btn fantasma chico" data-acc="editar">Editar ficha</button>' +
      '</div>';
    cont.appendChild(d);

    if (per.refs && per.refs.length) {
      const u = await assets.url(per.refs[0]);
      if (u) d.querySelector('.lienzo').innerHTML = '<img src="' + u + '" alt="' + esc(per.nombre) + '">';
    }
    d.querySelector('[data-acc=gen]').addEventListener('click', async () => {
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
      '<div class="lienzo"><span class="vacio">SIN FONDO</span></div>' +
      '<div class="cuerpo"><strong>' + esc(lug.nombre) + '</strong><p>' + esc(lug.ficha) + '</p></div>' +
      '<div class="acc">' +
      '<button class="btn chico" data-acc="gen">Generar fondo</button>' +
      '<button class="btn fantasma chico" data-acc="editar">Editar</button>' +
      '</div>';
    cl.appendChild(d);
    if (lug.ref) {
      const u = await assets.url(lug.ref);
      if (u) d.querySelector('.lienzo').innerHTML = '<img src="' + u + '" alt="' + esc(lug.nombre) + '">';
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
    assets.url(clave.imagen(ep.num, t.i)).then((u) => {
      if (u) d.querySelector('.lienzo').insertAdjacentHTML('afterbegin',
        '<img src="' + u + '" alt="toma ' + (t.i + 1) + '">');
    });
  }
  return d;
}

function pintarRejillaGuion() {
  const ep = epActual();
  const c = $('rejillaGuion');
  c.innerHTML = '';
  $('resumenGuion').textContent = resumenGuion(ep);
  if (!ep) return;
  for (const t of ep.tomas) c.appendChild(tarjetaToma(ep, t));
}

function pintarRejillaProd() {
  const ep = epActual();
  const c = $('rejillaProd');
  c.innerHTML = '';
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
    estilo: P.config.estilo, negativo: P.config.negativo, formato: P.config.formato,
    elenco: P.elenco, lugares: P.lugares,
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
    const u = t.video.local ? await assets.url(clave.video(ep.num, t.i)) : t.video.url;
    if (u) {
      const el = document.createElement('video');
      el.src = u; el.controls = true; el.playsInline = true; el.muted = true;
      v.appendChild(el);
    }
  } else if (t.imagen && t.imagen.ok) {
    const u = await assets.url(clave.imagen(ep.num, t.i));
    if (u) { const el = document.createElement('img'); el.src = u; v.appendChild(el); }
  } else {
    v.innerHTML = '<p class="nota" style="padding:26px;text-align:center">Sin fotograma todavía.</p>';
  }
  if (t.audio && t.audio.ok) {
    const u = await assets.url(clave.audio(ep.num, t.i));
    if (u) { const a = document.createElement('audio'); a.src = u; a.controls = true; a.style.width = '100%'; v.appendChild(a); }
  }
  $('btnBloquear').textContent = t.bloqueada ? 'Desbloquear' : 'Bloquear';
  pintarRejillaProd();
  pintarRejillaGuion();
}

/* ── Sala ───────────────────────────────────────────────────── */

function prepararSala() {
  if (!proyector) {
    proyector = new Proyector({
      img: $('salaImg'), vid: $('salaVid'), aud: $('salaAud'),
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

/* ── Presupuesto ────────────────────────────────────────────── */

function costeEpisodio(ep) {
  const pr = P.config.precios;
  const s = estadoEpisodio(ep);
  const caracteres = (ep.tomas || []).reduce((a, t) => a + t.chars, 0);
  const segundosVideo = (ep.tomas || [])
    .filter((t) => t.plano && t.plano.tipo === 'movimiento')
    .reduce((a, t) => a + Math.min(8, Math.max(4, Math.round(t.segundos || t.segEstimados || 8))), 0);
  return {
    imagen: s.tomas * pr.imagen,
    video: segundosVideo * pr.videoSegundo,
    voz: (caracteres / 1000) * pr.vozMil,
    director: pr.episodio,
    get total() { return this.imagen + this.video + this.voz + this.director; },
    tomas: s.tomas,
    segundosVideo,
  };
}

function pintarCoste() {
  const c = $('tablaCoste');
  if (!c) return;
  if (!P.episodios.length) { c.innerHTML = '<p class="nota">Sin episodios.</p>'; return; }
  const ep = epActual();
  const usd = (n) => '$' + n.toFixed(2);

  let temporada = 0, tomas = 0, segVid = 0;
  for (const e of P.episodios) {
    const k = costeEpisodio(e);
    temporada += k.total; tomas += k.tomas; segVid += k.segundosVideo;
  }
  const k = ep ? costeEpisodio(ep) : null;

  c.innerHTML =
    '<table class="cfg">' +
    (k ? '<tr><td>EP ' + pad2(ep.num) + ' — ' + k.tomas + ' fotogramas</td><td>' + usd(k.imagen) + '</td></tr>' +
      '<tr><td>EP ' + pad2(ep.num) + ' — ' + k.segundosVideo + ' s de video</td><td>' + usd(k.video) + '</td></tr>' +
      '<tr><td>EP ' + pad2(ep.num) + ' — voz</td><td>' + usd(k.voz) + '</td></tr>' +
      '<tr><td>EP ' + pad2(ep.num) + ' — dirección</td><td>' + usd(k.director) + '</td></tr>' +
      '<tr><td><strong>Este episodio</strong></td><td><strong>' + usd(k.total) + '</strong></td></tr>' : '') +
    '<tr><td><strong>Temporada completa</strong> — ' + tomas + ' fotogramas, ' + segVid + ' s de video</td>' +
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
  pintarRejillaGuion();
  pintarRejillaProd();
  pintarCoste();
  pintarResumenTemporada();
  pintarAlmacen();
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
  opciones($('cfgIdioma'), IDIOMAS, c.idioma);
  poblarModelos();
  $('cfgResVideo').value = c.resolucionVideo;
  $('cfgTempVoz').value = c.temperaturaVoz;
  $('valTempVoz').textContent = Number(c.temperaturaVoz).toFixed(2);
  $('cfgSemilla').value = c.semillaVoz;
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
  c.modeloTts = $('cfgModeloTts').value;
  c.modeloImagen = $('cfgModeloImagen').value;
  c.modeloVideo = $('cfgModeloVideo').value;
  c.modeloTexto = $('cfgModeloTexto').value;
  c.resolucionVideo = $('cfgResVideo').value;
  c.temperaturaVoz = parseFloat($('cfgTempVoz').value);
  c.semillaVoz = $('cfgSemilla').value;
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
  // Navegación
  document.querySelectorAll('nav.fases button').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('nav.fases button').forEach((x) => x.classList.remove('on'));
      document.querySelectorAll('section.fase').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      $('fase-' + b.dataset.fase).classList.add('on');
      if (b.dataset.fase === 'biblia') pintarFichas();
      if (b.dataset.fase === 'sala') { prepararSala(); const ep = epActual(); if (ep) proyector.cargar(ep); }
    });
  });

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
    if (!confirm('Esto borra TODO el material generado (voces, fotogramas y clips). Los guiones y el guion técnico se conservan. ¿Seguir?')) return;
    const ks = await assets.claves();
    for (const k of ks) await assets.borrar(k);
    for (const ep of P.episodios) {
      for (const t of ep.tomas) { t.audio = null; t.imagen = null; t.video = null; t.segundos = null; }
    }
    for (const p of P.elenco) p.refs = [];
    for (const l of P.lugares) l.ref = null;
    await guardar(); pintarTodo(); pintarFichas();
  });

  // Biblia
  $('btnGuardarArte').addEventListener('click', async () => {
    P.config.estilo = $('cfgEstilo').value.trim() || ESTILO_DEFECTO;
    P.config.negativo = $('cfgNegativo').value.trim() || NEGATIVO_DEFECTO;
    P.config.formato = $('cfgFormato').value;
    P.config.imageSize = $('cfgTamano').value;
    P.config.maxReferencias = parseInt($('cfgMaxRefs').value, 10) || 3;
    await guardar(); pintarTodo();
  });
  $('btnRefsPrincipales').addEventListener('click', async () => {
    jobMostrar('referencias');
    await nuevoMotor().generarReferencias(P.elenco.filter((p) => p.principal).map((p) => p.id));
    await guardar(); pintarFichas();
  });
  $('btnRefsTodos').addEventListener('click', async () => {
    jobMostrar('referencias');
    await nuevoMotor().generarReferencias(P.elenco.filter((p) => !p.refs || !p.refs.length).map((p) => p.id));
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
  $('cfgMovim').addEventListener('input', (e) => { $('valMovim').textContent = e.target.value + ' %'; });
  $('cfgMovim').addEventListener('change', async (e) => {
    P.config.proporcionMovimiento = Number(e.target.value) / 100;
    await guardar();
  });
  $('cfgModeloTexto').addEventListener('change', (e) => { P.config.modeloTexto = e.target.value; guardar(); });

  // Producción
  $('selEpProd').addEventListener('change', (e) => { P.sel = Number(e.target.value); guardar(); pintarTodo(); });
  const producir = async (fases, etiqueta) => {
    const ep = epActual();
    if (!ep) return;
    if (!ep.tomas.some((t) => t.plano) && (fases.imagen || fases.video)) {
      estado('estadoProd', 'Este episodio no está dirigido: ve a «Guion técnico» y pulsa «Dirigir este episodio».', 'err');
      return;
    }
    estado('estadoProd', '');
    jobMostrar(etiqueta);
    await nuevoMotor().producirEpisodio(ep, fases);
    await guardar();
    const s = estadoEpisodio(ep);
    estado('estadoProd',
      'EP ' + pad2(ep.num) + ' — voz ' + s.voz + '/' + s.tomas + ' · fotogramas ' + s.imagen + '/' + s.tomas +
      ' · movimiento ' + s.video + '/' + s.movimiento + (s.errores ? ' · ' + s.errores + ' con error' : ''),
      s.errores ? 'info' : 'ok');
  };
  $('btnProdTodo').addEventListener('click', () => producir({ voz: true, imagen: true, video: true }, 'producción'));
  $('btnProdVoz').addEventListener('click', () => producir({ voz: true }, 'voz'));
  $('btnProdImg').addEventListener('click', () => producir({ imagen: true }, 'fotogramas'));
  $('btnProdVid').addEventListener('click', () => producir({ video: true }, 'movimiento'));
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
      videoSegundo: parseFloat($('pxVideo').value) || 0,
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
    jobMostrar('voz');
    t.audio = null;
    const m = nuevoMotor();
    const guardadas = ep.tomas;
    ep.tomas = [t];
    try { await m.generarVoz(ep, true); } finally { ep.tomas = guardadas; }
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
        fmtDur(r.hoja.duracionTotal) +
        (r.enLaNube ? ' · ' + r.enLaNube + ' clips siguen en Google Cloud, mira CLIPS-EN-LA-NUBE.txt' : ''),
        'ok');
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
  $('btnExportProyecto').addEventListener('click', () => {
    descargar(new Blob([JSON.stringify(P, null, 2)], { type: 'application/json' }),
      'diezmo-proyecto-' + new Date().toISOString().slice(0, 10) + '.json');
  });
  $('fileProyecto').addEventListener('change', async (ev) => {
    const f = (ev.target.files || [])[0];
    if (!f) return;
    if (!confirm('Esto reemplaza el guion técnico y los ajustes actuales. El material generado se conserva. ¿Seguir?')) return;
    try {
      const j = JSON.parse(await f.text());
      if (!j || !j.version) throw new Error('El archivo no es una copia del proyecto');
      P = j;
      P.config = { ...CONFIG_DEFECTO, ...(P.config || {}) };
      await guardar(); pintarTodo(); pintarFichas();
      estado('estadoExport', 'Proyecto restaurado.', 'ok');
    } catch (e) {
      estado('estadoExport', 'No se pudo restaurar: ' + e.message, 'err');
    }
    ev.target.value = '';
  });

  // Ajustes
  $('btnAjustes').addEventListener('click', abrirAjustes);
  $('btnAjCancelar').addEventListener('click', () => $('dlgAjustes').close());
  $('btnAjGuardar').addEventListener('click', guardarAjustes);
  $('cfgTempVoz').addEventListener('input', (e) => { $('valTempVoz').textContent = Number(e.target.value).toFixed(2); });
  $('btnProbarVoz').addEventListener('click', async () => {
    const btn = $('btnProbarVoz');
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
        seed: $('cfgSemilla').value === '' ? undefined : Number($('cfgSemilla').value),
      });
      const ex = extraerPCM(b64aBytes(r.audio), r.sampleRate || 24000);
      const a = $('audioPrueba');
      a.src = URL.createObjectURL(crearWav([ex.pcm], ex.rate));
      a.style.display = 'block';
      a.play().catch(() => { /* el navegador pedirá un gesto */ });
    } catch (e) {
      alert('La prueba falló: ' + e.message);
    }
    btn.disabled = false; btn.textContent = 'Probar la voz';
  });

  window.addEventListener('beforeunload', (ev) => {
    if (motor && motor.activo) { ev.preventDefault(); ev.returnValue = ''; }
  });
}

/* ── Arranque ───────────────────────────────────────────────── */

async function iniciar() {
  await cargar();
  modelos = await store.leer('modelos');

  $('cfgEstilo').value = P.config.estilo;
  $('cfgNegativo').value = P.config.negativo;
  $('cfgFormato').value = P.config.formato;
  $('cfgTamano').value = P.config.imageSize;
  $('cfgMaxRefs').value = String(P.config.maxReferencias);
  $('cfgSegToma').value = P.config.segundosPorToma;
  $('valSegToma').textContent = P.config.segundosPorToma + ' s';
  $('cfgMovim').value = Math.round(P.config.proporcionMovimiento * 100);
  $('valMovim').textContent = Math.round(P.config.proporcionMovimiento * 100) + ' %';
  $('pxImagen').value = P.config.precios.imagen;
  $('pxVideo').value = P.config.precios.videoSegundo;
  $('pxVoz').value = P.config.precios.vozMil;
  $('pxTexto').value = P.config.precios.episodio;

  poblarModelos();
  cablear();
  pintarTodo();
  pintarFichas();
  comprobarConexion();

  if (!P.episodios.length) {
    log('proyecto nuevo: pulsa «Cargar los doce episodios» para empezar');
  } else {
    log('proyecto cargado: ' + P.episodios.length + ' episodios, ' +
      P.episodios.reduce((a, e) => a + e.tomas.length, 0) + ' tomas');
  }
}

iniciar();
