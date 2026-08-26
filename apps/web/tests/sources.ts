import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Chemins et non URL : en environnement jsdom, le `URL` global est celui de jsdom, que
 * `node:fs` refuse (« The URL must be of scheme file »). Le symptôme n'apparaît qu'à
 * l'intérieur d'un test, pas au chargement du module — de quoi chercher longtemps.
 */
/**
 * Séparateurs normalisés en `/`. Les tests comparent des chemins littéraux
 * (`endsWith("/app/layout.tsx")`), et `join` rend des antislashs sous Windows : sans
 * cette normalisation, échouent sur une machine Windows alors que
 * le code est correct — un rouge qui ne dit rien du produit.
 */
const enPosix = (chemin: string) => chemin.replaceAll("\\", "/");

export const RACINE = enPosix(join(import.meta.dirname, ".."));

export const lire = (chemin: string) => readFileSync(join(RACINE, chemin), "utf-8");

/**
 * Ce que le shard **livre** : `app`, `components`, `lib`. Les tests sont exclus — ils
 * nomment les motifs interdits pour les chercher, et s'y trouveraient eux-mêmes.
 *
 * Dans un module à part et non dans un fichier de test : importer un `*.test.ts` depuis
 * un autre en rejoue toutes les describes, et les compteurs doublent sans que personne
 * ne comprenne pourquoi.
 */
export function sourcesLivrees(): { chemin: string; code: string }[] {
  const fichiers: { chemin: string; code: string }[] = [];
  const parcourir = (dossier: string) => {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      const chemin = enPosix(join(dossier, entree.name));
      if (entree.isDirectory()) parcourir(chemin);
      else if (/\.tsx?$/.test(entree.name)) fichiers.push({ chemin, code: readFileSync(chemin, "utf-8") });
    }
  };
  for (const dossier of ["app", "components", "lib"]) parcourir(join(RACINE, dossier));
  return fichiers;
}

/** Les interdits portent sur ce que le shard exécute, pas sur ce qu'il explique. */
export const sansCommentaires = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
