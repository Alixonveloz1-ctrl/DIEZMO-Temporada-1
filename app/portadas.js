/* ============================================================
   portadas.js — portadas de episodio y carteles de la serie
   ============================================================
   Dos cosas distintas que comparten dirección de arte:

   · La PORTADA de cada capítulo. Vertical, una por episodio,
     con los personajes que de verdad salen en él.
   · Los CARTELES de la serie. Para anunciarla antes de que
     exista: no cuentan un episodio, cuentan la premisa.

   Los dos van con las hojas de referencia adjuntas, que es lo
   único que hace que el personaje sea el mismo de siempre.
   ============================================================ */

/*  Facebook no usa un solo formato: la historia es vertical, la publicación del
    muro se ve mejor casi cuadrada y la cabecera es apaisada. Se ofrecen los
    tres porque una portada recortada por el sitio equivocado pierde la cara
    del personaje, que es justo lo que se quería enseñar.                     */
export const FORMATOS = [
  ['16:9', 'Apaisado — como subes todo'],
  ['9:16', 'Vertical — historias'],
  ['4:5', 'Publicación de muro'],
];

/*  16:9 porque es como sube el canal: el reel lo convierte solo a vertical
    rellenando con negro, y ese acabado es el que le gusta a su público.     */
export const FORMATO_PORTADA = '16:9';

/*  Los carteles no salen de ningún episodio: son la promesa de la serie. Cada
    uno ataca por un lado distinto para que la página no repita la misma imagen
    con otro encuadre —que es lo que pasa cuando se pide «un cartel» cinco
    veces seguidas.                                                           */
export const CARTELES = [
  {
    id: 'anuncio',
    nombre: 'Anuncio principal',
    resumen: 'El que abre la campaña. Sōta pequeño, la nave enorme.',
    reparto: ['sota'],
    reclamo: 'PRÓXIMAMENTE',
    idea: 'Plano general vertical. Un chico solo, de espaldas y pequeñísimo en el ' +
      'encuadre inferior, mirando hacia arriba. Sobre él, ocupando cuatro quintos de la ' +
      'imagen, el casco de una nave alienígena inmensa suspendida sobre Tokio, tan grande ' +
      'que no cabe entera. Luz fría descendente, la ciudad en penumbra. La escala lo dice ' +
      'todo: no hay lucha posible.',
  },
  {
    id: 'diezmo',
    nombre: 'La cifra',
    resumen: 'Diez millones dicho sin decirlo: la fila que no termina.',
    reparto: [],
    reclamo: 'DIEZ MILLONES',
    idea: 'Plano general vertical, ligeramente elevado. Una fila ordenadísima de personas ' +
      'de espaldas que se pierde hacia el horizonte, entrando por una compuerta iluminada. ' +
      'Todos llevan la misma ropa civil corriente y una carpeta en la mano. Nadie forcejea, ' +
      'nadie llora: es un trámite. El horror está en la calma y en que la fila no acaba.',
  },
  {
    id: 'rostros',
    nombre: 'Los que se van',
    resumen: 'Retrato doble de los protagonistas. Para presentar personajes.',
    reparto: ['sota', 'hina'],
    idea: 'Retrato vertical de dos personajes en primer plano corto, uno ligeramente ' +
      'delante del otro, ambos mirando a cámara sin sonreír. Fondo desenfocado en tonos ' +
      'fríos con la silueta de la nave apenas insinuada. Iluminación de contorno recortando ' +
      'las caras. Es un cartel de personajes: las miradas mandan.',
  },
  {
    id: 'oficina',
    nombre: 'El horror es cortés',
    resumen: 'La cara burocrática. Diferencia esta serie de otra invasión.',
    reparto: ['kanzaki'],
    idea: 'Plano medio vertical. Un funcionario impecable detrás de un mostrador limpio, ' +
      'sonriendo con amabilidad profesional mientras desliza un formulario hacia el ' +
      'espectador. Luz de oficina blanca y pareja, todo ordenado, ni una mota. La violencia ' +
      'es el papel, no la sangre.',
  },
  {
    id: 'alienigena',
    nombre: 'El visitante',
    resumen: 'Presenta a los vessari sin enseñarlo todo.',
    reparto: ['vaal'],
    reclamo: 'YA ESTÁN AQUÍ',
    idea: 'Plano contrapicado vertical de una figura alienígena vessari erguida, vista ' +
      'desde abajo, parcialmente en contraluz para que la silueta y la postura importen más ' +
      'que el detalle. Cortesía en el gesto, nada de agresividad. Neblina y luz dorada ' +
      'detrás. Debe intrigar sin resolver qué son.',
  },
  {
    id: 'ciudad',
    nombre: 'Tokio bajo la sombra',
    resumen: 'Sin personajes. Sirve de fondo y de cabecera.',
    reparto: [],
    idea: 'Panorámica vertical de Tokio al atardecer, vista desde una azotea, con la ' +
      'sombra circular de algo enorme proyectada sobre los barrios. La ciudad sigue ' +
      'encendida y funcionando: coches, anuncios, gente diminuta. Nadie mira hacia arriba. ' +
      'Máximo detalle urbano, sin figuras en primer plano.',
  },
];

