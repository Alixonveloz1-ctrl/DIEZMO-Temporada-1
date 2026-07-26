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

/*  Cada movimiento se describe con seis números normalizados:
      z0,z1  escala al principio y al final
      x0,x1  desplazamiento horizontal de la cámara, en fracción del cuadro
      y0,y1  desplazamiento vertical
    Signo: +x mira más a la derecha, así que el contenido se va hacia la
    izquierda. +y mira más abajo. Es la convención de una cámara real.

    Las panorámicas necesitan una escala mayor que uno aunque no acerquen:
    sin ese margen no hay imagen fuera del cuadro por la que desplazarse. */

export const CAMARA = {
  'cámara fija': { z0: 1.00, z1: 1.00, x0: 0, x1: 0, y0: 0, y1: 0 },

  'travelling de acercamiento lento': { z0: 1.00, z1: 1.09, x0: 0, x1: 0, y0: 0, y1: 0 },
  'travelling de alejamiento lento': { z0: 1.09, z1: 1.00, x0: 0, x1: 0, y0: 0, y1: 0 },

  'panorámica lenta a la izquierda': { z0: 1.09, z1: 1.09, x0: 0.030, x1: -0.030, y0: 0, y1: 0 },
  'panorámica lenta a la derecha': { z0: 1.09, z1: 1.09, x0: -0.030, x1: 0.030, y0: 0, y1: 0 },

  'inclinación hacia arriba': { z0: 1.09, z1: 1.09, x0: 0, x1: 0, y0: 0.030, y1: -0.030 },
  'inclinación hacia abajo': { z0: 1.09, z1: 1.09, x0: 0, x1: 0, y0: -0.030, y1: 0.030 },

  // Baja mientras se abre: el gesto de una grúa que desciende y descubre el
  // plano. No puede cerrar por debajo de 1,06 o se queda sin recorrido vertical.
  'grúa descendente': { z0: 1.13, z1: 1.06, x0: 0, x1: 0, y0: -0.026, y1: 0.026 },

  // Acompaña a un sujeto: lateral sostenido, algo más largo que una panorámica.
  'seguimiento lateral': { z0: 1.11, z1: 1.11, x0: -0.042, x1: 0.042, y0: 0, y1: 0 },

  // Ni quieta ni con rumbo: deriva mínima y desigual entre los dos ejes.
  'cámara en mano sutil': { z0: 1.05, z1: 1.07, x0: -0.008, x1: 0.010, y0: 0.006, y1: -0.007 },
};

export const CAMARA_POR_DEFECTO = 'travelling de acercamiento lento';

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

/*  Con una escala z solo se puede desplazar la cámara por el sobrante:
    el cuadro visible mide 1/z, así que sobra (1 - 1/z) repartido entre
    los dos lados. Pasarse de ahí haría que ffmpeg tropezara con el borde
    y el movimiento se quedaría clavado a mitad de toma.                  */
function margen(z) { return Math.max(0, (1 - 1 / z) / 2); }

/**
 * El movimiento de una toma, ya recortado a lo que la escala permite.
 * @param {object|string} plano  el plano del director, o el texto del movimiento
 * @returns {{nombre:string, z0:number, z1:number, x0:number, x1:number, y0:number, y1:number}}
 */
export function planoCamara(plano) {
  const nombre = normalizarMovimiento(
    plano && typeof plano === 'object' ? plano.movimiento : plano);
  const c = CAMARA[nombre];
  const lim = (v, z) => Math.max(-margen(z), Math.min(margen(z), v));
  return {
    nombre,
    z0: c.z0, z1: c.z1,
    x0: lim(c.x0, c.z0), x1: lim(c.x1, c.z1),
    y0: lim(c.y0, c.z0), y1: lim(c.y1, c.z1),
  };
}

/** ¿Esta toma se queda de verdad quieta? */
export function esQuieta(mov) {
  const c = planoCamara(mov);
  return c.z0 === c.z1 && c.x0 === c.x1 && c.y0 === c.y1;
}

/* ── Para la Sala ───────────────────────────────────────────── */

/**
 * Los dos extremos de la animación, como transformaciones CSS.
 * El contenido va al revés que la cámara: si la cámara mira a la derecha,
 * la imagen se desplaza hacia la izquierda.
 */
export function fotogramasCss(mov) {
  const c = planoCamara(mov);
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
export function filtroZoompan(mov, frames, ancho, alto, fps) {
  const c = planoCamara(mov);
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
