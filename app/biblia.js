/* ============================================================
   biblia.js — dirección de arte, elenco y localizaciones
   ============================================================
   Todo esto es editable desde la interfaz. Lo que viene aquí es
   el punto de partida, sacado de los doce guiones de la temporada.
   ============================================================ */

export const ESTILO_DEFECTO =
  'Anime japonés seinen, animación 2D tradicional pintada a mano. Cel shading con sombras duras ' +
  'de dos tonos, línea de tinta fina y firme, fondos pintados con detalle arquitectónico realista, ' +
  'grano de película sutil. Paleta: negros marrones cálidos, hueso, bronce y ámbar; el rojo brasa ' +
  'reservado a lo vessari; los interiores humanos en verdes desaturados y fluorescente frío. ' +
  'Iluminación naturalista y muy contrastada, abundante contraluz y siluetas. Composición ' +
  'cinematográfica en escala: figuras humanas pequeñas contra arquitectura enorme. ' +
  'Registro adulto y sobrio, sin exageración cómica, sin deformación caricaturesca.';

export const NEGATIVO_DEFECTO =
  'texto, letras, subtítulos, marca de agua, logotipo, firma, collage, rejilla de viñetas, ' +
  'manos deformes, dedos de más, estilo chibi, moe, kawaii, render 3D, CGI, fotorrealismo, ' +
  'colores saturados de caramelo, sonrisas publicitarias, poses de videojuego';

export const INSTRUCCION_VOZ_DEFECTO =
  'Narra en español latino neutro, con voz grave y profunda, a un ritmo medio, con pausas ' +
  'naturales y energía dramática contenida, estilo narrador de recaps de anime. Este fragmento ' +
  'forma parte de una narración continua más larga: mantén exactamente el mismo tono, velocidad ' +
  'y energía de principio a fin, sin saludos ni despedidas. No leas esta instrucción: lee ' +
  'únicamente el texto que sigue.';

/* ── Elenco ─────────────────────────────────────────────────── */
/*  ficha: descripción canónica que se manda al generar la hoja de
    referencia y que después acompaña a cada fotograma donde aparece.  */

