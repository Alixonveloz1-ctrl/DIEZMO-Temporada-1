/* ============================================================
   biblia.js — dirección de arte, elenco y localizaciones
   ============================================================
   Todo esto es editable desde la interfaz. Lo que viene aquí es
   el punto de partida, sacado de los doce guiones de la temporada.
   ============================================================ */

import { aplicarTono, SEMILLA_FIJA } from './voz.js';

export const ESTILO_DEFECTO =
  'Anime japonés contemporáneo de alta gama, del estilo que se produce hoy. Dibujo 2D ' +
  'íntegramente a mano, animación tradicional en digital: nada de 3D, nada de CGI, nada de ' +
  'fotorrealismo. Línea de tinta limpia y nítida, de grosor parejo. Sombreado cel moderno: ' +
  'dos o tres tonos por superficie con transiciones suaves, luz de contorno recortando las ' +
  'figuras contra el fondo y reflejo cálido en el pelo. Ojos grandes y detallados, con el ' +
  'iris pintado en capas y brillos nítidos. Color rico y profundo, contraste alto, ' +
  'iluminación cinematográfica con una fuente de luz clara. Fondos pintados con gran detalle ' +
  'arquitectónico y profundidad atmosférica. Acabado limpio y de alta definición: sin grano ' +
  'de película, sin textura de papel, sin trama de puntos, sin aspecto envejecido ni retro. ' +
  'Paleta: negros marrones cálidos, hueso, bronce y ámbar; el rojo brasa reservado a lo ' +
  'vessari; los interiores humanos en verdes desaturados y fluorescente frío. ' +
  'Las figuras se dibujan altas y esbeltas, de piernas largas y torso estilizado, con la ' +
  'cabeza pequeña respecto al cuerpo, tal como se dibuja a los adultos en el anime moderno. ' +
  'DISEÑO DE PERSONAJES ATRACTIVO, del que engancha al público: rostros armónicos y bien ' +
  'proporcionados, ojos grandes y luminosos de mirada expresiva, piel limpia y sana, ' +
  'peinados con volumen y mechones bien definidos. Los personajes resultan agradables de ' +
  'mirar aunque la historia sea dura, y su ropa está limpia y bien confeccionada, con buena ' +
  'caída y costuras correctas, por humilde que sea. ' +
  'Registro adulto y sobrio, sin exageración cómica.';

export const NEGATIVO_DEFECTO =
  // Los defectos se nombran como defectos, nunca describiendo la imagen indeseada:
  // «duplicación de cabezas» no puede leerse como una instrucción de dibujarlas.
  'duplicación de cabezas, duplicación de rostros, duplicación de miembros, extremidades ' +
  'sobrantes, dedos sobrantes, miembros fusionados, cuerpos fusionados, anatomía imposible, ' +
  'articulaciones torcidas, manos deformes, cabeza desproporcionada, cuerpo achaparrado, ' +
  'piernas acortadas, proporciones infantiles, enanismo, ' +
  'aspecto andrajoso, tela basta de saco, prendas rotas o sucias, rostro demacrado, ' +
  'ojeras exageradas, piel enferma, envejecimiento prematuro, expresión de sufrimiento físico, ' +
  'texto, letras, subtítulos, marca de agua, logotipo, firma, collage, rejilla de viñetas, ' +
  'estilo chibi, moe, kawaii, render 3D, CGI, modelado por ordenador, fotorrealismo, ' +
  'fotografía, grano de película, textura de papel, trama de puntos, aspecto retro, ' +
  'colores lavados, dibujo de los años ochenta, sonrisas publicitarias, poses de videojuego';

