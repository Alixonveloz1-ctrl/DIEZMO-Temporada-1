# DIEZMO — Temporada 1

Serie de anime seinen de ciencia ficción oscura, y el estudio que la produce.

Este repositorio contiene dos cosas: los **doce guiones** de la temporada uno y una
**herramienta de producción** que los convierte en episodios animados usando Vertex AI
de Google Cloud para la voz, la imagen y el movimiento.

---

## Qué hay aquí

```
episodios/          Los doce guiones. El texto original nunca se modifica.
biblia/             Biblia de concepto y mapa de la temporada.
index.html          El estudio: interfaz completa de producción.
app/                Módulos del estudio.
  texto.js            limpieza, normalización para voz, segmentación en tomas
  biblia.js           dirección de arte, elenco y localizaciones
  director.js         el pase de dirección con IA
  pipeline.js         motor de generación (voz, fotogramas, movimiento)
  player.js           sala de proyección
  exportar.js         paquete .zip + script de ffmpeg
  db.js  api.js  main.js
api/ep-gemini.js    Backend: única puerta hacia Vertex AI.
vercel.json         Configuración de despliegue.
```

---

## Puesta en marcha

### 1 · Google Cloud

Activa en tu proyecto las API de **Vertex AI** y, si vas a generar video, **Cloud Storage**.

Crea una cuenta de servicio con el rol `Vertex AI User`. Si usas video, añádele además
`Storage Object Admin` sobre el bucket. Descarga su clave en JSON.

Crea un bucket para los clips de Veo:

```bash
gcloud storage buckets create gs://diezmo-video --location=us-central1
```

### 2 · Vercel

Despliega el repositorio y define tres variables de entorno:

| Variable | Valor |
|---|---|
| `GCP_PROJECT_ID` | el identificador de tu proyecto de Google Cloud |
| `GCP_SERVICE_ACCOUNT` | el contenido íntegro del JSON de la cuenta de servicio |
| `GCS_BUCKET` | `diezmo-video` (sin el prefijo `gs://`) |

Abre la página: la primera pestaña comprueba la conexión y te dice exactamente qué falta.

### 3 · CORS en el bucket (recomendado)

Veo escribe los clips en Cloud Storage. Sin CORS, el navegador puede reproducirlos pero
no descargarlos al proyecto, y quedarán fuera del `.zip`. Se arregla una sola vez:

```bash
cat > cors.json <<'EOF'
[{"origin":["*"],"method":["GET","HEAD"],"responseHeader":["Content-Type"],"maxAgeSeconds":3600}]
EOF
gcloud storage buckets update gs://diezmo-video --cors-file=cors.json
```

---

## Cómo se produce un episodio

El estudio tiene seis pestañas, y se recorren en orden.

**01 · Proyecto.** Pulsa «Cargar los doce episodios»: se leen de `/episodios` y se parten
en tomas. La segmentación es determinista y se verifica sola — si la concatenación de las
tomas no reproduce el guion carácter a carácter, la interfaz lo avisa. Ninguna palabra se
pierde nunca.

**02 · Biblia visual.** Aquí está el corazón de la consistencia. Genera la **hoja de
referencia** de cada personaje (tres vistas sobre fondo neutro) y el **fondo maestro** de
cada localización. A partir de ese momento, cada fotograma donde aparezca Sōta lleva
adjunta la imagen de Sōta: es lo que hace que tenga la misma cara en el episodio uno y en
el doce. También se edita aquí el estilo visual que encabeza todas las imágenes de la serie.

**03 · Guion técnico.** «Dirigir este episodio» manda el texto a Gemini, que decide para
cada toma el encuadre, quién está en cuadro, la localización, la luz, la atmósfera y el
movimiento. La IA no toca el texto: solo decide cómo se ve. Aquí también eliges cuántas
tomas se animan de verdad y cuántas se quedan como fotograma con movimiento de cámara.

**04 · Producción.** Genera voz, fotogramas y movimiento. Se puede detener y reanudar sin
perder nada. Cada toma se puede regenerar, editar su prompt, bloquear para que no se toque,
o cambiar de fija a animada. El panel de presupuesto estima el coste antes de empezar.

**05 · Sala.** Reproduce el episodio montado tal como quedará: la voz manda el tiempo, la
imagen o el clip se acomodan a ella.

**06 · Entrega.** Exporta un `.zip` con los fotogramas, los clips, las voces, la hoja de
montaje en JSON, el guion técnico legible y un `montar.sh`. Descomprime y ejecuta:

```bash
bash montar.sh          # produce DIEZMO-EP01.mp4
```

---

## Decisiones de diseño que conviene conocer

**La voz manda el tiempo.** Primero se genera la narración de cada toma; su duración real
define cuánto dura el plano. Nada se desincroniza porque nada se estima.

**Fijo por defecto, movimiento donde importa.** Un episodio son unas ciento treinta tomas.
Animarlas todas con Veo cuesta un orden de magnitud más que animar el treinta y cinco por
ciento que de verdad lo necesita; el resto funciona como fotograma con un travelling lento,
que es exactamente lo que hace el anime real cuando no hay presupuesto. El director de IA
puntúa cada toma según cuánto gana con movimiento, y el reparto respeta esa puntuación.

**Las cifras se convierten a letras antes de narrar.** Los guiones traen `¥280.000`,
`06:47`, `214-B-1187`. Un TTS los lee mal. El estudio los normaliza en memoria justo antes
de enviar el texto — «doscientos ochenta mil yenes», «las seis y cuarenta y siete»,
«doscientos catorce be mil ciento ochenta y siete». **Los archivos `.md` no se modifican
nunca.** En la pestaña de guion técnico, «Ver texto normalizado» enseña toma por toma
cómo va a sonar. Los casos que ninguna regla resuelve bien (género gramatical, monedas con
decimal) están en una tabla de reemplazos editable en `app/texto.js`.

**El trabajo sobrevive al cierre de la pestaña.** Todo vive en IndexedDB. Aun así, exporta
a menudo: pulsa «Proteger del borrado automático» en la primera pestaña.

---

## Límites conocidos

- Veo genera clips de ocho segundos como máximo. Cuando la locución de una toma dura más,
  el montaje congela el último fotograma para cubrir el resto — es lo que hace también el
  reproductor de la sala.
- Los modelos de Vertex cambian de nombre y de disponibilidad. «Descubrir modelos
  disponibles» consulta tu propio proyecto y rellena las listas; ningún identificador está
  fijado en el código.
- El estudio genera imagen, movimiento y voz. No genera música ni efectos de sonido: esos
  se añaden en el montaje final sobre el `.mp4` que produce `montar.sh`.
- Los precios del panel de presupuesto son orientativos y editables. Consulta la tarifa
  vigente de Vertex AI para tu proyecto.

---

## La serie

Una civilización alienígena demuestra en tres días que la humanidad no puede tocarla, y
después hace una oferta cortés: diez millones de humanos entregados voluntariamente, o cien
millones tomados por la fuerza. Los gobiernos de la Tierra eligen mentir. Sōta Amamiya,
diecinueve años, descubre que su hermana firmó —con la firma de él falsificada— y cruza el
Umbral para seguirla al otro lado de la mentira.

Doce episodios, tres arcos, unos ciento ochenta minutos de narración continua.
La biblia completa está en [`biblia/concepto.md`](biblia/concepto.md).
