/* ============================================================
   voz.js — tonos de narración ya calibrados
   ============================================================
   Ajustar una voz a mano —temperatura, semilla, instrucción de
   estilo— es probar a ciegas. Aquí van tonos cerrados, cada uno
   con su voz, su temperatura y su instrucción, listos para usar.

   Las cifras salen de medir una narración de referencia que el
   usuario dio por buena: tono de fondo en torno a noventa hercios
   (voz masculina grave), cinco sílabas por segundo —unas ciento
   cincuenta palabras por minuto—, pausas cortas de un cuarto de
   segundo, un cuarto del tiempo en silencio, y una dinámica
   contenida de cinco decibelios. Ni lenta, ni acelerada, ni
   teatral.
   ============================================================ */

/*  La instrucción es lo que de verdad manda en Gemini TTS: la voz elegida
    pone el timbre, pero el carácter lo pone este texto. Por eso todos los
    tonos describen el MISMO ritmo medido, y cambian solo en actitud.       */

const RITMO =
  'Ritmo: unas ciento cincuenta palabras por minuto, que es un paso vivo pero ' +
  'cómodo. Ni arrastres las frases ni las atropelles. Pausas breves, de un ' +
  'cuarto de segundo, en las comas y los puntos; nunca silencios largos. ' +
  'Volumen parejo de principio a fin, sin subidas ni caídas bruscas.';

const COMUN =
  'Eres el narrador de un anime seinen de ciencia ficción oscura. Voz masculina ' +
  'grave. Hablas en español neutro latinoamericano, articulando bien cada ' +
  'palabra. No interpretas a los personajes ni pones voces: narras. ' + RITMO;

export const TONOS = [
  {
    id: 'narrador',
    nombre: 'Narrador de anime — el de la referencia',
    resumen: 'Grave, paso vivo, sobrio. El que suena como el ejemplo que diste.',
    voz: 'Charon',
    temperatura: 0.75,
    instruccion: COMUN + ' Tono grave y sereno, con la seguridad de quien ya ' +
      'sabe cómo termina la historia. Cuenta lo terrible sin levantar la voz: el ' +
      'peso está en lo que dices, no en cómo lo adornas. Inflexión moderada, ' +
      'suficiente para que no suene plano, lejos de lo teatral.',
  },
  {
    id: 'informe',
    nombre: 'Informe institucional',
    resumen: 'Más frío y neutro. Para los episodios de burocracia y cifras.',
    voz: 'Rasalgethi',
    temperatura: 0.6,
    instruccion: COMUN + ' Tono neutro y profesional, como quien lee un informe ' +
      'oficial en voz alta. Sin emoción aparente, sin énfasis dramático. La ' +
      'frialdad es el efecto: que el horror lo ponga el contenido.',
  },
  {
    id: 'grave',
    nombre: 'Grave y áspero',
    resumen: 'Más profundo y con textura. Para los tramos más duros.',
    voz: 'Algenib',
    temperatura: 0.8,
    instruccion: COMUN + ' Voz especialmente profunda, con algo de aspereza. ' +
      'Grave y contenida, casi confidencial, sin llegar a susurrar. Deja que las ' +
      'frases caigan con peso, pero sin alargarlas.',
  },
  {
    id: 'tenso',
    nombre: 'Tenso',
    resumen: 'Firme y algo más urgente, sin acelerar. Para escenas de presión.',
    voz: 'Orus',
    temperatura: 0.85,
    instruccion: COMUN + ' Tono firme y alerta, con tensión contenida por debajo. ' +
      'Mantén exactamente el mismo ritmo: la urgencia se nota en la firmeza de la ' +
      'voz, no en la velocidad. Nunca grites ni te aceleres.',
  },
  {
    id: 'cercano',
    nombre: 'Cercano',
    resumen: 'Más humano y templado. Para los momentos íntimos entre personajes.',
    voz: 'Umbriel',
    temperatura: 0.8,
    instruccion: COMUN + ' Tono templado y humano, como quien cuenta algo que le ' +
      'tocó de cerca. Cálido sin ser blando, cercano sin perder la sobriedad.',
  },
];

export const TONO_POR_DEFECTO = 'narrador';

export function tonoPorId(id) {
  return TONOS.find((t) => t.id === id) || TONOS[0];
}

/** Los tres ajustes que define un tono, para volcarlos en la configuración. */
export function aplicarTono(config, id) {
  const t = tonoPorId(id);
  config.tono = t.id;
  config.voz = t.voz;
  config.temperaturaVoz = t.temperatura;
  config.instruccionVoz = t.instruccion;
  return t;
}

/** ¿La configuración actual sigue coincidiendo con su tono, o se tocó a mano? */
export function coincideConTono(config) {
  if (!config || !config.tono) return false;
  const t = tonoPorId(config.tono);
  return config.voz === t.voz &&
    Math.abs(Number(config.temperaturaVoz) - t.temperatura) < 0.001 &&
    String(config.instruccionVoz || '').trim() === t.instruccion.trim();
}
