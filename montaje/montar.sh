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

echo "── Encargo: $TRABAJO"
gcloud storage cp "$TRABAJO/hoja.json" "$TRABAJO/montar.sh" "$TRABAJO/descargas.txt" .

# Una sola llamada para todo el material del episodio. Bajar 134 archivos con
# 134 invocaciones costaría más tiempo que el propio montaje.
if [ -n "${PREFIJO:-}" ]; then
  echo "── Material: $PREFIJO"
  gcloud storage cp -r "$PREFIJO/**" bajado/ 2>/dev/null || true
fi

# descargas.txt: una línea por archivo, "origen<TAB>destino".
: > faltan.txt
while IFS=$'\t' read -r origen destino; do
  [ -z "${origen:-}" ] && continue
  copia="bajado/${origen#${PREFIJO:-__nada__}/}"
  if [ -f "$copia" ]; then
    cp "$copia" "$destino"
  else
    printf '%s\t%s\n' "$origen" "$destino" >> faltan.txt
  fi
done < descargas.txt

# Lo que no venía en el episodio —una toma que reutiliza el fotograma de otro—
# se baja suelto, en paralelo para que no se note.
if [ -s faltan.txt ]; then
  echo "── $(wc -l < faltan.txt) archivos sueltos"
  awk -F'\t' '{print $1"\n"$2}' faltan.txt | xargs -P 8 -n 2 gcloud storage cp
fi

echo "── Montando"
bash montar.sh

terminado=$(ls -1 DIEZMO-EP*.mp4 2>/dev/null | head -n 1 || true)
if [ -z "$terminado" ]; then
  echo "El montaje terminó sin producir el MP4" >&2
  exit 1
fi

echo "── Subiendo $terminado ($(du -h "$terminado" | cut -f1))"
gcloud storage cp "$terminado" "$SALIDA"
echo "Listo."
