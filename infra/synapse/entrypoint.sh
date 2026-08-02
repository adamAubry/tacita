#!/bin/sh
set -eu

# homeserver.yaml n'est pas templaté nativement par l'image officielle (start.py ne
# fait que vérifier son existence) : on rend nous-mêmes les ${VAR} avant de démarrer.
envsubst < /conf/homeserver.yaml.tmpl > /data/homeserver.yaml

# start.py bascule sur l'uid 991 quand il tourne en root (cf. son propre code) ; /data
# doit lui appartenir pour qu'il puisse y écrire ses clés générées au premier démarrage.
chown -R 991:991 /data

exec /start.py "$@"
