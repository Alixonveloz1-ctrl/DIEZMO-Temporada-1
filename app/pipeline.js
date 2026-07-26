/* ============================================================
   pipeline.js — motor de generación
   ============================================================
   Una sola cola para las tres fases (voz, fotograma, movimiento).
   Se puede detener y reanudar sin perder lo ya generado: cada
   toma terminada queda escrita en IndexedDB antes de pasar a la
   siguiente.
   ============================================================ */

import { api, generarVideo, bajarClip, b64aBytes, extraerPCM, crearWav, duracionPCM, blobAb64, comoReferencia } from './api.js';
import { assets } from './db.js';
import { nube } from './nube.js';
import { normalizarParaVoz, REEMPLAZOS_BASE } from './texto.js';
import { promptImagen, promptVideo, promptReferencia, promptLugar } from './director.js';
import { variantesDe, vestuarioPara } from './biblia.js';
import { duracionVeo } from './veo.js';
import { encargarMusica, promptMusica } from './musica.js';

export const clave = {
  audio: (ep, i) => 'ep' + pad(ep) + '/t' + pad3(i) + '/audio',
  imagen: (ep, i) => 'ep' + pad(ep) + '/t' + pad3(i) + '/img',
  video: (ep, i) => 'ep' + pad(ep) + '/t' + pad3(i) + '/vid',
  refPersonaje: (id, n) => 'ref/personaje/' + id + '/' + n,
  refLugar: (id) => 'ref/lugar/' + id,
  musica: (ep, esc) => 'ep' + pad(ep) + '/mus/' + pad3(esc),
  episodio: (ep) => 'ep' + pad(ep) + '/completo',
};

function pad(n) { return String(n).padStart(2, '0'); }
function pad3(n) { return String(n).padStart(3, '0'); }

/* ── Pool de concurrencia ───────────────────────────────────── */
async function enPool(items, limite, trabajo, señal) {
  const cola = items.slice();
  const activos = [];
  const errores = [];

  async function siguiente() {
    while (cola.length) {
      if (señal && señal.aborted) return;
      const it = cola.shift();
      try { await trabajo(it); } catch (e) {
        if (e && e.cancelado) return;
        errores.push({ item: it, error: e });
      }
    }
  }
  for (let k = 0; k < Math.min(limite, items.length); k++) activos.push(siguiente());
  await Promise.all(activos);
  return errores;
}

/* ── Motor ──────────────────────────────────────────────────── */

export class Motor {
  constructor(proyecto, avisos) {
    this.p = proyecto;
    this.avisos = avisos || {};
    this.abort = null;
    this.activo = false;
  }

  detener() { if (this.abort) this.abort.abort(); }

  get señal() { return this.abort ? this.abort.signal : undefined; }

  _prog(hecho, total, texto) {
    if (this.avisos.progreso) this.avisos.progreso({ hecho, total, texto });
  }

  _log(txt, tipo) {
    if (this.avisos.log) this.avisos.log(txt, tipo || 'info');
  }

  async _correr(fn) {
    if (this.activo) throw new Error('Ya hay un trabajo en marcha');
    this.activo = true;
    this.abort = new AbortController();
    try {
      return await fn();
    } finally {
      this.activo = false;
      this.abort = null;
      if (this.avisos.fin) this.avisos.fin();
    }
  }

  /* ── Hojas de referencia de personaje ─────────────────────── */

  /** Carga una hoja ya guardada y la deja lista para adjuntar. */
  async _refGuardada(k) {
    const b = await assets.blob(k);
    return b ? comoReferencia(b) : null;
  }