export const CALIDAD_DEFECTO =
  'ACABADO: producción de largometraje, con densidad de detalle alta y pareja en todo el ' +
  'encuadre. Cada material se reconoce por su textura: el algodón gastado de la ropa, el metal ' +
  'rayado, el reflejo del vidrio, el nácar de la piel vessari, la carne tibia y nervada del ' +
  'casco de las naves. Foco nítido y limpio sobre el sujeto principal, con profundidad de campo ' +
  'cinematográfica y un desenfoque suave y ordenado en el fondo. Bordes definidos y línea ' +
  'firme, sin emborronado ni artefactos. La luz está construida, no es plana: una fuente ' +
  'principal identificable, relleno suave en las sombras y una luz de contorno que separa a las ' +
  'figuras del fondo.';

export const INSTRUCCION_VOZ_DEFECTO =
  'Narra en español latino neutro, con voz grave y profunda, a un ritmo medio, con pausas ' +
  'naturales y energía dramática contenida, estilo narrador de recaps de anime. Este fragmento ' +
  'forma parte de una narración continua más larga: mantén exactamente el mismo tono, velocidad ' +
  'y energía de principio a fin, sin saludos ni despedidas. No leas esta instrucción: lee ' +
  'únicamente el texto que sigue.';

/* ── Elenco ─────────────────────────────────────────────────── */
/*  ficha:      el cuerpo y la cara. Nunca cambia en toda la serie.
    vestuarios: la ropa. Varios personajes se cambian a mitad de la
                temporada, así que cada vestuario tiene su propia hoja
                de referencia y los episodios en los que se lleva.
                Sin vestuarios, se entiende que va vestido igual siempre. */

