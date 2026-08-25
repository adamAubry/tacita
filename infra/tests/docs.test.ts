import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("REQ-INF-12 — comportement authenticated media consigné", () => {
  it("README.md documente le comportement vérifié pour la version Synapse déployée", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf-8");
    expect(readme).toContain("REQ-INF-12");
    expect(readme).toMatch(/authenticated media/i);
    expect(readme).toMatch(/v1\.155\.0/);
  });
});

describe("REQ-INF-13 — métadonnées en clair côté serveur documentées", () => {
  it("LIMITES.md documente la limite comme assumée, pas masquée", () => {
    const limites = readFileSync(new URL("../LIMITES.md", import.meta.url), "utf-8");
    expect(limites).toMatch(/métadonnées en clair/i);
    expect(limites).toMatch(/qui\s+parle\s+à\s+qui/i);
  });
});

describe("REQ-INF-18 — annuaire énumérable, dit et non masqué", () => {
  it("LIMITES.md nomme l'énumération comme une limite assumée", () => {
    // Interdit n°13 : un annuaire ouvert n'est pas un détail de config, c'est ce que
    // le produit expose. Le taire ferait dire à l'app moins que ce que le serveur fait.
    const limites = readFileSync(new URL("../LIMITES.md", import.meta.url), "utf-8");
    expect(limites).toMatch(/annuaire/i);
    expect(limites).toMatch(/énumér/i);
  });
});

describe("D-12 — la clé transmise au serveur, dite et non masquée", () => {
  it("LIMITES.md porte la limite pour l'opérateur", () => {
    /*
     * La concession la plus lourde du dépôt : elle amende le principe directeur de
     * `CLAUDE.md`. La documenter n'est pas une politesse — sans elle, la promesse E2EE se
     * lit plus large qu'elle ne l'est (interdit n°13, règle 5).
     */
    const limites = readFileSync(new URL("../LIMITES.md", import.meta.url), "utf-8");
    expect(limites).toMatch(/clé de récupération au serveur/i);
    expect(limites).toMatch(/non stocké n'est pas non vu/i);
    // Et ce qui la rouvrirait, sans quoi une limite assumée devient une limite acquise.
    expect(limites).toMatch(/héberger pour des tiers/i);
  });

  it("CLAUDE.md pointe la décision plutôt que de la porter", () => {
    // Le fichier est chargé à chaque session : il dit la règle et renvoie au motif.
    const claude = readFileSync(new URL("../../CLAUDE.md", import.meta.url), "utf-8");
    expect(claude).toMatch(/D-12/);
    expect(claude).toMatch(/clé de récupération/i);
  });
});
