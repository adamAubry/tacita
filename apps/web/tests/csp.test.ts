import { describe, expect, it } from "vitest";
import { buildCsp } from "../lib/csp";

/**
 * Durcissement (pas de REQ de spec : à rattacher à un REQ-UI si le PM veut le tracer).
 * Le test exerce la seule chose qui rend la CSP utile ou inutile — les directives qui
 * décident si une XSS peut s'exécuter et exfiltrer, ou non.
 */
describe("Durcissement CSP — contenir une XSS : ni script étranger, ni exfiltration", () => {
  const csp = buildCsp("NONCE", { elementCallUrl: "https://call.tacita.chat/room", dev: false });
  const directive = (nom: string) =>
    csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d === nom || d.startsWith(`${nom} `));

  it("un <script> injecté ne s'exécute pas : nonce + strict-dynamic, jamais 'unsafe-inline'", () => {
    const script = directive("script-src")!;
    expect(script).toContain("'nonce-NONCE'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
  });

  it("l'app ne peut être ni encadrée, ni détournée par <base> ou un plugin", () => {
    expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive("base-uri")).toBe("base-uri 'none'");
    expect(directive("object-src")).toBe("object-src 'none'");
  });

  it("seule l'origine Element Call du déploiement est un cadre autorisé — l'origine, pas l'URL", () => {
    expect(directive("frame-src")).toBe("frame-src https://call.tacita.chat");
  });

  it("les pièces jointes déchiffrées (blob:) s'affichent, la sortie réseau reste en 'self'", () => {
    expect(directive("img-src")).toContain("blob:");
    expect(directive("media-src")).toContain("blob:");
    expect(directive("connect-src")).toBe("connect-src 'self'");
  });

  it("'unsafe-eval' n'existe qu'en dev (HMR), jamais dans la CSP servie en production", () => {
    expect(buildCsp("N", { elementCallUrl: "https://c.example", dev: true })).toContain("'unsafe-eval'");
    expect(csp).not.toContain("'unsafe-eval'");
  });
});