export const ELENCO_DEFECTO = [
  {
    id: 'sota', nombre: 'Sōta', alias: ['Sōta Amamiya', 'Amamiya Sōta', 'hermano', 'contador'],
    principal: true,
    ficha: 'Chico japonés de diecinueve años, guapo y de presencia serena. Rostro de óvalo ' +
      'suave y facciones limpias: nariz recta, mandíbula definida sin dureza, cejas bien ' +
      'dibujadas, labios finos. Ojos oscuros, grandes y de mirada franca, con pestañas ' +
      'marcadas. Piel limpia y sana; apenas una sombra tenue bajo los ojos, porque trabaja de ' +
      'noche. Alto y esbelto, de hombros rectos, torso estilizado y piernas largas. Pelo negro ' +
      'liso y brillante, algo largo, con flequillo que le cae sobre la frente y mechones ' +
      'sueltos que le dan movimiento. ' +
      'Complexión delgada y fibrosa de quien carga cajas, no de gimnasio.',
    vestuarios: [
      { id: 'calle', nombre: 'Ropa de calle', episodios: [1, 2, 3, 4, 5],
        desc: 'Chaqueta de trabajo azul marino de cuello camisero, bien entallada y en buen ' +
          'estado, sobre camiseta blanca de cuello redondo. Pantalón oscuro de faena, cinturón ' +
          'sencillo, zapatillas de lona grises.' },
      { id: 'mono', nombre: 'Mono gris de Categoría B', episodios: [6, 7, 9, 10, 11, 12],
        desc: 'Mono de una pieza en gris cemento, de tejido técnico mate y corte limpio, con ' +
          'cremallera frontal y cuello bajo. En la muñeca izquierda, una pulsera negra rígida ' +
          'cubierta con una tira de tela blanca limpia atada encima.' },
      { id: 'blanco', nombre: 'Conjunto blanco infiltrado', episodios: [8],
        desc: 'Conjunto deportivo blanco del Programa Puente, limpio y de su talla, con la ' +
          'muñeca izquierda vendada con tela blanca para tapar la pulsera negra.' },
    ],
  },
  {
    id: 'hina', nombre: 'Hina', alias: ['Hina Amamiya', 'Amamiya Hina', 'hermana'],
    principal: true,
    ficha: 'Chica japonesa de dieciséis años, de belleza serena y natural. Rostro dulce de ' +
      'facciones armónicas, ojos grandes y luminosos de mirada directa y despierta, pestañas ' +
      'largas, boca pequeña. Piel clara y limpia. Figura esbelta, de piernas largas y postura ' +
      'firme; camina con paso corto y la cabeza alta. Pelo negro liso y brillante a la altura ' +
      'de los hombros, con flequillo recto y mechones enmarcándole la cara. ' +
      'Lleva siempre consigo un omamori de tela roja y dorada.',
    vestuarios: [
      { id: 'escuela', nombre: 'Uniforme escolar', episodios: [1, 2, 3, 4],
        desc: 'Uniforme escolar japonés de invierno azul marino impecable: blusa de marinero ' +
          'con cuello y pañuelo, falda plisada a la rodilla, calcetines oscuros y mocasines. ' +
          'Mochila escolar con un omamori de tela roja y dorada colgando del cierre.' },
      { id: 'calle', nombre: 'Ropa de calle', episodios: [5],
        desc: 'Campera celeste ligera con capucha sobre camiseta clara, vaqueros y zapatillas ' +
          'blancas. Bolso de mano pequeño con el omamori rojo y dorado atado al asa.' },
      { id: 'blanco', nombre: 'Conjunto del Programa Puente', episodios: [6, 7, 8, 9, 10, 11, 12],
        desc: 'Conjunto deportivo blanco de una pieza del Programa Puente, limpio y de corte ' +
          'sencillo, con una banda fina en las mangas. El omamori rojo y dorado atado a la ' +
          'cabecera de la litera o guardado en el bolsillo.' },
    ],
  },
  {
    id: 'rei', nombre: 'Rei', alias: ['Rei Kurosawa', 'Kurosawa Rei', 'la editora'],
    principal: true,
    ficha: 'Mujer japonesa de veinticuatro años, atractiva y de belleza afilada. Rostro de ' +
      'pómulos altos, mentón fino, ojos oscuros grandes e intensos con mirada alerta y ' +
      'penetrante. Piel clara y limpia; una sombra ligera bajo los ojos delata las noches sin ' +
      'dormir, sin llegar a afearla. Figura alta y delgada. Pelo negro corto, de corte ' +
      'moderno y algo despeinado con intención, mechones cayéndole sobre la frente. ' +
      'Cazadora negra de cuero sobre camiseta gris, vaqueros ajustados, botas, mochila ' +
      'cruzada. Manos siempre ocupadas: portátil, cuaderno, cables.',
  },
  {
    id: 'kanzaki', nombre: 'Kanzaki', alias: ['Kenji Kanzaki', 'el director', 'Director Kanzaki'],
    principal: true,
    ficha: 'Funcionario japonés de cincuenta y ocho años, de elegancia distinguida y ' +
      'envejecido con dignidad. Rostro alargado de facciones nobles, nariz recta, mandíbula ' +
      'firme, pómulos marcados; guapo de joven y todavía atractivo. Pelo gris plateado y ' +
      'abundante, peinado con raya impecable. Gafas de montura fina metálica. Mirada oscura y ' +
      'quieta, sin expresión legible. Alto, delgado, de porte recto. Traje gris oscuro de ' +
      'corte perfecto, camisa blanca sin una arruga, corbata sobria. Manos quietas. Lleva ' +
      'siempre una libreta pequeña, salvo en el episodio final.',
  },
  {
    id: 'vaal', nombre: 'Vaal', alias: ['Emisario Vaal', 'el Emisario'],
    principal: true,
    ficha: 'Alienígena vessari de casta alta. Figura muy alta, de más de dos metros, esbelta y ' +
      'de una elegancia serena, con extremidades largas y proporción estilizada. Rostro casi ' +
      'humano y de belleza fría y perfecta: facciones finas y limpias, pómulos altos, ' +
      'mandíbula estrecha, nariz recta y pequeña, labios delgados y bien dibujados; la ' +
      'simetría es tan exacta que resulta imposible, y es lo único que delata que no es ' +
      'humano. Piel pálida de nácar, lisa y luminosa, con un tenue subtono gris perla. Cabeza ' +
      'calva de cráneo liso y hermoso, sin cejas ni pestañas. Ojos grandes y almendrados de ' +
      'oro uniforme, sin pupila, brillantes. Cuello largo, manos de dedos largos y finos. ' +
      'VESTUARIO, importante: túnica ceremonial de una sola pieza en tejido gris perla ' +
      'finísimo y pesado, de caída perfecta como agua quieta, impecable, sin una arruga fuera ' +
      'de sitio, con orillos limpios y precisos y un brillo tenue de seda. Ropa de una ' +
      'civilización avanzadísima: sobria, cara y perfectamente confeccionada. ' +
      'Expresión serena y cortés; nunca gesticula.',
  },
  {
    id: 'sereth', nombre: 'Sereth', alias: ['el archivista', 'el último lector'],
    principal: true,
    ficha: 'Alienígena vessari de la casta archivista. El mismo rostro fino y bello de su ' +
      'especie, con la dignidad de la edad: facciones nobles algo afiladas, piel pálida de ' +
      'nácar, mirada de cansancio inteligente. Alto y muy delgado, de hombros estrechos y ' +
      'espalda ligeramente inclinada por los siglos leyendo. Cabeza calva de cráneo liso. ' +
      'Ojos grandes de oro uniforme, sin pupila, con algo rápido y despierto moviéndose ' +
      'detrás. VESTUARIO: túnica larga y holgada de tejido gris topo, de buena calidad y ' +
      'caída fluida, con capucha amplia que a veces lleva echada; sencilla y sin adornos, ' +
      'pero limpia y bien confeccionada. Los dedos de la mano derecha manchados de ámbar seco.',
  },
  {
    id: 'goro', nombre: 'Gorō', alias: ['el yakuza'],
    ficha: 'Hombre japonés de unos cuarenta y cinco años, de atractivo rudo y carismático. ' +
      'Alto y corpulento, hombros anchos, espalda recta. Rostro de facciones fuertes y ' +
      'agradables, mandíbula cuadrada, sonrisa ladeada; una cicatriz vieja y fina le parte la ' +
      'ceja derecha, y le sienta bien. Pelo corto entrecano, peinado hacia atrás. Mirada ' +
      'tranquila de quien ya lo vio todo. Por el cuello del mono gris asoma el borde de un ' +
      'tatuaje tradicional japonés de tinta azul y roja.',
    vestuarios: [
      { id: 'mono', nombre: 'Mono gris de Categoría B', episodios: [6, 7, 9, 10, 11, 12],
        desc: 'Mono de una pieza en gris cemento, de tejido técnico mate, con la cremallera ' +
          'abierta hasta el pecho y el cuello de una camiseta interior asomando.' },
    ],
  },
  {
    id: 'yuto', nombre: 'Yuto',
    ficha: 'Chico japonés de diecisiete años, de cara dulce y aniñada. Delgado y de estatura ' +
      'media, hombros estrechos. Ojos grandes, redondos y expresivos, que delatan todo lo que ' +
      'siente. Pelo negro suave y algo revuelto, flequillo largo. Piel clara y limpia. ' +
      'Se abraza a sí mismo cuando escucha.',
    vestuarios: [
      { id: 'mono', nombre: 'Mono gris de Categoría B', episodios: [6, 7, 9, 10, 11, 12],
        desc: 'Mono de una pieza en gris cemento que le queda holgado de hombros y le sobra ' +
          'de manga.' },
    ],
  },
  {
    id: 'ogata', nombre: 'Ogata', alias: ['señor Ogata', 'el cobrador'],
    ficha: 'Hombre japonés de cincuenta años, de apostura impecable y desagradable. Rostro ' +
      'anguloso y bien parecido, sonrisa constante y cordial que nunca le llega a los ojos. ' +
      'Pelo negro engominado hacia atrás sin un mechón fuera de sitio. Alto y delgado. Traje ' +
      'gris de corte excelente, corbata discreta, zapatos brillantes, carpeta bajo el brazo.',
  },
  {
    id: 'aoki', nombre: 'Aoki', alias: ['señorita Aoki', 'la reclutadora'],
    ficha: 'Mujer japonesa de unos treinta años, guapa y de trato encantador. Rostro amable de ' +
      'facciones suaves, ojos cálidos, sonrisa entrenada y perfecta. Pelo castaño oscuro ' +
      'recogido en un moño bajo pulcro, con mechones sueltos enmarcándole la cara. Maquillaje ' +
      'natural impecable. Uniforme corporativo azul del Programa Puente, entallado, con placa ' +
      'identificativa. Manos abiertas al hablar, postura inclinada hacia el interlocutor.',
  },
  {
    id: 'matsuda', nombre: 'Matsuda', alias: ['viejo Matsuda', 'señor Matsuda'],
    ficha: 'Anciano japonés de setenta y ocho años, menudo y de aire entrañable. Cara redonda ' +
      'surcada de arrugas amables, ojos pequeños y vivos, sonrisa de pocos dientes pero ' +
      'sincera. Pelo blanco ralo y bien peinado. Chaqueta de punto marrón cuidada sobre ' +
      'camisa abotonada. Lleva su propia silla plegable a todas partes.',
  },
  {
    id: 'sachiko', nombre: 'Sachiko',
    ficha: 'Chica japonesa de veintidós años, de Nagoya, guapa y luminosa. Cara redonda y ' +
      'simpática, ojos grandes y brillantes, sonrisa amplia y contagiosa que le llega a los ' +
      'ojos. Piel clara y sana. Figura atlética y esbelta. Pelo castaño oscuro recogido en una ' +
      'coleta alta que se le mueve al hablar, con dos mechones sueltos. Conjunto deportivo ' +
      'blanco del Programa Puente.',
  },
  {
    id: 'tanaka', nombre: 'Tanaka',
    ficha: 'Chico japonés de diecisiete años, delgado y de cara simpática. Facciones ' +
      'agradables, mandíbula algo marcada, ojos oscuros de mirada tranquila; una cicatriz ' +
      'leve de acné en la mejilla izquierda que no le afea. Pelo negro corto y ordenado.',
    vestuarios: [
      { id: 'escuela', nombre: 'Uniforme escolar', episodios: [3, 4],
        desc: 'Uniforme escolar japonés masculino azul marino, impecable, con la chaqueta ' +
          'abotonada.' },
      { id: 'apagado', nombre: 'Caminante de servicio', episodios: [9],
        desc: 'Restos de un conjunto deportivo blanco muy descolorido, puesto del revés. El ' +
          'pelo rapado a trasquilones por manos ajenas. Un anillo de filamentos pálidos vivos ' +
          'alrededor del cuello. La mirada vacía, sin nadie detrás.' },
    ],
  },
  {
    id: 'mizuno', nombre: 'Mizuno', alias: ['Mizuno Kaede', 'la asistente'],
    ficha: 'Funcionaria japonesa de veintinueve años, atractiva y de aire competente. Rostro ' +
      'de facciones finas y serias, ojos oscuros atentos tras unas gafas discretas de montura ' +
      'fina. Piel clara. Figura esbelta. Pelo negro liso recogido en una coleta baja pulcra. ' +
      'Traje de oficina gris bien entallado. Lleva un llavero con un gato de la suerte.',
  },
  {
    id: 'kaori', nombre: 'Kaori', alias: ['la actriz', 'la de Osaka'],
    ficha: 'Actriz japonesa de veintitrés años, muy guapa con un aspecto de "chica normal" ' +
      'cuidadosamente diseñado. Rostro bonito y cercano, ojos grandes y cálidos, sonrisa de ' +
      'anuncio sostenida un segundo de más. Pelo castaño claro suelto y con ondas suaves. ' +
      'Maquillaje natural perfecto. Ropa de casa cómoda pero favorecedora.',
  },
  {
    id: 'cuidador', nombre: 'cuidador vessari', alias: ['los cuidadores', 'el cuidador'],
    ficha: 'Vessari de casta obrera: la versión de trabajo de la misma especie. Comparte el ' +
      'rostro base de su pueblo, pero todo en él es más ancho y más duro: mandíbula pesada y ' +
      'cuadrada, frente baja, cuello grueso, hombros anchos. Sigue siendo una figura alta y ' +
      'de buena estampa, imponente más que fea. Piel gris lisa y sin poros, más apagada que ' +
      'la de la casta alta. Cabeza calva de cráneo alargado hacia atrás. Ojos de oro ' +
      'uniforme, sin pupila. VESTUARIO: traje sellado de una pieza en gris oscuro, ajustado y ' +
      'de acabado técnico impecable, con placas articuladas y un visor espejado adherido al ' +
      'casco que a veces se retira. Lleva una vara viva de escaneo.',
  },
  {
    id: 'caminante', nombre: 'caminante de servicio', alias: ['el ser del collar', 'los caminantes'],
    ficha: 'Criatura de otra especie esclavizada, más baja que un humano y encorvada. Piel ' +
      'gris verdosa, brazos largos y finos, manos de dedos alargados. Ojos grandes y oscuros ' +
      'sin blanco, de mirada mansa y triste. Alrededor del cuello, un anillo de filamentos ' +
      'pálidos vivos que le entran por la nuca y le bajan por la columna como una raíz. Del ' +
      'cuello le cuelga un cordón viejo con tres cuentas de madera gastadas de tanto tocarlas.',
  },
  {
    id: 'instructor', nombre: 'instructor vessari', alias: ['el instructor'],
    ficha: 'Vessari de casta alta, alto y esbelto: mismo rostro fino y bello que Vaal, misma ' +
      'piel pálida de nácar y mismos ojos de oro sin pupila, pero de expresión más cálida y ' +
      'accesible. VESTUARIO: túnica clara de tejido finísimo y caída perfecta, impecable. ' +
      'Modales de docente paciente: manos siempre a la vista, gestos abiertos y lentos.',
  },
];

