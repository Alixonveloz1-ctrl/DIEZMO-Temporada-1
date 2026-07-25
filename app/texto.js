/* ============================================================
   texto.js — limpieza, normalización para voz y segmentación en tomas
   ============================================================
   Nada de esto modifica los .md originales: todo ocurre en memoria,
   justo antes de mandar el texto a Vertex.
   ============================================================ */

/* ── Números a letras (español) ─────────────────────────────── */

const UNI = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho',
  'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco',
  'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const DEC = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const CEN = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos',
  'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

function tresCifras(n, femenino) {
  if (n === 0) return '';
  if (n === 100) return 'cien';
  let s = '';
  const c = Math.floor(n / 100), r = n % 100;
  if (c) s += femenino ? CEN[c].replace(/os$/, 'as') : CEN[c];
  if (r) {
    if (s) s += ' ';
    if (r < 30) s += UNI[r];
    else { s += DEC[Math.floor(r / 10)]; if (r % 10) s += ' y ' + UNI[r % 10]; }
  }
  if (femenino) s = s.replace(/\bveintiuno\b/, 'veintiuna').replace(/\buno\b/, 'una');
  return s;
}

// "uno" → "un" y "veintiuno" → "veintiún" cuando precede a un sustantivo (mil, millones).
function apocope(s) {
  return s.replace(/veintiuno$/, 'veintiún').replace(/\buno$/, 'un');
}

export function enLetras(n, femenino) {
  n = Math.trunc(Number(n));
  if (!isFinite(n)) return '';
  if (n < 0) return 'menos ' + enLetras(-n, femenino);
  if (n === 0) return 'cero';

  const partes = [];
  const millones = Math.floor(n / 1e6);
  const resto = n % 1e6;
  const miles = Math.floor(resto / 1000);
  const unidades = resto % 1000;

  if (millones) {
    partes.push(millones === 1 ? 'un millón' : apocope(enLetras(millones)) + ' millones');
  }
  if (miles) {
    partes.push(miles === 1 ? 'mil' : apocope(tresCifras(miles)) + ' mil');
  }
  if (unidades) partes.push(tresCifras(unidades, femenino));
  return partes.join(' ');
}

/* ── Reemplazos literales, editables desde la interfaz ──────── */
// Se aplican ANTES de las reglas automáticas. Aquí viven los casos que
// ninguna regla general resuelve bien: género gramatical, monedas con
// decimal, siglas. Están sembrados con lo que aparece en los doce guiones.
export const REEMPLAZOS_BASE = [
  ['¥8,4 millones', 'ocho millones cuatrocientos mil yenes'],
  ['8,4 millones', 'ocho millones cuatrocientos mil'],
  ['las 2.400', 'las dos mil cuatrocientas'],
  ['Las 2.400', 'Las dos mil cuatrocientas'],
  ['2.400 ojivas', 'dos mil cuatrocientas ojivas'],
  ['0,12 por ciento', 'cero coma doce por ciento'],
  ['4 km²', 'cuatro kilómetros cuadrados'],
  ['4 KM²', 'CUATRO KILÓMETROS CUADRADOS'],
  ['REF_DELEGACIÓN_07', 'ref delegación cero siete'],
  ['REF_DELEGACIÓN', 'ref delegación'],
  ['aula 2-B', 'aula dos B'],
  ['Aula 2-B', 'Aula dos B'],
  ['G20', 'G veinte'],
  ['FIN DEL EPISODIO', ''],
  ['FIN DE LA TEMPORADA 1', ''],
  ['FIN DEL ARCO 2', ''],
  ['CONTINUARÁ.', ''],
];

const LETRAS = {
  A: 'a', B: 'be', C: 'ce', D: 'de', E: 'e', F: 'efe', G: 'ge', H: 'hache', I: 'i',
  J: 'jota', K: 'ka', L: 'ele', M: 'eme', N: 'ene', O: 'o', P: 'pe', Q: 'cu', R: 'erre',
  S: 'ese', T: 'te', U: 'u', V: 'uve', W: 'doble uve', X: 'equis', Y: 'i griega', Z: 'zeta',
};

function digitoAdigito(s) {
  return String(s).split('').map((d) => UNI[Number(d)] || d).join(' ');
}

/**
 * Convierte un texto a una forma que el TTS lee correctamente:
 * sin cifras, sin símbolos y sin códigos crudos.
 */
