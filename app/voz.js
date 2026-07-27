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
    /*  Lo que molesta de Gemini es que sobreactúa, y eso SÍ se puede corregir:
        su carácter lo pone la instrucción. Este tono le pide expresamente que
        no actúe. Queda entre la constancia de Chirp —que no interpreta nada
        porque no sabe— y el narrador de tráiler, que era lo que sobraba.    */
    id: 'sobrio',
    nombre: 'Sobrio — expresivo sin actuar',
    resumen: 'La calidad de Gemini sin el énfasis. El punto medio con Chirp.',
    voz: 'Charon',
    temperatura: 0.45,
    instruccion: COMUN + ' Tono contenido y adulto, con la inflexión justa para que no ' +
      'suene plano y ni una gota más. NO ACTÚES: no dramatices, no subrayes las palabras ' +
      'importantes, no bajes la voz en lo confidencial ni la levantes en lo grave. Cuenta ' +
      'los hechos como quien los sabe de primera mano y no necesita convencer a nadie. ' +
      'Si dudas entre dos lecturas, elige siempre la más sobria.',
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

/* ── El otro motor: una locución por episodio ───────────────── */

/*  Gemini TTS actúa, pero cada llamada es una actuación NUEVA: el timbre lo
    fija la voz elegida y el registro se vuelve a sortear. En un episodio de
    quince minutos eso se oye como varios narradores. Y no se puede pedir
    entero, porque su campo de texto admite 4.000 bytes —unos cuatro minutos.

    Chirp 3: HD, con Long Audio Synthesis, hace el episodio entero de una vez:
    un mega de texto por llamada, el WAV escrito directamente en el bucket y
    el mismo narrador de principio a fin. Lee con menos rango dramático, pero
    para doce episodios narrados por la misma persona la constancia vale más.

    Son las mismas ocho personalidades que Gemini, con los mismos nombres.   */
export const VOCES_CHIRP = [
  ['es-US-Chirp3-HD-Charon', 'Charon — grave (la que ya usabas)'],
  ['es-US-Chirp3-HD-Orus', 'Orus — firme, algo más tensa'],
  ['es-US-Chirp3-HD-Fenrir', 'Fenrir — más áspera y rotunda'],
  ['es-US-Chirp3-HD-Puck', 'Puck — más clara y ligera'],
];

export const VOZ_CHIRP_DEFECTO = 'es-US-Chirp3-HD-Charon';

/*  1,00 es la velocidad NATIVA, y es la que suena bien. Google documenta que
    las voces Chirp 3: HD no admiten el parámetro de velocidad; al mandarlo
    igualmente, el audio no se genera más rápido sino que se estira después, y
    eso suena metálico y hueco —«como un micrófono mal configurado»—. El mando
    sigue ahí porque a veces compensa, pero por defecto no se toca.           */
export const VELOCIDAD_DEFECTO = 1;
export const VELOCIDAD_MIN = 0.25;
export const VELOCIDAD_MAX = 2;

/*  ¿Se narra el episodio de una vez, o por bloques? UNA sola definición: si la
    comparación se escribe suelta en cada botón, tarde o temprano uno se queda
    con el motor antiguo y nadie se entera hasta oírlo.                       */
export function narraEpisodioEntero(config) {
  return !config || config.motorVoz !== 'gemini';
}

export function nombreVozChirp(id) {
  const v = VOCES_CHIRP.find((x) => x[0] === id);
  return v ? v[1].split(' — ')[0] : String(id || '').split('-').pop();
}

/*  La semilla fija el muestreo del modelo. Vacía significa aleatoria, y con una
    llamada por escena eso son setenta y seis sorteos distintos en la temporada.
    Va dentro del tono porque no es una decisión del usuario: no hay un número
    «mejor» que otro, solo importa que no cambie. Si un número concreto no
    gusta, se cambia por otro y se rehace la voz.                              */
export const SEMILLA_FIJA = 20250726;