  async generarReferencias(ids, soloFaltantes) {
    const cfg = this.p.config;
    const objetivo = this.p.elenco.filter((x) => !ids || ids.indexOf(x.id) !== -1);

    return this._correr(async () => {
      let hecho = 0;
      const total = objetivo.reduce((a, p) => a + variantesDe(p).length, 0);
      for (const per of objetivo) {
        per.refs = per.refs || [];
        // La primera hoja de cuerpo entero es la MAESTRA: fija la cara, el pelo y
        // las proporciones. Las demás se generan con ella adjunta, para que salga
        // la misma persona con otra ropa o en primer plano. Sin esto, cada hoja
        // nacía de cero y el personaje cambiaba de rostro entre una y otra.
        let maestra = null;      // ya reducida, lista para adjuntar
        let maestraBlob = null;  // la hoja entera, por si hay que encogerla más
        for (const v of variantesDe(per)) {
          if (this.señal.aborted) return;
          const k = clave.refPersonaje(per.id, v.id);
          const seráMaestra = !maestra && v.cuerpo;

          if (soloFaltantes && per.refs.indexOf(k) !== -1) {
            if (seráMaestra) {
              maestraBlob = await assets.blob(k);
              maestra = maestraBlob ? await comoReferencia(maestraBlob) : null;
            }
            hecho++;
            this._prog(hecho, total, per.nombre);
            continue;
          }
          const quién = per.nombre + ' · ' + v.nombre;
          this._prog(hecho, total, quién);
          const pedir = (ref) => api.imagen({
            prompt: promptReferencia(per, cfg, v, !!ref),
            images: ref ? [ref] : [],
            model: cfg.modeloImagen,
            aspectRatio: v.cuerpo ? '2:3' : '1:1',
            imageSize: cfg.imageSize,
            guardarComo: k,
            // Más paciencia que en el resto: si esto se rinde, el personaje se
            // queda a medias y hay que rehacerlo entero.
          }, { intentos: 5, señal: this.señal, aviso: (m) => this._log(quién + ': ' + m) });

          try {
            let r;
            try {
              r = await pedir(maestra);
            } catch (e) {
              if (e && e.cancelado) throw e;
              /*  El rostro NO se negocia. Una cuota agotada, una caída de
                  capacidad o un tiempo de espera no tienen nada que ver con
                  el adjunto: rendirse y rehacer la hoja sin él daría un
                  personaje distinto, y esa cara equivocada acabaría de
                  referencia en las tomas del episodio. Antes ninguna hoja
                  que una hoja de otra persona.
                  Lo único que justifica tocar el adjunto es que la petición
                  no quepa, y ni siquiera entonces se quita: se encoge.       */
              if (!(maestra && maestraBlob && e.status === 413)) throw e;
              this._log('la petición no cabía; se encoge la referencia y se ' +
                'reintenta ' + quién + ' con el mismo rostro', 'aviso');
              maestra = await comoReferencia(maestraBlob, 640);
              r = await pedir(maestra);
            }

            const hoja = b64toBlob(r.image, r.mimeType);
            await assets.guardar(k, hoja, { personaje: per.id, variante: v.id });
            if (per.refs.indexOf(k) === -1) per.refs.push(k);
            if (seráMaestra) { maestraBlob = hoja; maestra = await comoReferencia(hoja); }
            this._log('referencia lista: ' + quién, 'ok');
          } catch (e) {
            if (e && e.cancelado) return;
            this._log('no se generó ' + quién + ': ' + e.message +
              (maestra ? ' · no se hace sin la referencia del rostro, saldría otra persona' : ''), 'err');
          }
          hecho++;
          this._prog(hecho, total, per.nombre);
        }
      }
    });
  }

