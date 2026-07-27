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
  ['9:16', 'Vertical — historias y reels'],
  ['4:5', 'Publicación de muro'],
  ['16:9', 'Cabecera y miniatura'],
];

export const FORMATO_PORTADA = '9:16';

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

/*  Sin texto. El modelo escribe mal en cualquier idioma y un título deformado
    arruina una portada por lo demás buena; el título se pone después, encima,
    con una tipografía de verdad.                                             */
const SIN_TEXTO =
  'SIN TEXTO DE NINGÚN TIPO: ni título, ni logotipo, ni créditos, ni letras, ni números, ' +
  'ni firmas, ni marcas de agua. La imagen va limpia para poder rotular encima.';

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
    'COMPOSICIÓN: vertical. Deja aire en el tercio superior para poder rotular el título ' +
    'encima sin tapar ninguna cara. Un solo punto de interés, profundidad real entre figura ' +
    'y fondo, iluminación cinematográfica con una fuente clara.',
    SIN_TEXTO,
    ctx.calidad || '',
    'EVITAR: ' + ctx.negativo,
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
    'COMPOSICIÓN: la de arriba, sin inventar otra. Deja aire para rotular. Iluminación ' +
    'cinematográfica, profundidad real, un solo punto de interés.',
    SIN_TEXTO,
    ctx.calidad || '',
    'EVITAR: ' + ctx.negativo,
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
