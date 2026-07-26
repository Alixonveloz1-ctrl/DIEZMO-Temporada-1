/* ============================================================
   auditar.mjs — revisión antes de entregar
   ============================================================
   Comprueba las invariantes que se rompen sin avisar cuando se
   toca una parte y se olvida otra. Se ejecuta con:

     node herramientas/auditar.mjs

   Sale con código 1 si algo falla, para poder encadenarlo.
   ============================================================ */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { execFileSync } from 'child_process';

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const leer = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');
const modulos = fs.readdirSync(path.join(raiz, 'app')).filter((f) => f.endsWith('.js'));

let fallos = 0;
const ok = (t) => console.log('  ✓ ' + t);
const mal = (t, d) => { fallos++; console.log('  ✗ ' + t + (d ? '\n      ' + d : '')); };
const titulo = (t) => console.log('\n' + t);

/* ── 1 · Sintaxis ──────────────────────────────────────────── */
titulo('SINTAXIS');
for (const f of ['api/ep-gemini.js'].concat(modulos.map((m) => 'app/' + m))) {
  try {
    execFileSync(process.execPath, ['--check', path.join(raiz, f)], { stdio: 'pipe' });
  } catch (e) {
    mal(f + ' no compila', String(e.stderr || e).split('\n').slice(0, 3).join(' '));
  }
}
if (!fallos) ok('los ' + (modulos.length + 1) + ' archivos de código compilan');

/* ── 2 · Interfaz y lógica siguen enlazadas ────────────────── */
titulo('INTERFAZ');
const html = leer('index.html');
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const usados = new Set();
for (const f of ['app/main.js', 'app/player.js']) {
  for (const m of leer(f).matchAll(/\$\('([^']+)'\)/g)) usados.add(m[1]);
}
const huerfanos = [...usados].filter((i) => !ids.has(i) && i !== 'avisoFlotante');
if (huerfanos.length) mal('el código busca elementos que no existen', huerfanos.join(' '));
else ok(usados.size + ' elementos buscados por el código existen en la página');

// Un elemento cuenta como usado si aparece de cualquier forma en el código o en
// la propia página: $(), querySelector, getElementById, label for=… o el CSS.
const todoJs = ['app/main.js', 'app/player.js'].map(leer).join('\n');
// Algunos se construyen sobre la marcha: $('fase-' + nombre). Cuentan igual.
const dinamico = (i) => {
  const corte = i.indexOf('-');
  if (corte > 0 && todoJs.includes("'" + i.slice(0, corte + 1) + "' +")) return true;
  // También los que terminan en número: $('estPaso' + n).
  const raiz2 = i.replace(/\d+$/, '');
  return raiz2 !== i && todoJs.includes("'" + raiz2 + "' +");
};
const sinUso = [...ids].filter((i) =>
  !usados.has(i) && !todoJs.includes(i) && !dinamico(i) &&
  !html.includes('for="' + i + '"') && !html.includes('#' + i));
if (sinUso.length) mal('elementos que nadie usa', sinUso.join(' '));
else ok('ningún elemento huérfano en la página');

/* ── 2b · Nadie llama a una función que ya no existe ───────── */
/*  Al unificar la pestaña borré pintarRejillaGuion y dejé una llamada viva.
    La página seguía pintándose, pero el detalle de toma reventaba al final y
    los botones de regenerar parecían no hacer nada. La auditoría miraba
    elementos del HTML, no funciones: por ahí se coló.                       */
titulo('LLAMADAS');
const GLOBALES = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'await', 'super',
  'Promise', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Math', 'JSON', 'Date', 'Set',
  'Map', 'Error', 'RegExp', 'Blob', 'File', 'FileReader', 'Image', 'URL', 'Audio', 'Uint8Array',
  'DataView', 'ArrayBuffer', 'AbortController', 'TextEncoder', 'TextDecoder', 'OffscreenCanvas',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'fetch', 'alert', 'confirm', 'prompt', 'atob', 'btoa', 'isNaN', 'isFinite', 'parseInt',
  'parseFloat', 'encodeURIComponent', 'decodeURIComponent', 'structuredClone', 'queueMicrotask',
  'createImageBitmap', 'indexedDB', 'CustomEvent', 'Event', 'IDBRequest', 'IDBKeyRange',
]);
let llamadasRotas = [];
for (const f of ['app/main.js', 'app/player.js']) {
  const txt = leer(f);
  const definidos = new Set(GLOBALES);
  for (const m of txt.matchAll(/(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) definidos.add(m[1]);
  for (const m of txt.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) definidos.add(m[1]);
  // Desestructuraciones y parámetros: se admiten todos los nombres que aparecen.
  for (const m of txt.matchAll(/(?:const|let|var)\s*\{([^}]*)\}/g)) {
    m[1].split(',').forEach((x) => definidos.add(x.trim().split(':').pop().trim()));
  }
  for (const m of txt.matchAll(/import\s*\{([^}]+)\}/g)) {
    m[1].split(',').forEach((x) => definidos.add(x.trim().split(/\s+as\s+/).pop().trim()));
  }
  for (const m of txt.matchAll(/\(([^()]*)\)\s*=>/g)) {
    m[1].split(',').forEach((x) => definidos.add(x.trim().replace(/[=[\]{}.]/g, '').split(' ')[0]));
  }
  // Solo las funciones propias del proyecto: verbo + MayúsculaCamello.
  for (const m of txt.matchAll(/(^|[^.\w$'"`])((?:pintar|generar|abrir|cerrar|cablear|guardar|cargar|producir|dirigir|recalcular|seleccionar|mostrar|aplicar|limpiar|actualizar|contar|preparar|mantener|soltar|nuevo|job)[A-Z][\w$]*)\s*\(/g)) {
    if (!definidos.has(m[2])) llamadasRotas.push(f + ' → ' + m[2] + '()');
  }
}
if (llamadasRotas.length) {
  mal('se llama a funciones que no existen', [...new Set(llamadasRotas)].join('\n      '));
} else ok('todas las funciones propias que se llaman están definidas o importadas');

/* ── 3 · Importaciones ─────────────────────────────────────── */
titulo('IMPORTACIONES');
const exporta = {};
for (const f of modulos) {
  const s = leer('app/' + f);
  const e = new Set();
  for (const m of s.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let)\s+([A-Za-z_$][\w$]*)/g)) e.add(m[1]);
  for (const m of s.matchAll(/export\s*\{([^}]+)\}/g)) {
    m[1].split(',').forEach((x) => e.add(x.trim().split(/\s+as\s+/).pop()));
  }
  exporta[f] = e;
}
let rotas = 0;
for (const f of modulos) {
  for (const m of leer('app/' + f).matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/([^']+)'/g)) {
    for (const n of m[1].split(',')) {
      const local = n.trim().split(/\s+as\s+/)[0].trim();
      if (!local) continue;
      if (!exporta[m[2]] || !exporta[m[2]].has(local)) {
        mal(f + ' importa {' + local + '} de ' + m[2] + ', que no lo exporta');
        rotas++;
      }
    }
  }
}
if (!rotas) ok('todas las importaciones resuelven');

/* ── 4 · Las imágenes se ven enteras ───────────────────────── */
titulo('VISUALIZACIÓN DE IMÁGENES');
const pipeline = leer('app/pipeline.js');
const proporciones = [...pipeline.matchAll(/aspectRatio:\s*([^,\n]+)/g)].map((m) => m[1].trim());
ok('proporciones que se piden al generar: ' + [...new Set(proporciones)].join(' · '));

// Un contenedor con proporción fija y recorte solo vale si la imagen trae esa
// misma proporción. Las hojas de personaje son verticales o cuadradas: contain.
const bloqueFicha = (html.match(/\.ficha \.lienzo img\{[^}]*\}/) || [''])[0];
if (/object-fit:\s*cover/.test(bloqueFicha)) {
  mal('las hojas de personaje se recortan', 'usa object-fit:contain en .ficha .lienzo img');
} else ok('las hojas de personaje se muestran enteras');