  async generarFondos(ids) {
    const cfg = this.p.config;
    const objetivo = this.p.lugares.filter((x) => !ids || ids.indexOf(x.id) !== -1);
    return this._correr(async () => {
      let hecho = 0;
      for (const lug of objetivo) {
        if (this.señal.aborted) return;
        this._prog(hecho, objetivo.length, lug.nombre);
        try {
          const k = clave.refLugar(lug.id);
          const r = await api.imagen({
            prompt: promptLugar(lug, cfg),
            model: cfg.modeloImagen,
            aspectRatio: cfg.formato,
            imageSize: cfg.imageSize,
            guardarComo: k,
          }, { intentos: 3, señal: this.señal, aviso: (m) => this._log(lug.nombre + ': ' + m) });
          await assets.guardar(k, b64toBlob(r.image, r.mimeType), { lugar: lug.id });
          lug.ref = k;
          this._log('fondo listo: ' + lug.nombre, 'ok');
        } catch (e) {
          if (e && e.cancelado) return;
          this._log('falló el fondo de ' + lug.nombre + ': ' + e.message, 'err');
        }
        hecho++;
        this._prog(hecho, objetivo.length, lug.nombre);
      }
    });
  }

  /* ── Voz ──────────────────────────────────────────────────── */
  /*  Secuencial a propósito: el TTS mantiene mejor el tono entre
      fragmentos consecutivos si no se pisan las llamadas.          */

  async generarVoz(ep, soloFaltantes) {
    const cfg = this.p.config;
    const pendientes = ep.tomas.filter((t) => !soloFaltantes || !t.audio || !t.audio.ok);

    return this._correr(async () => {
      let hecho = 0;
      for (const t of pendientes) {
        if (this.señal.aborted) return;
        this._prog(hecho, pendientes.length, 'voz · toma ' + (t.i + 1) + '/' + ep.tomas.length);

        let texto = t.texto;
        if (cfg.anunciarTitulo && t.i === 0) {
          texto = 'DIEZMO. Episodio ' + ep.num + ': ' + ep.titulo + '.\n\n' + texto;
        }
        if (cfg.normalizarVoz) {
          texto = normalizarParaVoz(texto, cfg.reemplazos || REEMPLAZOS_BASE);
        }
        if (!texto.trim()) { hecho++; continue; }

        try {
          const r = await api.tts({
            text: texto,
            voice: cfg.voz,
            model: cfg.modeloTts,
            styleInstruction: cfg.instruccionVoz,
            temperature: cfg.temperaturaVoz,
            languageCode: cfg.idioma || undefined,
            seed: cfg.semillaVoz === '' ? undefined : Number(cfg.semillaVoz),
          }, { intentos: 3, señal: this.señal, aviso: (m) => this._log('toma ' + (t.i + 1) + ': ' + m) });

          const ex = extraerPCM(b64aBytes(r.audio), r.sampleRate || 24000);
          const partes = [ex.pcm];
          if (t.corteEscena && cfg.silencioEscena > 0) {
            partes.push(new Uint8Array(Math.round(ex.rate * cfg.silencioEscena) * 2));
          }
          const blob = crearWav(partes, ex.rate);
          const dur = partes.reduce((a, p) => a + p.length, 0) / 2 / ex.rate;

          await assets.guardar(clave.audio(ep.num, t.i), blob, { ep: ep.num, toma: t.i, dur });
          t.audio = { ok: true, dur: +dur.toFixed(2), rate: ex.rate };
          t.segundos = +dur.toFixed(2);
        } catch (e) {
          if (e && e.cancelado) return;
          t.audio = { ok: false, error: e.message };
          this._log('voz toma ' + (t.i + 1) + ': ' + e.message, 'err');
        }
        hecho++;
        this._prog(hecho, pendientes.length, 'voz');
        if (this.avisos.cambio) this.avisos.cambio();
      }
    });
  }

  /* ── Fotogramas ───────────────────────────────────────────── */

