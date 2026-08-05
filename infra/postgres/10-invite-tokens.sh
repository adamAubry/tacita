#!/bin/sh
# REQ-INF-15 — base **dédiée** au service de liens (spec 12), jamais une table dans
# celle de Synapse : un service qui n'a aucun pouvoir Matrix ne doit pas partager la
# base de celui qui en a tous.
#
# Exécuté par l'entrypoint de l'image postgres, donc **uniquement à la première
# initialisation du volume**. Sur une pile déjà démarrée, créer la base à la main :
#
#   docker compose exec postgres createdb -U "$POSTGRES_USER" invite_tokens
#
# `createdb` et non `psql -c` : il hérite du template et des paramètres de locale C
# posés par POSTGRES_INITDB_ARGS (REQ-INF-01).
set -e
createdb -U "$POSTGRES_USER" invite_tokens