export function normalizarParaVoz(texto, reemplazos) {
  let t = String(texto);

  for (const [de, a] of (reemplazos || REEMPLAZOS_BASE)) {
    if (!de) continue;
    t = t.split(de).join(a);
  }

  // Códigos de lote: 214-B-1187 → doscientos catorce be mil ciento ochenta y siete
  t = t.replace(/\b(\d{1,4})-([A-Z])-(\d{1,5})\b/g,
    (_, a, l, b) => enLetras(a) + ' ' + (LETRAS[l] || l) + ' ' + enLetras(b));

  // Bloques: A-12 → A doce   ·   Ola 3 se resuelve con la regla de enteros
  t = t.replace(/\b([A-Z])-(\d{1,3})\b/g, (_, l, n) => l + ' ' + enLetras(n));

  // Horas: 09:12 → las nueve y doce   ·   21:00 → las veintiuna
  // El "las" que ya venga escrito delante se conserva en vez de duplicarse.
  t = t.replace(/((?:a\s+)?las\s+)?\b(\d{1,2}):(\d{2})(?::\d{2})?\b/gi, (m, pre, h, mi) => {
    const H = Number(h), M = Number(mi);
    if (H > 23 || M > 59) return m;
    const hh = enLetras(H, true);
    const cuerpo = M === 0 ? hh : hh + ' y ' + enLetras(M);
    return pre ? pre + cuerpo : 'las ' + cuerpo;
  });

  // Yenes: ¥300.000 → trescientos mil yenes
  t = t.replace(/¥\s?(\d{1,3}(?:\.\d{3})*|\d+)/g,
    (_, n) => enLetras(n.replace(/\./g, '')) + ' yenes');

  // Decimales con coma: 8,4 → ocho coma cuatro
  t = t.replace(/\b(\d+),(\d+)\b/g,
    (_, a, b) => enLetras(a) + ' coma ' + (b.length > 2 ? digitoAdigito(b) : enLetras(b)));

  // Miles con punto: 152.000 → ciento cincuenta y dos mil
  t = t.replace(/\b\d{1,3}(?:\.\d{3})+\b/g, (n) => enLetras(n.replace(/\./g, '')));

  // Porcentajes y unidades pegadas
  t = t.replace(/(\d+)\s?%/g, (_, n) => enLetras(n) + ' por ciento');
  t = t.replace(/(\d+)\s?km²/gi, (_, n) => enLetras(n) + ' kilómetros cuadrados');
  t = t.replace(/(\d+)\s?km\b/gi, (_, n) => enLetras(n) + ' kilómetros');

  // Enteros sueltos. Con cero delante se leen dígito a dígito (matrículas, códigos).
  t = t.replace(/\b0(\d+)\b/g, (m) => digitoAdigito(m));
  t = t.replace(/\b\d{1,9}\b/g, (n) => enLetras(n));

  // Símbolos residuales
  t = t.replace(/¥/g, ' yenes ').replace(/[²³]/g, '').replace(/&/g, ' y ');
  t = t.replace(/_/g, ' ');

  return t.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/* ── Limpieza de markdown ───────────────────────────────────── */
const SEP_ESCENA = '';

export function limpiarTexto(t) {
  const out = [];
  for (let ln of String(t).split('\n')) {
    const s = ln.trim();
    if (s.startsWith('#')) continue;                       // encabezados
    if (/^\*\*Duración/i.test(s)) continue;                // línea de metadatos
    if (/^-{3,}$/.test(s)) continue;                       // separadores
    if (/^\*\s*\*\s*\*$/.test(s)) { out.push(SEP_ESCENA); continue; }
    ln = ln.replace(/\*\*([^*]*)\*\*/g, '$1')
      .replace(/\*([^*]*)\*/g, '$1')
      .replace(/^>\s?/, '');
    out.push(ln);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function tituloDe(nombre, contenido) {
  let num = null, titulo = null;
  const m1 = String(contenido).match(/^#\s*(.+)$/m);
  if (m1) {
    const t = m1[1].trim();
    const m2 = t.match(/Episodio\s+(\d+)\s*:?\s*[«"“]?([^"»”\n]*)/i);
    if (m2) { num = parseInt(m2[1], 10); titulo = (m2[2] || '').trim(); }
    else titulo = t;
  }
  if (num == null && nombre) {
    const m3 = String(nombre).match(/ep[\s\-_]?0*(\d+)/i);
    if (m3) num = parseInt(m3[1], 10);
  }
  if (titulo) titulo = titulo.replace(/["»”]+\s*$/, '').trim();
  if (!titulo) titulo = String(nombre || 'Episodio').replace(/\.(md|txt)$/i, '');
  return { num, titulo };
}

/* ── Segmentación en tomas ──────────────────────────────────── */
/*  El texto se corta de forma determinista: ninguna palabra se pierde
    y la concatenación de todas las tomas reproduce el episodio exacto.
    La IA solo decide después CÓMO se ve cada toma, nunca qué dice.      */

function frasesDe(parrafo) {
  const m = parrafo.match(/[^.!?…]+[.!?…]+["»”']?\s*/g);
  if (!m) return [parrafo];
  const total = m.join('');
  if (total.length < parrafo.length) m.push(parrafo.slice(total.length));
  return m.filter((s) => s.trim());
}

function partirLargo(frase, max) {
  const trozos = [];
  let resto = frase;
  while (resto.length > max) {
    // Buscamos hacia atrás una pausa natural: raya de diálogo, punto y coma, coma.
    let corte = -1;
    for (const re of [/[;:]\s/g, /—\s/g, /,\s/g, /\s/g]) {
      let m, ultimo = -1;
      re.lastIndex = 0;
      while ((m = re.exec(resto)) !== null) {
        if (m.index > max) break;
        if (m.index > max * 0.5) ultimo = m.index + m[0].length;
      }
      if (ultimo > 0) { corte = ultimo; break; }
    }
    if (corte <= 0) corte = max;
    trozos.push(resto.slice(0, corte).trim());
    resto = resto.slice(corte);
  }
  if (resto.trim()) trozos.push(resto.trim());
  return trozos;
}

/**
 * Divide el episodio limpio en tomas de duración objetivo.
 * @param {string} limpio  texto ya pasado por limpiarTexto()
 * @param {object} cfg     {segundosPorToma, cps}
 * @returns {Array} tomas [{i, escena, texto, chars, segEstimados, corteEscena, dialogo}]
 */
export function segmentar(limpio, cfg) {
  const seg = (cfg && cfg.segundosPorToma) || 8;
  const cps = (cfg && cfg.cps) || 16;
  const objetivo = Math.round(seg * cps);        // ~128 caracteres a 8 s
  const max = Math.round(objetivo * 1.6);

  const bloques = String(limpio).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const tomas = [];
  let escena = 1;
  let acc = '';
  let accDialogo = false;

  const cerrar = (corteEscena) => {
    if (acc.trim()) {
      tomas.push({
        i: tomas.length,
        escena,
        texto: acc.trim(),
        chars: acc.trim().length,
        segEstimados: +(acc.trim().length / cps).toFixed(1),
        corteEscena: !!corteEscena,
        dialogo: accDialogo,
      });
    } else if (corteEscena && tomas.length) {
      tomas[tomas.length - 1].corteEscena = true;
    }
    acc = '';
    accDialogo = false;
  };

  for (const bloque of bloques) {
    if (bloque === SEP_ESCENA) { cerrar(true); escena++; continue; }

    const esDialogo = /^[—–-]\s/.test(bloque);

    // Un párrafo corto entra entero si cabe; si no, se parte por frases.
    const piezas = bloque.length <= max ? [bloque] : frasesDe(bloque);

    for (const pieza of piezas) {
      const partes = pieza.length > max ? partirLargo(pieza, max) : [pieza];
      for (const parte of partes) {
        const p = parte.trim();
        if (!p) continue;
        if (acc && (acc.length + 1 + p.length) > objetivo) cerrar(false);
        acc = acc ? acc + (esDialogo && accDialogo ? '\n' : ' ') + p : p;
        accDialogo = accDialogo || esDialogo;
        if (acc.length >= objetivo) cerrar(false);
      }
    }
    // Fin de párrafo narrativo: buen sitio para cerrar si ya hay material.
    if (acc.length >= objetivo * 0.6) cerrar(false);
  }
  cerrar(false);

  return tomas.map((t, i) => ({ ...t, i }));
}

/** Comprueba que la segmentación no perdió ni inventó texto. */
export function verificarCobertura(limpio, tomas) {
  const norm = (s) => String(s).replace(/[\s]+/g, '');
  const origen = norm(limpio);
  const suma = norm(tomas.map((t) => t.texto).join(''));
  return {
    ok: origen === suma,
    origen: origen.length,
    suma: suma.length,
    diferencia: suma.length - origen.length,
  };
}

/* ── Detección de personajes mencionados ────────────────────── */
export function personajesEn(texto, elenco) {
  const t = String(texto);
  const encontrados = [];
  for (const p of elenco) {
    const nombres = [p.nombre].concat(p.alias || []);
    for (const n of nombres) {
      if (!n) continue;
      const re = new RegExp('(^|[^\\p{L}])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\p{L}])', 'iu');
      if (re.test(t)) { encontrados.push(p.id); break; }
    }
  }
  return encontrados;
}

export const utilTexto = { SEP_ESCENA };