  async generarImagenes(ep, soloFaltantes, indices) {
    const cfg = this.p.config;
    const pendientes = ep.tomas.filter((t) => {
      if (indices && indices.indexOf(t.i) === -1) return false;
      if (t.bloqueada) return false;
      return !soloFaltantes || !t.imagen || !t.imagen.ok;
    });

    return this._correr(async () => {
      let hecho = 0;
      const total = pendientes.length;
      const errores = await enPool(pendientes, 2, async (t) => {
        if (this.señal.aborted) return;
        this._prog(hecho, total, 'fotograma · toma ' + (t.i + 1));
        await this._unaImagen(ep, t);
        hecho++;
        this._prog(hecho, total, 'fotogramas');
        if (this.avisos.cambio) this.avisos.cambio();
      }, this.señal);
      if (errores && errores.length) this._log(errores.length + ' fotogramas fallaron', 'err');
    });
  }

  async _unaImagen(ep, t) {
    const cfg = this.p.config;
    const plano = t.plano;
    if (!plano) { t.imagen = { ok: false, error: 'sin plano: dirige el episodio primero' }; return; }

    /*  Referencias: personajes en cuadro primero, fondo del lugar al final.
        Aquí vale la misma regla que en las hojas: si un personaje sale en el
        plano y no se puede adjuntar su cara, la toma NO se genera. Dibujarla
        igualmente daría un desconocido con su nombre, y como el fotograma se
        ve terminado en la rejilla, el cambiazo pasaría desapercibido hasta
        tener el episodio montado.                                            */
    const refs = [];
    const sinCara = [];
    for (const id of (plano.personajes || []).slice(0, cfg.maxReferencias)) {
      const per = this.p.elenco.find((p) => p.id === id);
      if (!per) continue;                       // el director nombró a alguien que ya no existe
      // La hoja del vestuario que lleva en ESTE episodio; si falta, la primera que haya.
      const kVest = clave.refPersonaje(per.id, vestuarioPara(per, ep.num).id);
      const k = (per.refs || []).indexOf(kVest) !== -1 ? kVest : (per.refs || [])[0];
      const b = k ? await assets.blob(k) : null;
      if (b) refs.push(await comoReferencia(b));
      else sinCara.push(per.nombre);
    }
    if (sinCara.length) {
      t.imagen = { ok: false, error: 'sin hoja de referencia de ' + sinCara.join(' y ') +
        ': genera sus hojas en la Biblia antes, o saldría otra persona' };
      this._log('toma ' + (t.i + 1) + ': falta la referencia de ' + sinCara.join(' y '), 'err');
      return;
    }
    if (refs.length < 4) {
      const lug = this.p.lugares.find((l) => l.id === plano.lugar);
      if (lug && lug.ref) {
        const b = await assets.blob(lug.ref);
        if (b) refs.push(await comoReferencia(b));
      }
    }

    const ctx = {
      estilo: cfg.estilo, calidad: cfg.calidad, negativo: cfg.negativo, formato: cfg.formato,
      elenco: this.p.elenco, lugares: this.p.lugares, episodio: ep.num,
    };
    const prompt = t.promptImagen || promptImagen(plano, ctx);

    try {
      const r = await api.imagen({
        prompt,
        images: refs,
        model: cfg.modeloImagen,
        aspectRatio: cfg.formato,
        imageSize: cfg.imageSize,
        guardarComo: clave.imagen(ep.num, t.i),
      }, { intentos: 3, señal: this.señal, aviso: (m) => this._log('toma ' + (t.i + 1) + ': ' + m) });

      await assets.guardar(clave.imagen(ep.num, t.i), b64toBlob(r.image, r.mimeType),
        { ep: ep.num, toma: t.i });
      t.imagen = { ok: true, refs: refs.length, region: r.region };
      t.promptImagen = prompt;
    } catch (e) {
      if (e && e.cancelado) throw e;
      t.imagen = { ok: false, error: e.message };
      this._log('fotograma toma ' + (t.i + 1) + ': ' + e.message, 'err');
    }
  }

  /* ── Movimiento (Veo) ─────────────────────────────────────── */

