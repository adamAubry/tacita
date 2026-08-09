#!/bin/sh
# Hook de déploiement certbot — recopie le certificat renouvelé là où le proxy le lit,
# puis recharge nginx sans couper les connexions.
#
# À installer sur le VPS en `/etc/letsencrypt/renewal-hooks/deploy/tacita.sh` (voir
# README.md, § 4). Certbot l'exécute après chaque renouvellement réussi, avec
# `RENEWED_LINEAGE` pointant sur le répertoire `live/<domaine>` concerné.
#
# ponytail: une recopie plutôt qu'un montage de `/etc/letsencrypt`. Les fichiers de
# `live/` sont des liens symboliques **relatifs** vers `../../archive/` : montés dans le
# conteneur, ils pointent hors du montage et nginx ne démarre plus. Monter le lien
# résolu marche jusqu'au premier renouvellement, qui écrit un `fullchain2.pem` que le
# montage ne suit pas — le proxy sert alors un certificat expiré sans rien signaler.
set -eu

# Adapter si le dépôt n'est pas cloné là. Le répertoire est celui que la pile de base
# monte en lecture seule dans le proxy (`./proxy/certs`).
TACITA_DIR="${TACITA_DIR:-/opt/tacita}"
CERTS_DIR="$TACITA_DIR/infra/proxy/certs"

install -d -m 755 "$CERTS_DIR"
install -m 644 "$RENEWED_LINEAGE/fullchain.pem" "$CERTS_DIR/fullchain.pem"
install -m 600 "$RENEWED_LINEAGE/privkey.pem" "$CERTS_DIR/privkey.pem"

# `nginx -s reload` et non un `restart` du conteneur : le proxy garde ses connexions, et
# surtout il ne redémarre pas dans un état où `web` ou `synapse` auraient changé d'IP.
# `|| true` : au tout premier certificat, la pile n'est pas encore levée — le hook ne doit
# pas faire échouer l'émission pour ça.
cd "$TACITA_DIR/infra"
docker compose -f docker-compose.yml -f staging/docker-compose.yml exec -T proxy nginx -s reload || true
