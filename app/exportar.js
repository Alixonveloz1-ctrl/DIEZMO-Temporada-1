/* ============================================================
   exportar.js — paquete de montaje
   ============================================================
   Saca del navegador todo lo generado en un único .zip:
   fotogramas, clips, voces, la hoja de montaje en JSON y un
   script de ffmpeg que arma el episodio terminado.
   ============================================================ */

import { assets } from './db.js';
import { clave, audioCompleto } from './pipeline.js';
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

  return {
    serie: 'DIEZMO',
    temporada: 1,
    episodio: ep.num,
    titulo: ep.titulo,
    formato: cfg.formato,
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
    const aFade = (fIn ? 'afade=t=in:st=0:d=' + fIn.toFixed(2) : '') +
      (fIn && fOut ? ',' : '') +
      (fOut ? 'afade=t=out:st=' + (t.duracion - fOut).toFixed(2) + ':d=' + fOut.toFixed(2) : '');

    const cadenaV = t.tipo === 'video' && t.video
      // El clip de Veo suele ser más corto que la locución: se congela el último
      // fotograma hasta cubrir la duración de la voz.
      ? '[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS},' +
        'tpad=stop_mode=clone:stop_duration=30,trim=duration=' + dur + ',setpts=PTS-STARTPTS' +
        vFade + '[v]'
      // Fija: se amplía primero para que el movimiento de cámara no pixele, y
      // después se recorre el fotograma según lo que pidió el director.
      : '[0:v]scale=${W}*4:${H}*4,' +
        filtroZoompan(t.plano, Math.max(2, Math.round(t.duracion * fps)), '${W}', '${H}', '${FPS}') +
        vFade + '[v]';

    const entrada = t.tipo === 'video' && t.video
      ? '-i "' + t.video + '"'
      : '-loop 1 -i "' + t.imagen + '"';

    L.push('ffmpeg -y -loglevel error ' + entrada + ' -i "' + t.audio + '" \\');
    L.push('  -filter_complex "' + cadenaV + (aFade ? ';[1:a]' + aFade + '[a]' : '') + '" \\');
    L.push('  -map "[v]" -map ' + (aFade ? '"[a]"' : '1:a') +
      ' -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p \\');
    L.push('  -c:a aac -b:a 192k -t ' + dur + ' "' + seg + '"');
    L.push('');
    lista.push(seg);
  });

  for (const t of hoja.tomas) {
    if (!t.audio) L.push('echo "toma ' + t.n + ': sin voz, se omite"');
    else if (!t.video && !t.imagen) L.push('echo "toma ' + t.n + ': sin imagen ni clip, se omite"');
  }

  L.push('# ── Concatenado final ──');
  L.push('rm -f lista.txt');
  for (const s2 of lista) L.push("echo \"file '" + s2 + "'\" >> lista.txt");
  L.push('ffmpeg -y -loglevel error -f concat -safe 0 -i lista.txt -c copy ' +
    '"DIEZMO-EP' + String(hoja.episodio).padStart(2, '0') + '.mp4"');
  L.push('echo "Listo: DIEZMO-EP' + String(hoja.episodio).padStart(2, '0') + '.mp4"');
  L.push('');

  return L.join('\n');
}

/* ── Exportación completa de un episodio ────────────────────── */

export async function exportarEpisodio(ep, cfg, progreso) {
  const zip = new Zip();
  const hoja = hojaDeMontaje(ep, cfg);
  const total = ep.tomas.length;
  let n = 0;

  for (const t of ep.tomas) {
    n++;
    if (progreso) progreso(n, total, 'empaquetando toma ' + n);

    const img = await assets.blob(clave.imagen(ep.num, t.i));
    if (img) await zip.añadir('fotogramas/toma-' + pad3(t.i + 1) + '.png', img);

    const aud = await assets.blob(clave.audio(ep.num, t.i));
    if (aud) await zip.añadir('voz/toma-' + pad3(t.i + 1) + '.wav', aud);

    const vid = await assets.blob(clave.video(ep.num, t.i));
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
