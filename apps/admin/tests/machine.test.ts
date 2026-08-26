import { describe, expect, it } from "vitest";

import { diagnostiquer, GIGA, type Contexte, type Execution } from "../src/contrat.ts";
import {
  certbotPresent,
  composeV2,
  dockerPresent,
  espaceDisque,
  memoireEtSwap,
  plateforme,
  portsLibres,
  versionDeNode,
  VERIFICATIONS_MACHINE,
} from "../src/machine.ts";
import { monde, SYSTEME_SAIN } from "./monde.ts";

const ABSENT: Execution = { code: 127, sortie: "command not found" };

/** Une machine qui remplit tout : chaque test ne dégrade que ce qu'il éprouve. */
const contexte = (modifications: Partial<Contexte> = {}): Contexte =>
  monde({ executer: async () => ({ code: 0, sortie: "ok" }), ...modifications });

const avecSysteme = (modifications: Partial<typeof SYSTEME_SAIN>) =>
  contexte({ systeme: { ...SYSTEME_SAIN, ...modifications } });

describe("la version de Node, que le doctor ne peut pas constater sur lui-même", () => {
  it("Node 18 bloque, parce que le moteur de types n'y existe pas", async () => {
    // Ubuntu 24.04 livre Node 18 dans apt : c'est le chemin que suit un administrateur
    // qui installe « nodejs », et l'outil refuserait de démarrer sans dire pourquoi.
    const constat = await versionDeNode.verifier(avecSysteme({ versionNode: "v18.19.1" }));
    expect(constat.etat).toBe("casse");
    expect(constat.remede).toContain("deb.nodesource.com");
  });

  it("Node 22 passe", async () => {
    expect((await versionDeNode.verifier(contexte())).etat).toBe("ok");
  });
});

describe("la plateforme", () => {
  it("hors Linux, rien de la pile ne s'applique", async () => {
    expect((await plateforme.verifier(avecSysteme({ plateforme: "darwin" }))).etat).toBe("casse");
  });

  it("Linux passe", async () => {
    expect((await plateforme.verifier(contexte())).etat).toBe("ok");
  });
});

describe("Docker, dont l'absence et le refus de parler sont deux pannes distinctes", () => {
  it("Docker absent bloque, et renvoie au script officiel plutôt qu'au paquet Ubuntu", async () => {
    const constat = await dockerPresent.verifier(contexte({ executer: async () => ABSENT }));
    expect(constat.etat).toBe("casse");
    expect(constat.remede).toContain("get.docker.com");
  });

  it("un démon qui refuse l'utilisateur mène au groupe docker, pas à une réinstallation", async () => {
    // C'est la panne du lendemain de l'installation : docker est là, l'utilisateur n'est
    // pas encore dans le groupe, et le message brut ne dit pas qu'il faut se reconnecter.
    const constat = await dockerPresent.verifier(
      contexte({
        executer: async (_commande, args) =>
          args[0] === "--version"
            ? { code: 0, sortie: "Docker version 27.3.1" }
            : { code: 1, sortie: "Got permission denied while trying to connect" },
      }),
    );
    expect(constat.etat).toBe("casse");
    expect(constat.constat).toContain("pas le droit");
    expect(constat.remede).toContain("usermod -aG docker");
  });

  it("un démon arrêté mène à systemctl, pas au groupe", async () => {
    const constat = await dockerPresent.verifier(
      contexte({
        executer: async (_commande, args) =>
          args[0] === "--version"
            ? { code: 0, sortie: "Docker version 27.3.1" }
            : { code: 1, sortie: "Cannot connect to the Docker daemon" },
      }),
    );
    expect(constat.remede).toContain("systemctl");
  });

  it("un démon joignable passe et donne sa version", async () => {
    const constat = await dockerPresent.verifier(
      contexte({ executer: async () => ({ code: 0, sortie: "27.3.1\n" }) }),
    );
    expect(constat.etat).toBe("ok");
    expect(constat.constat).toContain("27.3.1");
  });
});

describe("le plugin compose v2", () => {
  it("son absence bloque et nomme la différence avec l'ancien docker-compose", async () => {
    const constat = await composeV2.verifier(contexte({ executer: async () => ABSENT }));
    expect(constat.etat).toBe("casse");
    expect(constat.constat).toContain("docker-compose");
  });
});

