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
};

export default config;