export const ELENCO_DEFECTO = [
  {
    id: 'sota', nombre: 'Sōta', alias: ['Sōta Amamiya', 'Amamiya Sōta', 'hermano', 'contador'],
    principal: true,
    ficha: 'Chico japonés de diecinueve años. Delgado por trabajo, no por dieta. Pelo negro liso ' +
      'algo largo y desordenado, flequillo que le tapa la frente. Ojos oscuros con ojeras marcadas ' +
      'y permanentes. Cara angulosa, mandíbula tensa, expresión de cansancio contenido. ' +
      'Ropa: chaqueta de trabajo azul marino gastada sobre camisa blanca barata, pantalón oscuro, ' +
      'zapatillas viejas. En la segunda mitad de la temporada: mono gris de recluso con una pulsera ' +
      'negra en la muñeca izquierda, vendada con tela blanca.',
  },
  {
    id: 'hina', nombre: 'Hina', alias: ['Hina Amamiya', 'Amamiya Hina', 'hermana'],
    principal: true,
    ficha: 'Chica japonesa de dieciséis años. Estatura media, complexión menuda pero de postura ' +
      'firme. Pelo negro a la altura de los hombros con flequillo recto. Ojos grandes y despiertos, ' +
      'mirada directa. Camina con paso corto y la cabeza alta. ' +
      'Ropa: uniforme escolar japonés de invierno azul marino, o campera celeste sobre ropa de calle. ' +
      'En la nave: conjunto deportivo blanco del Programa Puente. Lleva siempre un omamori de tela ' +
      'roja y dorada atado a la mochila o a la cabecera de la litera.',
  },
  {
    id: 'rei', nombre: 'Rei', alias: ['Rei Kurosawa', 'Kurosawa Rei', 'la editora'],
    principal: true,
    ficha: 'Mujer japonesa de veinticuatro años. Pelo negro corto y descuidado, mechones sueltos. ' +
      'Ojeras profundas de insomnio prolongado, mirada intensa y alerta. Cazadora negra sobre ' +
      'camiseta gris, vaqueros, mochila cruzada. Manos siempre ocupadas: portátil, cuaderno, cables.',
  },
  {
    id: 'kanzaki', nombre: 'Kanzaki', alias: ['Kenji Kanzaki', 'el director', 'Director Kanzaki'],
    principal: true,
    ficha: 'Funcionario japonés de cincuenta y ocho años. Pelo gris peinado con raya impecable, ' +
      'gafas de montura fina metálica, cara larga sin expresión. Traje gris oscuro de burócrata, ' +
      'camisa blanca, corbata sobria. Postura recta, manos quietas. Lleva siempre una libreta ' +
      'pequeña — salvo en el episodio final, donde ya no la lleva.',
  },
  {
    id: 'vaal', nombre: 'Vaal', alias: ['Emisario Vaal', 'el Emisario'],
    principal: true,
    ficha: 'Alienígena vessari, dos metros y pico. Piel gris pálida y lisa, sin poros. Cráneo ' +
      'alargado hacia atrás, rasgos casi humanos pero de simetría imposible. Ojos de oro uniforme, ' +
      'sin pupila ni párpado visible. Va envuelto en capas de un tejido gris que cae como agua ' +
      'quieta. No gesticula. Se mueve con una economía absoluta, sin prisa.',
  },
  {
    id: 'sereth', nombre: 'Sereth', alias: ['el archivista', 'el último lector'],
    principal: true,
    ficha: 'Alienígena vessari de la casta archivista. Más angosto y liviano que los demás, algo ' +
      'encorvado de inclinarse sobre cosas durante siglos. Envuelto en un tejido gris sin forma. ' +
      'Los dedos de la mano derecha manchados de ámbar seco. Mismos ojos de moneda de oro, pero ' +
      'con algo rápido y vivo moviéndose detrás.',
  },
  {
    id: 'goro', nombre: 'Gorō', alias: ['el yakuza'],
    ficha: 'Hombre japonés de unos cuarenta y cinco años, corpulento, hombros anchos. Cara curtida, ' +
      'cicatriz vieja partiéndole la ceja derecha. Pelo corto entrecano. Por el cuello del mono gris ' +
      'asoma el borde de un tatuaje tradicional japonés. Postura relajada de quien ya vio de todo.',
  },
  {
    id: 'yuto', nombre: 'Yuto',
    ficha: 'Chico japonés de diecisiete años, muy flaco, hombros estrechos. Pelo negro mal cortado. ' +
      'Ojos grandes y asustados. Mono gris que le queda grande. Se abraza a sí mismo cuando escucha.',
  },
  {
    id: 'ogata', nombre: 'Ogata', alias: ['señor Ogata', 'el cobrador'],
    ficha: 'Hombre japonés de cincuenta años. Traje gris impecable, corbata discreta, carpeta bajo ' +
      'el brazo. Sonríe siempre, una sonrisa de oficina que no le llega a los ojos. Pelo engominado.',
  },
  {
    id: 'aoki', nombre: 'Aoki', alias: ['señorita Aoki', 'la reclutadora'],
    ficha: 'Mujer japonesa de unos treinta años. Uniforme corporativo azul del Programa Puente con ' +
      'placa identificativa. Pelo recogido, maquillaje impecable, sonrisa entrenada y cálida. ' +
      'Manos abiertas al hablar, postura inclinada hacia el interlocutor.',
  },
  {
    id: 'matsuda', nombre: 'Matsuda', alias: ['viejo Matsuda', 'señor Matsuda'],
    ficha: 'Anciano japonés de setenta y ocho años, encorvado, delgado. Pelo blanco ralo, cara ' +
      'llena de arrugas profundas. Chaqueta de punto marrón sobre camisa. Lleva su propia silla ' +
      'plegable a todas partes.',
  },
  {
    id: 'sachiko', nombre: 'Sachiko',
    ficha: 'Chica japonesa de veintidós años, de Nagoya. Pelo castaño oscuro recogido en una coleta ' +
      'alta. Cara redonda, sonrisa amplia y genuina, energía contagiosa. Conjunto deportivo blanco ' +
      'del Programa Puente.',
  },
  {
    id: 'tanaka', nombre: 'Tanaka',
    ficha: 'Chico japonés de diecisiete años, flaco, mandíbula un poco salida, cicatriz de acné en ' +
      'la mejilla izquierda. Uniforme escolar; más adelante, restos decolorados de un conjunto ' +
      'deportivo blanco y el pelo cortado al ras por manos ajenas.',
  },
  {
    id: 'mizuno', nombre: 'Mizuno', alias: ['Mizuno Kaede', 'la asistente'],
    ficha: 'Funcionaria japonesa de veintinueve años. Traje de oficina gris, pelo negro recogido, ' +
      'gafas discretas. Expresión seria y atenta. Lleva un llavero con un gato de la suerte.',
  },
  {
    id: 'kaori', nombre: 'Kaori', alias: ['la actriz', 'la de Osaka'],
    ficha: 'Actriz japonesa de veintitrés años. Aspecto de "chica normal" cuidadosamente diseñado: ' +
      'pelo castaño suelto, maquillaje natural, ropa de casa cómoda. Sonrisa de anuncio, sostenida ' +
      'un segundo de más.',
  },
  {
    id: 'cuidador', nombre: 'cuidador vessari', alias: ['los cuidadores', 'el cuidador'],
    ficha: 'Vessari de casta obrera: más ancho y duro que Vaal, mandíbula pesada, piel gris sin ' +
      'poros, ojos de moneda de oro. Traje sellado gris oscuro con visor espejado adherido al casco ' +
      '(a veces retirado). Lleva una vara viva de escaneo.',
  },
  {
    id: 'caminante', nombre: 'caminante de servicio', alias: ['el ser del collar', 'los caminantes'],
    ficha: 'Criatura encorvada, más baja que un humano, piel gris verdosa, brazos largos, ojos ' +
      'grandes y oscuros sin blanco. Alrededor del cuello, un anillo de filamentos pálidos vivos ' +
      'que le entran por la nuca y le bajan por la columna como una raíz. Del cuello le cuelga un ' +
      'cordón con tres cuentas de madera gastadas.',
  },
  {
    id: 'instructor', nombre: 'instructor vessari', alias: ['el instructor'],
    ficha: 'Vessari alto y sobrio, envuelto en tejido claro, ojos de oro. Modales de docente ' +
      'paciente: manos siempre a la vista, gestos abiertos y lentos.',
  },
];

