import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

/**
 * REQ-INF-16 — le shard a un artefact de production. Jusqu'ici il n'existait que sous
 * `next dev` : ce qui tournait en local n'était donc **jamais** ce qu'un déploiement
 * aurait servi, et aucun environnement ne pouvait le démentir.
 *
 * `standalone` et non `export` : deux routes sont rendues à la demande (`/i/[token]`,
 * `/profil/[userId]`). Un export statique les perdrait — le lien d'invitation (spec 12)
 * est justement la porte d'entrée du produit.
 */
const config: NextConfig = {
  output: "standalone",

  /**
   * Sans cette racine, le traceur de fichiers part de `apps/web` et n'embarque pas les
   * paquets du workspace (`@tacita/*`) ni le magasin pnpm qui vit à la racine du
   * monorepo : l'image démarre, puis meurt au premier `require` avec un
   * `MODULE_NOT_FOUND` sur un paquet pourtant présent dans le `package.json`.
   */
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),

  /**
   * **Côté serveur uniquement**, `matrix-js-sdk` est résolu sur `lib/matrix.js` — le
   * module que son entrée réexporte, sans le drapeau de singleton.
   *
   * Son entrée pose `globalThis.__js_sdk_entrypoint` et jette « Multiple matrix-js-sdk
   * entrypoints detected! » si le drapeau est déjà là. Sous `next dev`, webpack
   * réévalue ses modules à chaque recompilation **dans le même processus Node**, où ce
   * global-là, lui, survit : la première requête passe, puis toute modification de
   * fichier rendait `/` en 500 jusqu'au redémarrage du serveur. Reproduit le
   * 10/08/2026 — trois requêtes à 200, un `touch`, 500 sur toutes les suivantes.
   *
   * Ce n'est pas une double copie du SDK qu'on masque : le garde vise deux instances
   * réellement chargées ensemble, et il n'y en a qu'une. Il reste d'ailleurs en place là
   * où il protège quelque chose — le navigateur, qui charge `lib/browser-index.js` (et
   * son magasin crypto IndexedDB) sur un global neuf à chaque chargement de page.
   *
   * Le `$` limite l'alias à la correspondance exacte : `matrix-js-sdk/lib/crypto-api`,
   * importé par `client-core`, continue de se résoudre normalement.
   *
   * Externaliser le paquet (`serverExternalPackages`) ne marchait pas : il n'est pas une
   * dépendance directe du shard, et son ESM publie des imports de répertoire que le
   * loader de Node refuse — même raison que les `deps.inline` des configs Vitest.
   *
   * Clé `webpack` et pas `turbopack` : `next dev` tourne ici sur webpack, et
   * `resolveAlias` de Turbopack ne sait pas viser le seul graphe serveur — il
   * détournerait aussi le navigateur de `browser-index.js`.
   */
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        "matrix-js-sdk$": "matrix-js-sdk/lib/matrix.js",
      };
    }
    return config;
  },
};

export default config;
