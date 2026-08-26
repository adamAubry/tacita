import { describe, expect, it } from "vitest";

import { codeDeSortie, couleursActives, rendre } from "../src/rapport.ts";
import type { Constat, Verification } from "../src/contrat.ts";

const verification = (nom: string, phase: string): Verification => ({
  nom,
  phase,
  verifier: () => ({ nom, etat: "ok", constat: "" }),
});

const VERIFS: Verification[] = [
  verification("infra/.env", "Configuration"),
  verification("clés VAPID", "Configuration"),
  verification("certificat TLS", "Certificat"),
];

const CONSTATS: Constat[] = [
  { nom: "infra/.env", etat: "ok", constat: "présent, 14 variables lues" },
  {
    nom: "clés VAPID",
    etat: "casse",
    constat: "VAPID_PUBLIC_KEY fait 10 caractères, il en faut 87",
    remede: "docker run --rm node:22-alpine npx -y web-push generate-vapid-keys",
  },
  { nom: "certificat TLS", etat: "attention", constat: "expire dans 9 jours", remede: "certbot renew" },
];

describe("le rapport dit ce qui va, ce qui bloque, et quoi taper", () => {
  const sortie = rendre(CONSTATS, VERIFS, false);

  it("groupe les constats sous leur phase, dans l'ordre", () => {
    expect(sortie.indexOf("Configuration")).toBeLessThan(sortie.indexOf("Certificat"));
  });

  it("porte un symbole par état, pour que la couleur ne soit jamais seule à informer", () => {
    expect(sortie).toContain("✓");
    expect(sortie).toContain("✗");
    expect(sortie).toContain("⚠");
  });

  it("affiche le remède sous ce qui ne va pas, et rien sous ce qui va", () => {
    expect(sortie).toContain("└ docker run --rm node:22-alpine");
    expect(sortie).toContain("└ certbot renew");
    // Un remède affiché sous une ligne verte ferait douter d'un état sain.
    expect(sortie.split("infra/.env")[1]?.split("\n")[1]).not.toContain("└");
  });

  it("compte les bloquantes et les avertissements séparément", () => {
    expect(sortie).toContain("3 vérifications · 1 bloquante · 1 avertissement");
  });

  it("conclut par une phrase qui tranche", () => {
    expect(sortie).toContain("Corriger les lignes ✗ avant de démarrer la pile.");
    expect(rendre([CONSTATS[0]!], VERIFS, false)).toContain("Rien ne bloque le démarrage.");
  });
});

describe("les défauts d'affichage vus à la première exécution réelle", () => {
  it("un titre de phase ne s'affiche qu'une fois, même si une phase revient plus loin", () => {
    // La liste réelle finit par une vérification de « Configuration » posée après
    // celle du certificat : suivre l'ordre des constats réaffichait le titre.
    const verifs = [...VERIFS, verification("appels audio/vidéo", "Configuration")];
    const constats = [...CONSTATS, { nom: "appels audio/vidéo", etat: "attention", constat: "pas d'appels" } as Constat];
    const sortie = rendre(constats, verifs, false);
    expect(sortie.split("Configuration").length - 1).toBe(1);
    expect(sortie.indexOf("appels audio/vidéo")).toBeLessThan(sortie.indexOf("Certificat"));
  });

  it("la colonne s'élargit pour le plus long nom, la valeur ne colle jamais", () => {
    // `SYNAPSE_IP_RANGE_WHITELIST` fait exactement la largeur qui était figée.
    const nom = "SYNAPSE_IP_RANGE_WHITELIST";
    const sortie = rendre(
      [{ nom, etat: "ok", constat: '["172.16.0.0/12"]' }],
      [verification(nom, "Configuration")],
      false,
    );
    expect(sortie).toContain(`${nom}  [`);
  });
});

describe("la couleur est une amélioration, jamais un prérequis", () => {
  it("aucune séquence d'échappement quand les couleurs sont coupées", () => {
    expect(rendre(CONSTATS, VERIFS, false)).not.toContain("[");
  });

  it("des séquences quand elles sont actives", () => {
    expect(rendre(CONSTATS, VERIFS, true)).toContain("[");
  });

  it.each([
    ["hors terminal", {}, false, false],
    ["NO_COLOR posée", { NO_COLOR: "1" }, true, false],
    ["TERM=dumb", { TERM: "dumb" }, true, false],
    ["terminal ordinaire", { TERM: "xterm-256color" }, true, true],
  ])("%s → %s", (_cas, env, terminal, attendu) => {
    expect(couleursActives(env as NodeJS.ProcessEnv, terminal)).toBe(attendu);
  });
});

describe("le code de sortie, pour qu'un script puisse s'y fier", () => {
  it("vaut 1 dès qu'une vérification bloque", () => {
    expect(codeDeSortie(CONSTATS)).toBe(1);
  });

  it("vaut 0 quand seuls des avertissements restent", () => {
    // Un avertissement n'empêche pas de démarrer : le confondre avec un échec
    // rendrait le diagnostic inutilisable dans un script de déploiement.
    expect(codeDeSortie(CONSTATS.filter((c) => c.etat !== "casse"))).toBe(0);
  });
});
