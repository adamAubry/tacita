import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("comportement authenticated media consigné", () => {
  it("README.md documente le comportement vérifié pour la version Synapse déployée", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf-8");
    expect(readme).toMatch(/authenticated media/i);
    expect(readme).toMatch(/v1\.155\.0/);
  });
});

describe("D-12 — la clé transmise au serveur, dite et non masquée", () => {
  it("CLAUDE.md pointe la décision plutôt que de la porter", () => {
    // Le fichier est chargé à chaque session : il dit la règle et renvoie au motif.
    const claude = readFileSync(new URL("../../CLAUDE.md", import.meta.url), "utf-8");
    expect(claude).toMatch(/D-12/);
    expect(claude).toMatch(/clé de récupération/i);
  });
});
