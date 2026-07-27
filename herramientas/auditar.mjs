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
else ok('a intensidad cero la imagen se queda realmente quieta');

/*  Y nadie puede tirar ese cero por el camino. La sala hacía
    "intensidadCamara || 1", que convierte el cero del usuario en movimiento
    normal: enseñaba una cosa y el montaje exportaba otra.                   */
const tiraElCero = ['app/player.js', 'app/exportar.js', 'app/main.js']
  .filter((f) => /intensidadCamara\s*(\)\s*)?\|\|/.test(leer(f)));
if (tiraElCero.length) {
  mal('el cero de intensidad se convierte en movimiento normal', tiraElCero.join(' · '));
} else ok('el cero del usuario llega intacto a la sala y al montaje');

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

/* ── 5b-bis · Lo que enseña el desplegable es lo que se usa ── */
titulo('MODELOS GUARDADOS');
const mainM = leer('app/main.js');

/*  Un modelo guardado puede haber salido del catálogo. llenarSelect corregía el
    DESPLEGABLE y dejaba el nombre muerto en la configuración: se veía un modelo
    y el motor pedía otro. Con el de imagen era peor, porque RESOLUCIONES no
    encontraba lista para el modelo desconocido, caía a la del modelo de 1K y
    esa caída SÍ se guardaba: la resolución quedaba degradada para siempre.   */
if (!/function llenarSelect\(sel, pares, valor, preferido\)/.test(mainM) ||
    !/return sel\.value;/.test(mainM)) {
  mal('llenarSelect no devuelve el valor que ha quedado seleccionado',
    'la corrección se queda en pantalla y la configuración conserva el modelo muerto');
} else {
  const cuerpo = mainM.slice(mainM.indexOf('function poblarModelos()'),
    mainM.indexOf('function pintarNotasModelo()'));
  const escritos = ['modeloTts', 'modeloTexto', 'modeloImagen', 'modeloVideo',
                    'modeloMusica', 'imageSize']
    .filter((k) => new RegExp('P\\.config\\.' + k + ' = llenarSelect\\(').test(cuerpo));
  if (escritos.length !== 6) {
    mal('hay modelos cuya corrección no se escribe en la configuración',
      'solo se escriben: ' + (escritos.join(', ') || 'ninguno'));
  } else if (!/RESOLUCIONES\[P\.config\.modeloImagen\] \|\| RESOLUCIONES\[C\.modeloImagen\]/.test(cuerpo)) {
    mal('la lista de resoluciones cae a un modelo escrito a mano',
      'con el modelo de 1K de respaldo, la resolución se degradaba y se guardaba');
  } else if (!/ya no está disponible/.test(cuerpo)) {
    mal('cambiar un modelo por su cuenta no se avisa', 'cambia lo que cuesta y lo que sale');
  } else ok('los seis desplegables escriben su corrección en la configuración, y se avisa del cambio');
}

