import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const limites = readFileSync(new URL("../LIMITES.md", import.meta.url), "utf-8");

describe("REQ-PSH-05 — la contrainte iOS est documentée", () => {
  it("LIMITES.md exige la PWA sur l'écran d'accueil et exclut Safari seul", () => {
    expect(limites).toMatch(/iOS/);
    expect(limites).toMatch(/écran d'accueil/i);
    expect(limites).toMatch(/Safari/);
  });
});
