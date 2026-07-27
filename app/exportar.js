/* ============================================================
   exportar.js — paquete de montaje
   ============================================================
   Saca del navegador todo lo generado en un único .zip:
   fotogramas, clips, voces, la hoja de montaje en JSON y un
   script de ffmpeg que arma el episodio terminado.
   ============================================================ */

import { assets } from './db.js';
import { clave, audioCompleto, claveImagenDe, claveVideoDe } from './pipeline.js';
import { filtroZoompan, planoCamara } from './camara.js';

/* ── Escritor de ZIP (método "store", sin compresión) ───────── */
/*  Imágenes, audio y video ya vienen comprimidos: comprimir otra
    vez solo gastaría tiempo. Así el escritor cabe en cien líneas
    y no necesita ninguna librería externa.                        */

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function u16(n) { return new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF]); }
function u32(n) { return new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]); }
function une(...arrs) {
  let n = 0;
  for (const a of arrs) n += a.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

export class Zip {
  constructor() { this.entradas = []; this.offset = 0; this.trozos = []; }

  async añadir(ruta, datos) {
    const nombre = new TextEncoder().encode(ruta);
    const bytes = datos instanceof Uint8Array
      ? datos
      : new Uint8Array(await (datos instanceof Blob ? datos.arrayBuffer() : Promise.resolve(datos)));

    const crc = crc32(bytes);
    const cabecera = une(
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(bytes.length), u32(bytes.length),
      u16(nombre.length), u16(0), nombre
    );
    this.trozos.push(cabecera, bytes);
    this.entradas.push({ nombre, crc, tam: bytes.length, offset: this.offset });
    this.offset += cabecera.length + bytes.length;
  }

  cerrar() {
    const central = [];
    let tamCentral = 0;
    for (const e of this.entradas) {
      const c = une(
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(e.crc), u32(e.tam), u32(e.tam),
        u16(e.nombre.length), u16(0), u16(0), u16(0), u16(0), u32(0),
        u32(e.offset), e.nombre
      );
      central.push(c);
      tamCentral += c.length;
    }
    const fin = une(
      u32(0x06054b50), u16(0), u16(0),
      u16(this.entradas.length), u16(this.entradas.length),
      u32(tamCentral), u32(this.offset), u16(0)
    );
    return new Blob([...this.trozos, ...central, fin], { type: 'application/zip' });
  }
}

/*  La firma viaja como un PNG transparente del tamaño del fotograma, con el
    nombre del canal ya dibujado. No se le pide al modelo ni se rotula después:
    se superpone dentro del encode de cada toma.                              */
export const FIRMA_ARCHIVO = 'firma.png';

/* ── Hoja de montaje ────────────────────────────────────────── */

function pad3(n) { return String(n).padStart(3, '0'); }

export function hojaDeMontaje(ep, cfg) {
  let t0 = 0;
  const tomas = ep.tomas.map((t) => {
    const dur = t.segundos || t.segEstimados || 0;
    const usaVideo = !!(t.video && t.video.ok);
    const fila = {
      n: t.i + 1,
      escena: t.escena,
      inicio: +t0.toFixed(2),
      duracion: +dur.toFixed(2),
      tipo: usaVideo ? 'video' : 'fotograma',
      corteEscena: !!t.corteEscena,
      imagen: t.imagen && t.imagen.ok ? 'fotogramas/toma-' + pad3(t.i + 1) + '.png' : null,
      video: usaVideo ? 'clips/toma-' + pad3(t.i + 1) + '.mp4' : null,
      videoDuracion: usaVideo ? (t.video.dur || null) : null,
      audio: t.audio && t.audio.ok ? 'voz/toma-' + pad3(t.i + 1) + '.wav' : null,
      texto: t.texto,
      plano: t.plano || null,
    };
    t0 += dur;
    return fila;
  });

  // La música va por escena y cruza por encima de varias tomas, así que las
  // escenas viajan aparte con su duración real.
  const escenas = [];
  for (const t of ep.tomas) {
    const ult = escenas[escenas.length - 1];
    const dur = t.segundos || t.segEstimados || 0;
    if (ult && ult.escena === t.escena) { ult.duracion = +(ult.duracion + dur).toFixed(2); continue; }
    escenas.push({
      escena: t.escena,
      duracion: +dur.toFixed(2),
      musica: (ep.musica && ep.musica[t.escena] && ep.musica[t.escena].ok)
        ? 'musica/escena-' + pad3(t.escena) + '.mp3' : null,
    });
  }

  return {
    serie: 'DIEZMO',
    temporada: 1,
    episodio: ep.num,
    titulo: ep.titulo,
    formato: cfg.formato,
    firma: cfg.firmaActiva === false ? '' : (cfg.firma || ''),
    escenas,
    silencioEscena: cfg.silencioEscena || 0,
    duracionTotal: +t0.toFixed(2),
    tomas,
  };
}

/* ── Script de ffmpeg ───────────────────────────────────────── */

function dimensiones(formato) {
  return formato === '9:16' ? { w: 1080, h: 1920 }
    : formato === '1:1' ? { w: 1080, h: 1080 }
      : { w: 1920, h: 1080 };
}

export function scriptFfmpeg(hoja) {
  const { w, h } = dimensiones(hoja.formato);
  const fps = 24;
  const L = [];

  L.push('#!/usr/bin/env bash');
  L.push('# ============================================================');
  L.push('# DIEZMO — Episodio ' + hoja.episodio + ': ' + hoja.titulo);
  L.push('# Monta el episodio completo a partir de lo exportado.');
  L.push('# El movimiento de cámara de cada toma fija es el que decidió el');
  L.push('# director; va anotado en el comentario de cada una.');
  L.push('# Requiere ffmpeg. Ejecutar desde la carpeta del .zip descomprimido:');
  L.push('#   bash montar.sh');
  L.push('# ============================================================');
  L.push('set -euo pipefail');
  L.push('mkdir -p segmentos');
  L.push('W=' + w + '; H=' + h + '; FPS=' + fps);
  L.push('');

  /*  Los cortes de escena se marcan con un fundido corto a negro, y el resto
      de las tomas empalman a corte seco, como en cualquier montaje. El fundido
      cae dentro del silencio que la voz ya deja en ese punto, así que no se
      come ni una sílaba. Hacerlo por segmento permite seguir concatenando por
      copia, sin recodificar el episodio entero una segunda vez.               */
  const SILENCIO = Math.max(0, Number(hoja.silencioEscena) || 0);
  const lista = [];
  const vozLista = [];
  const usable = hoja.tomas.filter((t) => t.audio && (t.video || t.imagen));

  usable.forEach((t, k) => {
    const seg = 'segmentos/seg-' + pad3(t.n) + '.mp4';
    const dur = t.duracion.toFixed(3);
    const cam = planoCamara(t.plano);
    const previa = usable[k - 1];

    // Fundido de entrada: al empezar el episodio y al abrir una escena nueva.
    const abre = k === 0 || (previa && previa.corteEscena);
    // Fundido de salida: al cerrar una escena y al terminar el episodio.
    const cierra = !!t.corteEscena || k === usable.length - 1;
    const margen = Math.max(0.18, Math.min(SILENCIO || 0.45, 0.7));
    const fIn = abre ? Math.min(margen, t.duracion / 3) : 0;
    const fOut = cierra ? Math.min(margen, t.duracion / 3) : 0;

    L.push('# ── Toma ' + t.n + ' · escena ' + t.escena + ' · ' + dur + ' s · ' +
      (t.tipo === 'video' && t.video ? 'clip animado' : 'fija · ' + cam.nombre) +
      (fIn ? ' · abre escena' : '') + (fOut ? ' · cierra escena' : ''));

    const vFade = (fIn ? ',fade=t=in:st=0:d=' + fIn.toFixed(2) : '') +
      (fOut ? ',fade=t=out:st=' + (t.duracion - fOut).toFixed(2) + ':d=' + fOut.toFixed(2) : '');
    /*  LA VOZ NO LLEVA FUNDIDO DE ENTRADA. La imagen sí, pero aplicar el mismo
        al audio significaba subir el volumen desde cero durante siete décimas
        justo cuando el narrador arranca: se comía la primera palabra de cada
        escena, en todo el episodio. Y no hace falta ninguno, porque la toma
        que cierra escena ya lleva detrás un silencio de verdad.             */
    const aFade = fOut
      ? 'afade=t=out:st=' + (t.duracion - fOut).toFixed(2) + ':d=' + fOut.toFixed(2)
      : '';

    const cadenaV = t.tipo === 'video' && t.video
      // El clip de Veo suele ser más corto que la locución: se congela el último
      // fotograma hasta cubrir la duración de la voz.
      ? '[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS},' +
        'tpad=stop_mode=clone:stop_duration=30,trim=duration=' + dur + ',setpts=PTS-STARTPTS' +
        vFade + '[v]'
      /*  Fija: se amplía antes de recorrerla, para que el movimiento de cámara
          no pixele. Tres veces la salida basta —el zoom más agresivo que puede
          pedir el director es 2,8x— y cuesta la mitad que cuatro veces, que era
          lo que había: a 7680x4320 el filtro tardaba tanto que el montaje se
          arriesgaba a agotar el tiempo del Job y quedarse sin nada. Lanczos
          porque el original es de 2K y hay que estirarlo con cabeza.        */
      : '[0:v]scale=${W}*3:${H}*3:flags=lanczos,' +
        filtroZoompan(t.plano, Math.max(2, Math.round(t.duracion * fps)),
          '${W}', '${H}', '${FPS}', hoja.intensidadCamara) +
        vFade + '[v]';

    const entrada = t.tipo === 'video' && t.video
      ? '-i "' + t.video + '"'
      : '-loop 1 -i "' + t.imagen + '"';

    /*  La firma se incrusta AQUÍ, dentro de la única codificación que tiene
        cada toma. Ponerla al final, sobre el episodio ya montado, obligaría a
        recodificarlo entero: una segunda generación de x264 sobre los dieciséis
        minutos, justo lo que se quitó para que no perdiera calidad.          */
    const conFirma = !!hoja.firma;
    const marca = conFirma ? ' -i "' + FIRMA_ARCHIVO + '"' : '';

    /*  EL SEGMENTO VA MUDO, a propósito. Antes cada toma se codificaba con su
        audio en AAC y luego se pegaban con «concat -c copy». AAC no se puede
        pegar así: cada trozo lleva unas muestras de precarga y un relleno al
        final, y al concatenar por copia esos bordes quedan dentro y suenan
        como un chasquido en cada una de las 134 uniones. Y si había música, el
        audio se recodificaba una segunda vez encima.
        Ahora la voz no se corta ni se pega nunca en comprimido: va en PCM de
        principio a fin y se codifica UNA sola vez, al final de todo.        */
    const cadenaFinal = conFirma
      // La firma viene ya del tamaño exacto del fotograma: no hay que escalarla.
      ? cadenaV.replace(/\[v\]$/, '[base];[base][1:v]overlay=0:0[v]')
      : cadenaV;

    L.push('ffmpeg -y -loglevel error ' + entrada + marca + ' \\');
    L.push('  -filter_complex "' + cadenaFinal + '" \\');
    L.push('  -map "[v]" -an -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p \\');
    L.push('  -t ' + dur + ' "' + seg + '"');

    /*  Los fundidos de audio se aplican DENTRO de la toma, antes de unir nada:
        así siguen cayendo donde caían y la unión sigue siendo PCM contra PCM. */
    const vozPieza = 'voz/pieza-' + pad3(t.n) + '.wav';
    if (aFade) {
      L.push('ffmpeg -y -loglevel error -i "' + t.audio + '" -af "' + aFade +
        '" -c:a pcm_s16le "' + vozPieza + '"');
      vozLista.push(vozPieza);
    } else {
      vozLista.push(t.audio);
    }
    L.push('');
    lista.push(seg);
  });

  for (const t of hoja.tomas) {
    if (!t.audio) L.push('echo "toma ' + t.n + ': sin voz, se omite"');
    else if (!t.video && !t.imagen) L.push('echo "toma ' + t.n + ': sin imagen ni clip, se omite"');
  }

  const salida = 'DIEZMO-EP' + String(hoja.episodio).padStart(2, '0') + '.mp4';
  const conMusica = (hoja.escenas || []).some((e) => e.musica);
  const mudo = 'segmentos/episodio-mudo.mp4';

  L.push('# ── Montaje de la imagen ──');
  L.push('# El video se pega por COPIA y no se vuelve a codificar: una sola');
  L.push('# generación de x264 en todo el episodio.');
  L.push('rm -f lista.txt');
  for (const s2 of lista) L.push("echo \"file '" + s2 + "'\" >> lista.txt");
  L.push('ffmpeg -y -loglevel error -f concat -safe 0 -i lista.txt -c copy -an "' + mudo + '"');
  L.push('');

  /*  La voz se une en PCM. Concatenar audio SIN COMPRIMIR no introduce nada:
      no hay precarga de codificador, no hay relleno, no hay chasquido. Es la
      diferencia entre pegar 134 trozos de AAC y pegar 134 trozos de onda.   */
  L.push('# ── La voz, unida sin comprimir ──');
  L.push('rm -f listavoz.txt');
  for (const v of vozLista) L.push("echo \"file '" + v + "'\" >> listavoz.txt");
  L.push('ffmpeg -y -loglevel error -f concat -safe 0 -i listavoz.txt \\');
  L.push('  -c:a pcm_s16le voz/completa.wav');
  L.push('');

  /*  La música va por ESCENA y cruza por encima de varias tomas, así que no
      puede mezclarse segmento a segmento: se arma un lecho continuo del largo
      del episodio y se mezcla de una vez al final. El vídeo se copia tal cual
      —no se recodifica una segunda vez—, solo se rehace el audio.            */
  if (conMusica) {
    L.push('# ── Lecho musical, escena por escena ──');
    L.push('mkdir -p musica/lecho');
    L.push('rm -f listamus.txt');
    for (const e of hoja.escenas) {
      const d = Math.max(0.1, Number(e.duracion) || 0).toFixed(3);
      const trozo = 'musica/lecho/esc-' + pad3(e.escena) + '.wav';
      /*  El relevo de una pieza a la siguiente se oía como un tajo. Fundidos
          largos —de segundo y medio a tres y medio— lo convierten en un
          relevo: la música es un lecho de fondo y nadie echa de menos su
          primer segundo, pero el salto sí se nota.                          */
      const fade = Math.min(3.5, Math.max(1.2, (Number(e.duracion) || 2) / 4)).toFixed(2);
      if (e.musica) {
        // Si la pieza es más corta que la escena, se repite; el fundido de
        // entrada y salida tapa la costura y separa una escena de la siguiente.
        L.push('ffmpeg -y -loglevel error -stream_loop -1 -i "' + e.musica + '" -t ' + d + ' \\');
        L.push('  -af "afade=t=in:st=0:d=' + fade + ',afade=t=out:st=' +
          Math.max(0, (Number(e.duracion) || 0) - Number(fade)).toFixed(2) + ':d=' + fade +
          ',aformat=sample_rates=48000:channel_layouts=stereo" \\');
        L.push('  -c:a pcm_s16le "' + trozo + '"');
      } else {
        L.push('# escena ' + e.escena + ': sin música, silencio');
        L.push('ffmpeg -y -loglevel error -f lavfi -i anullsrc=r=48000:cl=stereo -t ' + d +
          ' -c:a pcm_s16le "' + trozo + '"');
      }
      L.push("echo \"file '" + trozo + "'\" >> listamus.txt");
    }
    L.push('ffmpeg -y -loglevel error -f concat -safe 0 -i listamus.txt -c copy musica/lecho.wav');
    L.push('');
  }

  /*  UNA SOLA codificación de audio en todo el episodio, aquí al final. La voz
      llega en PCM desde el principio de la cadena, la música también, se
      mezclan y recién entonces se comprime. El video se copia tal cual.     */
  const VOZ_PCM = '[1:a]aresample=48000:resampler=soxr,' +
    'aformat=sample_fmts=fltp:channel_layouts=stereo';
  L.push('# ── Mezcla final y ÚNICA codificación de audio ──');
  if (conMusica) {
    L.push('# La música cede paso a la narración: la voz abre el paso a la música');
    L.push('# por compresión lateral, no por un volumen fijo.');
    L.push('ffmpeg -y -loglevel error -i "' + mudo + '" -i voz/completa.wav -i musica/lecho.wav \\');
    L.push('  -filter_complex "' + VOZ_PCM + ',asplit=2[voz][llave];' +
      '[2:a]volume=' + (Number(hoja.volumenMusica) || 0.3).toFixed(2) + '[mus];' +
      '[mus][llave]sidechaincompress=threshold=0.015:ratio=14:attack=12:release=420[duck];' +
      '[voz][duck]amix=inputs=2:normalize=0:duration=first[mez]" \\');
    L.push('  -map 0:v -map "[mez]" -c:v copy -c:a aac -b:a 256k -movflags +faststart "' + salida + '"');
  } else {
    L.push('ffmpeg -y -loglevel error -i "' + mudo + '" -i voz/completa.wav \\');
    L.push('  -filter_complex "' + VOZ_PCM + '[mez]" \\');
    L.push('  -map 0:v -map "[mez]" -c:v copy -c:a aac -b:a 256k -movflags +faststart "' + salida + '"');
  }
  L.push('');

  L.push('echo "Listo: ' + salida + '"');
  L.push('');

  return L.join('\n');
}

/* ── Encargo de montaje para el montador de la nube ─────────── */

/**
 * Qué archivo del bucket va a qué sitio del montaje.
 *
 * Sale de la MISMA hoja que usa el script de ffmpeg, así que los nombres no
 * pueden discrepar: si la hoja dice «fotogramas/toma-007.png», aquí se dice
 * de dónde sale ese archivo, y no hay una segunda lista que mantener.
 */
export function descargasDe(ep, hoja) {
  const fuera = [];
  const mete = (clave, destino) => { if (clave && destino) fuera.push({ clave, destino }); };

  hoja.tomas.forEach((t, k) => {
    const toma = ep.tomas[k];
    if (!toma) return;
    if (t.imagen) mete(claveImagenDe(ep.num, toma), t.imagen);
    if (t.video) mete(claveVideoDe(ep.num, toma), t.video);
    if (t.audio) mete(clave.audio(ep.num, toma.i), t.audio);
  });
  for (const e of hoja.escenas || []) {
    if (e.musica) mete(clave.musica(ep.num, e.escena), e.musica);
  }
  // Un fotograma reutilizado aparece en varias tomas: se baja una vez y se
  // copia, pero la lista lo pide en cada destino porque los nombres difieren.
  return fuera;
}

/* ── Exportación completa de un episodio ────────────────────── */

export async function exportarEpisodio(ep, cfg, progreso) {
  const zip = new Zip();
  const hoja = hojaDeMontaje(ep, cfg);
  const total = ep.tomas.length;
  let n = 0;

  for (const esc of Object.keys(ep.musica || {})) {
    const m = await assets.blob(clave.musica(ep.num, Number(esc)));
    if (m) await zip.añadir('musica/escena-' + pad3(Number(esc)) + '.mp3', m);
  }

  for (const t of ep.tomas) {
    n++;
    if (progreso) progreso(n, total, 'empaquetando toma ' + n);

    const img = await assets.blob(claveImagenDe(ep.num, t));
    if (img) await zip.añadir('fotogramas/toma-' + pad3(t.i + 1) + '.png', img);

    const aud = await assets.blob(clave.audio(ep.num, t.i));
    if (aud) await zip.añadir('voz/toma-' + pad3(t.i + 1) + '.wav', aud);

    const vid = await assets.blob(claveVideoDe(ep.num, t));
    if (vid) await zip.añadir('clips/toma-' + pad3(t.i + 1) + '.mp4', vid);
  }

  if (progreso) progreso(total, total, 'montaje y guion técnico');

  const completo = await audioCompleto(ep);
  if (completo) await zip.añadir('voz/EPISODIO-COMPLETO.wav', completo);

  const enc = new TextEncoder();
  await zip.añadir('montaje.json', enc.encode(JSON.stringify(hoja, null, 2)));
  await zip.añadir('montar.sh', enc.encode(scriptFfmpeg(hoja)));
  await zip.añadir('guion-tecnico.md', enc.encode(guionTecnico(ep, hoja)));

  const faltan = hoja.tomas.filter((t) => t.tipo === 'video' && !t.video).length;
  return { blob: zip.cerrar(), hoja, faltan };
}

/* ── Guion técnico legible ──────────────────────────────────── */

function guionTecnico(ep, hoja) {
  const L = ['# DIEZMO — Episodio ' + ep.num + ': ' + ep.titulo,
    '',
    'Guion técnico generado por el Estudio. ' + hoja.tomas.length + ' tomas · ' +
    Math.round(hoja.duracionTotal / 60) + ' min ' + Math.round(hoja.duracionTotal % 60) + ' s · ' +
    hoja.formato,
    ''];
  let escena = 0;
  for (const t of hoja.tomas) {
    if (t.escena !== escena) {
      escena = t.escena;
      L.push('', '---', '', '## Escena ' + escena, '');
    }
    const p = t.plano || {};
    L.push('### Toma ' + t.n + ' · ' + t.duracion.toFixed(1) + ' s · ' + t.tipo);
    L.push('');
    L.push('- **Encuadre:** ' + (p.encuadre || '—') + ' · **Cámara:** ' + (p.movimiento || '—'));
    L.push('- **Lugar:** ' + (p.lugar || '—') + ' · **En cuadro:** ' +
      ((p.personajes && p.personajes.length) ? p.personajes.join(', ') : 'nadie'));
    L.push('- **Luz:** ' + (p.luz || '—') + ' · **Atmósfera:** ' + (p.emocion || '—'));
    if (p.descripcion) L.push('- **Imagen:** ' + p.descripcion);
    if (t.tipo === 'video' && p.accionVideo) L.push('- **Movimiento:** ' + p.accionVideo);
    L.push('');
    L.push('> ' + t.texto.replace(/\n/g, '\n> '));
    L.push('');
  }
  return L.join('\n');
}

/* ── Descarga ───────────────────────────────────────────────── */

export function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
