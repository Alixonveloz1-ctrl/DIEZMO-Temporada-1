/* ============================================================
   repetidos.js — el mismo plano dos veces
   ============================================================
   A lo largo de doce episodios, el director acaba pidiendo el
   mismo plano más de una vez: la misma localización, la misma
   gente en cuadro, el mismo encuadre y una descripción que dice
   lo mismo con otras palabras.

   Hoy cada una de esas tomas paga su propia imagen. Aquí se
   detectan los grupos para generar UNA y reutilizarla en todas.

   No usa IA: el director ya dejó escrito el lugar, los personajes
   y el encuadre. Agrupar por eso es contar, no adivinar.
   ============================================================ */

/* ── Normalización ──────────────────────────────────────────── */

const VACIAS = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'un', 'una', 'unos', 'unas', 'y', 'o', 'a', 'al',
  'en', 'con', 'sin', 'por', 'para', 'que', 'se', 'su', 'sus', 'le', 'lo', 'es', 'esta',
  'este', 'sobre', 'entre', 'como', 'mas', 'muy', 'ya', 'desde', 'hasta', 'hacia', 'ante',
]);

export function normalizar(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function palabras(s) {
  return new Set(normalizar(s).split(' ').filter((w) => w.length > 3 && !VACIAS.has(w)));
}

function parecido(a, b) {
  if (!a.size || !b.size) return 0;
  let comunes = 0;
  for (const w of a) if (b.has(w)) comunes++;
  return comunes / (a.size + b.size - comunes);
}

/* ── Huella de un plano ─────────────────────────────────────── */

/**
 * Lo que tiene que coincidir EXACTAMENTE para que dos tomas puedan ser el mismo
 * plano: el lugar, quién sale en cuadro y el encuadre. La descripción se compara
 * aparte, porque el director la redacta distinta cada vez aunque describa lo mismo.
 */
export function huella(plano) {
  if (!plano) return null;
  const gente = (plano.personajes || []).slice().sort().join('+');
  return [normalizar(plano.lugar), gente, normalizar(plano.encuadre)].join('|');
}

/* ── Agrupación ─────────────────────────────────────────────── */

/**
 * Recorre los doce episodios y devuelve los grupos de tomas que son el mismo
 * plano. El primero de cada grupo, por orden de episodio y de toma, es el
 * MAESTRO: es el que se genera. Los demás lo reutilizan.
 *
 * @param {Array} episodios  los episodios ya dirigidos
 * @param {object} opciones  { umbral } 0 a 1, cuánto se han de parecer las descripciones
 * @returns {Array} grupos, el más numeroso primero
 */
export function agrupar(episodios, opciones) {
  const o = opciones || {};
  const umbral = typeof o.umbral === 'number' ? o.umbral : 0.8;

  const porHuella = new Map();
  for (const ep of episodios || []) {
    for (const t of ep.tomas || []) {
      if (!t.plano) continue;
      const h = huella(t.plano);
      if (!h) continue;
      if (!porHuella.has(h)) porHuella.set(h, []);
      porHuella.get(h).push({
        ep: ep.num,
        i: t.i,
        escena: t.escena,
        plano: t.plano,
        bolsa: palabras(t.plano.descripcion),
        segundos: t.segundos || t.segEstimados || 0,
      });
    }
  }

  const grupos = [];
  for (const [h, lista] of porHuella) {
    if (lista.length < 2) continue;
    // Dentro de la misma huella, agrupar las descripciones que dicen lo mismo.
    const pendientes = lista.slice();
    while (pendientes.length) {
      const cabeza = pendientes.shift();
      const juntos = [cabeza];
      for (let k = pendientes.length - 1; k >= 0; k--) {
        if (parecido(cabeza.bolsa, pendientes[k].bolsa) >= umbral) {
          juntos.push(pendientes[k]);
          pendientes.splice(k, 1);
        }
      }
      if (juntos.length < 2) continue;
      juntos.sort((a, b) => a.ep - b.ep || a.i - b.i);
      grupos.push({
        huella: h,
        maestro: { ep: juntos[0].ep, i: juntos[0].i },
        lugar: cabeza.plano.lugar,
        personajes: cabeza.plano.personajes || [],
        encuadre: cabeza.plano.encuadre,
        descripcion: cabeza.plano.descripcion,
        miembros: juntos.map((x) => ({ ep: x.ep, i: x.i, escena: x.escena, segundos: x.segundos })),
        episodios: [...new Set(juntos.map((x) => x.ep))].sort((a, b) => a - b),
      });
    }
  }

  grupos.sort((a, b) => b.miembros.length - a.miembros.length ||
    a.maestro.ep - b.maestro.ep || a.maestro.i - b.maestro.i);
  return grupos;
}

/** Cuántas imágenes se ahorran si se acepta todo. */
export function ahorroDe(grupos) {
  const repetidas = grupos.reduce((a, g) => a + g.miembros.length - 1, 0);
  return {
    grupos: grupos.length,
    repetidas,
    // Un grupo de cinco tomas genera una imagen en vez de cinco: se ahorran cuatro.
    entreEpisodios: grupos.filter((g) => g.episodios.length > 1).length,
  };
}

/* ── Aplicar y deshacer ─────────────────────────────────────── */

/*  Marcar es reversible y no borra nada: la toma reutilizada guarda a quién
    apunta, y quitar la marca la devuelve a generarse por su cuenta.          */

export function aplicar(episodios, grupos, claves) {
  let marcadas = 0;
  const porEp = new Map((episodios || []).map((e) => [e.num, e]));
  for (const g of grupos) {
    const epM = porEp.get(g.maestro.ep);
    if (!epM) continue;
    const tomaM = (epM.tomas || []).find((t) => t.i === g.maestro.i);
    if (!tomaM) continue;
    const durMaestro = claves.duracion(tomaM);

    for (const m of g.miembros) {
      if (m.ep === g.maestro.ep && m.i === g.maestro.i) continue;
      const ep = porEp.get(m.ep);
      if (!ep) continue;
      const t = (ep.tomas || []).find((x) => x.i === m.i);
      if (!t || t.bloqueada) continue;
      t.reusa = claves.imagen(g.maestro.ep, g.maestro.i);
      // El clip solo se reutiliza si además dura lo mismo: un plano idéntico de
      // cuatro segundos no sirve para una toma de ocho, se quedaría congelada.
      t.reusaVideo = (claves.duracion(t) === durMaestro)
        ? claves.video(g.maestro.ep, g.maestro.i) : null;
      marcadas++;
    }
  }
  return marcadas;
}

export function limpiar(episodios) {
  let n = 0;
  for (const ep of episodios || []) {
    for (const t of ep.tomas || []) {
      if (t.reusa || t.reusaVideo) { delete t.reusa; delete t.reusaVideo; n++; }
    }
  }
  return n;
}