/** Las hojas de referencia que necesita un personaje: una por vestuario, más el rostro. */
export function variantesDe(personaje) {
  const ropa = (personaje.vestuarios && personaje.vestuarios.length)
    ? personaje.vestuarios.map((v) => ({ id: v.id, nombre: v.nombre, desc: v.desc, cuerpo: true }))
    : [{ id: 'hoja', nombre: 'Aspecto general', desc: '', cuerpo: true }];
  return ropa.concat([{ id: 'rostro', nombre: 'Rostro', desc: '', cuerpo: false }]);
}

/** Qué lleva puesto este personaje en un episodio concreto. */
export function vestuarioPara(personaje, episodio) {
  const vs = personaje.vestuarios;
  if (!vs || !vs.length) return { id: 'hoja', nombre: '', desc: '' };
  const n = Number(episodio);
  return vs.find((v) => (v.episodios || []).indexOf(n) !== -1) || vs[0];
}

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

// Sube cada vez que cambia la dirección de arte o el elenco. El estudio compara
// este número con el del proyecto guardado y refresca lo que no hayas tocado a mano.
export const BIBLIA_VERSION = 5;

export const CONFIG_DEFECTO = {
  bibliaVersion: BIBLIA_VERSION,

  // Solo para el saludo de la cabecera. Vive en este dispositivo.
  nombre: '',

  // Formato
  formato: '16:9',
  imageSize: '2K',

  // Modelos
  modeloTexto: 'gemini-3.1-pro-preview',
  modeloImagen: 'gemini-3-pro-image',
  modeloVideo: 'veo-3.1-lite-generate-001',
  modeloMusica: 'lyria-3-pro-preview',
  modeloTts: 'gemini-2.5-flash-preview-tts',

  // Voz — los tres campos siguientes los fija el tono elegido (app/voz.js)
  tono: 'narrador',
  voz: 'Charon',
  idioma: 'es-US',
  temperaturaVoz: 0.9,
  /*  Semilla FIJA a propósito. Vacía significa aleatoria, y con 134 llamadas
      por episodio eso son 134 sorteos distintos: parte de la variación de tono
      que se oye entre tomas viene de aquí. Con semilla fija, el muestreo deja
      de ser una lotería en cada llamada.                                      */
  semillaVoz: 20250726,
  instruccionVoz: INSTRUCCION_VOZ_DEFECTO,
  anunciarTitulo: true,
  silencioEscena: 0.7,

  // Segmentación
  segundosPorToma: 8,
  cps: 16,

  // Arte
  estilo: ESTILO_DEFECTO,
  calidad: CALIDAD_DEFECTO,
  negativo: NEGATIVO_DEFECTO,
  maxReferencias: 3,

  // Video
  resolucionVideo: '1080p',
  audioVeo: false,
  proporcionMovimiento: 0.35,   // fracción de tomas que se animan con Veo
  intensidadCamara: 1,          // 1 = normal; sube o baja el recorrido de las tomas fijas
  volumenMusica: 0.3,           // nivel de la música bajo la narración

  // Normalización de voz
  normalizarVoz: true,
  reemplazos: null,             // null = usar REEMPLAZOS_BASE

  // Precios orientativos en dólares, editables desde la interfaz.
  // Vertex cambia sus tarifas: aquí solo sirven para dimensionar el trabajo.
  // El segundo de video no está aquí: su precio depende del modelo, la resolución
  // y el audio, y sale de la tarifa oficial en app/veo.js.
  precios: { imagen: 0.15, vozMil: 0.012, episodio: 0.25 },
};

