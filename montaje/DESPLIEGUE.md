# Desplegar el montador (una sola vez)

El montador es un **Cloud Run Job** que vive en tu proyecto de Google Cloud. Junta los
fotogramas, el movimiento de cámara, los clips, la voz y la música, y deja el `.mp4`
terminado en tu bucket.

**No lleva escrito ningún dato de tu cuenta.** Ni bucket, ni proyecto, ni cuenta de
servicio. Todo eso se lo dice la herramienta en cada encargo. Por eso puedes pegar el
texto de abajo sin miedo a que apunte a la cuenta equivocada: no hay ninguna cuenta a la
que apuntar.

---

## Paso 1 — Comprobar en qué cuenta estás

Abre **Google Cloud Shell** (el icono de terminal, arriba a la derecha de la consola) y
pega esto tal cual:

```bash
gcloud config get-value project && gcloud storage ls
```

Te dirá el proyecto activo y tus buckets. **Comprueba que es la cuenta correcta antes de
seguir.** Si no lo es:

```bash
gcloud auth login && gcloud config set project EL-PROYECTO-QUE-QUIERAS
```

---

## Paso 2 — Pegarle esto al asistente del editor

Abre el **editor de Cloud Shell** y pásale al asistente este bloque completo:

> Crea una carpeta `montaje` con exactamente estos dos archivos, con este contenido
> literal, sin cambiar ni una línea, sin añadir comentarios y sin adaptar nada. No
> sustituyas ningún valor: el código es correcto tal cual y no debe llevar ningún
> identificador de proyecto, bucket ni cuenta de servicio.
>
> **Archivo `montaje/Dockerfile`:**
>
> ```dockerfile
> FROM google/cloud-sdk:slim
>
> RUN apt-get update \
>  && apt-get install -y --no-install-recommends ffmpeg \
>  && rm -rf /var/lib/apt/lists/*
>
> COPY montar.sh /montar.sh
> RUN chmod +x /montar.sh
>
> ENTRYPOINT ["/montar.sh"]
> ```
>
> **Archivo `montaje/montar.sh`:**
>
> ```bash
> #!/bin/bash
> set -euo pipefail
>
> : "${TRABAJO:?falta TRABAJO}"
> : "${SALIDA:?falta SALIDA}"
>
> obra=/tmp/obra
> rm -rf "$obra"; mkdir -p "$obra"; cd "$obra"
> mkdir -p fotogramas voz clips musica segmentos bajado
>
> echo "── Encargo: $TRABAJO"
> gcloud storage cp "$TRABAJO/hoja.json" "$TRABAJO/montar.sh" "$TRABAJO/descargas.txt" .
>
> if [ -n "${PREFIJO:-}" ]; then
>   echo "── Material: $PREFIJO"
>   gcloud storage cp -r "$PREFIJO/**" bajado/ 2>/dev/null || true
> fi
>
> : > faltan.txt
> while IFS=$'\t' read -r origen destino; do
>   [ -z "${origen:-}" ] && continue
>   copia="bajado/${origen#${PREFIJO:-__nada__}/}"
>   if [ -f "$copia" ]; then
>     cp "$copia" "$destino"
>   else
>     printf '%s\t%s\n' "$origen" "$destino" >> faltan.txt
>   fi
> done < descargas.txt
>
> if [ -s faltan.txt ]; then
>   echo "── $(wc -l < faltan.txt) archivos sueltos"
>   awk -F'\t' '{print $1"\n"$2}' faltan.txt | xargs -P 8 -n 2 gcloud storage cp
> fi
>
> echo "── Montando"
> bash montar.sh
>
> terminado=$(ls -1 DIEZMO-EP*.mp4 2>/dev/null | head -n 1 || true)
> if [ -z "$terminado" ]; then
>   echo "El montaje terminó sin producir el MP4" >&2
>   exit 1
> fi
>
> echo "── Subiendo $terminado ($(du -h "$terminado" | cut -f1))"
> gcloud storage cp "$terminado" "$SALIDA"
> echo "Listo."
> ```
>
> Cuando los dos archivos existan, dime solo «hecho». No ejecutes nada.

---

## Paso 3 — Desplegar

De vuelta en la terminal de Cloud Shell, pega esto entero. Es un solo bloque: habilita
las APIs, despliega el Job y da los permisos. Sustituye **solo** `TU-BUCKET` por el
nombre de tu bucket (sin `gs://`), que lo viste en el paso 1.

```bash
BUCKET=TU-BUCKET

set -e
PROY=$(gcloud config get-value project)
NUM=$(gcloud projects describe "$PROY" --format='value(projectNumber)')

gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com texttospeech.googleapis.com

gcloud run jobs deploy diezmo-montaje \
  --source montaje \
  --region us-central1 \
  --memory 8Gi \
  --cpu 8 \
  --task-timeout 3600s \
  --max-retries 1

# El montador lee y escribe en tu bucket.
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$NUM-compute@developer.gserviceaccount.com" \
  --role=roles/storage.objectAdmin

echo "Montador desplegado en $PROY."
```

---

## Paso 4 — Dar permiso a la herramienta para lanzarlo

La cuenta de servicio que usa la herramienta (la del `GCP_SERVICE_ACCOUNT` de Vercel)
necesita poder arrancar el Job. Pega esto poniendo su correo, que lo encuentras en la
consola en **IAM y administración → Cuentas de servicio**:

```bash
gcloud run jobs add-iam-policy-binding diezmo-montaje \
  --region us-central1 \
  --member="serviceAccount:EL-CORREO-DE-TU-CUENTA-DE-SERVICIO" \
  --role=roles/run.invoker

gcloud projects add-iam-policy-binding "$(gcloud config get-value project)" \
  --member="serviceAccount:EL-CORREO-DE-TU-CUENTA-DE-SERVICIO" \
  --role=roles/run.viewer
```

---

## Paso 5 — Si desplegaste en otra región o con otro nombre

Solo si cambiaste algo del paso 3: añade en Vercel estas variables de entorno.

| Variable | Valor |
|---|---|
| `MONTAJE_JOB` | el nombre que le pusieras (por defecto `diezmo-montaje`) |
| `MONTAJE_REGION` | la región que usaras (por defecto `us-central1`) |

Si seguiste los pasos tal cual, **no hace falta añadir nada**.

---

## Ya está

En la pestaña **Entrega** de la herramienta, «Montar el episodio (.mp4)». Tarda unos
minutos: cuando termina, el episodio queda en tu bucket y se baja con «Descargar el
último montaje».

Si algo falla, el detalle está en la consola de Google Cloud, en **Cloud Run → Jobs →
diezmo-montaje → Ejecuciones**.