const bloqueDet = (html.match(/\.det-vista img[^{]*\{[^}]*\}/) || [''])[0];
if (/object-fit:\s*cover/.test(bloqueDet)) mal('el detalle de toma recorta la imagen');
else ok('el detalle de toma muestra la imagen entera');

/* ── 5 · Nada de cantidades de partes del cuerpo en los prompts ── */
titulo('SEGURIDAD DE LOS PROMPTS');
const biblia = leer('app/biblia.js');
const negativo = (biblia.match(/NEGATIVO_DEFECTO =([\s\S]*?);\n/) || ['', ''])[1];
const cuentas = negativo.match(/\b(una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|\d+)\s+\w*(cabeza|brazo|pierna|mano|dedo)/gi);
if (cuentas) mal('la lista de exclusiones nombra cantidades de partes del cuerpo', cuentas.join(' | '));
else ok('las exclusiones nombran defectos, no imágenes');

/* ── 5b · Las hojas de referencia son del mismo personaje ──── */
titulo('HOJAS DE REFERENCIA');
const { promptReferencia } = await import(pathToFileURL(path.join(raiz, 'app', 'director.js')).href);
const ctxPrueba = { estilo: 'ESTILO', calidad: 'CALIDAD', negativo: 'NEGATIVO' };
const dePrueba = { nombre: 'Prueba', ficha: 'ficha de prueba' };

// El encuadre de rostro no puede describir el cuerpo: el modelo lo dibujaba entero.
const pRostro = promptReferencia(dePrueba, ctxPrueba, { id: 'rostro', cuerpo: false }, true);
const invasores = ['cuerpo entero', 'de pie', 'piernas', 'los pies', 'brazos a los costados']
  .filter((f) => pRostro.toLowerCase().includes(f));
if (invasores.length) mal('la hoja de rostro describe el cuerpo', invasores.join(' | '));
else ok('la hoja de rostro solo describe cabeza, cuello y hombros');

// Y la de cuerpo sí debe pedirlo entero, o vuelven los personajes achaparrados.
const pCuerpo = promptReferencia(dePrueba, ctxPrueba, { id: 'calle', desc: 'ropa', cuerpo: true }, false);
if (!/cuerpo entero/i.test(pCuerpo) || !/piernas largas/i.test(pCuerpo)) {
  mal('la hoja de cuerpo ya no pide figura entera y estilizada');
} else ok('la hoja de cuerpo pide figura entera con proporciones de anime moderno');

// La segunda hoja y siguientes deben llevar adjunta la primera, o sale otra cara.
if (!/la imagen de referencia adjunta es ESTE MISMO PERSONAJE/.test(
  promptReferencia(dePrueba, ctxPrueba, { id: 'mono', desc: 'ropa', cuerpo: true }, true))) {
  mal('el prompt no advierte que la referencia adjunta es el mismo personaje');
} else if (/la imagen de referencia adjunta es ESTE MISMO PERSONAJE/.test(pCuerpo)) {
  mal('la primera hoja habla de una referencia adjunta que todavía no existe');
} else ok('la advertencia de "mismo personaje" solo aparece cuando hay hoja maestra');

// Y el motor tiene que adjuntarla de verdad, no solo prometerlo en el texto.
const genRefs = (pipelineFuente => {
  const i = pipelineFuente.indexOf('async generarReferencias(');
  const j = pipelineFuente.indexOf('\n  async generarFondos(');
  return i > 0 && j > i ? pipelineFuente.slice(i, j) : '';
})(leer('app/pipeline.js'));
if (!genRefs) mal('no se encuentra generarReferencias en pipeline.js');
else if (!/images:\s*ref \? \[ref\] : \[\]/.test(genRefs) ||
         !/promptReferencia\([^)]*!!ref\)/.test(genRefs) ||
         !/pedir\(maestra\)/.test(genRefs)) {
  mal('el motor genera cada hoja por separado', 'no adjunta la hoja maestra a las siguientes');
} else if (!/soloFaltantes[\s\S]{0,400}assets\.blob\(k\)/.test(genRefs)) {
  mal('al saltarse hojas ya generadas no se recupera la maestra del almacén');
} else ok('cada hoja posterior se genera con la primera adjunta como referencia');

