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
  return corte > 0 && todoJs.includes("'" + i.slice(0, corte + 1) + "' +");
};
const sinUso = [...ids].filter((i) =>
  !usados.has(i) && !todoJs.includes(i) && !dinamico(i) &&
  !html.includes('for="' + i + '"') && !html.includes('#' + i));
if (sinUso.length) mal('elementos que nadie usa', sinUso.join(' '));
else ok('ningún elemento huérfano en la página');

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
let fuera = [];
for (const n of Object.keys(CAMARA)) {
  const c = CAMARA[n];
  for (let i = 0; i <= 100; i++) {
    const q = i / 100;
    const z = c.z0 + (c.z1 - c.z0) * q;
    const m = (1 - 1 / z) / 2;
    const dx = Math.abs(c.x0 + (c.x1 - c.x0) * q);
    const dy = Math.abs(c.y0 + (c.y1 - c.y0) * q);
    if (Math.max(dx, dy) > m + 1e-9) { fuera.push(n + ' (al ' + i + ' %)'); break; }
  }
}
if (fuera.length) mal('movimientos que se salen del fotograma', fuera.join(' · '));
else ok('ningún movimiento se sale del fotograma en ningún instante de la toma');

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