/*  CUÁNTA VOZ CABE EN UNA LLAMADA.

    La escena entera de una vez era lo ideal para el tono, pero no cabe: las
    escenas de DIEZMO duran de 44 s a 5 min 24 s, con dos minutos y medio de
    mediana, y el servidor pone dos techos que no dependen de Google.

    · El tamaño. Una respuesta de Vercel no puede pasar de 4,5 MB y el audio
      viaja en base64: a 24 kHz y 16 bits son 64 KB de texto por segundo
      hablado. Son unos setenta segundos de voz por respuesta, como mucho.
      Setenta y tres de las setenta y seis escenas de la temporada los pasan.
    · El tiempo. La función se corta al minuto de ejecución, y generar habla
      tarda una fracción del tiempo que dura: cuanto más audio, más se acerca.

    Cuarenta y cinco segundos dejan holgados los dos. La escena se parte en
    bloques SIEMPRE por corte de toma, nunca a mitad de frase, y todos los
    bloques de una escena van con la misma voz, la misma semilla y la misma
    instrucción: la costura cae donde el texto ya hacía una pausa.            */
export const SEGUNDOS_POR_LLAMADA = 45;

/*  Por debajo de esto un bloque no compensa: es una llamada y una costura para
    casi nada. Se rellena con tomas del bloque de delante.                     */
const MINIMO_POR_LLAMADA = 12;

/**
 * Reparte las tomas de una escena en bloques que quepan en una llamada.
 * Los bloques salen parejos —no uno grande y uno de dos segundos—, y ninguna
 * toma se parte por la mitad.
 *
 * @param {Array} tomas          tomas de la escena, en orden
 * @param {number} segundosMax   audio máximo por bloque, en segundos
 * @returns {Array<Array>} bloques de tomas
 */
export function repartirEnBloques(tomas, segundosMax) {
  if (!tomas || !tomas.length) return [];
  if (tomas.length === 1) return [tomas.slice()];
  const dur = tomas.map((t) => Math.max(0.5, t.segEstimados || (t.texto || '').length / 16));
  const total = dur.reduce((a, b) => a + b, 0);
  const max = Math.max(8, segundosMax || SEGUNDOS_POR_LLAMADA);

  const n = Math.max(1, Math.min(tomas.length, Math.ceil(total / max)));
  if (n === 1) return [tomas.slice()];
  const objetivo = total / n;      // reparto parejo en vez de llenar hasta el borde

  const bloques = [];
  let actual = [];
  let acc = 0;
  for (let k = 0; k < tomas.length; k++) {
    const quedan = tomas.length - k;         // tomas por colocar, contando esta
    const faltan = n - bloques.length;       // bloques por cerrar, contando el actual
    // El tope es tope: ningún bloque lo pasa, ni siquiera el último, que es el
    // que se queda con el resto y era por donde se escapaba.
    const tope = actual.length && acc + dur[k] > max;
    // Y dentro del tope, se reparte parejo en vez de llenar hasta el borde y
    // dejar un último bloque de dos segundos.
    const parejo = actual.length && faltan > 1 && quedan >= faltan && acc + dur[k] / 2 > objetivo;
    if (tope || parejo) {
      bloques.push(actual);
      actual = [];
      acc = 0;
    }
    actual.push(tomas[k]);
    acc += dur[k];
  }
  if (actual.length) bloques.push(actual);

  /*  Aun así el tope duro puede dejar una cola de cinco segundos suelta, y una
      llamada entera para cinco segundos es una costura que no hacía falta. Se
      le pasan tomas del bloque de delante mientras quepan y allí sobren.     */
  const dondeEsta = new Map(tomas.map((t, k) => [t, k]));
  const largo = (b) => b.reduce((a, t) => a + dur[dondeEsta.get(t)], 0);
  for (let b = 1; b < bloques.length; b++) {
    while (largo(bloques[b]) < MINIMO_POR_LLAMADA && bloques[b - 1].length > 1) {
      const cede = bloques[b - 1][bloques[b - 1].length - 1];
      if (largo(bloques[b]) + dur[dondeEsta.get(cede)] > max) break;
      bloques[b].unshift(bloques[b - 1].pop());
    }
  }
  return bloques;
}

export function tonoPorId(id) {
  return TONOS.find((t) => t.id === id) || TONOS[0];
}