// El rostro no se negocia: ningún fallo puede acabar generando la hoja sin la
// referencia, porque saldría otra persona y esa cara se propagaría a las tomas.
const rendirse = /pedir\(\s*(null|false|undefined)\s*\)/.test(genRefs);
const catchRefs = (genRefs.match(/catch \(e\) \{[\s\S]*?\n            \}/) || [''])[0];
if (rendirse) {
  mal('hay un camino que genera la hoja sin la referencia del rostro',
    'saldría un personaje distinto y esa cara acabaría en las tomas del episodio');
} else if (!/e\.status === 413/.test(catchRefs) || !/comoReferencia\(maestraBlob/.test(catchRefs)) {
  mal('el reintento tras un fallo no conserva la referencia del rostro',
    'una cuota agotada o una caída de capacidad deben reintentarse con la misma cara');
} else if (!/intentos:\s*[5-9]/.test(genRefs)) {
  mal('pocos reintentos para las hojas', 'un límite de cuota dejaría al personaje a medias');
} else ok('ante cualquier fallo se reintenta con el mismo rostro; nunca sin él');

// Una hoja de 2K en base64 pasa de 3 MB; tres no caben en una petición de 4,5 MB.
// El primer fotograma que se le da a Veo es la excepción: no es una referencia de
// estilo, es el fotograma inicial del clip, y va a resolución completa.
const fuentePipeline = leer('app/pipeline.js');
const inicioVeo = fuentePipeline.indexOf('async _unVideo(');
const finVeo = fuentePipeline.indexOf('\n  /* ──', inicioVeo);
const crudos = [...fuentePipeline.matchAll(/data:\s*await blobAb64\(/g)]
  .filter((m) => !(inicioVeo > 0 && m.index > inicioVeo && (finVeo < 0 || m.index < finVeo)))
  .map((m) => fuentePipeline.slice(m.index, m.index + 60).split('\n')[0].trim());
if (crudos.length) {
  mal('se adjunta una imagen de referencia sin reducir', crudos.join(' | ') +
    ' — usa comoReferencia(), o el cuerpo de la petición pasa del límite');
} else if (!/refs\.push\(await comoReferencia\(/.test(fuentePipeline)) {
  mal('los fotogramas no reducen las hojas antes de adjuntarlas');
} else ok('las referencias se reducen antes de viajar; el fotograma de Veo va entero');

// Y la misma regla en el sitio que de verdad importa: las tomas del episodio.
const unaImagen = (() => {
  const i = fuentePipeline.indexOf('async _unaImagen(');
  const j = fuentePipeline.indexOf('\n  /* ──', i);
  return i > 0 ? fuentePipeline.slice(i, j > i ? j : undefined) : '';
})();
if (!unaImagen) mal('no se encuentra _unaImagen en pipeline.js');
else if (!/sinCara/.test(unaImagen) || !/t\.imagen = \{ ok: false[\s\S]{0,120}sinCara/.test(unaImagen)) {
  mal('una toma con un personaje sin hoja se genera igual',
    'saldría un desconocido con su nombre y el fotograma parecería correcto');
} else ok('una toma no se genera si falta la cara de alguien que sale en ella');

/* ── 5c · El montaje obedece al director ───────────────────── */
titulo('MOVIMIENTO DE CÁMARA');
const { CAMARA, planoCamara, filtroZoompan, fotogramasCss, normalizarMovimiento } =
  await import(pathToFileURL(path.join(raiz, 'app', 'camara.js')).href);
const { MOVIMIENTOS } = await import(pathToFileURL(path.join(raiz, 'app', 'biblia.js')).href);

// Todo movimiento que el director puede elegir tiene que saber ejecutarse.
const huerfanosMov = MOVIMIENTOS.filter((m) => !CAMARA[m]);
if (huerfanosMov.length) mal('el director puede pedir movimientos que el montaje no sabe hacer', huerfanosMov.join(' · '));
else ok('los ' + MOVIMIENTOS.length + ' movimientos del director tienen traducción al montaje');

// La escala interpola durante la toma: si el desplazamiento se pasa del sobrante
// en cualquier instante, el movimiento se clava contra el borde a mitad de plano.
// Y tiene que aguantar a cualquier intensidad, que ahora es un mando del usuario.
let fuera = [];
for (const k of [0, 0.5, 1, 1.5, 2, 3]) {
  for (const n of Object.keys(CAMARA)) {
    const c = planoCamara(n, k);
    for (let i = 0; i <= 100; i++) {
      const q = i / 100;
      const z = c.z0 + (c.z1 - c.z0) * q;
      const m = (1 - 1 / z) / 2;
      const dx = Math.abs(c.x0 + (c.x1 - c.x0) * q);
      const dy = Math.abs(c.y0 + (c.y1 - c.y0) * q);
      if (Math.max(dx, dy) > m + 1e-9) { fuera.push(n + ' a intensidad ' + k + ' (al ' + i + ' %)'); break; }
    }
  }
}
if (fuera.length) mal('movimientos que se salen del fotograma', fuera.slice(0, 4).join(' · '));
else ok('a intensidad 0, 0,5, 1, 1,5, 2 y 3 ningún movimiento se sale del fotograma');

// Y el recorrido tiene que NOTARSE: el nueve por ciento anterior no se veía.
const recorrido = (n) => {
  const c = planoCamara(n, 1);
  return Math.max(Math.abs(c.z1 / c.z0 - 1), Math.abs(c.x1 - c.x0), Math.abs(c.y1 - c.y0));
};
const flojos = Object.keys(CAMARA)
  .filter((n) => n !== 'cámara fija' && !/en mano/.test(n))
  .filter((n) => recorrido(n) < 0.1);
if (flojos.length) {
  mal('movimientos que no se van a percibir', flojos.join(' · ') + ' — recorren menos del 10 %');
} else ok('a intensidad normal todo movimiento recorre al menos el 10 % del encuadre');

// A intensidad cero la imagen se queda de verdad quieta.
const c0 = planoCamara('travelling de acercamiento lento', 0);
if (c0.z0 !== c0.z1 || c0.x0 !== c0.x1) mal('a intensidad cero la cámara sigue moviéndose');
else ok('a intensidad cero la imagen se queda realmente quieta')

// Sala y montaje tienen que partir de los mismos números, o lo aprobado no es lo que sale.
const usaCamara = (f, q) => new RegExp(q).test(leer(f));
if (!usaCamara('app/player.js', 'fotogramasCss') || !usaCamara('app/player.js', 'planoCamara')) {
  mal('la Sala no usa el movimiento del director');
} else if (!usaCamara('app/exportar.js', 'filtroZoompan')) {
  mal('el montaje no usa el movimiento del director', 'volvería al acercamiento fijo para todo');
} else if (/kenburns/.test(leer('index.html')) || /kenburns/.test(leer('app/player.js'))) {
  mal('queda la animación antigua, que ignoraba al director');
} else ok('la Sala y el montaje salen de la misma tabla de movimientos');

// Un texto que el director invente no puede dejar la toma sin movimiento definido.
const raros = ['', 'algo que no existe', 'TRAVELLING LENTO HACIA DENTRO', null, undefined];
const malRaros = raros.filter((r) => !CAMARA[normalizarMovimiento(r)]);
if (malRaros.length) mal('un movimiento no reconocido deja la toma sin definir');
else ok('cualquier texto del director cae en un movimiento válido');

// El filtro tiene que salir sintácticamente entero, con sus tres ejes.
const f = filtroZoompan('panorámica lenta a la derecha', 192, 1920, 1080, 24);
if (!/^zoompan=z=/.test(f) || !/:x='/.test(f) || !/:y='/.test(f) || !/:d=192:/.test(f)) {
  mal('el filtro de movimiento sale mal formado', f.slice(0, 90));
} else if (fotogramasCss('cámara fija').length !== 2) {
  mal('la Sala no recibe los dos extremos de la animación');
} else ok('el filtro de montaje y la animación de la Sala salen bien formados');

/* ── 5d · Duraciones y tarifa de Veo ───────────────────────── */
titulo('DURACIÓN Y COSTE DEL VIDEO');
const { DURACIONES, duracionVeo, precioSegundo, TARIFA } =
  await import(pathToFileURL(path.join(raiz, 'app', 'veo.js')).href);

// El backend valida por su cuenta: si las dos tablas se separan, Vertex rechaza.
const backend = leer('api/ep-gemini.js');
const tablaBack = {};
const bloqueBack = (backend.match(/const DURACIONES_VEO = \{([\s\S]*?)\};/) || ['', ''])[1];
for (const m of bloqueBack.matchAll(/'([^']+)':\s*\[([0-9,\s]+)\]/g)) {
  tablaBack[m[1]] = m[2].split(',').map((x) => parseInt(x, 10));
}
const desajuste = Object.keys(DURACIONES).filter((k) =>
  !tablaBack[k] || tablaBack[k].join(',') !== DURACIONES[k].join(','));
if (!Object.keys(tablaBack).length) mal('el backend no valida la duración contra el modelo');
else if (desajuste.length) mal('las duraciones del backend y del cliente no coinciden', desajuste.join(' · '));
else ok('cliente y backend admiten las mismas duraciones para los ' + Object.keys(DURACIONES).length + ' modelos');

// Ya no puede quedar el recorte viejo, que mandaba 5 y 7 a un modelo que no los acepta.
if (/Math\.min\(8,\s*Math\.max\(4,/.test(leer('app/pipeline.js')) ||
    /Math\.min\(Math\.max\(parseInt\(body\.durationSeconds/.test(backend)) {
  mal('sigue el recorte 4-8 en algún sitio', 'puede pedir 5 o 7 segundos, que Veo 3.x rechaza');
} else ok('nadie recorta ya la duración a mano');

// Ninguna duración de toma puede producir un valor que el modelo no admita.
let invalido = [];
for (const modelo of Object.keys(DURACIONES)) {
  for (let d = 0.1; d <= 20; d = +(d + 0.1).toFixed(1)) {
    const v = duracionVeo(modelo, d);
    if (DURACIONES[modelo].indexOf(v) === -1) { invalido.push(modelo + ' con ' + d + ' s → ' + v); break; }
  }
  for (const raro of [0, -3, NaN, null, undefined, 'ocho']) {
    const v = duracionVeo(modelo, raro);
    if (DURACIONES[modelo].indexOf(v) === -1) invalido.push(modelo + ' con «' + raro + '» → ' + v);
  }
}
if (invalido.length) mal('el cálculo de duración puede devolver un valor que Veo rechaza', invalido.slice(0, 4).join(' · '));
else ok('cualquier duración de toma cae en un valor que el modelo admite');

// En empate manda la mayor: vale más sobrar clip que congelar imagen.
const empates = [[5, 6], [7, 8]].filter(([d, esperado]) => duracionVeo('veo-3.1-lite-generate-001', d) !== esperado);
if (empates.length) mal('en un empate no se elige la duración mayor', JSON.stringify(empates));
else if (duracionVeo('veo-3.1-lite-generate-001', 3.8) !== 4 || duracionVeo('veo-3.1-lite-generate-001', 6.2) !== 6) {
  mal('no se elige la duración válida más cercana');
} else ok('se pide la más cercana, y en empate la mayor (cinco segundos pide seis)');

// Todo modelo que la interfaz ofrece tiene que tener duración y tarifa.
const ofrecidos = [...leer('app/main.js').matchAll(/\['(veo-[^']+)'/g)].map((m) => m[1]);
const sinTabla = [...new Set(ofrecidos)].filter((m) => !DURACIONES[m] || !TARIFA[m]);
if (sinTabla.length) mal('modelos de video ofrecidos sin duración o sin tarifa', sinTabla.join(' · '));
else if (precioSegundo('veo-3.1-lite-generate-001', '1080p', false) !== 0.05) {
  mal('la tarifa de Veo 3.1 Lite no coincide con la oficial');
} else ok('los ' + new Set(ofrecidos).size + ' modelos ofrecidos tienen duración y tarifa oficial');

/* ── 5e · Todo lo que se genera tiene su botón, y en orden ─── */
titulo('PASOS DE PRODUCCIÓN');
const FASES = [
  { n: 1, nombre: 'dirigir',     boton: 'btnDirigir',  motor: 'dirigirEpisodio' },
  { n: 2, nombre: 'voz',         boton: 'btnProdVoz',  motor: 'generarVoz' },
  { n: 3, nombre: 'fotogramas',  boton: 'btnProdImg',  motor: 'generarImagenes' },
  { n: 4, nombre: 'movimiento',  boton: 'btnProdVid',  motor: 'generarVideos' },
  { n: 5, nombre: 'música',      boton: 'btnProdMus',  motor: 'generarMusica' },
];
const fuenteMotor = leer('app/pipeline.js') + leer('app/main.js');
const sinBoton = FASES.filter((f) => !ids.has(f.boton));
const sinMotor = FASES.filter((f) => !fuenteMotor.includes(f.motor));
if (sinBoton.length) mal('fases sin botón en la página', sinBoton.map((f) => f.nombre).join(' · '));
else if (sinMotor.length) mal('botones sin nada detrás', sinMotor.map((f) => f.nombre).join(' · '));
else ok('las ' + FASES.length + ' fases tienen botón propio y motor detrás');

// El orden en la página tiene que ser el orden real de producción.
const posiciones = FASES.map((f) => ({ n: f.n, pos: html.indexOf('id="' + f.boton + '"') }));
const desordenadas = posiciones.filter((x, i) => i > 0 && x.pos < posiciones[i - 1].pos);
if (desordenadas.length) mal('los botones no aparecen en el orden de producción');
else ok('aparecen en pantalla en el mismo orden en que hay que ejecutarlos');

// Y cada paso tiene que decir cómo va, o quedan cosas a oscuras.
const sinEstado = FASES.filter((f) => !ids.has('estPaso' + f.n));
if (sinEstado.length) mal('pasos que no informan de su estado', sinEstado.map((f) => f.nombre).join(' · '));
else if (!/function pintarPasos\(/.test(leer('app/main.js'))) mal('nada pinta el estado de los pasos');
else ok('cada paso muestra cuánto lleva hecho');

// Nada duplicado: un solo selector de episodio y una sola rejilla de tomas.
const seccion = html.slice(html.indexOf('id="fase-episodios"'), html.indexOf('id="fase-biblia"'));
const selectores = (seccion.match(/<select id="selEp[^"]*"/g) || []).length;
const rejillas = (seccion.match(/class="tomas" id="[^"]+"/g) || []).length;
if (selectores > 1) mal('hay ' + selectores + ' selectores de episodio en la misma pestaña');
else if (rejillas > 1) mal('la lista de tomas aparece ' + rejillas + ' veces en la misma pestaña');
else ok('un solo selector de episodio y una sola lista de tomas');

/* ── 5f · Música ───────────────────────────────────────────── */
titulo('MÚSICA');
const { MODELOS_MUSICA, precioPieza, escenasDe, promptMusica, duracionMaxima } =
  await import(pathToFileURL(path.join(raiz, 'app', 'musica.js')).href);

if (precioPieza('lyria-3-pro-preview') !== 0.08) mal('la tarifa de Lyria 3 Pro no es la oficial');
else if (duracionMaxima('lyria-3-pro-preview') !== 184) mal('la duración máxima de Lyria 3 Pro no es la documentada');
else ok('Lyria 3 Pro: pieza de hasta 184 s por 0,08 $, cobrada por pieza y no por segundo');

// La música lleva narración encima: una voz cantada competiría con ella.
const pm = promptMusica({ escena: 1, segundos: 120, encargo: 'prueba' }, { modeloMusica: 'lyria-3-pro-preview' });
/*  Lyria es un modelo de canciones: canta salvo que se le insista. La
    restricción tiene que ir DELANTE del encargo —lo primero que lee— y
    repetirse al final, o acaba cantando la descripción de la escena.        */
if (!/^INSTRUMENTAL ONLY/.test(pm)) {
  mal('el prompt de música no empieza prohibiendo la voz',
    'Lyria canta por defecto: la restricción tiene que ir lo primero');
} else if (!/INSTRUMENTAL ONLY[\s\S]*$/.test(pm.slice(-200))) {
  mal('el prompt de música no repite la prohibición al final');
} else if (!/No vocals/.test(pm) || !/No lyrics/.test(pm)) {
  mal('el prompt no dice explícitamente que no haya voces ni letra');
} else if (!/no lyrics|not lyrics|nunca una letra/i.test(pm)) {
  mal('no se aclara que el encargo es una descripción, no una letra para cantar');
} else ok('el prompt de música prohíbe la voz al principio y al final, y en inglés');

// Una pieza por escena, no por toma.
const epFalso = { num: 1, tomas: [
  { i: 0, escena: 1, segEstimados: 8, texto: 'a' }, { i: 1, escena: 1, segEstimados: 8, texto: 'b' },
  { i: 2, escena: 2, segEstimados: 8, texto: 'c' }] };
const es = escenasDe(epFalso);
if (es.length !== 2 || es[0].segundos !== 16) mal('las escenas no se agrupan bien para la música');
else if (!/\[maestra\]|musica\/lecho/.test(leer('app/exportar.js'))) {
  mal('el montaje no mezcla la música');
} else if (!/sidechaincompress/.test(leer('app/exportar.js'))) {
  mal('la música no cede paso a la narración en la mezcla');
} else ok('una pieza por escena, mezclada en el montaje y agachándose bajo la voz');

/* ── 5f-bis · El mando del movimiento hace algo ────────────── */
titulo('PROPORCIÓN DE MOVIMIENTO');
const seccionEp = html.slice(html.indexOf('id="fase-episodios"'), html.indexOf('id="fase-biblia"'));
const posMovim = seccionEp.indexOf('id="cfgMovim"');
const posPaso4 = seccionEp.indexOf('id="selModVidProd"');
const posPaso5 = seccionEp.indexOf('id="selModMusProd"');
if (posMovim < 0) mal('no existe el mando de proporción de movimiento');
else if (!(posMovim > posPaso4 && (posPaso5 < 0 || posMovim < posPaso5))) {
  mal('el mando del movimiento no está en el paso de movimiento',
    'es una decisión de coste: tiene que verse donde se toma');
} else if (/<details[\s\S]*id="cfgMovim"[\s\S]*<\/details>/.test(seccionEp.slice(0, posMovim + 200))) {
  mal('el mando del movimiento está escondido en un desplegable');
} else ok('el mando de proporción vive en el paso de movimiento, a la vista');

// Y moverlo tiene que repartir de nuevo, no solo guardar un número.
const mainJs = leer('app/main.js');
const manejador = (mainJs.match(/\$\('cfgMovim'\)\.addEventListener\('change'[\s\S]{0,900}?\n  \}\);/) || [''])[0];
if (!manejador) mal('nadie escucha el cambio de proporción');
else if (!/repartirMovimiento\(/.test(manejador)) {
  mal('cambiar la proporción no reparte de nuevo',
    'bajarla parecería funcionar y se seguiría pagando la anterior');
} else if (!/id="cuentaMovim"/.test(html)) mal('no se ve cuánto cuesta la proporción elegida');
else ok('cambiar la proporción reparte de nuevo y enseña los clips, los segundos y el gasto');

/* ── 5c-quater · La voz se pide por escena ─────────────────── */
titulo('VOZ POR ESCENA');
const pipeVoz = leer('app/pipeline.js');
const genVoz = pipeVoz.slice(pipeVoz.indexOf('async generarVoz('),
  pipeVoz.indexOf('/* ── Fotogramas'));

if (!/porEscena/.test(genVoz) || !/api\.tts\(/.test(genVoz)) {
  mal('no se encuentra la generación de voz');
} else if ((genVoz.match(/api\.tts\(/g) || []).length !== 1) {
  mal('hay más de una llamada de voz por escena');
} else if (!/cortarEscena\(/.test(genVoz)) {
  mal('el audio de la escena no se reparte entre sus tomas',
    'la imagen no sabría cuándo cambiar');
} else if (!/if \(indices\) return tomas\.some/.test(genVoz)) {
  mal('regenerar una toma suelta no rehace su escena',
    'esa toma volvería a salir con otro tono y se notaría más');
} else ok('una sola llamada por escena, repartida después entre sus tomas');

// El reparto por silencios: se comprueba de verdad, no por su forma.
const { cortarEscena } = await import(pathToFileURL(path.join(raiz, 'app', 'voz.js')).href);
const R = 24000;
function escenaFalsa(duraciones, pausa) {
  let sem = 7; const rnd = () => ((sem = (sem * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const trozos = [], limites = []; let t = 0;
  duraciones.forEach((d, k) => {
    const n = Math.round(d * R), v = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      v[i] = ((Math.sin(2 * Math.PI * 118 * i / R) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 4.5 * i / R)) * 9000) + (rnd() - 0.5) * 90) | 0;
    }
    trozos.push(v); t += n;
    if (k < duraciones.length - 1) {
      const p = new Int16Array(Math.round(pausa * R));
      for (let i = 0; i < p.length; i++) p[i] = ((rnd() - 0.5) * 90) | 0;
      limites.push(t + Math.round(p.length / 2));
      trozos.push(p); t += p.length;
    }
  });
  const pcm = new Int16Array(t); let o = 0;
  for (const x of trozos) { pcm.set(x, o); o += x.length; }
  return { pcm, limites };
}
const duraciones = [6, 11, 4, 9, 7, 5];
const { pcm: pcmF, limites } = escenaFalsa(duraciones, 0.4);
const tramos = cortarEscena(pcmF, R, duraciones.map((d) => d * 100));
const errores = limites.map((real, k) => Math.abs(tramos[k].hasta - real) / R);
const suma = tramos.reduce((a, t) => a + (t.hasta - t.desde), 0);
const monotono = tramos.every((t, k) => t.hasta > t.desde && (k === 0 || t.desde === tramos[k - 1].hasta));
if (suma !== pcmF.length) mal('el reparto pierde o duplica audio', suma + ' de ' + pcmF.length + ' muestras');
else if (!monotono) mal('los tramos se solapan o van hacia atrás');
else if (Math.max(...errores) > 0.3) {
  mal('el reparto por silencios se desvía demasiado', 'peor error ' + Math.max(...errores).toFixed(2) + ' s');
} else ok('reparte una escena de 6 tomas con ' + (Math.max(...errores) * 1000).toFixed(0) + ' ms de error, sin perder audio');

// Ninguna escena puede pasarse del presupuesto de audio del modelo.
const { limpiarTexto: lt2, segmentar: sg2 } =
  await import(pathToFileURL(path.join(raiz, 'app', 'texto.js')).href);
let peorEscena = 0;
for (let k = 1; k <= 12; k++) {
  const ts = sg2(lt2(leer('episodios/ep' + String(k).padStart(2, '0') + '.md')), { segundosPorToma: 8, cps: 16 });
  const porEsc = new Map();
  for (const t of ts) porEsc.set(t.escena, (porEsc.get(t.escena) || 0) + t.segEstimados);
  peorEscena = Math.max(peorEscena, ...porEsc.values());
}
const TOPE = 16000 / 32;      // tokens de salida / tokens por segundo de audio
if (peorEscena > TOPE) {
  mal('hay escenas más largas de lo que el modelo puede narrar de una vez',
    (peorEscena / 60).toFixed(1) + ' min frente a un tope de ' + (TOPE / 60).toFixed(1) + ' min');
} else {
  ok('la escena más larga son ' + (peorEscena / 60).toFixed(1) + ' min · caben ' +
     (TOPE / 60).toFixed(1) + ' min por llamada');
}

/* ── 5c-ter · El audio no puede llegar cortado ─────────────── */
titulo('AUDIO COMPLETO');
const back4 = leer('api/ep-gemini.js');
/*  Gemini parte el audio en varias partes cuando el texto es largo. Quedarse
    con la primera corta la locución a la mitad, y el reproductor salta a la
    toma siguiente: es lo que se oía.                                         */
if (!/function juntarAudio\(/.test(back4)) {
  mal('el audio se toma de una sola parte de la respuesta',
    'una locución larga viene troceada y se cortaría a la mitad');
} else if (!/Buffer\.concat\(trozos\)/.test(back4)) {
  mal('las partes de audio no se concatenan en binario',
    'pegar cadenas base64 produce basura si un trozo no es múltiplo de tres bytes');
} else {
  const usos = (back4.match(/juntarAudio\(out\.json\)/g) || []).length;
  const conPick = /mode === 'tts'[\s\S]{0,1600}pickInlinePart\(/.test(back4) ||
    /mode === 'musica'[\s\S]{0,1400}pickInlinePart\(/.test(back4);
  if (usos < 2 || conPick) mal('la voz o la música siguen tomando una sola parte del audio');
  else ok('voz y música juntan todas las partes del audio que devuelve el modelo');
}

// Y la cabecera RIFF de un trozo intermedio no puede quedarse dentro.
if (!/RIFF'\)\s*\{[\s\S]{0,80}slice\(44\)/.test(back4)) {
  mal('una cabecera WAV en mitad del audio no se descarta', 'sonaría un chasquido en la costura');
} else ok('las cabeceras de los trozos intermedios se descartan al unir');

/* ── 5c-bis · Tonos de voz ya calibrados ───────────────────── */
titulo('TONOS DE VOZ');
const { TONOS, tonoPorId, aplicarTono, coincideConTono } =
  await import(pathToFileURL(path.join(raiz, 'app', 'voz.js')).href);
const { VOCES, CONFIG_DEFECTO } = await import(pathToFileURL(path.join(raiz, 'app', 'biblia.js')).href);

const vocesValidas = new Set(VOCES.map((v) => v[0]));
const tonoMalo = TONOS.filter((t) => !vocesValidas.has(t.voz));
if (!TONOS.length) mal('no hay ningún tono de voz predefinido');
else if (tonoMalo.length) mal('tonos con una voz que no existe', tonoMalo.map((t) => t.id).join(' · '));
else ok(TONOS.length + ' tonos listos para usar, todos con voz válida');

// Todos describen el MISMO ritmo medido: es lo que evita probar a ciegas.
const sinRitmo = TONOS.filter((t) => !/ciento cincuenta palabras por minuto/.test(t.instruccion));
const sinGenero = TONOS.filter((t) => !/[Vv]oz masculina/.test(t.instruccion));
if (sinRitmo.length) mal('tonos que no fijan el ritmo medido', sinRitmo.map((t) => t.id).join(' · '));
else if (sinGenero.length) mal('tonos que no fijan voz masculina', sinGenero.map((t) => t.id).join(' · '));
else ok('todos fijan voz masculina y el ritmo de la referencia: 150 palabras por minuto');

// El proyecto arranca con un tono aplicado de verdad, no a medias.
const cfg = { ...CONFIG_DEFECTO };
if (!cfg.tono) mal('el proyecto no arranca con ningún tono elegido');
else {
  aplicarTono(cfg, cfg.tono);
  if (!coincideConTono(cfg)) mal('aplicar un tono no deja la configuración coincidiendo con él');
  else {
    cfg.voz = 'Puck';
    if (coincideConTono(cfg)) mal('tocar la voz a mano no se detecta como personalizado');
    else ok('arranca con «' + tonoPorId(CONFIG_DEFECTO.tono).nombre + '» y detecta si se toca a mano');
  }
}

// Y al cargar el proyecto el tono se reaplica, para que afinarlo llegue al usuario.
if (!/if \(P\.config\.tono\) aplicarTono\(P\.config, P\.config\.tono\);/.test(leer('app/main.js'))) {
  mal('el tono no se reaplica al cargar', 'afinar un tono no llegaría a los proyectos ya guardados');
} else ok('el tono se reaplica al abrir, salvo que se haya ajustado a mano');

/* ── 5d-bis · No se puede perder un episodio ───────────────── */
titulo('INTEGRIDAD DEL PROYECTO');
const mainP = leer('app/main.js');
const rehid = (mainP.match(/async function rehidratar\(compacto\)[\s\S]*?\n\}/) || [''])[0];
if (!rehid) mal('no se encuentra la reconstrucción del proyecto');
else if (/fetch\([\s\S]{0,120}continue;/.test(rehid)) {
  mal('un fallo de red al leer un guion borra ese episodio del proyecto',
    'y acto seguido se guarda la lista recortada: la pérdida queda grabada');
} else if (!/await traerGuiones\(\)/.test(rehid)) {
  mal('la lista de episodios no la fijan los guiones del repositorio');
} else ok('la lista de episodios sale del repositorio; lo guardado solo añade el trabajo');

const traer = (mainP.match(/async function traerGuiones[\s\S]*?\n\}/) || [''])[0];
if (!traer) mal('no hay un punto único para traer los guiones');
else if (!/intento <= 3/.test(traer)) mal('leer un guion no se reintenta ante un corte de red');
else if (!/se conserva lo que hubiera/.test(traer)) {
  mal('si un guion no se puede leer no se avisa');
} else ok('cada guion se reintenta tres veces y su fallo se avisa, no se traga');

// La custodia: nunca guardar encima con menos episodios.
if (!/_maxEpisodios/.test(mainP)) {
  mal('nada impide guardar un proyecto al que le faltan episodios');
} else if (!/try \{ estadoCompacto\(\); \} catch \(e\) \{ return; \}/.test(mainP)) {
  mal('el guardado local no respeta la custodia de episodios');
} else ok('un proyecto con episodios de menos no puede sobrescribir al bueno');

// Lo que se genera tiene que viajar entero en el estado guardado.
const compactoTxt = (mainP.match(/function estadoCompacto\(\)[\s\S]*?\n\}/) || [''])[0];
const campos = ['musica', 'reusa', 'reusaVideo', 'plano', 'audio', 'imagen', 'video', 'segundos'];
const olvidados = campos.filter((c) => !new RegExp('\\b' + c + ':').test(compactoTxt));
if (olvidados.length) {
  mal('el estado guardado no incluye ' + olvidados.join(', '),
    'se perdería al recuperar el proyecto en otro aparato');
} else ok('el estado guardado lleva plano, voz, imagen, clip, música y reutilizaciones');

/* ── 5d-ter · Todo lo generado acaba en el bucket ──────────── */
titulo('TODO EN LA NUBE');
const pl3 = leer('app/pipeline.js');
const backend3 = leer('api/ep-gemini.js');

// Cada fase tiene que dejar su archivo en el bucket, por una vía o por otra.
const archiva = {
  'hojas de personaje': /generarReferencias[\s\S]*?guardarComo: k/.test(pl3),
  'fondos de lugar': /generarFondos[\s\S]*?guardarComo: k/.test(pl3),
  'voz': /nube\.subir\(kAudio/.test(pl3),
  'fotogramas': /guardarComo: clave\.imagen/.test(pl3),
  'música': /generarMusica[\s\S]*?guardarComo: k/.test(pl3),
  'clips de Veo': /archivarClip/.test(pl3) && /nube\.subir\(kVid/.test(pl3),
};
const huecos = Object.keys(archiva).filter((k) => !archiva[k]);
if (huecos.length) {
  mal('no llega al bucket: ' + huecos.join(', '),
    'ese trabajo viviría solo en este navegador y se perdería al recuperar el proyecto');
} else ok('las seis clases de material se archivan en el bucket');

if (!/accion === 'subir'/.test(backend3)) mal('el backend no admite subir lo montado en el navegador');
else ok('el backend admite subir lo que se termina de montar en el cliente');

// Y todo lo del bucket tiene que poder volver.
const mainN = leer('app/main.js');
const iInv = mainN.indexOf('if (inventario.size)');
const recupera = mainN.slice(iInv, mainN.indexOf('for (const per of P.elenco)', iInv));
const clases = ['clave.audio', 'clave.imagen', 'clave.video', 'clave.musica'];
const sinRecuperar = clases.filter((c) => !recupera.includes(c));
if (sinRecuperar.length) {
  mal('el inventario del bucket no recupera ' + sinRecuperar.join(', '),
    'aparecería como no generado aunque esté guardado');
} else ok('voz, fotogramas, clips y música se recuperan del inventario del bucket');

// La generación más reciente gana.
if (!/info\.ts > local\.ts/.test(mainN)) {
  mal('una copia local vieja puede tapar una regeneración más nueva de la nube');
} else if (!/ts: it\.updated/.test(backend3)) {
  mal('el inventario no trae la fecha de cada archivo');
} else ok('si la copia del bucket es más nueva, se tira la local y se vuelve a traer');

/* ── 5e-bis · El almacén local se recupera solo ────────────── */
titulo('ALMACÉN LOCAL');
const dbJs = leer('app/db.js');
if (!/_db\.onclose/.test(dbJs) || !/_db\.onversionchange/.test(dbJs)) {
  mal('no se detecta que el navegador cierre la base de datos',
    'a partir de ahí todo falla con «The database connection is closing»');
} else if (!/esConexionCerrada\(/.test(dbJs) || !/tx\(store, modo, fn, true\)/.test(dbJs)) {
  mal('una conexión cerrada no se reabre', 'hay que reintentar con conexión nueva');
} else if (!/if \(esReintento \|\| !esConexionCerrada\(e\)\) throw e;/.test(dbJs)) {
  mal('el reintento del almacén podría entrar en bucle');
} else ok('si el navegador cierra la base, se reabre sola y se reintenta una vez');

// Ninguna imagen puede quedarse mostrando el icono de rota.
const mainI = leer('app/main.js');
const crudas = [...mainI.matchAll(/<img src=/g)].length +
  [...mainI.matchAll(/createElement\('img'\)/g)].length;
if (!/function ponerImagen\(/.test(mainI)) mal('no hay un punto único para pintar imágenes');
else if (crudas > 1) {
  mal('hay ' + crudas + ' sitios que pintan imágenes a mano',
    'una URL muerta se quedaría como icono roto; usa ponerImagen()');
} else if (!/assets\.url\(id, true\)/.test(mainI)) {
  mal('una imagen rota no se reintenta con una URL nueva');
} else ok('todas las imágenes pasan por un punto que se recupera de una URL muerta');

/* ── 5f-ter · Todo lo generado se puede rehacer ────────────── */
titulo('REHACER');
const REHACER = [
  { fase: 'voz',        boton: 'btnRehacerVoz', suelto: 'btnRegenVoz' },
  { fase: 'fotogramas', boton: 'btnRehacerImg', suelto: 'btnRegenImg' },
  { fase: 'movimiento', boton: 'btnRehacerVid', suelto: 'btnRegenVid' },
  { fase: 'música',     boton: 'btnRehacerMus', suelto: 'btnRegenMus' },
];
const sinRehacer = REHACER.filter((r) => !ids.has(r.boton));
const sinSuelto = REHACER.filter((r) => !ids.has(r.suelto));
if (sinRehacer.length) mal('fases que no se pueden rehacer enteras', sinRehacer.map((r) => r.fase).join(' · '));
else if (sinSuelto.length) mal('fases que no se pueden rehacer de una en una', sinSuelto.map((r) => r.fase).join(' · '));
else ok('las cuatro fases se pueden rehacer enteras y elemento a elemento');

// Rehacer tiene que pasar soloFaltantes=false, o no rehace nada.
const mainR = leer('app/main.js');
const bloqueRehacer = (mainR.match(/const rehacer = async[\s\S]*?\n  \};/) || [''])[0];
if (!bloqueRehacer) mal('no existe la función de rehacer una fase');
else if (/generar\w+\(ep, true\)/.test(bloqueRehacer)) {
  mal('rehacer usa soloFaltantes', 'saltaría justo lo que se quiere rehacer');
} else if (!/confirm\(/.test(bloqueRehacer)) {
  mal('rehacer no avisa de que se vuelve a pagar lo ya generado');
} else ok('rehacer ignora lo ya hecho y avisa antes de volver a pagarlo');

// Y lo mismo en los botones sueltos del detalle de toma.
const sueltos = (mainR.match(/\$\('btnRegen(Voz|Img|Vid|Mus)'\)[\s\S]{0,420}?\}\)\);/g) || []);
const conFaltantes = sueltos.filter((b) => /generar\w+\(ep, true/.test(b));
if (sueltos.length < 4) mal('faltan botones de regenerar en el detalle de toma');
else if (conFaltantes.length) mal('un botón de regenerar salta lo que ya existe', conFaltantes.length + ' de 4');
else ok('regenerar una toma suelta rehace de verdad, exista o no');

// El truco de sustituir ep.tomas rompía el guardado: no puede volver.
const pl2 = leer('app/main.js');
if (/ep\.tomas = \[/.test(pl2)) {
  mal('se sustituye la lista de tomas del episodio para generar una sola',
    'el guardado automático corre con el episodio truncado y lo persiste así');
} else ok('nadie trunca la lista de tomas para generar un elemento suelto');

/* ── 5g · Planos repetidos ─────────────────────────────────── */
titulo('PLANOS REPETIDOS');
const { agrupar, huella, aplicar: aplicarR, limpiar: limpiarR, ahorroDe } =
  await import(pathToFileURL(path.join(raiz, 'app', 'repetidos.js')).href);

// Dos tomas solo son el mismo plano si coinciden lugar, personajes y encuadre.
const pA = { lugar: 'bodega', personajes: ['sota', 'hina'], encuadre: 'plano medio', descripcion: 'x' };
const pB = { lugar: 'bodega', personajes: ['hina', 'sota'], encuadre: 'plano medio', descripcion: 'y' };
const pC = { lugar: 'bodega', personajes: ['sota'], encuadre: 'plano medio', descripcion: 'x' };
if (huella(pA) !== huella(pB)) mal('el orden de los personajes cambia la huella');
else if (huella(pA) === huella(pC)) mal('dos repartos distintos comparten huella');
else ok('la huella ignora el orden del reparto pero distingue quién sale');

// Agrupa entre episodios distintos, que es de lo que se trata.
const mismo = { lugar: 'tokio', personajes: [], encuadre: 'plano general',
  descripcion: 'Calle vacía al amanecer con niebla baja entre los edificios apagados' };
const otro = { lugar: 'aula', personajes: [], encuadre: 'primer plano', descripcion: 'Un pupitre vacío junto a la ventana' };
const eps = [
  { num: 1, tomas: [{ i: 0, escena: 1, segEstimados: 6, plano: mismo }, { i: 1, escena: 1, segEstimados: 6, plano: otro }] },
  { num: 7, tomas: [{ i: 3, escena: 2, segEstimados: 6, plano: { ...mismo } }] },
];
const gs = agrupar(eps, { umbral: 0.8 });
if (gs.length !== 1) mal('no agrupa el mismo plano de dos episodios distintos', 'grupos: ' + gs.length);
else if (gs[0].maestro.ep !== 1) mal('el maestro no es la primera aparición');
else if (gs[0].miembros.length !== 2) mal('el grupo no reúne las dos apariciones');
else ok('el mismo plano en dos episodios se agrupa, y manda la primera aparición');

// Aplicar marca a los demás, nunca al maestro, y es reversible.
const claves = {
  imagen: (e, i) => 'ep' + e + '/img' + i,
  video: (e, i) => 'ep' + e + '/vid' + i,
  duracion: () => 6,
};
const marcadas = aplicarR(eps, gs, claves);
const maestro = eps[0].tomas[0];
const copia = eps[1].tomas[0];
if (marcadas !== 1) mal('no marca exactamente las tomas que reutilizan');
else if (maestro.reusa) mal('el maestro se marcó a sí mismo como reutilizador');
else if (copia.reusa !== 'ep1/img0') mal('la copia no apunta al fotograma del maestro');
else if (!copia.reusaVideo) mal('no reutiliza el clip pese a durar lo mismo');
else if (limpiarR(eps) !== 1 || copia.reusa) mal('deshacer no limpia las marcas');
else ok('marca solo a las copias, apunta al maestro y se puede deshacer');

// Si la duración no coincide, el clip NO se reutiliza: se quedaría congelado.
aplicarR(eps, gs, { ...claves, duracion: (t) => (t.i === 0 ? 8 : 4) });
if (eps[1].tomas[0].reusaVideo) mal('reutiliza un clip de otra duración', 'la toma se quedaría corta o congelada');
else ok('el clip solo se reutiliza si la duración pedida a Veo es la misma');
limpiarR(eps);

// Todo el que lea un fotograma tiene que pasar por el resolutor.
const lectores = ['app/exportar.js', 'app/player.js', 'app/main.js'];
const sinResolver = [];
for (const f of lectores) {
  const txt = leer(f);
  for (const m of txt.matchAll(/assets\.(blob|url)\(clave\.(imagen|video)\(/g)) {
    sinResolver.push(f + ' → ' + m[0]);
  }
}
if (sinResolver.length) {
  mal('se lee un fotograma sin resolver la reutilización', sinResolver.join(' | ') +
    ' — usa claveImagenDe / claveVideoDe o la toma reutilizada saldrá vacía');
} else ok('los cinco lectores resuelven la reutilización antes de pedir el archivo');

// Y el motor no puede gastar en una toma que reutiliza.
const pl = leer('app/pipeline.js');
if (!/if \(t\.reusa\)[\s\S]{0,600}return;/.test(pl)) mal('el motor genera igualmente las tomas que reutilizan');
else if (!/if \(t\.reusaVideo\)[\s\S]{0,600}return;/.test(pl)) mal('el motor genera igualmente los clips que reutilizan');
else ok('una toma marcada no gasta ni una llamada');

/* ── 5h · Aguante ante cortes de conexión ──────────────────── */
titulo('CONEXIÓN Y REINTENTOS');
const apiJs = leer('app/api.js');
const mainJs2 = leer('app/main.js');

// Un fetch que revienta no trae código de estado: hay que distinguirlo.
if (!/catch \(e\)[\s\S]{0,320}err\.red = true/.test(apiJs)) {
  mal('un corte de red no se distingue de un rechazo del servidor',
    'el usuario vería «Load failed» sin saber que es su conexión');
} else if (!/const red = !!e\.red \|\| !e\.status/.test(apiJs)) {
  mal('el reintento no clasifica los cortes de red');
} else if (!/red \? intentos \+ \d+ : intentos/.test(apiJs)) {
  mal('un corte de red se reintenta las mismas veces que un error del servidor',
    'tres intentos en seis segundos caen todos dentro del mismo bache');
} else ok('un corte de red se distingue, se explica y se reintenta con más margen');

// No sirve de nada disparar peticiones contra una pestaña dormida.
if (!/function esperarVisible\(/.test(apiJs)) mal('no se espera a que la pestaña vuelva a estar visible');
else if (!/await esperarVisible\(señal\)[\s\S]{0,200}crudo\(/.test(apiJs)) {
  mal('se llama al servidor sin comprobar que la pestaña esté delante');
} else ok('con la app en segundo plano la cola espera en vez de fallar');

// Y mejor aún: que el teléfono no se duerma mientras trabaja.
if (!/wakeLock/.test(mainJs2)) {
  mal('nada impide que el teléfono se bloquee a mitad de una tanda',
    'es lo que produce los cortes en primer lugar');
} else if (!/soltarDespierto\(\)/.test(mainJs2) || !/visibilitychange[\s\S]{0,200}mantenerDespierto/.test(mainJs2)) {
  mal('el candado de pantalla no se suelta o no se recupera al volver');
} else ok('mientras hay trabajo se pide que la pantalla no se apague');

// Lo que falló por conexión se recupera solo, sin pedírselo al usuario.
if (!/pasada de recuperación/.test(mainJs2)) {
  mal('no hay pasada automática de recuperación tras una tanda con fallos');
} else if (!/if \(ahora >= antes\)[\s\S]{0,80}break/.test(mainJs2)) {
  mal('la recuperación podría repetirse sin avanzar', 'tiene que parar si no arregla nada');
} else ok('tras una tanda con fallos se reintenta solo, y para si deja de avanzar');

/* ── 6 · Vestuario coherente ───────────────────────────────── */
titulo('VESTUARIO');
const { ELENCO_DEFECTO, variantesDe, vestuarioPara } =
  await import(pathToFileURL(path.join(raiz, 'app', 'biblia.js')).href);

let vestOk = true;
for (const p of ELENCO_DEFECTO) {
  const vs = variantesDe(p);
  const ids2 = vs.map((v) => v.id);
  if (new Set(ids2).size !== ids2.length) { mal(p.nombre + ' tiene vestuarios repetidos'); vestOk = false; }
  if (!ids2.includes('rostro')) { mal(p.nombre + ' no genera hoja de rostro'); vestOk = false; }
  if (p.vestuarios) {
    for (const v of p.vestuarios) {
      if (!v.desc || !v.desc.trim()) { mal(p.nombre + ' · ' + v.id + ' sin descripción'); vestOk = false; }
      const fuera = (v.episodios || []).filter((n) => n < 1 || n > 12);
      if (fuera.length) { mal(p.nombre + ' · ' + v.id + ' apunta a episodios inexistentes: ' + fuera); vestOk = false; }
    }
    // Cada episodio en que el personaje sale debe resolver a un vestuario
    for (let e = 1; e <= 12; e++) {
      if (!vestuarioPara(p, e).id) { mal(p.nombre + ' no resuelve vestuario en el episodio ' + e); vestOk = false; }
    }
  }
}
if (vestOk) {
  const conRopa = ELENCO_DEFECTO.filter((p) => p.vestuarios && p.vestuarios.length > 1);
  ok(ELENCO_DEFECTO.length + ' personajes · ' + conRopa.length + ' se cambian de ropa · ' +
     ELENCO_DEFECTO.reduce((a, p) => a + variantesDe(p).length, 0) + ' hojas de referencia en total');
}

/* ── 7 · Nada privado en el repositorio ────────────────────── */
titulo('PRIVACIDAD');
const patrones = [/gserviceaccount\.com/, /BEGIN PRIVATE KEY/, /"private_key"/, /\bgs:\/\/[a-z0-9_-]{3,}/];
let sucio = [];
const recorrer = (dir) => {
  for (const e of fs.readdirSync(path.join(raiz, dir), { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { recorrer(rel); continue; }
    if (!/\.(js|mjs|html|json|md)$/.test(e.name)) continue;
    if (rel.endsWith('auditar.mjs')) continue;          // este archivo define los patrones
    const txt = fs.readFileSync(path.join(raiz, rel), 'utf8');
    for (const p of patrones) {
      if (p.test(txt) && !/censor|redact|oculto|nombreBucket|gs:\/\/mi-|gs:\/\/diezmo-video|gs:\/\/«/.test(txt.split('\n').find((l) => p.test(l)) || '')) {
        sucio.push(rel + ' → ' + (txt.split('\n').find((l) => p.test(l)) || '').trim().slice(0, 70));
      }
    }
  }
};
recorrer('.');
if (sucio.length) mal('posible dato privado en el repositorio', sucio.join('\n      '));
else ok('sin credenciales ni identificadores de cuenta en los archivos');

/* ── 8 · Los guiones siguen intactos y narrables ───────────── */
titulo('GUIONES');
const { limpiarTexto, segmentar, verificarCobertura, normalizarParaVoz, REEMPLAZOS_BASE } =
  await import(pathToFileURL(path.join(raiz, 'app', 'texto.js')).href);
let malGuion = 0, tomas = 0;
for (let k = 1; k <= 12; k++) {
  const f = 'episodios/ep' + String(k).padStart(2, '0') + '.md';
  if (!fs.existsSync(path.join(raiz, f))) { mal('falta ' + f); malGuion++; continue; }
  const limpio = limpiarTexto(leer(f));
  const ts = segmentar(limpio, { segundosPorToma: 8, cps: 16 });
  tomas += ts.length;
  if (!verificarCobertura(limpio, ts).ok) { mal(f + ': la segmentación pierde texto'); malGuion++; }
  const resto = normalizarParaVoz(limpio, REEMPLAZOS_BASE).match(/[\d¥²³%]/g);
  if (resto) { mal(f + ': quedan símbolos sin narrar: ' + [...new Set(resto)].join('')); malGuion++; }
}
if (!malGuion) ok('doce guiones · ' + tomas + ' tomas · cobertura exacta · sin cifras sin narrar');

/* ── Resultado ─────────────────────────────────────────────── */
console.log('\n' + (fallos ? '✗ ' + fallos + ' problemas' : '✓ auditoría limpia'));
process.exit(fallos ? 1 : 0);
