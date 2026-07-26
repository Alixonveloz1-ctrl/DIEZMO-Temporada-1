/* ============================================================
   player.js — sala de proyección
   ============================================================
   Reproduce el episodio tal como quedará montado: la voz manda
   el tiempo, la imagen o el clip se acomodan a ella. Sirve para
   ver el corte antes de exportar nada.
   ============================================================ */

import { assets } from './db.js';
import { clave, claveImagenDe, claveVideoDe } from './pipeline.js';
import { fotogramasCss, planoCamara } from './camara.js';

export class Proyector {
  constructor(nodos) {
    this.img = nodos.img;
    this.vid = nodos.vid;
    this.aud = nodos.aud;
    this.mus = nodos.mus || null;
    this.pie = nodos.pie;
    this.barra = nodos.barra;
    this.info = nodos.info;

    this.ep = null;
    this.orden = [];
    this.pos = 0;
    this.reproduciendo = false;
    this.anim = null;
    this.escenaMus = null;
    this.cache = new Map();

    this.aud.addEventListener('ended', () => this._siguiente());
    this.aud.addEventListener('timeupdate', () => this._pintarBarra());
  }

  async cargar(ep, desde) {
    this.ep = ep;
    this.orden = ep.tomas.filter((t) => t.audio && t.audio.ok);
    this.pos = Math.max(0, Math.min(desde || 0, this.orden.length - 1));
    if (!this.orden.length) {
      this._estado('Este episodio todavía no tiene voz generada.');
      return false;
    }
    await this._montar(this.pos);
    return true;
  }

  async reproducir() {
    if (!this.orden.length) return;
    this.reproduciendo = true;
    try { await this.aud.play(); } catch (e) { this.reproduciendo = false; return; }
    if (!this.vid.hidden) { try { await this.vid.play(); } catch (e) { /* sin clip */ } }
    if (this.anim) this.anim.play();
    if (this.mus && this.mus.src) { try { await this.mus.play(); } catch (e) { /* sin música */ } }
  }

  pausar() {
    this.reproduciendo = false;
    this.aud.pause();
    this.vid.pause();
    if (this.mus) this.mus.pause();
    if (this.anim) this.anim.pause();
  }

  async irA(indice) {
    const k = this.orden.findIndex((t) => t.i === indice);
    if (k < 0) return;
    this.pos = k;
    await this._montar(k);
    if (this.reproduciendo) this.reproducir();
  }

  async _siguiente() {
    if (this.pos + 1 >= this.orden.length) {
      this.reproduciendo = false;
      this._estado('Fin del episodio.');
      return;
    }
    this.pos++;
    await this._montar(this.pos);
    if (this.reproduciendo) this.reproducir();
  }

  /*  La música va por escena, así que solo se cambia de pieza al cambiar de
      escena: reiniciarla en cada toma la cortaría cada ocho segundos. Suena
      por debajo de la voz, que es quien manda.                               */
  async _musicaDe(t) {
    if (!this.mus) return;
    if (this.escenaMus === t.escena) return;
    this.escenaMus = t.escena;
    const url = await assets.url(clave.musica(this.ep.num, t.escena));
    if (!url) { this.mus.pause(); this.mus.removeAttribute('src'); return; }
    this.mus.src = url;
    this.mus.volume = 0.28;
    if (this.reproduciendo) { try { await this.mus.play(); } catch (e) { /* sin música */ } }
  }

  async _urls(t) {
    const k = 'k' + t.i;
    if (this.cache.has(k)) return this.cache.get(k);
    const r = {
      audio: await assets.url(clave.audio(this.ep.num, t.i)),
      imagen: await assets.url(claveImagenDe(this.ep.num, t)),
      video: (t.video && t.video.ok) ? await assets.url(claveVideoDe(this.ep.num, t)) : null,
    };
    this.cache.set(k, r);
    return r;
  }

  async _montar(k) {
    const t = this.orden[k];
    const u = await this._urls(t);

    this.aud.src = u.audio || '';
    await this._musicaDe(t);

    if (u.video) {
      this.vid.hidden = false;
      this.img.hidden = true;
      if (this.vid.src !== u.video) this.vid.src = u.video;
      this.vid.currentTime = 0;
      // Si el clip es más corto que la locución, se queda helado en el último
      // fotograma en vez de repetirse: es lo que hará también el montaje final.
      this.vid.loop = false;
    } else {
      this.vid.hidden = true;
      this.vid.removeAttribute('src');
      this.img.hidden = false;
      if (u.imagen) {
        this.img.src = u.imagen;
        // El movimiento lo eligió el director para ESTA toma. Sale de los mismos
        // números que usará el montaje, así que lo que ves aquí es lo que saldrá.
        const dur = t.segundos || t.segEstimados || 8;
        if (this.anim) { this.anim.cancel(); this.anim = null; }
        const cam = planoCamara(t.plano);
        const pasos = fotogramasCss(t.plano);
        this.img.style.transform = pasos[0].transform;
        if (cam.nombre !== 'cámara fija') {
          this.anim = this.img.animate(pasos,
            { duration: dur * 1000, easing: 'linear', fill: 'forwards' });
        }
      } else {
        this.img.removeAttribute('src');
      }
    }

    if (this.info) {
      const p = t.plano || {};
      this.info.textContent = 'Toma ' + (t.i + 1) + '/' + this.ep.tomas.length +
        ' · escena ' + t.escena + ' · ' + (p.encuadre || '—') +
        (u.video ? ' · clip animado' : ' · ' + planoCamara(p).nombre);
    }
    if (this.pie) this.pie.textContent = t.texto;

    // Precargamos la siguiente para que el salto no se note.
    const sig = this.orden[k + 1];
    if (sig) this._urls(sig);
  }

  _pintarBarra() {
    if (!this.barra || !this.orden.length) return;
    const t = this.orden[this.pos];
    const dentro = this.aud.duration ? this.aud.currentTime / this.aud.duration : 0;
    const pct = ((this.pos + dentro) / this.orden.length) * 100;
    this.barra.style.width = pct.toFixed(2) + '%';
  }

  _estado(txt) {
    if (this.info) this.info.textContent = txt;
  }

  liberar() {
    this.pausar();
    if (this.mus) { this.mus.removeAttribute('src'); this.escenaMus = null; }
    if (this.anim) { this.anim.cancel(); this.anim = null; }
    this.cache.clear();
  }
}
