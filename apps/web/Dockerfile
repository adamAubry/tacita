# apps/web — la PWA Next.js (spec 11), servie par le proxy sur `location /`
# (infra/docker-compose.yml, infra/proxy/nginx.conf).
#
# Deux étapes : la première bâtit tout le workspace pnpm (Next transpile les paquets
# @tacita/* depuis leur source, voir next.config.ts) ; la seconde n'emporte que la sortie
# autonome, sans pnpm ni code source.
#
# node:22-alpine, digest épinglé comme les autres images du compose — résolu via
# `docker buildx imagetools inspect node:22-alpine`, à revérifier avant tout bump
# (infra/README.md).
FROM node@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build
WORKDIR /repo
RUN corepack enable

# `NEXT_PUBLIC_*` est **inliné au build** : providers.tsx lit l'URL du homeserver côté
# client. L'app est donc figée sur son homeserver au moment où on la construit, pas à
# l'exécution — d'où un build arg, pas une variable d'environnement de conteneur.
ARG NEXT_PUBLIC_HOMESERVER_URL=https://chat.example.org
ENV NEXT_PUBLIC_HOMESERVER_URL=${NEXT_PUBLIC_HOMESERVER_URL}

# Le workspace entier (le `.dockerignore` retire node_modules, .next, .git, les secrets).
# `--filter web` ne bâtit que la PWA, mais tire ses dépendances de workspace.
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter web build

FROM node@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# `output: standalone` (next.config.ts) place le serveur et ses dépendances tracées sous
# `.next/standalone`. Next ne copie **pas** les assets statiques ni `/public` dans cette
# sortie — ils se montent à côté, au chemin que le serveur autonome attend.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public

# Pas de root : le serveur ne fait que rendre la coquille et servir des fichiers statiques.
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