export function cartelPorId(id) {
  return CARTELES.find((c) => c.id === id) || null;
}

/* ── Prompts ────────────────────────────────────────────────── */

const ENCARGO =
  'PORTADA DE ANIME (key visual). Ilustración única y acabada, pensada para verse sola: ' +
  'composición cuidada, un punto de interés claro y aire alrededor. No es un fotograma de ' +
  'la serie, es el cartel.';

/*  EL TEXTO VA DENTRO, Y GRANDE.

    El modelo escribe bien cuando la tipografía es de cartel; lo que le sale
    deforme es la letra pequeña —créditos, fechas, frases sueltas, direcciones—,
    porque a ese tamaño no le quedan píxeles para dibujar la forma de la letra.
    Así que no se prohíbe el texto: se prohíbe el texto PEQUEÑO, que es la parte
    que falla, y se exige un tamaño mínimo para la que se queda.

    Pocas palabras y muy grandes. Cada línea de más es una oportunidad de que
    algo salga torcido.                                                        */
export const TITULO_SERIE = 'DIEZMO';

/*  LA MISMA TIPOGRAFÍA EN LAS DIECIOCHO PIEZAS. Doce portadas y seis carteles
    con letras distintas son dieciocho imágenes sueltas; con la misma letra son
    una colección, y eso es lo que hace que una página parezca una serie de
    verdad. Por eso se describe aquí una sola vez y la usan las dos.          */
const TIPOGRAFIA =
  'TIPOGRAFÍA (la misma en toda la colección, no la cambies): grotesca de palo seco ' +
  'condensada y muy gruesa, en MAYÚSCULAS, de las que se usan en los carteles de cine. ' +
  'Sin serifas, sin cursiva, sin adornos, sin efectos 3D, sin degradados, sin resplandor. ' +
  'Color blanco hueso, con un reborde oscuro fino y limpio para que se lea sobre cualquier ' +
  'fondo. Letras nítidas, bien formadas, bien espaciadas y perfectamente horizontales.';

/**
 * El bloque de título, ya escrito. El modelo no tiene que inventar ni una
 * palabra: se le dan las líneas exactas y el tamaño de cada una.
 *
 * @param {Array<{texto:string, parte:string}>} filas  de mayor a menor
 */
function bloqueTexto(filas) {
  const buenas = filas.filter((f) => f && f.texto);
  return [
    'TEXTO DENTRO DE LA IMAGEN. Va rotulado ya, listo para publicar. Escribe EXACTAMENTE ' +
    'estas ' + buenas.length + (buenas.length === 1 ? ' línea' : ' líneas') + ', sin cambiar ' +
    'ni una letra, sin traducir, sin reordenar y sin añadir ninguna más:',
    ...buenas.map((f, k) => '  ' + (k + 1) + ') «' + f.texto + '»  → ocupando a lo ancho ' +
      'al menos ' + f.parte + ' de la imagen'),
    '',
    TIPOGRAFIA,
    'COLOCACIÓN: todas las líneas juntas, alineadas entre sí, formando un solo bloque de ' +
    'título en el tercio superior o en el inferior, sobre una zona tranquila y sin tapar ' +
    'ninguna cara. Si una línea no cabe de una vez, pártela en dos renglones del mismo ' +
    'tamaño, nunca la encojas.',
    'PROHIBIDA LA LETRA PEQUEÑA, sin excepción: nada de créditos, ni fechas, ni nombres de ' +
    'estudio o distribuidora, ni direcciones web, ni redes sociales, ni eslóganes que no ' +
    'estén en la lista, ni firmas, ni marcas de agua, ni texto de relleno, ni caracteres ' +
    'japoneses decorativos. SOLO esas líneas y a ese tamaño. La letra menuda es la que ' +
    'sale deforme.',
  ].join('\n');
}

/** Las líneas exactas de la portada de un capítulo. */
export function lineasPortada(ep) {
  const filas = [
    { texto: TITULO_SERIE, parte: 'la mitad' },
    { texto: 'EPISODIO ' + String(ep.num).padStart(2, '0'), parte: 'un cuarto' },
  ];
  // El título del capítulo es el que da la pista de qué va: si lo hay, va.
  if (ep.titulo) filas.push({ texto: ep.titulo.toUpperCase(), parte: 'un tercio' });
  return filas;
}

/** Las líneas exactas de un cartel de la serie. */
export function lineasCartel(cartel) {
  const filas = [{ texto: TITULO_SERIE, parte: 'dos tercios' }];
  if (cartel.reclamo) filas.push({ texto: cartel.reclamo, parte: 'un tercio' });
  return filas;
}