/* ── Localizaciones ─────────────────────────────────────────── */

export const LUGARES_DEFECTO = [
  { id: 'apartamento', nombre: 'Apartamento de Kōtō',
    ficha: 'Apartamento japonés de treinta y dos metros cuadrados en un bloque viejo de Tokio. ' +
      'Cocina y sala en una sola pieza, mesa baja, televisor viejo de tubo, futones doblados, ' +
      'foto enmarcada de la madre. Fluorescente frío, paredes con humedad, todo limpio y gastado.' },
  { id: 'tienda', nombre: 'Tienda de conveniencia nocturna',
    ficha: 'Konbini japonés de madrugada: luz fluorescente blanca cruda, estanterías llenas, ' +
      'suelo brillante, ventanales negros con la calle vacía reflejada.' },
  { id: 'tokio', nombre: 'Tokio bajo las naves',
    ficha: 'Calles de Tokio con una nave-catedral de once kilómetros suspendida sobre la bahía al ' +
      'fondo: masa negra curva de nervaduras orgánicas que tapa el cielo. Autos detenidos, gente ' +
      'mirando hacia arriba, semáforos funcionando sin nadie.' },
  { id: 'karasu', nombre: 'Isla Karasu',
    ficha: 'Islote rocoso de cuatro kilómetros cuadrados, pinos torcidos por el viento, acantilados ' +
      'grises, mar abierto alrededor. Vista aérea de nitidez imposible.' },
  { id: 'salaTe', nombre: 'Sala del té — nave de Tokio',
    ficha: 'Sala del tamaño de un estadio dentro de la nave viva. Paredes cálidas, curvas y ' +
      'latientes de color hueso, que emiten su propia claridad pareja sin lámparas. Una mesa larga ' +
      'blanca con cuarenta sillas y servicio de té humeante.' },
  { id: 'chiba', nombre: 'Estudio de Chiba',
    ficha: 'Hangar industrial enorme con tres decorados dentro: dormitorio de sábanas blancas, ' +
      'comedor de madera clara con fruta, jardín interior con árboles en macetas ocultas y un techo ' +
      'de pantallas LED que proyecta un atardecer color miel. Alrededor: andamios, cables, focos.' },
  { id: 'oficina', nombre: 'Oficina del Programa Puente',
    ficha: 'Sucursal bancaria quebrada reconvertida en una semana: paredes blancas y azules recién ' +
      'pintadas, carteles del puente y la estrella, escritorios nuevos, máquina de café gratis, ' +
      'olor a pintura. Fila de gente esperando fuera.' },
  { id: 'centro', nombre: 'Centro de Procesamiento de la bahía',
    ficha: 'Vieja terminal de cruceros reconvertida: vallas blancas, banderas del puente y la ' +
      'estrella, pasarela iluminada, corrales para familiares, guardias de uniforme azul. Al fondo, ' +
      'la nave negra sobre el agua.' },
  { id: 'umbral', nombre: 'El Umbral',
    ficha: 'Pasillo blanco estrecho que termina en un arco de tres metros de material blanco y ' +
      'curvo, con una veta central oscura que late despacio y un solo ojo de cámara arriba.' },
  { id: 'pabellonB', nombre: 'Pabellón B',
    ficha: 'Galpón de contenedores con las ventanas tapiadas, doscientos catres en filas de veinte, ' +
      'luz blanca que nunca se apaga del todo, suelo de cemento. Sin carteles ni banderas.' },
  { id: 'bodegaB', nombre: 'Bodega B de la nave siete',
    ficha: 'Cámara ovalada del tamaño de un gimnasio con paredes vivas color hueso oscuro. Del ' +
      'suelo brotan repisas orgánicas tibias a la medida de un cuerpo. Sin puertas visibles. ' +
      'Penumbra de brasa en la fase de descanso.' },
  { id: 'conductos', nombre: 'Conductos orgánicos',
    ficha: 'Túnel de un metro de diámetro dentro de la carne de la nave: paredes tibias, blandas, ' +
      'de color hueso húmedo, con esfínteres fruncidos y una claridad interna tenue. Espacio ' +
      'claustrofóbico visto desde dentro.' },
  { id: 'comedorA', nombre: 'Comedor del bloque A-12',
    ficha: 'Salón grande y limpio color loza dentro de la nave. Literas blancas de a cuatro, mesas ' +
      'largas, bandejas humeantes, carteles del puente sostenidos por la pared viva. Luz blanca ' +
      'generosa y pareja.' },
  { id: 'anfiteatro', nombre: 'Anfiteatro de orientación',
    ficha: 'Anfiteatro de tejido blanco nacarado con gradas curvas que brotan del suelo en anillos. ' +
      'En el centro, un sillón reclinado blanco crecido del propio suelo, y colgando del techo un ' +
      'ramillete de filamentos pálidos peinados hacia abajo.' },
  { id: 'capsulas', nombre: 'Pasillo de las cápsulas',
    ficha: 'Pasillo interminable de paredes vivas color hueso viejo, con nichos transparentes ' +
      'empotrados a cuatro alturas hasta perderse de vista. Dentro de cada uno, líquido ámbar, una ' +
      'cara suspendida y filamentos pálidos entrando por el cráneo hacia la pared.' },
  { id: 'astillero', nombre: 'Mundo-astillero',
    ficha: 'Cielo bajo de color brasa vieja. Mar poco profundo del color del bronce, quieto como ' +
      'aceite, hasta el horizonte. Del mar salen arrecifes de naves-catedral en todos los estados ' +
      'de crecimiento: costillares de hueso blanco chorreando agua, cascos a medio cubrir de carne ' +
      'oscura, leviatanes terminados. Venas de luz recorriendo los lomos.' },
  { id: 'recinto', nombre: 'Recinto de Acogida 214',
    ficha: 'Isla de coral vivo blanco de tres kilómetros sobre el mar de bronce. En un extremo ' +
      'pabellones blancos mullidos, en el centro una explanada con salones nacarados en ' +
      'crecimiento, en el otro extremo galpones grises. Sin vallas: el horizonte es la valla.' },
  { id: 'torre', nombre: 'Torre del Archivo',
    ficha: 'Espiral de coral oscurecido sin ventanas. Las paredes recorridas por miles de vetas de ' +
      'ámbar que suben en hélice, cada una parpadeando por dentro con imágenes diminutas. Entre las ' +
      'vetas, repisas crecidas del hueso con objetos pequeños de mundos distintos.' },
  { id: 'nucleo', nombre: 'Sala de Núcleo Tres',
    ficha: 'Sala nacarada grande con cincuenta sillones blancos reclinados en cinco hileras de ' +
      'diez, cada uno bajo su ramillete de filamentos, y gradas alrededor para el personal.' },
  { id: 'ministerio', nombre: 'Sótano del Ministerio',
    ficha: 'Sala de reuniones sin ventanas en un subsuelo: mesa larga, pantalla con cifras, ' +
      'funcionarios de traje, luz fría de techo. Estética burocrática japonesa, sobria y sin alma.' },
  { id: 'mangacafe', nombre: 'Manga café, cabina catorce',
    ficha: 'Cubículo estrecho de manga café con paredes de melamina, estanterías de tomos, luz ' +
      'amarilla baja, una laptop vieja con un agujero tapado con cinta negra donde estaba el wifi.' },
  { id: 'lavanderia', nombre: 'Lavandería de monedas',
    ficha: 'Lavandería automática japonesa de noche: fluorescente verdoso, hilera de lavadoras ' +
      'industriales, sillas de plástico, ventanal a una calle vacía.' },
];

