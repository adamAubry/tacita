import { describe, expect, it } from "vitest";

import { adressePublique, estPublique, guideDns } from "../src/dns.ts";

describe("l'adresse à mettre dans l'enregistrement A", () => {
  it.each([
    ["203.0.113.10", true],
    ["10.0.0.4", false],
    ["172.17.0.1", false], // le réseau Docker
    ["172.32.0.1", true], // juste au-dessus de la plage privée
    ["192.168.1.20", false],
    ["127.0.0.1", false],
    ["169.254.1.1", false],
    ["100.64.0.1", false], // CGNAT : publique en apparence, inatteignable en pratique
  ])("%s est publique : %s", (adresse, attendu) => {
    expect(estPublique(adresse)).toBe(attendu);
  });

  it("choisit la première adresse joignable depuis l'extérieur", () => {
    // Une machine porte presque toujours plusieurs interfaces : boucle locale, réseau
    // Docker, réseau privé. Proposer l'une d'elles produirait un domaine qui ne résout
    // que pour son propriétaire.
    expect(adressePublique(["127.0.0.1", "172.17.0.1", "203.0.113.10"])).toBe("203.0.113.10");
  });

  it("n'en invente aucune quand la machine est derrière un NAT", () => {
    expect(adressePublique(["127.0.0.1", "192.168.1.20"])).toBeUndefined();
  });
});

describe("le guide donne les deux lignes à recopier, pas une description", () => {
  const guide = guideDns("chat.tacita.fr", "203.0.113.10", [
    { nom: "chat.tacita.fr", adresses: [] },
    { nom: "call.chat.tacita.fr", adresses: [] },
  ]).join("\n");

  it("les deux enregistrements A portent le nom et l'adresse, prêts à copier", () => {
    expect(guide).toMatch(/A\s+chat\.tacita\.fr\s+203\.0\.113\.10/);
    expect(guide).toMatch(/A\s+call\.chat\.tacita\.fr\s+203\.0\.113\.10/);
  });

  it("il dit pourquoi le sous-domaine des appels n'est pas optionnel", () => {
    // C'est l'oubli coûteux : le certificat doit le porter dès l'émission, sans quoi
    // il faut tout réémettre le jour où l'on branche les appels.
    expect(guide).toMatch(/dès son émission/);
    expect(guide).toMatch(/réémettre/);
  });

  it("il donne la commande de vérification et prévient du délai de propagation", () => {
    expect(guide).toContain("dig +short chat.tacita.fr call.chat.tacita.fr");
    expect(guide).toMatch(/propagation/);
  });

  it("il dit de ne pas lancer certbot avant que les noms répondent", () => {
    expect(guide).toMatch(/Ne pas lancer `pnpm admin certificat`/);
  });

  it("aucun astérisque de Markdown : ça s'affiche dans un terminal, pas dans un lecteur", () => {
    expect(guide).not.toMatch(/\*\*/);
  });
});

describe("le guide s'adapte à ce qu'il constate", () => {
  it("sans adresse publique, il l'annonce et renvoie au panneau de l'hébergeur", () => {
    const guide = guideDns("chat.tacita.fr", undefined, [
      { nom: "chat.tacita.fr", adresses: ["198.51.100.7"] },
    ]).join("\n");
    expect(guide).toContain("<IP publique de cette machine>");
    expect(guide).toMatch(/derrière un NAT/);
    // Rien à comparer : accuser une adresse face à un texte de remplacement enverrait
    // corriger une configuration correcte.
    expect(guide).not.toMatch(/ce n'est pas </);
  });

  it("une adresse qui ne correspond pas est nommée, avec celle qui était attendue", () => {
    const guide = guideDns("chat.tacita.fr", "203.0.113.10", [
      { nom: "chat.tacita.fr", adresses: ["198.51.100.7"] },
    ]).join("\n");
    expect(guide).toContain("ce n'est pas 203.0.113.10");
  });

  it("quand tout résout, il enchaîne sur la commande suivante", () => {
    const guide = guideDns("chat.tacita.fr", "203.0.113.10", [
      { nom: "chat.tacita.fr", adresses: ["203.0.113.10"] },
      { nom: "call.chat.tacita.fr", adresses: ["203.0.113.10"] },
    ]).join("\n");
    expect(guide).toContain("Les deux noms répondent");
    expect(guide).toContain("pnpm admin certificat");
    expect(guide).not.toMatch(/propagation/);
  });

  it("un nom encore muet est dit comme tel, pas comme une erreur", () => {
    const guide = guideDns("chat.tacita.fr", "203.0.113.10", [
      { nom: "chat.tacita.fr", adresses: ["203.0.113.10"] },
      { nom: "call.chat.tacita.fr", adresses: [] },
    ]).join("\n");
    expect(guide).toContain("ne résout pas encore");
  });
});
