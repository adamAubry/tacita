import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Première des deux portes (règle du PM) : celle-ci atteste d'un fichier et tourne
 * sans Docker. La seconde est la cible de fumée elle-même, qui atteste du
 * comportement contre un vrai Synapse.
 *
 * Ce qu'elle garde : la fumée à deux personnes doit rester verte **par le chemin
 * produit**. Sa version précédente appelait `setDeviceVerified()` des deux côtés,
 * simulant une UI de vérification que personne n'avait en charge — elle était verte
 * alors que deux utilisateurs réels ne pouvaient pas se parler. Condition
 * d'acceptation de D-08.
 */
const source = readFileSync(
  new URL("../smoke/deux-personnes.smoke.test.ts", import.meta.url),
  "utf-8",
);

/** Même convention que `client-core/tests/session.test.ts` : ce qui s'exécute, pas ce qui se documente. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe(" — la fumée à deux personnes passe par le chemin produit", () => {
  it("aucun appel de vérification manuelle ne rend les tests verts à la place du produit", () => {
    expect(code).not.toMatch(/setDeviceVerified/);
    expect(code).not.toMatch(/requestDeviceVerification/);
  });

  it("la confiance vient du bootstrap d'inscription, seul geste autorisé", () => {
    // c'est `setupRecoveryKey()` qui amorce le cross-signing, donc qui
    // signe l'appareil. Si ce geste disparaît, les tests ne prouvent plus rien.
    expect(code).toMatch(/setupRecoveryKey\(\)/);
  });

  it("le cas négatif repose sur un appareil non signé, pas sur une absence de vérification", () => {
    // Le piège que ce garde ferme : `ouvrir()` signe par défaut. Un cas négatif
    // construit sans `signe: false` passerait au vert pour la mauvaise raison.
    // ponytail: garde par chaîne de caractères — renommer le paramètre donne une
    // fausse alerte. Assumé : la fausse alerte se lit et se corrige, l'inverse non.
    expect(code).toMatch(/signe:\s*false/);
  });
});
