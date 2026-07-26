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
else if (!/images:\s*maestra/.test(genRefs) || !/promptReferencia\([^)]*maestra\)/.test(genRefs)) {
  mal('el motor genera cada hoja por separado', 'no adjunta la hoja maestra a las siguientes');
} else if (!/soloFaltantes[\s\S]{0,400}_comoReferencia\(/.test(genRefs)) {
  mal('al saltarse hojas ya generadas no se recupera la maestra del almacén');
} else ok('cada hoja posterior se genera con la primera adjunta como referencia');

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
