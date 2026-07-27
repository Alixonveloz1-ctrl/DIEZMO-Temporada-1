/* ============================================================
   pipeline.js — motor de generación
   ============================================================
   Una sola cola para las tres fases (voz, fotograma, movimiento).
   Se puede detener y reanudar sin perder lo ya generado: cada
   toma terminada queda escrita en IndexedDB antes de pasar a la
   siguiente.
   ============================================================ */

import { api, generarVideo, generarVozLarga, bajarClip, b64aBytes, extraerPCM, crearWav, duracionPCM, blobAb64, comoReferencia } from './api.js';
import { assets } from './db.js';
import { nube } from './nube.js';
import { normalizarParaVoz, REEMPLAZOS_BASE } from './texto.js';
import { promptImagen, promptVideo, promptReferencia, promptLugar } from './director.js';
import { variantesDe, vestuarioPara } from './biblia.js';
import { duracionVeo } from './veo.js';
import { encargarMusica, promptMusica } from './musica.js';
import {
  promptPortada, promptCartel, repartoDe, CARTELES, FORMATO_PORTADA,
} from './portadas.js';
import { conFirma } from './firma.js';
import {
  cortarEscena, repartirEnBloques, SEGUNDOS_POR_LLAMADA,
  nombreVozChirp, VOZ_CHIRP_DEFECTO, narraEpisodioEntero,
} from './voz.js';

export const clave = {
  audio: (ep, i) => 'ep' + pad(ep) + '/t' + pad3(i) + '/audio',
  imagen: (ep, i) => 'ep' + pad(ep) + '/t' + pad3(i) + '/img',
  video: (ep, i) => 'ep' + pad(ep) + '/t' + pad3(i) + '/vid',
  refPersonaje: (id, n) => 'ref/personaje/' + id + '/' + n,
  refLugar: (id) => 'ref/lugar/' + id,
  musica: (ep, esc) => 'ep' + pad(ep) + '/mus/' + pad3(esc),
  vozEpisodio: (ep) => 'ep' + pad(ep) + '/voz-completa',
  portada: (ep) => 'portada/ep' + pad(ep),
  // El formato va en la clave: un cartel vertical y uno de muro son dos imágenes.
  cartel: (id, formato) => 'cartel/' + id + '-' + String(formato).replace(':', 'x'),
  episodio: (ep) => 'ep' + pad(ep) + '/completo',
};

/*  Una toma puede reutilizar el fotograma de otra: el director pidió el mismo
    plano dos veces y no tiene sentido pagarlo dos veces. Todo el que LEA un
    fotograma o un clip tiene que pasar por aquí, o vería un hueco donde en
    realidad hay una imagen compartida.                                       */
export function claveImagenDe(numEp, t) {
  return (t && t.reusa) || clave.imagen(numEp, t.i);
}
export function claveVideoDe(numEp, t) {
  return (t && t.reusaVideo) || clave.video(numEp, t.i);
}

/*  El PCM viaja como bytes; el reparto por silencios necesita muestras de 16
    bits. Se copia en vez de reinterpretar el búfer porque el desplazamiento
    puede ser impar y Int16Array exige alineación par.                        */
function aInt16(bytes) {
  const n = bytes.length >> 1;
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = (bytes[i * 2] | (bytes[i * 2 + 1] << 8)) << 16 >> 16;
  return out;
}