/** Los tres ajustes que define un tono, para volcarlos en la configuración. */
export function aplicarTono(config, id) {
  const t = tonoPorId(id);
  config.tono = t.id;
  config.voz = t.voz;
  /*  La semilla solo se pone si no había ninguna: cambiar de tono no tiene por
      qué tirar una semilla que el usuario ya estaba usando a gusto.
      null va aparte porque Number(null) es 0, que es finito: la guarda lo daba
      por válido y se acababa mandando semilla 0 en vez de la fija.           */
  if (config.semillaVoz === '' || config.semillaVoz === null ||
      config.semillaVoz === undefined || !Number.isFinite(Number(config.semillaVoz))) {
    config.semillaVoz = SEMILLA_FIJA;
  }
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

/* ── Cortar una escena en sus tomas ─────────────────────────── */

/*  Generar la voz escena a escena arregla el tono, pero deja un problema: el
    audio llega de una pieza y la herramienta necesita saber dónde empieza cada
    toma para que la imagen cambie a tiempo.

    Se resuelve por los silencios. Se sabe cuánto texto tiene cada toma, así
    que se sabe en qué segundo DEBERÍA caer cada corte; alrededor de esa
    posición se busca el silencio real más largo y se corta ahí. Encaja porque
    el segmentador ya corta las tomas en final de frase, que es justo donde el
    narrador hace una pausa.                                                   */

/** Energía por ventana corta, que es la forma barata de ver dónde hay voz. */
function envolvente(pcm, muestrasPorVentana) {
  const n = Math.floor(pcm.length / muestrasPorVentana);
  const env = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let suma = 0;
    const base = k * muestrasPorVentana;
    for (let i = 0; i < muestrasPorVentana; i++) {
      const v = pcm[base + i] / 32768;
      suma += v * v;
    }
    env[k] = Math.sqrt(suma / muestrasPorVentana);
  }
  return env;
}

function percentil(arr, p) {
  const o = Array.from(arr).sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.max(0, Math.floor(o.length * p)))];
}

/**
 * Reparte una escena entre sus tomas.
 *
 * @param {Int16Array} pcm    audio de la escena entera
 * @param {number} rate       muestras por segundo
 * @param {number[]} pesos    longitud de texto de cada toma, en el mismo orden
 * @returns {Array<{desde:number, hasta:number}>} índices de muestra por toma
 */
/** Todos los silencios de la escena, con su centro y su longitud. */
function silencios(env, umbral, minVentanas) {
  const out = [];
  let ini = -1;
  for (let v = 0; v <= env.length; v++) {
    const callado = v < env.length && env[v] < umbral;
    if (callado && ini < 0) ini = v;
    if (!callado && ini >= 0) {
      const largo = v - ini;
      if (largo >= minVentanas) out.push({ centro: (ini + v) / 2, largo });
      ini = -1;
    }
  }
  return out;
}

/**
 * Reparte una escena entre sus tomas.
 *
 * La primera versión buscaba cada corte por separado, cerca de donde el texto
 * decía que debía estar. Falla en cuanto una toma se lee más despacio que otra:
 * el error se arrastra y ya no encuentra el silencio bueno. Ahora se localizan
 * TODOS los silencios de la escena y se elige de una vez la combinación que
 * mejor encaja con las proporciones esperadas. Un desajuste local lo corrigen
 * los vecinos.
 *
 * @param {Int16Array} pcm    audio de la escena entera
 * @param {number} rate       muestras por segundo
 * @param {number[]} pesos    longitud de texto de cada toma, en el mismo orden
 * @returns {Array<{desde:number, hasta:number}>} índices de muestra por toma
 */
