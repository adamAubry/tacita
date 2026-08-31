#!/bin/sh
# Point d'entrée unique pour les certificats du proxy (REQ-INF-10).
#
# Deux sources, une seule commande pour l'admin :
#   - certbot a déjà émis un certificat pour $SERVER_NAME  -> copié ici ;
#   - sinon                                                -> auto-signé de dev.
#
# nginx lit `certs/fullchain.pem` et `certs/privkey.pem` (nginx.conf), montés en
# lecture seule par le compose. certbot, lui, écrit sous
# /etc/letsencrypt/live/<domaine>/ et ne connaît pas ce dépôt : sans cette copie,
# la pile démarre sur l'auto-signé **sans rien dire**, et l'admin ne découvre au
# navigateur qu'il sert un certificat invalide qu'une fois en production.
set -eu

ICI="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
INFRA="$(dirname "$ICI")"
# Surchargeables pour les tests et les installations non standard
# (`certbot --config-dir`) ; l'admin n'y touche jamais.
CERTS="${CERTS_DIR:-$ICI/certs}"
LETSENCRYPT_LIVE="${LETSENCRYPT_LIVE:-/etc/letsencrypt/live}"

# Même lecture de .env que generate-dev-certs.sh : le README fait lancer ce script
# juste après `cp .env.example .env`, sans rien exporter. Une variable déjà
# présente dans l'environnement l'emporte (cas des tests).
ENV_FILE="$INFRA/.env"
lire_env() {
  [ -f "$ENV_FILE" ] || return 0
  # `[^A-Za-z]*` avale un éventuel BOM UTF-8, `\r` les fins de ligne Windows.
  sed -n "s/^[^A-Za-z]*$1=//p" "$ENV_FILE" | tr -d '\r' | tail -1
}
SERVER_NAME="${SERVER_NAME:-$(lire_env SERVER_NAME)}"

NOM="${SERVER_NAME:-localhost}"
LIVE="$LETSENCRYPT_LIVE/$NOM"
mkdir -p "$CERTS"

# Test sur `-d` et pas sur `-r` : le répertoire peut exister tout en étant
# illisible — certbot met /etc/letsencrypt/{live,archive} en 0700 root. Tester la
# lisibilité ferait retomber l'admin sur l'auto-signé en silence, c'est-à-dire
# reproduire la panne muette que ce script existe pour supprimer.
if [ -d "$LIVE" ]; then
  if [ ! -r "$LIVE/privkey.pem" ]; then
    echo "certs: $LIVE existe mais n'est pas lisible." >&2
    echo "       certbot garde /etc/letsencrypt en 0700 root. Relancer avec :" >&2
    echo "         sudo -E $0" >&2
    exit 1
  fi
  # `cp -L` : dans live/, les .pem sont des liens vers archive/<domaine>/<n>.pem.
  # On copie le fichier pointé, pas le lien — un lien serait mort dans le conteneur.
  cp -L "$LIVE/fullchain.pem" "$CERTS/fullchain.pem"
  cp -L "$LIVE/privkey.pem" "$CERTS/privkey.pem"
  chmod 600 "$CERTS/privkey.pem"
  # Lancé sous sudo, les copies appartiendraient à root : la prochaine exécution
  # sans sudo échouerait à les écraser, et l'admin servirait un certificat périmé.
  if [ -n "${SUDO_USER:-}" ]; then
    chown "$SUDO_USER" "$CERTS/fullchain.pem" "$CERTS/privkey.pem"
  fi
  echo "certs: Let's Encrypt pour $NOM -> $CERTS"
  echo "       Expire le : $(openssl x509 -in "$CERTS/fullchain.pem" -noout -enddate | cut -d= -f2)"
  echo "       Le renouvellement certbot n'écrit QUE dans $LIVE : sans deploy-hook,"
  echo "       le proxy servira un certificat périmé au bout de 90 jours. À poser une fois :"
  echo "         certbot renew --deploy-hook '$ICI/setup-certs.sh && docker compose -f $INFRA/docker-compose.yml restart proxy'"
else
  echo "certs: aucun certificat Let's Encrypt pour $NOM sous $LETSENCRYPT_LIVE"
  echo "       -> auto-signé (dev uniquement, le navigateur affichera un avertissement)"
  CERTS_DIR="$CERTS" "$ICI/generate-dev-certs.sh"
fi