const kb = (b) => (b.size / 1048576).toFixed(1) + ' MB ' + (b.type || '').replace('image/', '');

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

  async generarVoz(ep, soloFaltantes, indices) {
    const cfg = this.p.config;

    /*  LO MÁS LARGO QUE QUEPA EN UNA LLAMADA, no toma a toma. Pedir la voz
        toma a toma daba 134 llamadas por episodio, y cada una es un narrador
        que no sabe qué se acaba de decir: cambia el tono, y a veces hasta el
        timbre.

        Se pide por escena, que es donde un cambio de tono no molesta —donde
        incluso se agradece—, pero la escena mediana dura dos minutos y medio y
        eso NO CABE en una respuesta del servidor (ver SEGUNDOS_POR_LLAMADA):
        setenta y tres de las setenta y seis escenas de la temporada se pasan.
        Así que la escena se parte en bloques por corte de toma. Salen unas
        veinte llamadas por episodio en vez de 134, y ninguna costura cae a
        mitad de frase.

        Después el audio se reparte entre las tomas por sus silencios, para que
        la imagen siga cambiando en el sitio exacto.                          */
    const porEscena = new Map();
    for (const t of ep.tomas) {
      if (!porEscena.has(t.escena)) porEscena.set(t.escena, []);
      porEscena.get(t.escena).push(t);
    }
    const escenas = [...porEscena.entries()]
      .map(([n, tomas]) => ({ escena: n, tomas }))
      .filter(({ tomas }) => {
        // Regenerar una toma suelta rehace su escena: si no, esa toma volvería
        // a salir con otro tono y se notaría más que antes.
        if (indices) return tomas.some((t) => indices.indexOf(t.i) !== -1);
        return !soloFaltantes || tomas.some((t) => !t.audio || !t.audio.ok);
      });

    return this._correr(async () => {
      /*  Si un bloque no cabe, los siguientes tampoco van a caber: el techo se
          baja para toda la tanda en cuanto el servidor lo dice una vez.      */
      let techo = SEGUNDOS_POR_LLAMADA;

      /*  El plan se arma ENTERO antes de empezar, para poder decir cuántas
          llamadas son. La barra contaba tomas rellenadas y eso se leía como
          134 generaciones cuando en realidad son 24: aquí lo que se paga y lo
          que se espera es la llamada, así que es lo que hay que contar.      */
      const plan = [];
      for (const esc of escenas) {
        for (const tomas of repartirEnBloques(esc.tomas, techo)) {
          plan.push({ escena: esc.escena, tomas, parte: 1, partes: 1 });
        }
      }
      // Cuántas partes tiene cada escena y qué número es cada una. Se recalcula
      // después de cada corte, para que la etiqueta nunca mienta.
      const renumerar = () => {
        const cuantas = new Map();
        for (const b of plan) cuantas.set(b.escena, (cuantas.get(b.escena) || 0) + 1);
        const vistas = new Map();
        for (const b of plan) {
          const n = (vistas.get(b.escena) || 0) + 1;
          vistas.set(b.escena, n);
          b.parte = n;
          b.partes = cuantas.get(b.escena);
        }
      };
      renumerar();

      const tomasTotal = escenas.reduce((a, e) => a + e.tomas.length, 0);
      this._log('voz: ' + plan.length + ' llamadas para ' + tomasTotal + ' tomas de ' +
        escenas.length + ' escenas', 'info');

      let hecho = 0;
      while (hecho < plan.length) {
        if (this.señal.aborted) return;
        const b = plan[hecho];
        const dónde = 'escena ' + b.escena +
          (b.partes > 1 ? ' · parte ' + b.parte + ' de ' + b.partes : '');
        this._prog(hecho, plan.length, 'voz · ' + dónde);

        try {
          await this._unBloqueDeVoz(ep, b.tomas, dónde);
        } catch (e) {
          if (e && e.cancelado) return;
          /*  Demasiado audio para una sola respuesta (413) o más tiempo del
              que el servidor espera (504): no es un fallo de Google, es que se
              pidió de más. Este bloque se sustituye por sus dos mitades —una
              llamada más en el plan— y se reintenta solo.                    */
          if (b.tomas.length > 1 && (e.status === 413 || e.status === 504)) {
            techo = Math.max(10, Math.round(techo / 2));
            const mitad = Math.ceil(b.tomas.length / 2);
            plan.splice(hecho, 1,
              { escena: b.escena, tomas: b.tomas.slice(0, mitad), parte: 1, partes: 1 },
              { escena: b.escena, tomas: b.tomas.slice(mitad), parte: 1, partes: 1 });
            renumerar();
            this._log(dónde + ': era demasiado para una llamada; se parte en dos', 'aviso');
            continue;
          }
          for (const t of b.tomas) t.audio = { ok: false, error: e.message };
          this._log('voz ' + dónde + ': ' + e.message, 'err');
        }

        hecho++;
        this._prog(hecho, plan.length, 'voz');
        if (this.avisos.cambio) this.avisos.cambio();
      }
    });
  }

  /** Una llamada de voz: pide el bloque entero y lo reparte entre sus tomas. */
  async _unBloqueDeVoz(ep, tomas, dónde) {
    const cfg = this.p.config;

    const piezas = tomas.map((t) => {
      let texto = t.texto;
      if (cfg.anunciarTitulo && t.i === 0) {
        texto = 'DIEZMO. Episodio ' + ep.num + ': ' + ep.titulo + '.\n\n' + texto;
      }
      if (cfg.normalizarVoz) texto = normalizarParaVoz(texto, cfg.reemplazos || REEMPLAZOS_BASE);
      return texto.trim();
    });
    if (!piezas.some((p) => p)) return;

    const r = await api.tts({
      text: piezas.filter(Boolean).join('\n\n'),
      voice: cfg.voz,
      model: cfg.modeloTts,
      styleInstruction: cfg.instruccionVoz,
      temperature: cfg.temperaturaVoz,
      languageCode: cfg.idioma || undefined,
      seed: cfg.semillaVoz === '' ? undefined : Number(cfg.semillaVoz),
    }, {
      intentos: 3,
      // Un 504 aquí no es mala suerte: es que el bloque era largo. Reintentarlo
      // igual son otros sesenta segundos tirados. Se parte y ya.
      finales: [504],
      señal: this.señal,
      aviso: (m) => this._log(dónde + ': ' + m),
    });

    const ex = extraerPCM(b64aBytes(r.audio), r.sampleRate || 24000);
    const muestras = aInt16(ex.pcm);
    // El peso de cada toma es su texto: es lo que predice cuánto dura.
    const pesos = piezas.map((p) => Math.max(1, p.length));
    const tramos = cortarEscena(muestras, ex.rate, pesos);

    for (let k = 0; k < tomas.length; k++) {
      const t = tomas[k];
      const trozo = ex.pcm.subarray(tramos[k].desde * 2, tramos[k].hasta * 2);
      const partes = [trozo];
      if (t.corteEscena && cfg.silencioEscena > 0) {
        partes.push(new Uint8Array(Math.round(ex.rate * cfg.silencioEscena) * 2));
      }
      const blob = crearWav(partes, ex.rate);
      const dur = partes.reduce((a, x) => a + x.length, 0) / 2 / ex.rate;

      const kAudio = clave.audio(ep.num, t.i);
      await assets.guardar(kAudio, blob, { ep: ep.num, toma: t.i, dur });
      if (nube.disponible) {
        try { await nube.subir(kAudio, await blobAb64(blob), 'audio/wav'); }
        catch (e) { this._log('la voz de la toma ' + (t.i + 1) + ' no se pudo subir al bucket', 'aviso'); }
      }
      t.audio = { ok: true, dur: +dur.toFixed(2), rate: ex.rate };
      t.segundos = +dur.toFixed(2);
    }

    this._log('voz lista: ' + dónde + ' · ' + tomas.length + ' tomas · ' +
      (muestras.length / ex.rate).toFixed(1) + ' s en una sola locución', 'ok');
  }

  /*  UN SOLO SITIO decide qué motor narra, para que no haya que repetir la
      condición en cada botón. Con la locución por episodio no existe «solo
      las que faltan» ni «solo esta toma»: el episodio es una pieza entera, y
      rehacer una toma suelta es rehacer la locución.                        */
  async generarVozDe(ep, soloFaltantes, indices) {
    if (!narraEpisodioEntero(this.p.config)) return this.generarVoz(ep, soloFaltantes, indices);
    if (soloFaltantes && (ep.tomas || []).every((t) => t.audio && t.audio.ok)) return;
    return this.generarVozLarga(ep);
  }

  /* ── Voz larga: el episodio entero en una sola locución ───── */

  /*  Una llamada por episodio. No hay costuras que disimular porque no hay
      costuras: es una única toma de quince minutos, y después se reparte
      entre las 134 tomas por los silencios que el narrador ya hizo.        */
  async generarVozLarga(ep) {
    const cfg = this.p.config;

    return this._correr(async () => {
      const piezas = ep.tomas.map((t) => {
        let texto = t.texto;
        if (cfg.anunciarTitulo && t.i === 0) {
          texto = 'DIEZMO. Episodio ' + ep.num + ': ' + ep.titulo + '.\n\n' + texto;
        }
        if (cfg.normalizarVoz) texto = normalizarParaVoz(texto, cfg.reemplazos || REEMPLAZOS_BASE);
        return texto.trim();
      });
      const texto = piezas.filter(Boolean).join('\n\n');
      if (!texto) { this._log('el episodio no tiene texto que narrar', 'err'); return; }

      /*  Long Audio Synthesis admite un mega de entrada. El episodio más
          largo de la temporada no llega a veinte mil caracteres, así que
          nunca se roza; pero si algún día se rozara, más vale decirlo.     */
      if (texto.length > 900000) {
        this._log('el episodio pasa del millón de caracteres que admite una locución', 'err');
        return;
      }

      this._prog(0, 1, 'voz · narrando el episodio entero');
      this._log('voz: una sola locución para las ' + ep.tomas.length + ' tomas · ' +
        texto.length + ' caracteres · voz ' + nombreVozChirp(cfg.vozChirp) +
        ' a ' + Number(cfg.velocidadVoz).toFixed(2) + 'x', 'info');

      let ref;
      try {
        ref = await generarVozLarga({
          text: texto,
          voice: cfg.vozChirp || VOZ_CHIRP_DEFECTO,
          languageCode: cfg.idioma || 'es-US',
          speakingRate: cfg.velocidadVoz,
          clave: clave.vozEpisodio(ep.num),
        }, {
          señal: this.señal,
          aviso: (m) => this._prog(0, 1, 'voz · ' + m),
        });
      } catch (e) {
        if (e && e.cancelado) return;
        for (const t of ep.tomas) t.audio = { ok: false, error: e.message };
        this._log('voz: ' + e.message, 'err');
        return;
      }

      this._prog(0, 1, 'voz · trayendo la locución del bucket');
      const blob = await bajarClip(ref, this.señal);
      const ex = extraerPCM(new Uint8Array(await blob.arrayBuffer()), 24000);
      const segundos = ex.pcm.length / 2 / ex.rate;
      this._log('locución lista: ' + (segundos / 60).toFixed(1) + ' min de un tirón', 'ok');

      this._prog(0, 1, 'voz · repartiendo entre las tomas');
      const muestras = aInt16(ex.pcm);
      // El peso de cada toma es su texto: es lo que predice cuánto dura.
      const pesos = piezas.map((p) => Math.max(1, p.length));
      const tramos = cortarEscena(muestras, ex.rate, pesos);

      for (let k = 0; k < ep.tomas.length; k++) {
        if (this.señal.aborted) return;
        const t = ep.tomas[k];
        this._prog(k, ep.tomas.length, 'voz · guardando toma ' + (k + 1));
        const trozo = ex.pcm.subarray(tramos[k].desde * 2, tramos[k].hasta * 2);
        const partes = [trozo];
        if (t.corteEscena && cfg.silencioEscena > 0) {
          partes.push(new Uint8Array(Math.round(ex.rate * cfg.silencioEscena) * 2));
        }
        const wav = crearWav(partes, ex.rate);
        const dur = partes.reduce((a, x) => a + x.length, 0) / 2 / ex.rate;

        const kAudio = clave.audio(ep.num, t.i);
        await assets.guardar(kAudio, wav, { ep: ep.num, toma: t.i, dur });
        if (nube.disponible) {
          try { await nube.subir(kAudio, await blobAb64(wav), 'audio/wav'); }
          catch (e) { this._log('la voz de la toma ' + (t.i + 1) + ' no se pudo subir al bucket', 'aviso'); }
        }
        t.audio = { ok: true, dur: +dur.toFixed(2), rate: ex.rate };
        t.segundos = +dur.toFixed(2);
      }

      this._prog(ep.tomas.length, ep.tomas.length, 'voz');
      if (this.avisos.cambio) this.avisos.cambio();
      this._log('voz repartida entre las ' + ep.tomas.length + ' tomas', 'ok');
    });
  }

  /* ── Portadas y carteles ──────────────────────────────────── */

  /*  Una portada con la cara equivocada es peor que ninguna: es lo primero que
      ve quien no conoce la serie. Así que van con las hojas de referencia
      adjuntas, igual que los fotogramas, y si un personaje no tiene hoja se
      dice en vez de inventarle una cara.                                     */
  async _refsDe(ids) {
    const refs = [];
    const sinCara = [];
    for (const id of ids) {
      const per = this.p.elenco.find((x) => x.id === id);
      if (!per) continue;
      const k = (per.refs || []).find((r) => /\/rostro$/.test(r)) || (per.refs || [])[0];
      const b = k ? await assets.blob(k) : null;
      if (!b) { sinCara.push(per.nombre); continue; }
      refs.push(await comoReferencia(b));
    }
    return { refs, sinCara };
  }

  async _unaPortada(clave_, prompt, ids, formato, quién) {
    const cfg = this.p.config;
    const { refs, sinCara } = await this._refsDe(ids || []);
    if (sinCara.length) {
      this._log(quién + ': falta la hoja de ' + sinCara.join(', ') +
        '; genérala antes o saldrá otra cara', 'aviso');
    }
    const r = await api.imagen({
      prompt,
      images: refs,
      model: cfg.modeloImagen,
      aspectRatio: formato,
      imageSize: cfg.imageSize,
      guardarComo: clave_,
    }, { intentos: 4, señal: this.señal, aviso: (m) => this._log(quién + ': ' + m) });

    /*  La firma se estampa aquí, no se le pide al modelo: un nombre de canal
        es letra pequeña, y la letra pequeña es justo la que sale deforme.
        Dibujada por el navegador sale nítida y siempre en el mismo sitio.  */
    let blob = b64toBlob(r.image, r.mimeType);
    const firma = cfg.firmaActiva === false ? '' : (cfg.firma || '');
    if (firma) blob = await conFirma(blob, firma);

    await assets.guardar(clave_, blob, { portada: true, formato, firma: !!firma });
    if (nube.disponible) {
      /*  subir() devuelve false cuando el bucket rechaza sin lanzar: ignorar el
          booleano dejaba la portada solo en el navegador y nadie se enteraba.
          Y el aviso tiene que decir POR QUÉ, o no hay nada que corregir.     */
      try {
        const ok = await nube.subir(clave_, await blobAb64(blob), blob.type || 'image/png');
        if (!ok) this._log(quién + ': el bucket rechazó el archivo (' + kb(blob) + ')', 'aviso');
      } catch (e) {
        this._log(quién + ': no se pudo subir al bucket (' + kb(blob) + '): ' + e.message, 'aviso');
      }
    }
    return { ok: true, formato, firma: !!firma, ts: Date.now() };
  }

  /** Portadas de episodio. Sin lista, las hace todas las que falten. */
  async generarPortadas(nums, formato) {
    const cfg = this.p.config;
    const ctx = { estilo: cfg.estilo, calidad: cfg.calidad, negativo: cfg.negativo };
    const eps = this.p.episodios.filter((e) => !nums || nums.indexOf(e.num) !== -1);

    return this._correr(async () => {
      this.p.portadas = this.p.portadas || {};
      let hecho = 0;
      for (const ep of eps) {
        if (this.señal.aborted) return;
        const quién = 'portada del episodio ' + ep.num;
        this._prog(hecho, eps.length, quién);
        try {
          const ids = repartoDe(ep, 2);
          const personajes = ids.map((id) => this.p.elenco.find((x) => x.id === id)).filter(Boolean);
          const prompt = promptPortada(ep, ctx, personajes, true);
          this.p.portadas[ep.num] = await this._unaPortada(
            clave.portada(ep.num), prompt, ids, formato || FORMATO_PORTADA, quién);
          this._log(quién + ': lista', 'ok');
        } catch (e) {
          if (e && e.cancelado) return;
          this.p.portadas[ep.num] = { ok: false, error: e.message };
          this._log(quién + ': ' + e.message, 'err');
        }
        hecho++;
        this._prog(hecho, eps.length, 'portadas');
        if (this.avisos.cambio) this.avisos.cambio();
      }
    });
  }

  /** Carteles de la serie, para anunciarla antes de que exista. */
  async generarCarteles(ids, formato) {
    const cfg = this.p.config;
    const ctx = { estilo: cfg.estilo, calidad: cfg.calidad, negativo: cfg.negativo };
    const lista = CARTELES.filter((c) => !ids || ids.indexOf(c.id) !== -1);

    return this._correr(async () => {
      this.p.carteles = this.p.carteles || {};
      let hecho = 0;
      for (const c of lista) {
        if (this.señal.aborted) return;
        const quién = 'cartel «' + c.nombre + '»';
        this._prog(hecho, lista.length, quién);
        try {
          const personajes = c.reparto
            .map((id) => this.p.elenco.find((x) => x.id === id)).filter(Boolean);
          const prompt = promptCartel(c, ctx, personajes, true);
          this.p.carteles[c.id] = await this._unaPortada(
            clave.cartel(c.id, formato || FORMATO_PORTADA), prompt, c.reparto,
            formato || FORMATO_PORTADA, quién);
          this._log(quién + ': listo', 'ok');
        } catch (e) {
          if (e && e.cancelado) return;
          this.p.carteles[c.id] = { ok: false, error: e.message };
          this._log(quién + ': ' + e.message, 'err');
        }
        hecho++;
        this._prog(hecho, lista.length, 'carteles');
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

    // Este plano ya existe en otra toma: se apunta a ella y no se gasta nada.
    if (t.reusa) {
      const prestado = await assets.blob(t.reusa);
      const deDonde = (String(t.reusa).match(/^ep(\d+)/) || [])[1];
      t.imagen = prestado
        ? { ok: true, reusada: t.reusa }
        : { ok: false, error: 'reutiliza un plano del episodio ' + (deDonde || '?') +
            ' que aún no está generado: genera antes ese episodio' };
      return;
    }

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
    if (t.reusaVideo) {
      const prestado = await assets.blob(t.reusaVideo);
      const deDonde = (String(t.reusaVideo).match(/^ep(\d+)/) || [])[1];
      t.video = prestado
        ? { ok: true, reusada: t.reusaVideo, local: true }
        : { ok: false, error: 'reutiliza un clip del episodio ' + (deDonde || '?') +
            ' que aún no está generado: genera antes ese episodio' };
      return;
    }
    const img = await assets.blob(claveImagenDe(ep.num, t));
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
        const kVid = clave.video(ep.num, t.i);
        await assets.guardar(kVid, b64toBlob(r.video, r.mimeType || 'video/mp4'),
          { ep: ep.num, toma: t.i });
        // Veo lo devolvió en línea, así que nadie lo ha archivado todavía.
        if (nube.disponible) {
          try { await nube.subir(kVid, r.video, r.mimeType || 'video/mp4'); }
          catch (e) { this._log('el clip de la toma ' + (t.i + 1) + ' no se pudo subir al bucket', 'aviso'); }
        }
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

  async generarMusica(ep, soloFaltantes, escenas) {
    const cfg = this.p.config;
    return this._correr(async () => {
      this._prog(0, 1, 'encargando la música del episodio');
      let todas;
      try {
        todas = await encargarMusica(ep, cfg, {
          señal: this.señal, aviso: (m) => this._log('música: ' + m),
        });
      } catch (e) {
        if (e && e.cancelado) return;
        this._log('no se pudo preparar la música: ' + e.message, 'err');
        return;
      }

      ep.musica = ep.musica || {};
      let hecho = 0;
      const lista = escenas ? todas.filter((e) => escenas.indexOf(e.escena) !== -1) : todas;
      for (const esc of lista) {
        if (this.señal.aborted) return;
        const k = clave.musica(ep.num, esc.escena);
        const ya = ep.musica[esc.escena];
        if (soloFaltantes && ya && ya.ok) { hecho++; this._prog(hecho, lista.length, 'música'); continue; }

        this._prog(hecho, lista.length, 'música · escena ' + esc.escena);
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
        this._prog(hecho, lista.length, 'música');
        if (this.avisos.cambio) this.avisos.cambio();
      }
    });
  }

  /* ── Episodio completo, de principio a fin ────────────────── */

  async producirEpisodio(ep, fases) {
    const f = fases || { voz: true, imagen: true, video: true, musica: true };
    // El orden importa: la voz fija la duración real de cada toma, y de ahí
    // salen los segundos de vídeo y la longitud de cada pieza de música.
    if (f.voz) { await this.generarVozDe(ep, true); }
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
