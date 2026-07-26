/* ============================================================
   camara.js — el movimiento de cámara de las tomas fijas
   ============================================================
   Una toma fija no es una imagen quieta: es un fotograma con la
   cámara moviéndose por encima. Quién decide ese movimiento es
   el director (director.js), toma por toma, y aquí se traduce a
   algo que puedan ejecutar los dos sitios donde se ve:

     · la Sala, con la API de animación del navegador
     · el montaje final, con el filtro zoompan de ffmpeg

   Los dos parten de ESTOS mismos números, para que lo que
   apruebas mirando sea exactamente lo que sale montado.
   ============================================================ */

/*  Cada movimiento se describe por lo que RECORRE, no por la escala:
      pan   fracción del cuadro que se desplaza de principio a fin
      zoom  cuánto abre o cierra a lo largo de la toma
    La escala necesaria para que quepa ese recorrido se calcula después. Así,
    subir la intensidad no puede sacar la cámara del fotograma: el margen se
    agranda solo.

    Las cifras son las de un Ken Burns que se nota. La versión anterior movía
    un nueve por ciento en siete segundos y no se percibía.                   */
export const CAMARA = {
  'cámara fija': {},

  'travelling de acercamiento lento': { zoom: 0.18 },
  'travelling de alejamiento lento': { zoom: -0.18 },

  'panorámica lenta a la izquierda': { panX: -0.13 },
  'panorámica lenta a la derecha': { panX: 0.13 },

  'inclinación hacia arriba': { panY: -0.13 },
  'inclinación hacia abajo': { panY: 0.13 },

  // Baja mientras se abre: el gesto de una grúa que desciende y descubre el plano.
  'grúa descendente': { panY: 0.11, zoom: -0.09 },

  // Acompaña a un sujeto: lateral sostenido, más recorrido que una panorámica.
  'seguimiento lateral': { panX: 0.17 },

  // Ni quieta ni con rumbo: deriva mínima y desigual entre los dos ejes.
  'cámara en mano sutil': { panX: 0.028, panY: -0.022, zoom: 0.04 },
};

export const CAMARA_POR_DEFECTO = 'travelling de acercamiento lento';
export const INTENSIDAD_POR_DEFECTO = 1;

/** El texto del director, reducido a una de las claves de arriba. */
export function normalizarMovimiento(texto) {
  const t = String(texto || '').toLowerCase().trim();
  if (CAMARA[t]) return t;
  for (const k of Object.keys(CAMARA)) if (t === k.toLowerCase()) return k;
  // Tolerancia a variantes: el director escribe en lenguaje natural.
  if (/fij|quiet|est[áa]tic/.test(t)) return 'cámara fija';
  if (/acerc|hacia dentro|zoom in|avanc/.test(t)) return 'travelling de acercamiento lento';
  if (/alej|hacia fuera|zoom out|retroces/.test(t)) return 'travelling de alejamiento lento';
  if (/izquierda/.test(t)) return 'panorámica lenta a la izquierda';
  if (/derecha/.test(t)) return 'panorámica lenta a la derecha';
  if (/arriba|ascend/.test(t)) return 'inclinación hacia arriba';
  if (/gr[úu]a|descend|abajo/.test(t)) return /gr[úu]a/.test(t) ? 'grúa descendente' : 'inclinación hacia abajo';
  if (/mano|hombro|temblor/.test(t)) return 'cámara en mano sutil';
  if (/seguimient|lateral|acompa/.test(t)) return 'seguimiento lateral';
  return CAMARA_POR_DEFECTO;
}

/*  Con una escala z el cuadro visible mide 1/z, así que sobra (1 - 1/z)
    repartido entre los dos lados. Para recorrer una fracción `r` del cuadro
    hace falta al menos esa holgura, y se pide un dieciocho por ciento de más
    para no rozar nunca el borde.                                             */
function escalaPara(recorrido) {
  if (recorrido <= 0) return 1;
  return 1 / (1 - Math.min(0.55, recorrido * 1.18));
}

/**
 * El movimiento de una toma, ya resuelto a escalas y desplazamientos.
 * @param {object|string} plano       el plano del director, o el texto del movimiento
 * @param {number} intensidad         1 = normal; 0,5 la mitad; 2 el doble
 */
export function planoCamara(plano, intensidad) {
  const nombre = normalizarMovimiento(
    plano && typeof plano === 'object' ? plano.movimiento : plano);
  const base = CAMARA[nombre];
  // Cero es una elección válida —imagen realmente quieta—, así que solo se
  // recurre al valor por defecto cuando no viene número.
  const n = Number(intensidad);
  const k = Math.max(0, Math.min(3, isFinite(n) && n >= 0 ? n : INTENSIDAD_POR_DEFECTO));

  const panX = (base.panX || 0) * k;
  const panY = (base.panY || 0) * k;
  const dz = (base.zoom || 0) * k;
  const recorrido = Math.max(Math.abs(panX), Math.abs(panY));
  const zBase = escalaPara(recorrido);

  // El extremo con menos escala es el que tiene que caber: se apoya ahí.
  let z0, z1;
  if (dz >= 0) { z0 = zBase; z1 = zBase + dz; } else { z1 = zBase; z0 = zBase - dz; }

  return {
    nombre, z0, z1,
    x0: -panX / 2, x1: panX / 2,
    y0: -panY / 2, y1: panY / 2,
  };
}

/** ¿Esta toma se queda de verdad quieta? */
export function esQuieta(mov, intensidad) {
  const c = planoCamara(mov, intensidad);
  return c.z0 === c.z1 && c.x0 === c.x1 && c.y0 === c.y1;
}

/* ── Para la Sala ───────────────────────────────────────────── */

/**
 * Los dos extremos de la animación, como transformaciones CSS.
 * El contenido va al revés que la cámara: si la cámara mira a la derecha,
 * la imagen se desplaza hacia la izquierda.
 */
export function fotogramasCss(mov, intensidad) {
  const c = planoCamara(mov, intensidad);
  const paso = (z, x, y) =>
    ({ transform: 'scale(' + z.toFixed(4) + ') translate(' +
      (-x * 100 / z).toFixed(4) + '%, ' + (-y * 100 / z).toFixed(4) + '%)' });
  return [paso(c.z0, c.x0, c.y0), paso(c.z1, c.x1, c.y1)];
}

/* ── Para el montaje ────────────────────────────────────────── */

/**
 * El filtro zoompan equivalente, con las mismas cifras.
 * `on` es el número de fotograma que va sacando el filtro; se convierte en
 * un avance de cero a uno para interpolar la escala y el desplazamiento.
 */
export function filtroZoompan(mov, frames, ancho, alto, fps, intensidad) {
  const c = planoCamara(mov, intensidad);
  const n = Math.max(2, Math.round(frames));
  const p = 'on/' + (n - 1);
  const num = (v) => v.toFixed(6);

  const z = c.z0 === c.z1
    ? num(c.z0)
    : "'" + num(c.z0) + '+(' + num(c.z1 - c.z0) + ')*(' + p + ")'";

  // El centro del cuadro, más el desplazamiento pedido en ese instante.
  const eje = (a, b, dim) => "'" + dim + '/2-(' + dim + '/zoom/2)+(' +
    num(a) + '+(' + num(b - a) + ')*(' + p + '))*' + dim + "'";

  return 'zoompan=z=' + z +
    ':x=' + eje(c.x0, c.x1, 'iw') +
    ':y=' + eje(c.y0, c.y1, 'ih') +
    ':d=' + n + ':s=' + ancho + 'x' + alto + ':fps=' + fps;
}
