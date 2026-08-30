import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("comportement authenticated media consigné", () => {
  it("README.md documente le comportement vérifié pour la version Synapse déployée", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf-8");
    expect(readme).toMatch(/authenticated media/i);
    expect(readme).toMatch(/v1\.155\.0/);
  });
});

/**
 * La clé de récupération transite vers le serveur au changement de mot de passe, et
 * elle ouvre une session à elle seule. Ce sont des limites du produit, pas des détails
 * d'implémentation : ne pas les tenir écrites reviendrait à afficher une garantie qu'on
 * n'a pas. Ce test est le seul endroit du dépôt qui empêche la page publique de les
 * perdre — c'est la porte de l'interdit « tenir la promesse ou la retirer ».
 */
describe("le modèle de menace public porte les limites de la clé de récupération", () => {
  // Espaces normalisés : le fichier est coupé à 88 colonnes, et une phrase qu'on
  // assert ici tomberait à cheval sur deux lignes dès qu'on le reformate.
  const menaces = readFileSync(new URL("../../THREAT_MODEL.md", import.meta.url), "utf-8")
    .replace(/\s+/g, " ");

  it("dit que le serveur voit la clé au changement de mot de passe", () => {
    expect(menaces).toMatch(/recovery key/i);
    expect(menaces).toMatch(/in the clear on every password change/i);
  });

  it("dit que la clé ouvre une session à elle seule", () => {
    expect(menaces).toMatch(/opens a session on its own/i);
  });

  it("dit que la taille des pièces jointes donne la durée des médias", () => {
    expect(menaces).toMatch(/size ÷ bitrate/);
  });
});
