# ============================================================
# DIEZMO — montador de episodios
# ============================================================
# Corre como Cloud Run Job en el proyecto del usuario. No sabe
# nada de su cuenta: recibe por variables de entorno de dónde
# leer el encargo y dónde dejar el resultado, y el encargo lo
# escribe el backend, que es quien tiene los datos.
#
# Se parte de la imagen del SDK porque trae "gcloud storage" ya
# autenticado con la cuenta del propio Job. Pesa más que una
# base mínima, pero se construye una sola vez y evita tener que
# firmar peticiones a mano dentro del contenedor.
# ============================================================
FROM google/cloud-sdk:slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

COPY montar.sh /montar.sh
RUN chmod +x /montar.sh

ENTRYPOINT ["/montar.sh"]