/*  La lista de «evitar» de los fotogramas prohíbe texto, letras, logotipo y
    firma —y con razón: un fotograma con letras encima está arruinado—. Pero la
    portada SÍ lleva título rotulado y firma del canal, así que pedir las dos
    cosas a la vez es contradecirse, y el modelo hace lo que le parece. Aquí se
    quitan solo esos términos; el resto de la lista sigue entera.            */
const PERMITIDO_EN_PORTADA = /^(texto|letras|subt[íi]tulos|marca de agua|logotipo|firma)$/i;

export function negativoDePortada(negativo) {
  return String(negativo || '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t && !PERMITIDO_EN_PORTADA.test(t))
    .join(', ');
}

function bloqueReparto(personajes, conReferencia) {
  if (!personajes.length) return [];
  const fichas = personajes.map((p) => '· ' + p.nombre + ': ' + p.ficha);
  return [
    'PERSONAJES EN LA IMAGEN (' + personajes.length + '):',
    ...fichas,
    conReferencia
      ? 'Se adjuntan sus hojas de referencia: respeta el rostro, el peinado y las ' +
        'proporciones EXACTAMENTE. Es la misma persona, en otra escena.'
      : '',
  ].filter(Boolean);
}

/**
 * Portada de un episodio concreto.
 * @param {object} ep          episodio, con titulo y tomas
 * @param {object} ctx         {estilo, calidad, negativo}
 * @param {Array} personajes   fichas de quienes salen, ya resueltas
 * @param {boolean} conReferencia  si se adjuntan sus hojas
 */
export function promptPortada(ep, ctx, personajes, conReferencia) {
  /*  El resumen sale del propio episodio, no de una sinopsis escrita aparte que
      habría que mantener al día: las primeras tomas son las que sitúan.      */
  const arranque = (ep.tomas || []).slice(0, 6).map((t) => t.texto).join(' ')
    .replace(/\s+/g, ' ').slice(0, 700);

  return [
    ENCARGO + ' ' + ctx.estilo,
    '',
    'SERIE: DIEZMO. Ciencia ficción oscura, seinen. Una civilización alienígena exige diez ' +
    'millones de humanos entregados voluntariamente, y los gobiernos de la Tierra fabrican ' +
    'el consentimiento con una mentira. El horror es burocrático y cortés, nunca sangriento.',
    '',
    'ESTE CAPÍTULO — «' + (ep.titulo || ('Episodio ' + ep.num)) + '»:',
    arranque,
    '',
    ...bloqueReparto(personajes, conReferencia),
    '',
    'COMPOSICIÓN: deja una zona tranquila y despejada en el tercio superior ' +
    'para que el título quepa ahí sin tapar ninguna cara. Un solo punto de interés, ' +
    'profundidad real entre figura y fondo, iluminación cinematográfica con una fuente clara.',
    bloqueTexto(lineasPortada(ep)),
    ctx.calidad || '',
    'EVITAR: ' + negativoDePortada(ctx.negativo),
  ].filter((l) => l !== null && l !== undefined).join('\n');
}

/**
 * Cartel de la serie, para anunciarla. No cuenta un episodio: cuenta la premisa.
 */
export function promptCartel(cartel, ctx, personajes, conReferencia) {
  return [
    ENCARGO + ' ' + ctx.estilo,
    '',
    'SERIE: DIEZMO. Ciencia ficción oscura, seinen. Una civilización alienígena exige diez ' +
    'millones de humanos entregados voluntariamente, y los gobiernos de la Tierra fabrican ' +
    'el consentimiento con una mentira. El horror es burocrático y cortés, nunca sangriento.',
    '',
    'CARTEL: ' + cartel.nombre,
    cartel.idea,
    '',
    ...bloqueReparto(personajes, conReferencia),
    '',
    'COMPOSICIÓN: la de arriba, sin inventar otra. Deja una zona tranquila donde quepa el ' +
    'título. Iluminación cinematográfica, profundidad real, un solo punto de interés.',
    bloqueTexto(lineasCartel(cartel)),
    ctx.calidad || '',
    'EVITAR: ' + negativoDePortada(ctx.negativo),
  ].filter((l) => l !== null && l !== undefined).join('\n');
}

/**
 * Quiénes salen de verdad en un episodio, por orden de presencia.
 * El director ya anotó el reparto de cada plano: se cuenta ahí en vez de
 * adivinarlo del texto, que daría personajes solo mencionados.
 */
export function repartoDe(ep, tope) {
  const cuenta = new Map();
  for (const t of ep.tomas || []) {
    for (const id of (t.plano && t.plano.personajes) || []) {
      cuenta.set(id, (cuenta.get(id) || 0) + 1);
    }
  }
  return [...cuenta.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, tope || 2)
    .map(([id]) => id);
}