/* ── Vocabulario de encuadre para el director de IA ─────────── */

export const ENCUADRES = [
  'gran plano general', 'plano general', 'plano entero', 'plano americano',
  'plano medio', 'primer plano', 'primerísimo primer plano', 'plano detalle',
  'plano cenital', 'plano contrapicado', 'plano holandés', 'plano subjetivo',
];

export const MOVIMIENTOS = [
  'cámara fija', 'panorámica lenta a la izquierda', 'panorámica lenta a la derecha',
  'travelling de acercamiento lento', 'travelling de alejamiento lento',
  'inclinación hacia arriba', 'inclinación hacia abajo', 'cámara en mano sutil',
  'grúa descendente', 'seguimiento lateral',
];

/* ── Configuración por defecto del proyecto ─────────────────── */

export const CONFIG_DEFECTO = {
  // Formato
  formato: '16:9',
  imageSize: '2K',

  // Modelos
  modeloTexto: 'gemini-2.5-pro',
  modeloImagen: 'gemini-3-pro-image-preview',
  modeloVideo: 'veo-3.1-fast-generate-preview',
  modeloTts: 'gemini-2.5-flash-preview-tts',

  // Voz
  voz: 'Charon',
  idioma: 'es-US',
  temperaturaVoz: 0.9,
  semillaVoz: '',
  instruccionVoz: INSTRUCCION_VOZ_DEFECTO,
  anunciarTitulo: true,
  silencioEscena: 0.7,

  // Segmentación
  segundosPorToma: 8,
  cps: 16,

  // Arte
  estilo: ESTILO_DEFECTO,
  negativo: NEGATIVO_DEFECTO,
  maxReferencias: 3,

  // Video
  resolucionVideo: '1080p',
  audioVeo: false,
  proporcionMovimiento: 0.35,   // fracción de tomas que se animan con Veo

  // Normalización de voz
  normalizarVoz: true,
  reemplazos: null,             // null = usar REEMPLAZOS_BASE

  // Precios orientativos en dólares, editables desde la interfaz.
  // Vertex cambia sus tarifas: aquí solo sirven para dimensionar el trabajo.
  precios: { imagen: 0.15, videoSegundo: 0.15, vozMil: 0.012, episodio: 0.25 },
};

