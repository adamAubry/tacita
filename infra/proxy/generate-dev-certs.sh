#!/bin/sh
# Certificat auto-signé pour le dev local uniquement. En prod, remplacer par des
# certs Let's Encrypt (getUserMedia exige un contexte sécurisé — REQ-INF-10).
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
TURN_DOMAIN="${TURN_DOMAIN:-$(lire_env TURN_DOMAIN)}"

NAME="${SERVER_NAME:-localhost}"
# `.env` déclare TURN_DOMAIN comme devant être un SAN du certificat monté
# (rtc/README.md) : on l'ajoute quand il est défini, sinon la spec 02 hérite d'un
# certificat qui ne couvre pas son propre domaine.
ALT="DNS:${NAME}${TURN_DOMAIN:+,DNS:$TURN_DOMAIN}"

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
