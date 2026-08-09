# node:22-alpine (2026-08-03), même digest que apps/push-gateway et apps/invite-tokens.
# Résolu via `docker buildx imagetools inspect node:22-alpine` — à revérifier avant tout
# bump de version, voir infra/README.md.
FROM node@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build

WORKDIR /repo

# Contrairement aux deux autres services, le shard **a** des dépendances de workspace
# (`@tacita/*`) : il faut le monorepo entier et pnpm, pas un `npm install` ciblé.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# Une seule copie, sans découpage en couches par `package.json` : un déploiement de
# staging est rare, et le gain de cache ne vaut pas la liste de chemins à maintenir.
# ponytail: si les builds deviennent fréquents, découper ici avant d'optimiser ailleurs.
COPY . .
RUN pnpm install --frozen-lockfile

# **Ces trois valeurs sont figées dans le bundle par `next build`** (`NEXT_PUBLIC_*` est
# inliné, pas lu au démarrage) : l'image produite n'est valable que pour le déploiement
# qui l'a construite. C'est le motif du build sur la machine cible plutôt que d'un
# registre d'images — voir infra/staging/README.md.
ARG NEXT_PUBLIC_HOMESERVER_URL
ARG NEXT_PUBLIC_ELEMENT_CALL_URL
ARG NEXT_PUBLIC_PUSH_NOTIFY_URL
ENV NEXT_PUBLIC_HOMESERVER_URL=$NEXT_PUBLIC_HOMESERVER_URL \
    NEXT_PUBLIC_ELEMENT_CALL_URL=$NEXT_PUBLIC_ELEMENT_CALL_URL \
    NEXT_PUBLIC_PUSH_NOTIFY_URL=$NEXT_PUBLIC_PUSH_NOTIFY_URL

RUN pnpm --filter web build

FROM node@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

WORKDIR /app
# `HOSTNAME` n'est pas décoratif : le serveur `standalone` écoute sur `localhost` par
# défaut, donc sur la seule boucle locale du conteneur, et le proxy ne l'atteint jamais.
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0

# `outputFileTracingRoot` étant la racine du monorepo, l'arborescence produite est
# `standalone/apps/web/server.js` — d'où les chemins ci-dessous.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
# Le service worker (REQ-UI-01) vit dans `public/` : sans cette copie, `/sw.js` répond
# 404, la PWA ne s'installe pas, et rien dans les logs ne le dit.
COPY --from=build /repo/apps/web/public ./apps/web/public

# Pas de root : le shard ne sert que des fichiers statiques et deux routes rendues.
USER node

CMD ["node", "apps/web/server.js"]
