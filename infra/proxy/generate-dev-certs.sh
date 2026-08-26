#!/bin/sh
# Certificat auto-signé pour le dev local uniquement. En prod, remplacer par des
# certs Let's Encrypt (getUserMedia exige un contexte sécurisé —).
set -eu
mkdir -p "$(dirname "$0")/certs"

# Le README fait lancer ce script juste après `cp .env.example .env`, sans exporter
# quoi que ce soit : sans cette lecture, `SERVER_NAME` retombait sur `localhost` et le
# certificat ne couvrait pas le nom que Synapse appelle. C'est la panne que
# `subjectAltName` venait justement de corriger — un SAN juste, sur le mauvais nom.
# Une variable déjà présente dans l'environnement l'emporte (cas des tests).
lire_env() {
  [ -f "$ENV_FILE" ] || return 0
  # `[^A-Za-z]*` avale un éventuel BOM UTF-8, `\r` les fins de ligne Windows.
  sed -n "s/^[^A-Za-z]*$1=//p" "$ENV_FILE" | tr -d '\r' | tail -1
}
ENV_FILE="$(dirname "$0")/../.env"
SERVER_NAME="${SERVER_NAME:-$(lire_env SERVER_NAME)}"

NAME="${SERVER_NAME:-localhost}"
# Deux noms, et le TURN n'en demande pas un troisième : il s'annonce sous `$NAME`
# lui-même (rtc/livekit.yaml), donc le premier SAN le couvre déjà.
#
# `call.<domaine>` en revanche est indispensable : Element Call est servi sous son
# propre nom d'hôte par l'overlay RTC, et sans ce SAN l'iframe d'appel échoue au TLS.
# Le shard n'affiche alors que son délai de chargement, sans pouvoir en dire la
# cause — une panne muette de plus, pour un nom oublié dans une liste.
ALT="DNS:${NAME},DNS:call.${NAME}"

# `subjectAltName` n'est pas facultatif. Un certificat qui ne porte qu'un CN est
# refusé par tout client TLS moderne : les navigateurs depuis 2017, et côté serveur
# `service_identity` — donc Twisted, donc le client HTTP de Synapse, qui échoue alors
# sur sa propre découverte OIDC avec un simple timeout (voir README.md, « Login OIDC »).
# `MSYS_NO_PATHCONV=1` : sous Git Bash (Windows), MSYS prend le `/CN=…` pour un chemin
# et le réécrit en `C:/Program Files/Git/CN=…`, ce qui fait échouer openssl. Variable
# ignorée partout ailleurs — elle ne coûte rien sous Linux ni macOS.
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -sha256 -days 365 -nodes \
    -keyout "$(dirname "$0")/certs/privkey.pem" \
    -out "$(dirname "$0")/certs/fullchain.pem" \
    -subj "/CN=${NAME}" \
    -addext "subjectAltName=${ALT}"
