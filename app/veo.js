/* ============================================================
   veo.js — duraciones y tarifa de los clips
   ============================================================
   Veo no acepta cualquier duración: cada modelo admite una lista
   cerrada de valores enteros. El director pide 6,2 s y hay que
   traducirlo a algo que el modelo sepa generar.

   Este archivo es la única fuente de esos dos datos —qué
   duraciones valen y cuánto cuesta cada segundo—, y lo usan el
   motor, el presupuesto y la validación del backend.
   ============================================================ */

/*  Comprobado en la referencia del API de Veo en Vertex AI: la familia 3.x
    admite exactamente 4, 6 u 8 segundos, y Veo 2 va de 5 a 8. Pedir un valor
    fuera de lista no se redondea solo: la petición se rechaza.               */
export const DURACIONES = {
  'veo-3.1-generate-001': [4, 6, 8],
  'veo-3.1-fast-generate-001': [4, 6, 8],
  'veo-3.1-lite-generate-001': [4, 6, 8],
  'veo-2.0-generate-001': [5, 6, 7, 8],
};

export const DURACIONES_POR_DEFECTO = [4, 6, 8];

export function duracionesDe(modelo) {
  return DURACIONES[modelo] || DURACIONES_POR_DEFECTO;
}

/**
 * La duración que se le pide a Veo para una toma de `segundos`.
 *
 * Se elige la válida más cercana. En un empate gana la mayor: entre generar
 * cuatro o seis segundos para una toma de cinco, vale más sobrar un segundo
 * —que el montaje recorta— que faltar uno, que se ve como imagen congelada.
 *
 * Por encima del máximo se devuelve el máximo: la toma se anima ocho segundos
 * y el resto se queda en el último fotograma. Es una decisión asumida; alargar
 * con extensiones de siete segundos costaría casi el doble.
 */
export function duracionVeo(modelo, segundos) {
  const lista = duracionesDe(modelo);
  const d = Number(segundos);
  if (!isFinite(d) || d <= 0) return lista[lista.length - 1];
  let mejor = lista[0];
  for (const v of lista) {
    const dif = Math.abs(v - d);
    const difMejor = Math.abs(mejor - d);
    if (dif < difMejor || (dif === difMejor && v > mejor)) mejor = v;
  }
  return mejor;
}

/** Cuánto se desperdicia o se congela al pedir esa duración. */
export function ajusteDe(modelo, segundos) {
  const pedida = duracionVeo(modelo, segundos);
  const d = Number(segundos) || 0;
  return {
    pedida,
    sobra: Math.max(0, pedida - d),      // se genera de más y el montaje lo recorta
    congelado: Math.max(0, d - pedida),  // falta clip: último fotograma quieto
  };
}

/* ── Tarifa ─────────────────────────────────────────────────── */

/*  Dólares por segundo generado, de la tabla oficial de precios de Vertex AI.
    Se factura por segundo, así que un clip de cuatro segundos cuesta la mitad
    que uno de ocho. Veo 2 no genera audio.                                    */
export const TARIFA = {
  'veo-3.1-generate-001': {
    sin: { '720p': 0.20, '1080p': 0.20, '4k': 0.40 },
    con: { '720p': 0.40, '1080p': 0.40, '4k': 0.60 },
  },
  'veo-3.1-fast-generate-001': {
    sin: { '720p': 0.08, '1080p': 0.10, '4k': 0.25 },
    con: { '720p': 0.10, '1080p': 0.12, '4k': 0.30 },
  },
  'veo-3.1-lite-generate-001': {
    sin: { '720p': 0.03, '1080p': 0.05 },
    con: { '720p': 0.05, '1080p': 0.08 },
  },
  'veo-2.0-generate-001': {
    sin: { '720p': 0.50 },
    con: { '720p': 0.50 },
  },
};

/** Dólares por segundo del modelo, resolución y audio elegidos. */
export function precioSegundo(modelo, resolucion, conAudio) {
  const t = TARIFA[modelo];
  if (!t) return 0.05;
  const fila = t[conAudio ? 'con' : 'sin'];
  return fila[resolucion] || fila['1080p'] || fila['720p'] || 0.05;
}

/** Texto corto para la interfaz: de dónde sale el precio que se está aplicando. */
export function tarifaLegible(modelo, resolucion, conAudio) {
  const p = precioSegundo(modelo, resolucion, conAudio);
  const t = TARIFA[modelo];
  const res = t && t[conAudio ? 'con' : 'sin'][resolucion] ? resolucion : '1080p';
  return res + ' · ' + (conAudio ? 'con audio' : 'sin audio') + ' · ' +
    p.toFixed(2).replace('.', ',') + ' $ por segundo generado';
}