  async generarVideos(ep, soloFaltantes, indices) {
    const cfg = this.p.config;
    const pendientes = ep.tomas.filter((t) => {
      if (indices) return indices.indexOf(t.i) !== -1;
      if (!t.plano || t.plano.tipo !== 'movimiento') return false;
      if (!t.imagen || !t.imagen.ok) return false;
      return !soloFaltantes || !t.video || !t.video.ok;
    });

    return this._correr(async () => {
      let hecho = 0;
      const total = pendientes.length;
      // Veo es lento; dos en paralelo aprovechan la espera sin disparar la cuota.
      const errores = await enPool(pendientes, 2, async (t) => {
        if (this.señal.aborted) return;
        this._prog(hecho, total, 'movimiento · toma ' + (t.i + 1));
        await this._unVideo(ep, t);
        hecho++;
        this._prog(hecho, total, 'movimiento');
        if (this.avisos.cambio) this.avisos.cambio();
      }, this.señal);
      if (errores && errores.length) this._log(errores.length + ' clips fallaron', 'err');
    });
  }

  async _unVideo(ep, t) {
    const cfg = this.p.config;
    const img = await assets.blob(clave.imagen(ep.num, t.i));
    if (!img) { t.video = { ok: false, error: 'falta el fotograma' }; return; }

    // Veo solo admite ciertos enteros y los rechaza si no coinciden: 4, 6 u 8 en
    // la familia 3.x, de 5 a 8 en Veo 2. Se pide el más cercano a lo que dura la voz.
    const dur = duracionVeo(cfg.modeloVideo, t.segundos || t.segEstimados || 8);
    const ctx = { estilo: cfg.estilo };

    try {
      const r = await generarVideo({
        prompt: promptVideo(t.plano, ctx),
        image: { data: await blobAb64(img), mimeType: img.type || 'image/png' },
        model: cfg.modeloVideo,
        aspectRatio: cfg.formato,
        durationSeconds: dur,
        resolution: cfg.resolucionVideo,
        generateAudio: !!cfg.audioVeo,
        negativePrompt: cfg.negativo,
        storagePrefix: 'diezmo/ep' + pad(ep.num),
      }, { señal: this.señal, aviso: (m) => this._log('toma ' + (t.i + 1) + ': ' + m) });

      if (r.video) {
        await assets.guardar(clave.video(ep.num, t.i), b64toBlob(r.video, r.mimeType || 'video/mp4'),
          { ep: ep.num, toma: t.i });
        t.video = { ok: true, dur, local: true };
      } else if (r.clip) {
        // El clip se archiva en el bucket bajo su clave y se trae una copia local.
        try { await nube.archivarClip(r.clip, clave.video(ep.num, t.i)); } catch (e) { /* sigue igual */ }
        const blob = await bajarClip(r.clip, this.señal);
        await assets.guardar(clave.video(ep.num, t.i), blob, { ep: ep.num, toma: t.i });
        t.video = { ok: true, dur, local: true };
      } else {
        throw new Error('Veo terminó sin devolver el clip');
      }
    } catch (e) {
      if (e && e.cancelado) throw e;
      t.video = { ok: false, error: e.message };
      this._log('movimiento toma ' + (t.i + 1) + ': ' + e.message, 'err');
    }
  }

  /* ── Música ───────────────────────────────────────────────── */
  /*  Una pieza por escena, no por toma. Lyria cobra por pieza y no por
      segundo, así que una de tres minutos cuesta lo mismo que una de treinta.  */

