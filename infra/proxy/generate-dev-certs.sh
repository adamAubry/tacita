#!/bin/sh
# Certificat auto-signé pour le dev local uniquement. En prod, remplacer par des
# certs Let's Encrypt (getUserMedia exige un contexte sécurisé — REQ-INF-10).
set -eu
mkdir -p "$(dirname "$0")/certs"

NAME="${SERVER_NAME:-localhost}"
# `.env` déclare TURN_DOMAIN comme devant être un SAN du certificat monté
# (rtc/README.md) : on l'ajoute quand il est défini, sinon la spec 02 hérite d'un
# certificat qui ne couvre pas son propre domaine.
ALT="DNS:${NAME}${TURN_DOMAIN:+,DNS:$TURN_DOMAIN}"

# `subjectAltName` n'est pas facultatif. Un certificat qui ne porte qu'un CN est
# refusé par tout client TLS moderne : les navigateurs depuis 2017, et côté serveur
# `service_identity` — donc Twisted, donc le client HTTP de Synapse, qui échoue alors
# sur sa propre découverte OIDC avec un simple timeout (voir README.md, « Login OIDC »).
openssl req -x509 -newkey rsa:2048 -sha256 -days 365 -nodes \
    -keyout "$(dirname "$0")/certs/privkey.pem" \
    -out "$(dirname "$0")/certs/fullchain.pem" \
    -subj "/CN=${NAME}" \
    -addext "subjectAltName=${ALT}"
