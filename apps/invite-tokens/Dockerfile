# node:22-alpine (2026-08-03), digest épinglé comme les autres images du compose.
# Résolu via `docker buildx imagetools inspect node:22-alpine` — à revérifier avant
# tout bump de version, voir infra/README.md.
FROM node@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

WORKDIR /app

# Même patron que apps/push-gateway : une seule dépendance, aucune dépendance de
# workspace. La version est **figée ici et vérifiée par un test**
# (infra/tests/invite-tokens.test.ts) contre celle que pnpm a résolue dans
# pnpm-lock.yaml — sans quoi l'image installerait au build autre chose que ce qui a
# été testé.
#
# Le `package.json` de l'app est copié d'abord : sans lui, Node ne voit pas
# `"type": "module"` et journalise un avertissement à chaque démarrage.
COPY apps/invite-tokens/package.json ./
RUN npm install --omit=dev --no-package-lock --no-fund --no-audit pg@8.22.0

COPY apps/invite-tokens/src ./src

# Pas de root : le service ne parle qu'à PostgreSQL et à Synapse.
USER node

# Le service refuse de démarrer sans DATABASE_URL ni HOMESERVER_URL (src/index.ts).
# Aucun jeton d'administration Synapse ne lui est passé, ici ni ailleurs : `invite-tokens`
# lui interdit tout pouvoir Matrix.
CMD ["node", "--experimental-strip-types", "src/index.ts"]