export const VOCES = [
  ['Charon', 'grave, informativa (recomendada para el narrador)'],
  ['Algenib', 'rasposa, grave'], ['Gacrux', 'madura'], ['Fenrir', 'vehemente'],
  ['Orus', 'firme'], ['Alnilam', 'firme'], ['Kore', 'firme (femenina)'],
  ['Umbriel', 'relajada'], ['Callirrhoe', 'relajada'], ['Achird', 'amigable'],
  ['Zubenelgenubi', 'casual'], ['Rasalgethi', 'informativa'], ['Sadaltager', 'experta'],
  ['Iapetus', 'clara'], ['Erinome', 'clara'], ['Schedar', 'uniforme'],
  ['Achernar', 'suave'], ['Algieba', 'suave'], ['Despina', 'suave'],
  ['Vindemiatrix', 'gentil'], ['Sulafat', 'cálida'], ['Aoede', 'ligera'],
  ['Zephyr', 'brillante'], ['Autonoe', 'brillante'], ['Puck', 'animada'],
  ['Laomedeia', 'animada'], ['Sadachbia', 'vivaz'], ['Pulcherrima', 'directa'],
  ['Leda', 'juvenil'], ['Enceladus', 'susurrante'],
];

export const IDIOMAS = [
  ['', 'Automático (detecta del texto)'],
  ['es-US', 'Español · Latinoamérica'],
  ['es-ES', 'Español · España'],
  ['en-US', 'Inglés'],
  ['pt-BR', 'Portugués · Brasil'],
  ['ja-JP', 'Japonés'],
];
