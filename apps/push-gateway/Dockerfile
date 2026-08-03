# node:22-alpine — digest à épingler avant déploiement comme les autres images du
# compose : `docker buildx imagetools inspect node:22-alpine`, puis reporter le digest
# ici et dans le tableau de infra/README.md.
FROM node:22-alpine

WORKDIR /app

# Une seule dépendance, aucune dépendance de workspace : `npm install` d'une version
# exacte suffit et évite d'embarquer pnpm et le workspace entier dans l'image pour
# résoudre un paquet.
#
# La version est **figée ici et vérifiée par un test** (infra/tests/push-gateway.test.ts)
# contre celle que pnpm a résolue dans pnpm-lock.yaml : un `^3.6.7` laissé libre
# installerait au build autre chose que ce qui a été testé, et un pin muet dériverait
# du lockfile sans que personne ne le voie.
RUN npm install --omit=dev --no-package-lock --no-fund --no-audit web-push@3.6.7

COPY apps/push-gateway/src ./src

# Pas de root : le service ne fait que poster vers des services push tiers.
USER node

# Le service refuse de démarrer si les clés VAPID manquent (src/index.ts), plutôt que
# de tourner en émettant des push que personne ne peut déchiffrer.
CMD ["node", "--experimental-strip-types", "src/index.ts"]