// El de voz era el único sin fijar al cambiar, y poblarModelos lo repintaba encima.
if (!/\$\('cfgModeloTts'\)\.addEventListener\('change'/.test(mainM)) {
  mal('el modelo de voz no se fija al cambiarlo',
    'cambiar el de imagen repinta los desplegables y se perdía la elección sin avisar');
} else if (/c\.modelo(Tts|Imagen|Video|Texto) = \$\(/.test(mainM)) {
  mal('«Guardar ajustes» vuelve a leer los modelos de la pantalla',
    'es el camino por el que podía volver un valor viejo');
} else ok('los cinco modelos se fijan al cambiarlos, y guardar no los relee de la pantalla');

// Tras recuperar de la nube hay que repintar, o «Guardar» sube lo viejo.
if (!/await rehidratar\(remoto\);[\s\S]{0,320}pintarConfig\(\)/.test(mainM)) {
  mal('tras recuperar el proyecto de la nube no se repintan los mandos',
    'abrir Ajustes y guardar subiría al bucket los valores locales viejos sin tocar nada');
} else ok('recuperar de la nube repinta los mandos antes de que nadie pueda guardarlos');

/* ── 5b-quater · El episodio se entrega montado ─────────────── */
titulo('MONTAJE EN LA NUBE');
const { limpiarTexto: lt2, segmentar: sg2 } =
  await import(pathToFileURL(path.join(raiz, 'app', 'texto.js')).href);
const backM = leer('api/ep-gemini.js');
const contenedor = leer('montaje/montar.sh');

/*  El contenedor se despliega copiándolo a mano en la consola del usuario, que
    tiene varias cuentas. Si llevara escrito un bucket o un proyecto, acabaría
    apuntando a la cuenta equivocada. No debe llevar NINGUNO: todo llega en las
    tres rutas que compone el backend, que es donde viven los datos.         */
if (!/gs:\/\//.test(contenedor) === false && /gs:\/\/[a-z0-9]/i.test(contenedor)) {
  mal('el montador lleva una ruta de bucket escrita', 'apuntaría a la cuenta equivocada');
} else if (/TRABAJO|SALIDA/.test(contenedor) === false) {
  mal('el montador no recibe las rutas por variables de entorno');
} else ok('el montador no lleva escrito ningún dato de la cuenta: todo llega en tres rutas');

if (!/mode === 'montar'/.test(backM)) {
  mal('no existe el modo de montaje');
} else if (!/jobs\/' \+ job \+ ':run'/.test(backM)) {
  mal('el montaje no lanza el Cloud Run Job');
} else if (!/MONTAJE_JOB|MONTAJE_REGION/.test(backM)) {
  mal('el nombre y la región del montador están escritos a fuego, no en variables');
} else ok('el backend escribe el encargo en el bucket y lanza el Job, y consulta como con Veo');

/*  El montador se despliega copiando a mano el texto de DESPLIEGUE.md. Si ese
    texto se queda atrás respecto al archivo real, lo desplegado NO es lo
    auditado y nadie se entera hasta que el montaje falla en la nube.        */
{
  const doc = leer('montaje/DESPLIEGUE.md');
  const desnudo = (t) => t.split('\n')
    .filter((l) => !l.trim().startsWith('#') || l.startsWith('#!'))
    .map((l) => l.trimEnd()).join('\n').replace(/\n{2,}/g, '\n').trim();
  const citado = (marca) => {
    const i = doc.indexOf(marca);
    if (i < 0) return null;
    const j = doc.indexOf('> ```', i + marca.length);
    if (j < 0) return null;
    return desnudo(doc.slice(doc.indexOf('\n', i) + 1, j).split('\n')
      .map((l) => (l.startsWith('> ') ? l.slice(2) : (l.trim() === '>' ? '' : l))).join('\n'));
  };
  const pares = [
    ['montaje/montar.sh', citado('```bash\n> #!/bin/bash')],
    ['montaje/Dockerfile', citado('```dockerfile')],
  ];
  const desfasados = pares.filter(([f, c]) => c === null || c !== desnudo(leer(f)));
  if (desfasados.length) {
    mal('el texto que se pega en la consola ya no coincide con ' +
      desfasados.map(([f]) => f).join(' y '),
      'se desplegaría un montador distinto del que se ha comprobado aquí');
  } else ok('lo que se pega en la consola es exactamente el montador auditado');
}

/*  LA INVARIANTE QUE IMPORTA: cada archivo que el script de ffmpeg abre tiene
    que estar en la lista de descargas. Si falta uno, el fallo aparece en la
    nube después de minutos de trabajo, y el mensaje de ffmpeg no dice cuál. */
{
  const { hojaDeMontaje: hdm, scriptFfmpeg: sff, descargasDe: dds } =
    await import(pathToFileURL(path.join(raiz, 'app', 'exportar.js')).href);
  const tomasEp = sg2(lt2(leer('episodios/ep01.md')), { segundosPorToma: 8, cps: 16 })
    .map((t, k) => ({
      ...t,
      audio: { ok: true },
      imagen: { ok: true },
      // Una de cada cinco con clip, y una reutilizando el fotograma de otra:
      // los dos casos que rompen una lista escrita aparte.
      video: k % 5 === 0 ? { ok: true, dur: 8 } : null,
      reusa: k === 7 ? 'ep01/t003/img' : undefined,
      plano: { tipo: k % 5 === 0 ? 'movimiento' : 'fijo', movimiento: 'travelling de acercamiento lento' },
    }));
  const epF = { num: 1, titulo: 'Prueba', tomas: tomasEp, musica: { 1: { ok: true }, 2: { ok: true } } };
  const hojaF = hdm(epF, { formato: '16:9', intensidadCamara: 1, volumenMusica: 0.3 });
  const guion = sff(hojaF);
  const dan = new Set(dds(epF, hojaF).map((d) => d.destino));

  /*  Lo que el script CREA por su cuenta no hace falta bajarlo. Se listan las
      rutas con y sin comillas: mirando solo las entrecomilladas, media cadena
      se quedaba fuera del examen y la comprobación pasaba por suerte.       */
  const creados = /^(segmentos\/|musica\/lecho|voz\/(completa|pieza-))/;
  const pedidos = new Set();
  for (const m of guion.matchAll(/-i (?:"([^"]+)"|(\S+))/g)) {
    const ruta = m[1] || m[2];
    if (!creados.test(ruta) && !/^(lista|listamus|listavoz)/.test(ruta) && ruta.indexOf('=') === -1) {
      pedidos.add(ruta);
    }
  }
  const huecos = [...pedidos].filter((p) => !dan.has(p));
  /*  Y un fotograma reutilizado tiene que pedirse desde SU maestro. Si se pide
      desde la clave de la propia toma, la lista sale completa y el montaje
      falla en la nube por un archivo que no existe.                         */
  const lista = dds(epF, hojaF);
  const reusada = lista.find((d) => d.destino === 'fotogramas/toma-008.png');
  if (!pedidos.size) {
    mal('no se ha podido leer qué archivos pide el script de montaje');
  } else if (!reusada || reusada.clave !== 'ep01/t003/img') {
    mal('un fotograma reutilizado no se pide desde el suyo',
      'se pediría ' + (reusada ? reusada.clave : 'nada') + ', que no existe en el bucket');
  } else if (huecos.length) {
    mal(huecos.length + ' archivos que pide ffmpeg no están en la lista de descargas',
      huecos.slice(0, 4).join(' · '));
  } else {
    ok('los ' + pedidos.size + ' archivos que pide ffmpeg —con clips y fotogramas ' +
       'reutilizados— están todos en la lista de descargas');
  }
}

/* ── 5b-sexies · Portadas y carteles ────────────────────────── */
titulo('PORTADAS Y CARTELES');
{
  const pr = await import(pathToFileURL(path.join(raiz, 'app', 'portadas.js')).href);
  const bib = await import(pathToFileURL(path.join(raiz, 'app', 'biblia.js')).href);
  const C = bib.CONFIG_DEFECTO;
  const ctx = { estilo: C.estilo, calidad: C.calidad, negativo: C.negativo };
  const dos = bib.ELENCO_DEFECTO.slice(0, 2);
  const epF = { num: 1, titulo: 'El censo', tomas: [{ i: 0, texto: 'Texto de arranque.' }] };
  const port = pr.promptPortada(epF, ctx, dos, true);
  const cart = pr.promptCartel(pr.CARTELES[0], ctx, [bib.ELENCO_DEFECTO[0]], true);

  /*  El texto va DENTRO y grande. Lo que el modelo deforma es la letra
      pequeña, no la de cartel, así que se le da el texto exacto, se le exige
      un tamaño mínimo y se le prohíbe expresamente la letra menuda —créditos,
      fechas, webs—, que es la parte que falla.                              */
  const conTitulo = [port, cart].every((p) => /«DIEZMO»/.test(p) &&
    /TIPOGRAFÍA DE CARTEL, MUY GRANDE/.test(p) && /PROHIBIDA LA LETRA PEQUEÑA/.test(p));
  const conCapitulo = /«EPISODIO 01»/.test(port);
  // Pocas palabras: cada línea de más es una ocasión de que algo salga torcido.
  const lineasPedidas = (p) => (p.match(/^ {2}\d\) «/gm) || []).length;
  const demasiadas = [port, cart].some((p) => lineasPedidas(p) > 2 || lineasPedidas(p) < 1);
  const sinTexto = conTitulo && conCapitulo && !demasiadas;
  /*  Y la cara tiene que ser la de siempre: una portada con otro rostro es lo
      primero que ve quien no conoce la serie.                               */
  const conFichas = dos.every((p) => port.indexOf(p.nombre) !== -1) &&
    /hojas de referencia/.test(port);
  if (!sinTexto) {
    mal('el texto de las portadas no está bien pedido',
      'hace falta el título exacto, tipografía de cartel y la letra pequeña prohibida');
  } else if (!conFichas) {
    mal('la portada no lleva las fichas ni pide respetar las hojas de referencia',
      'saldrían personajes con otra cara');
  } else if ([port, cart].some((p) => p.indexOf(C.negativo) === -1)) {
    mal('las portadas no heredan la lista de lo que hay que evitar');
  } else {
    ok('portada y cartel llevan el título rotulado en grande —con el capítulo—, la letra ' +
       'pequeña prohibida, y las hojas de referencia adjuntas');
  }

  // Los carteles no pueden ser el mismo cartel seis veces.
  const ideas = pr.CARTELES.map((c) => c.idea);
  const repetidas = ideas.length - new Set(ideas).size;
  const sinReparto = pr.CARTELES.filter((c) => !c.reparto.length).length;
  const idsMalos = pr.CARTELES.filter((c) =>
    c.reparto.some((id) => !bib.ELENCO_DEFECTO.some((p) => p.id === id)));
  if (repetidas) {
    mal(repetidas + ' carteles repiten la misma idea');
  } else if (idsMalos.length) {
    mal('hay carteles que piden personajes que no existen en el elenco',
      idsMalos.map((c) => c.id).join(' · '));
  } else if (sinReparto === 0) {
    mal('todos los carteles llevan personajes',
      'hace falta alguno sin figuras, que sirva de fondo y de cabecera');
  } else {
    ok(pr.CARTELES.length + ' carteles distintos, ' + sinReparto + ' sin figuras · formatos: ' +
       pr.FORMATOS.map((f) => f[0]).join(', '));
  }

  // El reparto de una portada sale de lo que el director anotó, no del texto.
  const conPlanos = { num: 1, titulo: 'X', tomas: [
    { i: 0, plano: { personajes: ['sota', 'hina'] } },
    { i: 1, plano: { personajes: ['sota'] } },
    { i: 2, plano: { personajes: ['rei'] } },
  ] };
  const rep = pr.repartoDe(conPlanos, 2);
  if (rep[0] !== 'sota' || rep.length !== 2) {
    mal('el reparto de la portada no sale por presencia real', 'salió: ' + rep.join(', '));
  } else ok('la portada se reparte por quién sale más, no por quién se menciona');

  /*  Y lo generado para publicar tiene que sobrevivir a una recarga: si no se
      guarda en el estado, la próxima carga lo da por no hecho y se paga otra vez. */
  const mainP = leer('app/main.js');
  const guarda = /portadas: P\.portadas/.test(mainP) && /carteles: P\.carteles/.test(mainP) &&
    /montaje: e\.montaje/.test(mainP);
  const recupera = /P\.portadas = compacto\.portadas/.test(mainP) &&
    /P\.carteles = compacto\.carteles/.test(mainP) && /ep\.montaje = ce\.montaje/.test(mainP);
  if (!guarda) mal('las portadas, los carteles o el montaje no se guardan en el estado');
  else if (!recupera) mal('no se recuperan al volver del bucket', 'se darían por no hechos');
  else ok('portadas, carteles y montaje se guardan y se recuperan: una recarga no los pierde');
}

/* ── 5b-quinquies · La calidad del montaje ──────────────────── */
titulo('CALIDAD DEL MONTAJE');
{
  const { hojaDeMontaje: hdm2, scriptFfmpeg: sff2 } =
    await import(pathToFileURL(path.join(raiz, 'app', 'exportar.js')).href);
  const t = (i, esc, corte) => ({
    i, escena: esc, texto: 'x'.repeat(120), segEstimados: 8, segundos: 8, corteEscena: corte,
    audio: { ok: true }, imagen: { ok: true },
    plano: { tipo: 'fijo', movimiento: 'travelling de acercamiento lento' },
  });
  const epQ = { num: 1, titulo: 'T', tomas: [t(0, 1, false), t(1, 1, true), t(2, 2, false)],
    musica: { 1: { ok: true }, 2: { ok: true } } };
  const g = sff2(hdm2(epQ, { formato: '16:9', intensidadCamara: 1, volumenMusica: 0.3, silencioEscena: 0.7 }));

  /*  EL CHASQUIDO. Codificar cada toma a AAC y luego pegarlas con «concat -c
      copy» mete un chasquido en CADA unión: el AAC lleva muestras de precarga
      y relleno, y por copia esos bordes se quedan dentro. Era lo que sonaba.
      La voz no puede tocar un codificador hasta el final de todo.           */
  const segmentoConAudio = /segmentos\/seg[\s\S]{0,300}?-c:a (?!pcm)/.test(g) ||
    /-map "\[v\]"[^\n]*-map [^\n]*:a/.test(g);
  const encodesAudio = (g.match(/-c:a (?!pcm)\w+/g) || []).length;
  if (segmentoConAudio) {
    mal('los segmentos llevan audio comprimido',
      'al pegarlos por copia suena un chasquido en cada unión');
  } else if (!/-map "\[v\]" -an/.test(g)) {
    mal('los segmentos no se declaran mudos');
  } else if (!/-f concat[^\n]*listavoz[\s\S]{0,120}pcm_s16le/.test(g)) {
    mal('la voz no se une sin comprimir', 'unir en comprimido es lo que produce el ruido');
  } else if (encodesAudio !== 1) {
    mal('el audio se codifica ' + encodesAudio + ' veces', 'debe codificarse una sola vez, al final');
  } else ok('la voz va en PCM de principio a fin y se codifica una sola vez, al final');

  // El video tampoco puede recodificarse dos veces.
  const concatVideo = /-f concat[^\n]*lista\.txt[^\n]*-c copy/.test(g);
  const remuxFinal = /-map 0:v[^\n]*-c:v copy/.test(g);
  if (!concatVideo || !remuxFinal) {
    mal('el episodio se vuelve a codificar al unirlo o al mezclar',
      'una segunda generación de x264 sobre todo el episodio');
  } else ok('la imagen se codifica una vez por toma y el episodio se pega por copia');

  /*  Y el ampliado previo al movimiento de cámara tiene que cubrir el zoom más
      agresivo sin pasarse: pasarse cuesta tiempo de Job, y agotar el tiempo
      significa quedarse sin montaje.                                        */
  const mAmp = /scale=\$\{W\}\*(\d+):/.exec(g);
  const { planoCamara: pc2 } = await import(pathToFileURL(path.join(raiz, 'app', 'camara.js')).href);
  const { CAMARA } = await import(pathToFileURL(path.join(raiz, 'app', 'camara.js')).href);
  let zoomMax = 1;
  for (const nombre of Object.keys(CAMARA)) {
    const c = pc2(nombre, 3);              // intensidad máxima que admite el mando
    zoomMax = Math.max(zoomMax, c.z0, c.z1);
  }
  if (!mAmp) {
    mal('no se amplía la imagen antes de recorrerla', 'el movimiento de cámara pixelaría');
  } else if (Number(mAmp[1]) < zoomMax) {
    mal('el ampliado (' + mAmp[1] + 'x) no cubre el zoom máximo (' + zoomMax.toFixed(2) + 'x)',
      'la imagen se vería blanda en las tomas más cerradas');
  } else if (Number(mAmp[1]) > zoomMax + 1.2) {
    mal('el ampliado (' + mAmp[1] + 'x) se pasa del zoom máximo (' + zoomMax.toFixed(2) + 'x)',
      'son pixeles filtrados para nada, y el Job se arriesga a agotar su tiempo');
  } else if (!/flags=lanczos/.test(g)) {
    mal('el ampliado usa el escalador por defecto', 'el original es de 2K: hay que estirarlo con cabeza');
  } else {
    ok('se amplía ' + mAmp[1] + 'x con lanczos para un zoom máximo de ' + zoomMax.toFixed(2) + 'x');
  }
}

/* ── 5b-ter · Una locución por episodio ─────────────────────── */
titulo('VOZ DE EPISODIO ENTERO');
const pipeVL = leer('app/pipeline.js');
const backVL = leer('api/ep-gemini.js');
const { VOCES_CHIRP, VOZ_CHIRP_DEFECTO, VELOCIDAD_DEFECTO, cortarEscena } =
  await import(pathToFileURL(path.join(raiz, 'app', 'voz.js')).href);

/*  El motor por bloques nunca podrá dar el mismo narrador quince minutos
    seguidos: cada llamada es una actuación nueva. El de episodio entero sí,
    y para eso el audio tiene que ir por el bucket —una locución de quince
    minutos son 45 MB y por la función no caben.                            */
if (!/mode === 'vozlarga'/.test(backVL)) {
  mal('no existe el modo de locución por episodio');
} else if (!/synthesizeLongAudio/.test(backVL)) {
  mal('la locución larga no usa Long Audio Synthesis',
    'ninguna otra vía admite un episodio entero de una vez');
} else if (!/outputGcsUri/.test(backVL)) {
  mal('la locución no se escribe en el bucket',
    'quince minutos de audio no caben en una respuesta de la función');
} else if (!/audioConfig\.speakingRate = Math\.min\(2, Math\.max\(0\.25/.test(backVL)) {
  mal('la velocidad no se acota al rango que admite el motor (0,25x a 2x)');
} else ok('el episodio entero se narra de una vez y se escribe directo en el bucket');

// Y el reparto entre tomas tiene que ser el mismo de siempre, no otro distinto.
const genVL = pipeVL.slice(pipeVL.indexOf('async generarVozLarga('),
  pipeVL.indexOf('/* ── Fotogramas'));
if (!genVL) {
  mal('no existe la generación de voz por episodio');
} else if (!/cortarEscena\(/.test(genVL)) {
  mal('la locución no se reparte entre las tomas por los silencios');
} else if (!/clave\.audio\(ep\.num, t\.i\)/.test(genVL)) {
  mal('la voz repartida no se guarda donde el resto de la herramienta la busca');
} else ok('la locución se reparte con el mismo cortador de silencios y se guarda toma a toma');

/*  Y tiene que aguantar un episodio ENTERO, que es el caso nuevo: 134 tomas y
    dieciséis minutos, no seis tomas y un minuto. Se prueba de verdad, con una
    locución falsa de ritmo irregular —un narrador no lee a velocidad fija.  */
{
  const R = 24000;
  const tomasEp = sg2(lt2(leer('episodios/ep01.md')), { segundosPorToma: 8, cps: 16 });
  let sem = 7; const rnd = () => ((sem = (sem * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const dur = tomasEp.map((t) => t.segEstimados * (0.85 + rnd() * 0.3));
  const pcm = new Int16Array(Math.round(dur.reduce((a, d) => a + d + 0.45, 0) * R));
  const limites = [];
  let o = 0;
  dur.forEach((d, k) => {
    const n = Math.round(d * R);
    for (let i = 0; i < n; i++) {
      pcm[o + i] = ((Math.sin(2 * Math.PI * 118 * (o + i) / R) *
        (0.5 + 0.5 * Math.sin(2 * Math.PI * 4.5 * i / R)) * 9000) + (rnd() - 0.5) * 90) | 0;
    }
    o += n;
    if (k < dur.length - 1) {
      const p = Math.round(0.45 * R);
      for (let i = 0; i < p; i++) pcm[o + i] = ((rnd() - 0.5) * 90) | 0;
      limites.push(o + p / 2);
      o += p;
    }
  });
  const trs = cortarEscena(pcm.subarray(0, o), R, tomasEp.map((t) => Math.max(1, t.texto.length)));
  const err = limites.map((real, k) => Math.abs(trs[k].hasta - real) / R).sort((a, b) => a - b);
  const suma = trs.reduce((a, t) => a + (t.hasta - t.desde), 0);
  const seguidos = trs.every((t, k) => t.hasta > t.desde && (k === 0 || t.desde === trs[k - 1].hasta));
  if (trs.length !== tomasEp.length || suma !== o) {
    mal('repartir un episodio entero pierde o duplica audio', suma + ' de ' + o + ' muestras');
  } else if (!seguidos) {
    mal('los tramos del episodio se solapan o van hacia atrás');
  } else if (err[err.length - 1] > 0.25) {
    mal('el reparto del episodio se desvía demasiado',
      'peor error ' + err[err.length - 1].toFixed(2) + ' s');
  } else {
    ok('reparte un episodio de ' + (o / R / 60).toFixed(0) + ' min y ' + tomasEp.length +
       ' tomas con ' + (err[Math.floor(err.length / 2)] * 1000).toFixed(0) + ' ms de error mediano y ' +
       (err[err.length - 1] * 1000).toFixed(0) + ' ms el peor');
  }
}

/*  Un solo sitio decide el motor: si la condición se repite en cada botón,
    tarde o temprano uno se queda con el motor antiguo.                     */
const mainVL = leer('app/main.js');
const sueltasMotor = ['app/main.js', 'app/pipeline.js', 'app/player.js', 'app/exportar.js']
  .filter((f) => /motorVoz\s*[!=]==\s*'/.test(leer(f)));
if (!/async generarVozDe\(/.test(pipeVL)) {
  mal('no hay un despachador único de motor de voz');
} else if (/\.generarVoz\(ep, (false|true)\)/.test(mainVL)) {
  mal('algún botón llama al motor por bloques sin pasar por el despachador');
} else if (sueltasMotor.length) {
  mal('la condición del motor se compara a mano en ' + sueltasMotor.join(' · '),
    'debe salir siempre de narraEpisodioEntero(), o uno se quedará atrás');
} else ok('un único despachador elige motor y una única función define cuál es');

// Las voces ofrecidas tienen que ser masculinas y del catálogo real de Chirp.
const malFormadas = VOCES_CHIRP.filter(([id]) => !/^es-US-Chirp3-HD-\w+$/.test(id));
const varones = ['Charon', 'Orus', 'Fenrir', 'Puck'];
const intrusas = VOCES_CHIRP.filter(([id]) => varones.indexOf(id.split('-').pop()) === -1);
if (malFormadas.length) {
  mal('hay voces con el identificador mal formado', malFormadas.map((v) => v[0]).join(' · '));
} else if (intrusas.length) {
  mal('hay voces que no son masculinas', 'el proyecto es de narrador masculino');
} else if (VOCES_CHIRP.every(([id]) => id !== VOZ_CHIRP_DEFECTO)) {
  mal('la voz por defecto no está en el catálogo');
} else if (VELOCIDAD_DEFECTO <= 1) {
  mal('la velocidad por defecto no acelera la narración', 'se pidió algo más rápida');
} else {
  ok(VOCES_CHIRP.length + ' voces masculinas de Chirp 3: HD · por defecto ' +
     VOZ_CHIRP_DEFECTO.split('-').pop() + ' a ' + VELOCIDAD_DEFECTO + 'x');
}

/* ── 5c-pre · La semilla no se teclea y llega a lo guardado ── */
titulo('SEMILLA DE VOZ');
const { SEMILLA_FIJA, aplicarTono: aplT } =
  await import(pathToFileURL(path.join(raiz, 'app', 'voz.js')).href);
const mainS = leer('app/main.js');

/*  Cambiar CONFIG_DEFECTO no basta: lo guardado gana. Y no basta con reparar en
    un sitio, porque hay dos caminos que construyen la configuración —el
    navegador y la recuperación desde el bucket— y el segundo se ejecuta en cada
    arranque, después del primero. Se comprueba ejecutando la reparación, no
    buscando una línea: una línea se mueve, el comportamiento no.             */
const { normalizarConfig: normCfg, CONFIG_DEFECTO } =
  await import(pathToFileURL(path.join(raiz, 'app', 'biblia.js')).href);

const semillasMalas = [['vacía', ''], ['nula', null], ['ausente', undefined],
                       ['con texto', 'aleatoria'], ['NaN', NaN]];
/*  Con tono elegido, aplicarTono ya pone la semilla. Sin tono —voz ajustada a
    mano— no la pone nadie, y ese es justo el caso que hay que reparar aquí.  */
const contextos = [['con tono', { tono: 'narrador' }], ['con la voz a mano', { tono: null, voz: 'Puck' }],
                   ['anterior a los tonos', { voz: 'Puck' }]];
const noReparadas = [];
for (const [ctx, base] of contextos) {
  for (const [nombre, v] of semillasMalas) {
    const s = Number(normCfg({ ...base, semillaVoz: v }).semillaVoz);
    if (!Number.isFinite(s) || s === 0) noReparadas.push(nombre + ' ' + ctx);
  }
}
if (noReparadas.length) {
  mal('la semilla no queda reparada: ' + noReparadas.join(', '),
    'sin semilla fija el modelo sortea el tono en cada llamada');
} else if (Number(normCfg({ semillaVoz: 12345, tono: 'narrador' }).semillaVoz) !== 12345) {
  mal('la reparación pisa una semilla que el usuario ya tenía puesta');
} else ok('cinco formas de semilla inválida quedan reparadas a ' + SEMILLA_FIJA + ', y la buena se respeta');

/*  Y la reparación tiene que estar en el ÚNICO sitio que construye la
    configuración: si vuelve a haber dos, el segundo deshace al primero.     */
const fusiones = (mainS.match(/\{\s*\.\.\.CONFIG_DEFECTO\s*,\s*\.\.\./g) || []).length;
const usosNorm = (mainS.match(/normalizarConfig\(/g) || []).length;
if (fusiones) {
  mal(fusiones + ' sitios fusionan CONFIG_DEFECTO por su cuenta',
    'el que se ejecute último gana, y se salta las reparaciones');
} else if (usosNorm < 3) {
  mal('no todos los caminos pasan por normalizarConfig', 'hay ' + usosNorm + ', hacen falta 3: nuevo, guardado y nube');
} else ok('los tres caminos —proyecto nuevo, copia local y bucket— pasan por la misma reparación');

// El precio nuevo dentro de precios llega, aunque el proyecto guardara los viejos.
const conPrecios = normCfg({ precios: { imagen: 0.9 } });
if (Object.keys(CONFIG_DEFECTO.precios).some((k) => conPrecios.precios[k] === undefined)) {
  mal('una clave nueva de precios no llega a un proyecto ya guardado',
    'precios es un objeto anidado: la fusión superficial lo sustituye entero');
} else if (conPrecios.precios.imagen !== 0.9) {
  mal('la fusión de precios pisa lo que el usuario había puesto');
} else ok('precios se fusiona clave a clave: lo nuevo llega y lo tuyo se queda');

// Un proyecto anterior a los tonos no puede perder la voz que eligiera a mano.
const antiguo = normCfg({ voz: 'Puck', temperaturaVoz: 0.5 });
if (antiguo.voz !== 'Puck') {
  mal('a un proyecto anterior a los tonos se le borra la voz elegida a mano',
    'se le mete el tono por defecto y aplicarTono machaca voz, temperatura e instrucción');
} else if (antiguo.tono) {
  mal('un proyecto sin tono aparece como si tuviera uno', 'el selector diría «narrador» con otra voz puesta');
} else ok('un proyecto anterior a los tonos conserva su voz y sale como personalizado');

// Aplicar un tono no puede pisar una semilla que ya estaba puesta.
const conSemilla = { semillaVoz: 12345 };
aplT(conSemilla, 'narrador');
if (Number(conSemilla.semillaVoz) !== 12345) mal('cambiar de tono pisa la semilla del usuario');
else {
  /*  null va aparte de vacío y de ausente: Number(null) es 0, que es finito, y
      la guarda lo daba por válido. Se acababa mandando semilla 0.            */
  const sinPoner = [['vacía', ''], ['nula', null], ['ausente', undefined]]
    .filter(([, v]) => {
      const c = { semillaVoz: v };
      aplT(c, 'narrador');
      return !Number.isFinite(Number(c.semillaVoz)) || Number(c.semillaVoz) === 0;
    });
  if (sinPoner.length) {
    mal('aplicar un tono deja la semilla sin poner: ' + sinPoner.map((x) => x[0]).join(', '));
  } else ok('el tono pone semilla si falta —vacía, nula o ausente— y respeta la que ya hubiera');
}

// Y no puede haber un campo donde el usuario tenga que inventarse un número.
if (/id="cfgSemilla"/.test(html)) {
  mal('la semilla sigue siendo un campo de escribir',
    'el usuario no tiene forma de saber qué número poner');
} else if (!ids.has('btnNuevaSemilla') || !ids.has('valSemilla')) {
  mal('no hay forma de ver ni de cambiar la semilla sin teclearla');
} else ok('la semilla se ve y se cambia con un botón, no se teclea');

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
} else if (!/repartirEnBloques\(/.test(genVoz)) {
  mal('la escena se pide entera de una vez', 'la mediana dura dos minutos y medio y no cabe en una respuesta');
} else ok('un solo sitio pide voz, por bloques de escena, repartida después entre sus tomas');

// El reparto por silencios: se comprueba de verdad, no por su forma.
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

/*  Ninguna llamada puede pasarse de lo que aguanta el servidor. Son dos techos
    distintos y los dos son de la plataforma, no de Google: una respuesta no
    puede pasar de 4,5 MB —y el audio viaja en base64, a 64 KB por segundo
    hablado— y la función se corta al minuto de ejecución. La escena mediana
    dura dos minutos y medio: pedirla entera fallaba siempre.                 */
const { repartirEnBloques, SEGUNDOS_POR_LLAMADA } =
  await import(pathToFileURL(path.join(raiz, 'app', 'voz.js')).href);

const TOPE_MODELO = 16000 / 32;          // tokens de salida / tokens por segundo
const MB_POR_SEGUNDO = 24000 * 2 * 4 / 3 / 1e6;   // PCM 24 kHz 16 bits, en base64
let peorEscena = 0, peorBloque = 0, llamadas = 0, tomasVoz = 0, rotos = 0, bloquesCortos = 0;
for (let k = 1; k <= 12; k++) {
  const ts = sg2(lt2(leer('episodios/ep' + String(k).padStart(2, '0') + '.md')), { segundosPorToma: 8, cps: 16 });
  tomasVoz += ts.length;
  const porEsc = new Map();
  for (const t of ts) { if (!porEsc.has(t.escena)) porEsc.set(t.escena, []); porEsc.get(t.escena).push(t); }
  for (const tomasEsc of porEsc.values()) {
    peorEscena = Math.max(peorEscena, tomasEsc.reduce((a, t) => a + t.segEstimados, 0));
    const bloques = repartirEnBloques(tomasEsc, SEGUNDOS_POR_LLAMADA);
    llamadas += bloques.length;
    // Cobertura exacta: ni una toma perdida, ni repetida, ni fuera de orden.
    const plano = bloques.flat();
    if (plano.length !== tomasEsc.length || plano.some((t, j) => t !== tomasEsc[j])) rotos++;
    for (const b of bloques) {
      const s = b.reduce((a, t) => a + t.segEstimados, 0);
      peorBloque = Math.max(peorBloque, s);
      if (bloques.length > 1 && s < 12) bloquesCortos++;
    }
  }
}
if (rotos) {
  mal(rotos + ' escenas pierden, repiten o desordenan tomas al repartirse en bloques');
} else if (peorBloque > SEGUNDOS_POR_LLAMADA + 0.05) {
  mal('hay bloques por encima del tope de la llamada',
    peorBloque.toFixed(1) + ' s frente a ' + SEGUNDOS_POR_LLAMADA + ' s');
} else if (peorBloque * MB_POR_SEGUNDO > 4.0) {
  mal('la respuesta de un bloque no cabe en el servidor',
    (peorBloque * MB_POR_SEGUNDO).toFixed(2) + ' MB frente a un techo de 4,5 MB');
} else if (bloquesCortos) {
  mal(bloquesCortos + ' bloques quedan por debajo de 12 s', 'son llamadas y costuras que no hacían falta');
} else {
  ok('escena más larga ' + (peorEscena / 60).toFixed(1) + ' min → ' + llamadas + ' llamadas ' +
     'de hasta ' + peorBloque.toFixed(0) + ' s (' + (peorBloque * MB_POR_SEGUNDO).toFixed(1) +
     ' MB de 4,5) en vez de ' + tomasVoz + ' toma a toma');
}
if (peorBloque > TOPE_MODELO) {
  mal('un bloque pasa de lo que el modelo puede narrar de una vez',
    (peorBloque / 60).toFixed(1) + ' min frente a ' + (TOPE_MODELO / 60).toFixed(1) + ' min');
}

// Y si aun así el servidor no llega, hay que partir en vez de rendirse.
if (!/e\.status === 413 \|\| e\.status === 504/.test(genVoz) || !/plan\.splice\(hecho, 1,/.test(genVoz)) {
  mal('un bloque que no cabe no se parte en dos', 'la escena entera se quedaría sin voz');
} else if (!/finales: \[504\]/.test(genVoz)) {
  mal('un 504 de voz se reintenta igual', 'son otros sesenta segundos perdidos por intento');
} else ok('lo que no cabe se parte en dos y se reintenta solo, sin repetir la espera');

/*  Y la barra tiene que contar LLAMADAS. Contando tomas rellenadas, el
    episodio 1 marcaba «/134» y eso se lee como 134 generaciones, que es justo
    lo que se acababa de dejar de hacer: son 24.                             */
if (!/this\._prog\(hecho, plan\.length,/.test(genVoz) ||
    /this\._prog\([^)]*tomasTotal/.test(genVoz)) {
  mal('la barra de voz no cuenta llamadas', 'contar tomas hace parecer que se pide toma a toma');
} else {
  const ep1 = sg2(lt2(leer('episodios/ep01.md')), { segundosPorToma: 8, cps: 16 });
  const esc1 = new Map();
  for (const t of ep1) { if (!esc1.has(t.escena)) esc1.set(t.escena, []); esc1.get(t.escena).push(t); }
  let n1 = 0;
  for (const ts of esc1.values()) n1 += repartirEnBloques(ts, SEGUNDOS_POR_LLAMADA).length;
  ok('la barra cuenta llamadas: el episodio 1 marca ' + n1 + ', no ' + ep1.length);
}

// El servidor tiene que decir que no cabe, en vez de dejar que corte la plataforma.
const guardaTts = leer('api/ep-gemini.js');
if (!/inline\.data\.length > LIMITE_RESPUESTA/.test(guardaTts) ||
    !/status\(413\)[\s\S]{0,400}s de voz de una sola vez/.test(guardaTts)) {
  mal('el servidor no avisa cuando el audio no cabe en la respuesta',
    'la plataforma devolvería un error suyo, sin explicación');
} else ok('el servidor avisa con la cifra exacta cuando la voz no cabe en la respuesta');

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
const { VOCES } = await import(pathToFileURL(path.join(raiz, 'app', 'biblia.js')).href);

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
const afinado = normCfg({ tono: 'grave', voz: 'Puck', temperaturaVoz: 0.1, instruccionVoz: 'vieja' });
if (afinado.voz !== tonoPorId('grave').voz || !coincideConTono(afinado)) {
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
const sueltos = (mainR.match(/\$\('btnRegen(Voz|Img|Vid|Mus)'\)[\s\S]{0,900}?\}\)\);/g) || []);
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
    /*  Se examina CADA línea que coincide, no solo la primera. Mirando solo la
        primera, una línea eximida —una plantilla, un ejemplo— tapaba todas las
        demás del archivo: se coló una cuenta de servicio real detrás de un
        ejemplo y la auditoría dio limpio.                                    */
    for (const linea of txt.split('\n')) {
      for (const p of patrones) {
        if (!p.test(linea)) continue;
        /*  Una dirección cuyo usuario sale de una variable de shell no es una
            dirección: es una plantilla que se rellena en la máquina del
            usuario. Se exime esa forma concreta, no el patrón: un correo de
            verdad nunca empieza por «$».                                     */
        if (/\$\{?\w+\}?[^@\s"']*@/.test(linea)) continue;
        if (/censor|redact|oculto|nombreBucket|gs:\/\/mi-|gs:\/\/diezmo-video|gs:\/\/«/.test(linea)) continue;
        sucio.push(rel + ' → ' + linea.trim().slice(0, 70));
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
