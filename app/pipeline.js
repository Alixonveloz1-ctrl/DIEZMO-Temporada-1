/* ============================================================
   pipeline.js — motor de generación
   ============================================================
   Una sola cola para las tres fases (voz, fotograma, movimiento).
   Se puede detener y reanudar sin perder lo ya generado: cada
   toma terminada queda escrita en IndexedDB antes de pasar a la
   siguiente.
   ============================================================ */

import { api, generarVideo, bajarClip, b64aBytes, extraerPCM, crearWav, duracionPCM, blobAb64 } from './api.js';
import { assets } from './db.js';
import { nube } from './nube.js';
import { normalizarParaVoz, REEMPLAZOS_BASE } from './texto.js';
import { promptImagen, promptVideo, promptReferencia, promptLugar } from './director.js';
import { variantesDe, vestuarioPara } from './biblia.js';

export const clave = {
  audio: (ep, i) => 'ep' + pad(ep) + '/t' + pad3(i) + '/audio',
  imagen: (ep, i) => 'ep' + pad(ep) + '/t' + pad3(i) + '/img',
  video: (ep, i) => 'ep' + pad(ep) + '/t' + pad3(i) + '/vid',
  refPersonaje: (id, n) => 'ref/personaje/' + id + '/' + n,
  refLugar: (id) => 'ref/lugar/' + id,
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

  async generarReferencias(ids, soloFaltantes) {
    const cfg = this.p.config;
    const objetivo = this.p.elenco.filter((x) => !ids || ids.indexOf(x.id) !== -1);

    return this._correr(async () => {
      let hecho = 0;
      const total = objetivo.reduce((a, p) => a + variantesDe(p).length, 0);
      for (const per of objetivo) {
        per.refs = per.refs || [];
        for (const v of variantesDe(per)) {
          if (this.señal.aborted) return;
          if (soloFaltantes && per.refs.indexOf(clave.refPersonaje(per.id, v.id)) !== -1) {
            hecho++; continue;
          }
          this._prog(hecho, total, per.nombre + ' · ' + v.nombre);
          const prompt = promptReferencia(per, cfg, v);
          try {
            const k = clave.refPersonaje(per.id, v.id);
            const r = await api.imagen({
              prompt,
              model: cfg.modeloImagen,
              aspectRatio: v.cuerpo ? '2:3' : '1:1',
              imageSize: cfg.imageSize,
              guardarComo: k,
            }, { intentos: 3, señal: this.señal, aviso: (m) => this._log(per.nombre + ': ' + m) });

            await assets.guardar(k, b64toBlob(r.image, r.mimeType), { personaje: per.id, variante: v.id });
            if (per.refs.indexOf(k) === -1) per.refs.push(k);
            this._log('referencia lista: ' + per.nombre + ' · ' + v.nombre, 'ok');
          } catch (e) {
            if (e && e.cancelado) return;
            this._log('falló la referencia de ' + per.nombre + ' · ' + v.nombre + ': ' + e.message, 'err');
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

    // Referencias: personajes en cuadro primero, fondo del lugar al final.
    const refs = [];
    for (const id of (plano.personajes || []).slice(0, cfg.maxReferencias)) {
      const per = this.p.elenco.find((p) => p.id === id);
      if (!per || !per.refs || !per.refs.length) continue;
      // La hoja del vestuario que lleva en ESTE episodio; si falta, la primera que haya.
      const kVest = clave.refPersonaje(per.id, vestuarioPara(per, ep.num).id);
      const k = per.refs.indexOf(kVest) !== -1 ? kVest : per.refs[0];
      const b = await assets.blob(k);
      if (b) refs.push({ data: await blobAb64(b), mimeType: b.type || 'image/png' });
    }
    if (refs.length < 4) {
      const lug = this.p.lugares.find((l) => l.id === plano.lugar);
      if (lug && lug.ref) {
        const b = await assets.blob(lug.ref);
        if (b) refs.push({ data: await blobAb64(b), mimeType: b.type || 'image/png' });
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

    const dur = Math.min(8, Math.max(4, Math.round(t.segundos || t.segEstimados || 8)));
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

  /* ── Episodio completo, de principio a fin ────────────────── */

  async producirEpisodio(ep, fases) {
    const f = fases || { voz: true, imagen: true, video: true };
    if (f.voz) { await this.generarVoz(ep, true); }
    if (f.imagen) { await this.generarImagenes(ep, true); }
    if (f.video) { await this.generarVideos(ep, true); }
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
    segundos,
  };
}
