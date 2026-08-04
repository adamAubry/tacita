# node:22-alpine (2026-08-03), digest épinglé comme les autres images du compose.
# Résolu via `docker buildx imagetools inspect node:22-alpine` — à revérifier avant
# tout bump de version, voir infra/README.md.
FROM node@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

WORKDIR /app

# Une seule dépendance, aucune dépendance de workspace : `npm install` d'une version
# exacte suffit et évite d'embarquer pnpm et le workspace entier dans l'image pour
# résoudre un paquet.
#
# La version est **figée ici et vérifiée par un test** (infra/tests/push-gateway.test.ts)
# contre celle que pnpm a résolue dans pnpm-lock.yaml : un `^3.6.7` laissé libre
# installerait au build autre chose que ce qui a été testé, et un pin muet dériverait
# du lockfile sans que personne ne le voie.
#
# Le `package.json` de l'app est copié d'abord : sans lui, Node ne voit pas
# `"type": "module"` et reparse `src/index.ts` en ESM après avoir échoué à le lire en
# CommonJS — ça marche, mais ça journalise un avertissement à chaque démarrage.
COPY apps/push-gateway/package.json ./
RUN npm install --omit=dev --no-package-lock --no-fund --no-audit web-push@3.6.7

COPY apps/push-gateway/src ./src

# Pas de root : le service ne fait que poster vers des services push tiers.
USER node

# Le service refuse de démarrer si les clés VAPID manquent (src/index.ts), plutôt que
# de tourner en émettant des push que personne ne peut déchiffrer.
CMD ["node", "--experimental-strip-types", "src/index.ts"]
