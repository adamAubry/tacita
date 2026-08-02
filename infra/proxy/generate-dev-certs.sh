#!/bin/sh
# Certificat auto-signé pour le dev local uniquement. En prod, remplacer par des
# certs Let's Encrypt (getUserMedia exige un contexte sécurisé — REQ-INF-10).
set -eu
mkdir -p "$(dirname "$0")/certs"
openssl req -x509 -newkey rsa:2048 -sha256 -days 365 -nodes \
    -keyout "$(dirname "$0")/certs/privkey.pem" \
    -out "$(dirname "$0")/certs/fullchain.pem" \
    -subj "/CN=${SERVER_NAME:-localhost}"
