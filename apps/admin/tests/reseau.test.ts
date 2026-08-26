import { describe, expect, it } from "vitest";

import { resolutionDesNoms, sousDomaineDesAppels } from "../src/reseau.ts";
import { monde } from "./monde.ts";

const IP = "203.0.113.10";

const avec = (
  resolution: Record<string, readonly string[]>,
  modifications: Parameters<typeof monde>[0] = {},
) =>
  monde({
    env: new Map([["SERVER_NAME", "chat.tacita.fr"]]),
    resoudre: async (nom) => resolution[nom] ?? [],
    adressesLocales: () => [IP],
    ...modifications,
  });

describe("la résolution des noms, vérifiée avant certbot plutôt qu'après", () => {
  it("un nom qui ne résout pas bloque, parce que certbot échouerait sans le dire", async () => {
    // La propagation prend le temps qu'elle prend, et le message d'échec de certbot ne
    // nomme jamais le DNS. Dix secondes ici valent mieux qu'une heure à chercher.
    const constat = await resolutionDesNoms.verifier(avec({}));
    expect(constat.etat).toBe("casse");
    expect(constat.constat).toContain("chat.tacita.fr");
    expect(constat.remede).toContain("enregistrement A");
  });

  it("en développement, le remède est le fichier hosts et non un enregistrement DNS", async () => {
    const constat = await resolutionDesNoms.verifier(avec({}, { dev: true }));
    expect(constat.remede).toContain("hosts");
    expect(constat.remede).toContain("Windows");
  });

  it("les deux noms pointant sur cette machine, la vérification passe", async () => {
    const constat = await resolutionDesNoms.verifier(
      avec({ "chat.tacita.fr": [IP], "call.chat.tacita.fr": [IP] }),
    );
    expect(constat.etat).toBe("ok");
  });

  it("un nom qui résout ailleurs avertit sans bloquer — le NAT existe", async () => {
    // Derrière un NAT sans hairpin, ou avec un DNS à horizon partagé, l'adresse publique
    // n'est portée par aucune interface. Bloquer là-dessus serait faux la moitié du temps.
    const constat = await resolutionDesNoms.verifier(
      avec({ "chat.tacita.fr": ["198.51.100.7"], "call.chat.tacita.fr": ["198.51.100.7"] }),
    );
    expect(constat.etat).toBe("attention");
    expect(constat.constat).toContain("198.51.100.7");
    expect(constat.remede).toContain("NAT");
  });

  it("sans SERVER_NAME, la vérification attend au lieu d'échouer", async () => {
    const constat = await resolutionDesNoms.verifier(monde({ env: new Map() }));
    expect(constat.etat).toBe("attente");
  });

  it("seul le nom manquant est nommé, pas les deux", async () => {
    const constat = await resolutionDesNoms.verifier(avec({ "chat.tacita.fr": [IP] }));
    expect(constat.constat).toContain("call.chat.tacita.fr");
    expect(constat.constat.startsWith("chat.tacita.fr et")).toBe(false);
  });
});

describe("le sous-domaine des appels, à déclarer dès l'émission du certificat", () => {
  it("son absence avertit, en disant que l'oubli se paiera par une réémission", async () => {
    // Le certificat doit le porter dès le premier jour, même sans appels déployés :
    // l'ajouter plus tard oblige à tout réémettre.
    const constat = await sousDomaineDesAppels.verifier(avec({ "chat.tacita.fr": [IP] }));
    expect(constat.etat).toBe("attention");
    expect(constat.constat).toContain("réémis");
  });

  it("déclaré, il passe", async () => {
    expect(
      (await sousDomaineDesAppels.verifier(avec({ "call.chat.tacita.fr": [IP] }))).etat,
    ).toBe("ok");
  });
});