describe("la mémoire, dont le manque tue les builds sans le dire", () => {
  it("moins de 4 Go sans swap bloque, et le remède est la commande de swap complète", async () => {
    const constat = await memoireEtSwap.verifier(
      avecSysteme({ memoireOctets: 2 * GIGA, swapOctets: 0 }),
    );
    expect(constat.etat).toBe("casse");
    expect(constat.constat).toContain("OOM killer");
    expect(constat.remede).toContain("mkswap");
  });

  it("moins de 8 Go sans swap avertit sans bloquer", async () => {
    expect(
      (await memoireEtSwap.verifier(avecSysteme({ memoireOctets: 4 * GIGA, swapOctets: 0 }))).etat,
    ).toBe("attention");
  });

  it("du swap tient lieu de filet sous le plancher", async () => {
    // Le point n'est pas la RAM en soi : c'est qu'un build ne se fasse pas tuer.
    expect(
      (await memoireEtSwap.verifier(avecSysteme({ memoireOctets: 2 * GIGA, swapOctets: 4 * GIGA })))
        .etat,
    ).toBe("attention");
  });

  it("8 Go passent", async () => {
    const constat = await memoireEtSwap.verifier(contexte());
    expect(constat.etat).toBe("ok");
    expect(constat.constat).toContain("Go de RAM");
  });
});

describe("l'espace disque", () => {
  it.each([
    [5, "casse"],
    [20, "attention"],
    [100, "ok"],
  ])("%s Go libres → %s", async (go, attendu) => {
    expect((await espaceDisque.verifier(contexte({ espaceLibreOctets: () => go * GIGA }))).etat).toBe(
      attendu,
    );
  });

  it("un espace illisible avertit plutôt que de prétendre savoir", async () => {
    expect((await espaceDisque.verifier(contexte({ espaceLibreOctets: () => undefined }))).etat).toBe(
      "attention",
    );
  });
});

describe("les ports 80 et 443", () => {
  it("un port pris bloque avant le téléchargement des images", async () => {
    const constat = await portsLibres.verifier(
      contexte({ sonderPort: async (port) => (port === 443 ? "occupe" : "libre") }),
    );
    expect(constat.etat).toBe("casse");
    expect(constat.constat).toContain("443");
    expect(constat.constat).not.toContain("80 et");
  });

  it("sans privilèges, l'outil dit qu'il ne peut pas conclure — et que ce n'est pas bloquant", async () => {
    // Se lier au 443 en simple utilisateur rend EACCES. Le compter comme un échec
    // ferait échouer le diagnostic sur toutes les machines correctement configurées.
    const constat = await portsLibres.verifier(contexte({ sonderPort: async () => "inconnu" }));
    expect(constat.etat).toBe("attention");
    expect(constat.constat).toContain("Docker s'y liera en root");
  });

  it("deux ports libres passent", async () => {
    expect((await portsLibres.verifier(contexte())).etat).toBe("ok");
  });
});

describe("certbot, qui ne sert qu'au moment d'émettre", () => {
  it("son absence avertit sans bloquer l'installation", async () => {
    expect((await certbotPresent.verifier(contexte({ executer: async () => ABSENT }))).etat).toBe(
      "attention",
    );
  });

  it("en développement il n'est même pas cherché", async () => {
    const constat = await certbotPresent.verifier(
      contexte({
        dev: true,
        executer: async () => {
          throw new Error("ne doit pas être appelé");
        },
      }),
    );
    expect(constat.etat).toBe("ok");
  });
});

describe("le diagnostic machine complet", () => {
  it("sur une machine conforme, rien ne bloque", async () => {
    const constats = await diagnostiquer(contexte(), VERIFICATIONS_MACHINE);
    expect(constats).toHaveLength(VERIFICATIONS_MACHINE.length);
    expect(constats.filter((c) => c.etat === "casse")).toEqual([]);
  });

  it("sur une machine nue, chaque prémisse manquante est nommée séparément", async () => {
    const constats = await diagnostiquer(
      contexte({
        executer: async () => ABSENT,
        systeme: { ...SYSTEME_SAIN, versionNode: "v18.19.1", memoireOctets: 2 * GIGA, swapOctets: 0 },
        espaceLibreOctets: () => 2 * GIGA,
      }),
      VERIFICATIONS_MACHINE,
    );
    const casses = constats.filter((c) => c.etat === "casse").map((c) => c.nom);
    expect(casses).toEqual(["Node", "mémoire", "disque", "Docker", "plugin compose"]);
  });
});
