/* ============================================================
   firma.js — la marca de la página, incrustada
   ============================================================
   El nombre del canal en la esquina, tanto en el episodio como
   en las portadas, y ya puesto: nada de editar después.

   NO se la pedimos al modelo de imagen. Un nombre de página es
   letra pequeña, y la letra pequeña es justo lo que sale
   deforme —lo comprobó el usuario en otros proyectos—. Se
   dibuja aquí, con la tipografía del navegador: sale nítida,
   siempre igual, y en el sitio exacto.
   ============================================================ */

export const FIRMA_DEFECTO = 'Mundo Isekai';

/*  Proporciones respecto al alto del fotograma, no en píxeles: así la firma se
    ve igual de grande en 1080p que en un cartel vertical.                    */
/*  Una firma de canal es una marca discreta, no un rótulo. Iba al 3,2 % del
    alto y con opacidad casi plena, así que competía con el título y se leía
    como texto puesto encima con prisa. Pequeña, en versalitas espaciadas y
    traslúcida es como se firma una imagen.                                   */
const ALTO_TEXTO = 0.019;     // cuerpo de la letra
const MARGEN = 0.034;         // separación al borde
const ESPACIADO = 0.18;       // separación entre letras, en cuerpos

/**
 * Dibuja la firma sobre un lienzo ya existente, arriba a la izquierda.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w  ancho del lienzo en píxeles
 * @param {number} h  alto del lienzo en píxeles
 * @param {string} texto
 */
export function dibujarFirma(ctx, w, h, texto) {
  const cuerpo = Math.max(9, Math.round(h * ALTO_TEXTO));
  const m = Math.round(h * MARGEN);
  ctx.save();
  ctx.font = '500 ' + cuerpo + 'px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = Math.round(cuerpo * 0.9);
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  /*  El espaciado entre letras no existe en canvas, así que se dibuja letra a
      letra. Es lo que separa una firma de una etiqueta.                      */
  const paso = cuerpo * ESPACIADO;
  let x = m;
  for (const ch of texto.toUpperCase()) {
    ctx.fillText(ch, x, m);
    x += ctx.measureText(ch).width + paso;
  }
  ctx.restore();
}

/** El tamaño que ocupará la firma, para reservarle sitio. */
export function medidaFirma(w, h, texto) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const cuerpo = Math.max(9, Math.round(h * ALTO_TEXTO));
  ctx.font = '500 ' + cuerpo + 'px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const m = Math.round(h * MARGEN);
  const letras = [...String(texto).toUpperCase()];
  const ancho = letras.reduce((a, ch) => a + ctx.measureText(ch).width, 0) +
    cuerpo * ESPACIADO * Math.max(0, letras.length - 1);
  return { cuerpo, margen: m, ancho: Math.ceil(ancho) };
}

/**
 * La firma sola, en PNG transparente del tamaño del fotograma.
 * Es lo que se superpone al video: ffmpeg la coloca sin escalarla, así que
 * sale con el mismo grosor de trazo que en las portadas.
 *
 * @returns {Promise<Blob>}
 */
export function firmaPng(w, h, texto) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  dibujarFirma(c.getContext('2d'), w, h, texto);
  return new Promise((listo, falla) => {
    c.toBlob((b) => (b ? listo(b) : falla(new Error('no se pudo dibujar la firma'))), 'image/png');
  });
}

/**
 * Una imagen ya generada, con la firma incrustada encima.
 * Se hace aquí y no en el modelo por lo dicho arriba: nítida y siempre igual.
 *
 * @param {Blob} blob   la portada o el cartel recién generado
 * @returns {Promise<Blob>}
 */
/*  El PNG de un lienzo es SIEMPRE sin pérdida, así que una ilustración de 2K
    recién dibujada engorda hasta varios megas —más que la que devolvió el
    modelo—. Y subirla al bucket va por el servidor, que no admite más de 4,5 MB
    de petición: la imagen se guardaba en el navegador y no llegaba a la nube.

    Se prefiere PNG mientras quepa, porque los títulos son tipografía grande y
    el JPEG les mete halos en los bordes. Cuando no cabe, JPEG de calidad alta:
    en una ilustración con texto de cartel no se distingue, y lo que sí se nota
    es que la portada no esté en el bucket.                                    */
const CABE_EN_PETICION = 2600000;      // en bytes; con base64 quedan ~3,5 MB

export async function conFirma(blob, texto) {
  if (!texto) return blob;
  const bitmap = await crearBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bitmap.width;
  c.height = bitmap.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  dibujarFirma(ctx, c.width, c.height, texto);
  if (bitmap.close) bitmap.close();

  const png = await aBlob(c, 'image/png');
  if (png && png.size <= CABE_EN_PETICION) return png;
  const jpg = await aBlob(c, 'image/jpeg', 0.94);
  return (jpg && jpg.size < (png ? png.size : Infinity)) ? jpg : (png || blob);
}

function aBlob(lienzo, mime, calidad) {
  return new Promise((listo) => {
    try { lienzo.toBlob((b) => listo(b), mime, calidad); }
    catch (e) { listo(null); }
  });
}

function crearBitmap(blob) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  return new Promise((listo, falla) => {
    const u = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(u); listo(img); };
    img.onerror = () => { URL.revokeObjectURL(u); falla(new Error('imagen ilegible')); };
    img.src = u;
  });
}
