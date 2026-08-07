#!/bin/sh
set -eu

# REQ-INF-09 — l'origine du shard, quand il n'est pas servi sur le domaine du
# homeserver. Rendu en entrée de liste YAML, ou en ligne vide quand il n'y a rien à
# ouvrir : `envsubst` ne sait pas produire une ligne conditionnelle, un shell si.
if [ -n "${SHARD_ORIGIN:-}" ]; then
  SSO_CLIENT_WHITELIST="[\"https://${SERVER_NAME}/\", \"${SHARD_ORIGIN}\"]"
else
  SSO_CLIENT_WHITELIST="[\"https://${SERVER_NAME}/\"]"
fi
export SSO_CLIENT_WHITELIST

# homeserver.yaml n'est pas templaté nativement par l'image officielle (start.py ne
# fait que vérifier son existence) : on rend nous-mêmes les ${VAR} avant de démarrer.
envsubst < /conf/homeserver.yaml.tmpl > /data/homeserver.yaml

# start.py bascule sur l'uid 991 quand il tourne en root (cf. son propre code) ; /data
# doit lui appartenir pour qu'il puisse y écrire ses clés générées au premier démarrage.
chown -R 991:991 /data

exec /start.py "$@"
