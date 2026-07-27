#!/bin/bash
# ============================================================
# DIEZMO — montador de episodios
# ============================================================
# Recibe tres variables:
#   TRABAJO  carpeta gs:// con el encargo (hoja.json, montar.sh,
#            descargas.txt) que ha escrito el backend
#   PREFIJO  carpeta gs:// del material del episodio, para
#            bajarlo de una vez en lugar de archivo a archivo
#   SALIDA   ruta gs:// donde dejar el MP4 terminado
#
# No hay ningún dato de la cuenta escrito aquí: todo llega en
# esas tres rutas, y quien las compone es el backend.
# ============================================================
set -euo pipefail

: "${TRABAJO:?falta TRABAJO}"
: "${SALIDA:?falta SALIDA}"

obra=/tmp/obra
rm -rf "$obra"; mkdir -p "$obra"; cd "$obra"
mkdir -p fotogramas voz clips musica segmentos bajado

# Cualquier queja del montador se guarda para que la lea el Estudio: desde un
# teléfono no hay forma de abrir el registro de Cloud Run, y "exit code 254" no
# le dice nada a nadie. Se instala antes de la primera descarga, que también
# puede fallar. La nota no menciona ninguna ruta: los nombres del bucket y del
# proyecto no salen de aquí.
avisa() { printf '%s\n' "$@" | tee -a error.txt >&2; }
: > error.txt
trap 'gcloud storage cp error.txt "$TRABAJO/error.txt" 2>/dev/null || true' EXIT

echo "── Encargo: $TRABAJO"
if ! gcloud storage cp "$TRABAJO/hoja.json" "$TRABAJO/montar.sh" "$TRABAJO/descargas.txt" . 2> encargo.txt; then
  avisa "El montador no pudo leer el encargo:" "$(tail -n 5 encargo.txt)"
  exit 1
fi

# Una sola llamada para todo el material del episodio. Bajar 134 archivos con
# 134 invocaciones costaría más tiempo que el propio montaje.
if [ -n "${PREFIJO:-}" ]; then
  echo "── Material: $PREFIJO"
  gcloud storage cp -r "$PREFIJO/**" bajado/ 2>/dev/null || true
fi

# descargas.txt: una línea por archivo, "origen<TAB>destino". El «|| [ -n ]» no
# es adorno: si el archivo no termina en salto de línea, «read» devuelve falso
# al leer la última y el bucle la descarta en silencio. Se perdía siempre el
# último archivo del encargo y ffmpeg moría sin poder abrirlo.
: > faltan.txt
: > esperados.txt
while IFS=$'\t' read -r origen destino || [ -n "${origen:-}" ]; do
  [ -z "${origen:-}" ] && continue
  copia="bajado/${origen#${PREFIJO:-__nada__}/}"
  if [ -f "$copia" ]; then
    cp "$copia" "$destino"
  else
    printf '%s\t%s\n' "$origen" "$destino" >> faltan.txt
  fi
  printf '%s\n' "$destino" >> esperados.txt
done < descargas.txt

# Lo que no venía en el episodio —una toma que reutiliza el fotograma de otro—
# se baja suelto, en paralelo para que no se note.
# El «|| true» deja que la comprobación de abajo diga QUÉ falta. Sin él, la
# primera pieza que no esté en el bucket mata el montador con un número y sin
# una palabra, que es justo lo que se quiere evitar.
if [ -s faltan.txt ]; then
  echo "── $(wc -l < faltan.txt) archivos sueltos"
  awk -F'\t' '{print $1"\n"$2}' faltan.txt | xargs -P 8 -n 2 gcloud storage cp || true
fi

# Se comprueba ANTES de montar que está todo. Si falta algo se dice cuál, en vez
# de dejar que ffmpeg se estrelle contra el primero y devuelva un número.
sin=$(while read -r d; do [ -f "$d" ] || printf '%s\n' "$d"; done < esperados.txt)
if [ -n "$sin" ]; then
  avisa "No llegó todo el material del episodio. Falta:" "$sin" \
    "Genera esas piezas en el Estudio y vuelve a montar."
  exit 1
fi

echo "── Montando"
if ! bash montar.sh 2> ffmpeg.txt; then
  avisa "ffmpeg falló al montar:" "$(tail -n 20 ffmpeg.txt)"
  exit 1
fi

terminado=$(ls -1 DIEZMO-EP*.mp4 2>/dev/null | head -n 1 || true)
if [ -z "$terminado" ]; then
  avisa "El montaje terminó sin producir el MP4."
  exit 1
fi

echo "── Subiendo $terminado ($(du -h "$terminado" | cut -f1))"
gcloud storage cp "$terminado" "$SALIDA"
echo "Listo."