  async generarMusica(ep, soloFaltantes) {
    const cfg = this.p.config;
    return this._correr(async () => {
      this._prog(0, 1, 'encargando la música del episodio');
      let escenas;
      try {
        escenas = await encargarMusica(ep, cfg, {
          señal: this.señal, aviso: (m) => this._log('música: ' + m),
        });
      } catch (e) {
        if (e && e.cancelado) return;
        this._log('no se pudo preparar la música: ' + e.message, 'err');
        return;
      }

      ep.musica = ep.musica || {};
      let hecho = 0;
      for (const esc of escenas) {
        if (this.señal.aborted) return;
        const k = clave.musica(ep.num, esc.escena);
        const ya = ep.musica[esc.escena];
        if (soloFaltantes && ya && ya.ok) { hecho++; this._prog(hecho, escenas.length, 'música'); continue; }

        this._prog(hecho, escenas.length, 'música · escena ' + esc.escena);
        try {
          const r = await api.musica({
            prompt: promptMusica(esc, cfg),
            model: cfg.modeloMusica,
            guardarComo: k,
          }, { intentos: 3, señal: this.señal, aviso: (m) => this._log('escena ' + esc.escena + ': ' + m) });

          await assets.guardar(k, b64toBlob(r.audio, r.mimeType || 'audio/mpeg'),
            { ep: ep.num, escena: esc.escena });
          ep.musica[esc.escena] = {
            ok: true, encargo: esc.encargo, segundos: Math.round(esc.segundos),
            desde: esc.desde, hasta: esc.hasta,
          };
          this._log('música lista: escena ' + esc.escena, 'ok');
        } catch (e) {
          if (e && e.cancelado) return;
          ep.musica[esc.escena] = { ok: false, error: e.message };
          this._log('música escena ' + esc.escena + ': ' + e.message, 'err');
        }
        hecho++;
        this._prog(hecho, escenas.length, 'música');
        if (this.avisos.cambio) this.avisos.cambio();
      }
    });
  }

  /* ── Episodio completo, de principio a fin ────────────────── */

  async producirEpisodio(ep, fases) {
    const f = fases || { voz: true, imagen: true, video: true, musica: true };
    // El orden importa: la voz fija la duración real de cada toma, y de ahí
    // salen los segundos de vídeo y la longitud de cada pieza de música.
    if (f.voz) { await this.generarVoz(ep, true); }
    if (f.imagen) { await this.generarImagenes(ep, true); }
    if (f.video) { await this.generarVideos(ep, true); }
    if (f.musica) { await this.generarMusica(ep, true); }
  }
}

/* ── Utilidades ─────────────────────────────────────────────── */

export function b64toBlob(b64, mime) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: mime || 'application/octet-stream' });
}

/** Une todos los audios de un episodio en un único WAV continuo. */
export async function audioCompleto(ep) {
  const partes = [];
  let rate = 24000;
  for (const t of ep.tomas) {
    const b = await assets.blob(clave.audio(ep.num, t.i));
    if (!b) continue;
    const buf = new Uint8Array(await b.arrayBuffer());
    const ex = extraerPCM(buf, rate);
    rate = ex.rate;
    partes.push(ex.pcm);
  }
  if (!partes.length) return null;
  return crearWav(partes, rate);
}

/** Resumen de estado de un episodio para la interfaz. */
export function estadoEpisodio(ep) {
  const n = ep.tomas ? ep.tomas.length : 0;
  const cuenta = (f) => (ep.tomas || []).filter(f).length;
  const escenas = new Set((ep.tomas || []).map((t) => t.escena)).size;
  const musica = Object.values(ep.musica || {}).filter((m) => m && m.ok).length;
  const segundos = (ep.tomas || []).reduce((a, t) => a + (t.segundos || t.segEstimados || 0), 0);
  return {
    tomas: n,
    dirigido: cuenta((t) => !!t.plano),
    voz: cuenta((t) => t.audio && t.audio.ok),
    imagen: cuenta((t) => t.imagen && t.imagen.ok),
    movimiento: cuenta((t) => t.plano && t.plano.tipo === 'movimiento'),
    video: cuenta((t) => t.video && t.video.ok),
    errores: cuenta((t) => (t.audio && t.audio.ok === false) || (t.imagen && t.imagen.ok === false) ||
      (t.video && t.video.ok === false)),
    escenas,
    musica,
    segundos,
  };
}