export function cortarEscena(pcm, rate, pesos, opciones) {
  const o = opciones || {};
  const n = pesos.length;
  if (n <= 1) return [{ desde: 0, hasta: pcm.length }];

  const vent = Math.max(1, Math.round(rate * 0.02));       // ventanas de 20 ms
  const env = envolvente(pcm, vent);
  // Umbral de silencio relativo al propio audio: una fracción de la energía
  // típica de la voz deja fuera el ruido de fondo sin comerse las consonantes.
  const umbral = Math.max(1e-4, percentil(env, 0.6) * (o.umbral || 0.125));

  const total = pesos.reduce((a, b) => a + b, 0) || 1;
  const esperados = [];
  let acumulado = 0;
  for (let k = 0; k < n - 1; k++) {
    acumulado += pesos[k];
    esperados.push((acumulado / total) * pcm.length);
  }

  // Silencios de al menos 60 ms; si salen pocos, se rebaja la exigencia.
  let cand = silencios(env, umbral, 3);
  if (cand.length < n - 1) cand = silencios(env, umbral, 2);
  if (cand.length < n - 1) cand = silencios(env, umbral * 2, 2);
  if (cand.length < n - 1) {
    // Sin silencios suficientes no hay nada que buscar: reparto proporcional.
    const cortes = [0].concat(esperados.map(Math.round), [pcm.length]);
    return cortes.slice(0, -1).map((d, k) => ({ desde: d, hasta: cortes[k + 1] }));
  }

  const pos = cand.map((c) => c.centro * vent);
  /*  El premio por silencio largo se mide CONTRA LA PROPIA ESCENA. Un narrador
      pausa en cada coma, así que hay muchos más silencios que cortes; lo que
      distingue un final de toma es que su pausa es notablemente más larga que
      la típica de ese audio. En valor absoluto no se distinguen; en relación a
      la mediana, sí.                                                          */
  const medianaLargo = Math.max(1, percentil(cand.map((c) => c.largo), 0.5));
  const premio = cand.map((c) => Math.min(3, c.largo / medianaLargo) * (o.premio || 0.55));
  const m = pos.length;
  const INF = Infinity;

  /*  Programación dinámica: coste[k][j] es el mejor coste posible si el corte
      número k cae en el silencio j. El coste de un corte es lo que se desvía
      de donde el texto decía, menos un premio por ser un silencio largo —los
      largos son finales de frase de verdad, no respiraciones.               */
  const coste = [], viene = [];
  for (let k = 0; k < n - 1; k++) { coste.push(new Float64Array(m).fill(INF)); viene.push(new Int32Array(m).fill(-1)); }

  /*  Desviarse medio segundo en una toma de cuatro es mucho más grave que en
      una de trece, así que el error se mide EN RELACIÓN a lo que dura la toma,
      no en segundos absolutos. Si no, en las escenas largas los cortes de las
      tomas cortas se sacrifican para cuadrar los de las largas.              */
  const duraciones = pesos.map((w) => Math.max(1.5, (w / total) * pcm.length / rate));
  const desvio = (j, k) => {
    const d = (pos[j] - esperados[k]) / rate / duraciones[k];
    return d * d - premio[j];
  };

  for (let j = 0; j < m; j++) coste[0][j] = desvio(j, 0);
  for (let k = 1; k < n - 1; k++) {
    let mejor = INF, mejorJ = -1;
    for (let j = 0; j < m; j++) {
      // Se acumula el mínimo de los candidatos anteriores, que exige orden.
      if (j > 0 && coste[k - 1][j - 1] < mejor) { mejor = coste[k - 1][j - 1]; mejorJ = j - 1; }
      if (mejorJ < 0) continue;
      coste[k][j] = mejor + desvio(j, k);
      viene[k][j] = mejorJ;
    }
  }

  let fin = -1, mejorFin = INF;
  for (let j = 0; j < m; j++) if (coste[n - 2][j] < mejorFin) { mejorFin = coste[n - 2][j]; fin = j; }
  if (fin < 0) {
    const cortes = [0].concat(esperados.map(Math.round), [pcm.length]);
    return cortes.slice(0, -1).map((d, k) => ({ desde: d, hasta: cortes[k + 1] }));
  }

  const elegidos = new Array(n - 1);
  for (let k = n - 2; k >= 0; k--) { elegidos[k] = fin; fin = viene[k][fin]; }

  const cortes = [0];
  for (let k = 0; k < n - 1; k++) {
    const c = Math.round(pos[elegidos[k]]);
    cortes.push(Math.max(cortes[cortes.length - 1] + vent, Math.min(c, pcm.length - vent * (n - k - 1))));
  }
  cortes.push(pcm.length);
  return cortes.slice(0, -1).map((d, k) => ({ desde: d, hasta: cortes[k + 1] }));
}
