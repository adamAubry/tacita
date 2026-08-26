import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf-8");

describe("symptôme d'un oubli documenté", () => {
  it("le README décrit la coupure à 15-20 s", () => {
    expect(readme).toMatch(/15\s*(à|-)\s*20\s*(secondes|s)\b/i);
    expect(readme).toMatch(/pare-feu/i);
  });
});

describe("MSC MatrixRTC non stabilisés", () => {
  it("le README impose de relire la doc courante d'Element Call", () => {
    expect(readme).toMatch(/pas stabilisé/i);
    expect(readme).toMatch(/Element Call/);
  });

  it("nomme les valeurs littérales concernées : préfixes et state keys", () => {
    expect(readme).toMatch(/préfixe/i);
    expect(readme).toMatch(/state key/i);
  });
});
