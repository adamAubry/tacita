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