/*  EL ÚNICO SITIO QUE DECIDE QUÉ GANA, si lo guardado o el repositorio.

    Había dos: cargar() fusionaba y reparaba, y rehidratar() —la recuperación
    desde el bucket— volvía a fusionar sin reparar nada. Como el proyecto vive
    en Google Cloud y se recupera en CADA arranque, la segunda pisaba siempre a
    la primera: la semilla fija que se arregló ayer duraba unos milisegundos y
    volvía a quedarse vacía, con la voz sorteando el tono en cada llamada. Una
    reparación que solo se escribe en un camino no llega nunca.               */
export function normalizarConfig(guardada) {
  const previa = guardada || {};
  const c = { ...CONFIG_DEFECTO, ...previa };

  /*  precios es un objeto anidado: la fusión superficial lo sustituye ENTERO,
      así que una clave nueva dentro de precios no llegaría jamás a un proyecto
      ya guardado. Es el único campo con esa forma.                           */
  c.precios = { ...CONFIG_DEFECTO.precios, ...(previa.precios || {}) };

  /*  El tono fija voz, temperatura e instrucción, y se reaplica por si se
      afinó desde la última vez. Pero solo si la configuración guardada YA
      traía la clave: un proyecto anterior a los tonos no la tiene, y darle el
      tono por defecto le borraría la voz que hubiera elegido a mano. En ese
      caso se marca como personalizado, que es la verdad.                     */
  if (Object.prototype.hasOwnProperty.call(previa, 'tono')) {
    if (c.tono) aplicarTono(c, c.tono);
  } else if (previa.voz || previa.instruccionVoz) {
    c.tono = null;
  } else if (c.tono) {
    aplicarTono(c, c.tono);
  }

  /*  Semilla vacía significaba «aleatoria». Ya no es una opción válida: con
      una llamada por bloque eso son trescientos sorteos por temporada, y parte
      de la variación de tono que se oye entre tomas venía de ahí. null entra
      aquí a propósito: Number(null) es 0, que es finito, así que la guarda de
      aplicarTono lo dejaba pasar y acababa mandándose semilla 0.             */
  if (c.semillaVoz === '' || c.semillaVoz === null || c.semillaVoz === undefined ||
      !isFinite(Number(c.semillaVoz))) {
    c.semillaVoz = SEMILLA_FIJA;
  }
  return c;
}

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
