import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const bootstrap = readFileSync(new URL("../bootstrap.sh", import.meta.url), "utf-8");
const machine = readFileSync(new URL("../../apps/admin/src/machine.ts", import.meta.url), "utf-8");

describe("le script d'amorçage tourne là où rien n'est encore installé", () => {
  it("c'est du shell POSIX, pas du bash", () => {
    // Il s'exécute avant Node, avant Docker, et parfois dans une image minimale où
    // `bash` n'existe pas. Supposer bash rendrait le seul script d'amorçage inutilisable
    // là où il est justement le seul recours.
    expect(bootstrap).toMatch(/^#!\/bin\/sh$/m);
    expect(bootstrap).not.toMatch(/^#!.*bash$/m);
  });

  it("il s'arrête à la première erreur plutôt que de continuer sur une base fausse", () => {
    expect(bootstrap).toMatch(/^set -eu$/m);
  });

  it("il n'exige pas sudo quand il tourne déjà en root", () => {
    // Sur une image sans sudo — fréquent en conteneur — le supposer ferait échouer
    // un script qui n'en avait aucun besoin.
    expect(bootstrap).toMatch(/id -u.*-eq 0/);
    expect(bootstrap).toMatch(/command -v sudo/);
  });
});

describe("il est rejouable : ce qui est là n'est pas réinstallé", () => {
  it.each(["docker", "node"])("l'installation de %s est gardée par une détection", (outil) => {
    const bloc = new RegExp(`command -v ${outil} >/dev/null`);
    expect(bootstrap).toMatch(bloc);
  });

  it("le plugin compose est testé par son propre appel, pas déduit de Docker", () => {
    // Le paquet `docker.io` d'Ubuntu installe Docker sans le plugin v2 : déduire l'un
    // de l'autre laisserait une machine où `docker compose` n'existe pas.
    expect(bootstrap).toMatch(/docker compose version >\/dev\/null/);
  });
});

describe("il installe les versions que le reste du dépôt exige", () => {
  /**
   * La jonction que rien d'autre ne tient : le script installe une version, le
   * diagnostic en exige une autre, et les deux sont écrites à des endroits différents.
   * Ce test est le seul lien entre elles — sans lui, relever l'une laisserait l'autre
   * derrière, et la panne n'apparaîtrait que sur une machine neuve.
   */
  it("la version de Node installée est celle que le diagnostic réclame", () => {
    const [, installee] = /^NODE_MAJEUR_MINIMAL=(\d+)$/m.exec(bootstrap) ?? [];
    const [, exigee] = /^export const NODE_MINIMAL = (\d+);$/m.exec(machine) ?? [];
    expect(installee).toBeDefined();
    expect(exigee).toBeDefined();
    expect(installee).toBe(exigee);
  });

  it("Docker vient du script officiel, jamais du paquet Ubuntu", () => {
    // `apt install docker.io` pose une version ancienne et sans plugin compose v2.
    expect(bootstrap).toContain("get.docker.com");
    expect(bootstrap).not.toMatch(/apt-get install[^\n]*\bdocker\.io\b/);
  });

  it("Node vient de NodeSource, parce qu'Ubuntu 24.04 livre Node 18", () => {
    expect(bootstrap).toContain("deb.nodesource.com/setup_");
  });
});

describe("il ne laisse pas l'administrateur devant une panne qu'il vient de créer", () => {
  it("il dit que le groupe docker ne prend effet qu'à la reconnexion", () => {
    // Sans cet avertissement, `docker info` échoue encore juste après la correction,
    // et on cherche ailleurs une panne qui n'existe plus.
    expect(bootstrap).toMatch(/usermod -aG docker/);
    expect(bootstrap).toMatch(/reconnecter/);
  });

  it("il se termine en nommant la commande suivante", () => {
    expect(bootstrap).toMatch(/pnpm admin init/);
  });
});

describe("il annonce avant d'agir, et demande une fois", () => {
  /**
   * Un script d'amorçage tourne en root sur une machine que son auteur ne voit pas, et
   * la première version enchaînait `curl … | sudo sh` sans rien demander. Annoncer le
   * plan puis demander une seule fois est le minimum ; `--oui` reste pour les scripts.
   */
  it("il constate tout avant de modifier quoi que ce soit", () => {
    const constat = bootstrap.indexOf("BESOIN_DOCKER=0");
    const premiereAction = bootstrap.indexOf("curl -fsSL https://get.docker.com");
    expect(constat).toBeGreaterThan(-1);
    expect(constat).toBeLessThan(premiereAction);
  });

  it("il énumère ce qu'il va faire, en tant que root, avant de demander", () => {
    const annonce = bootstrap.indexOf("Ce script va, en tant que root");
    expect(annonce).toBeGreaterThan(-1);
    expect(annonce).toBeLessThan(bootstrap.indexOf("Continuer ?"));
  });

  it("il attend une réponse, et n'accepte que « o » ou « oui »", () => {
    expect(bootstrap).toMatch(/read -r reponse/);
    expect(bootstrap).toMatch(/o \| O \| oui/);
  });

  it("`--oui` saute la question, pour l'automatisation", () => {
    expect(bootstrap).toMatch(/--oui/);
    expect(bootstrap).toMatch(/SANS_DEMANDER=1/);
  });

  it("hors terminal et sans --oui, il refuse plutôt que de supposer un accord", () => {
    // Un `read` sans terminal rendrait une chaîne vide, donc « non » — mais en silence.
    expect(bootstrap).toMatch(/\[ ! -t 0 \]/);
    expect(bootstrap).toMatch(/relancer avec --oui/);
  });

  it("quand tout est déjà en place, il sort sans rien demander", () => {
    expect(bootstrap).toMatch(/Rien à faire — tout est déjà en place/);
  });
});

describe("il ne laisse pas la machine à moitié installée", () => {
  it("l'absence d'apt-get est constatée avant la première installation", () => {
    // Sur Fedora ou Alpine, la version précédente installait Docker puis échouait sur
    // `apt-get` — dans un état intermédiaire que personne n'avait demandé.
    const garde = bootstrap.indexOf("apt-get est introuvable");
    expect(garde).toBeGreaterThan(-1);
    expect(garde).toBeLessThan(bootstrap.indexOf("curl -fsSL https://get.docker.com"));
  });

  it("il dit quoi faire sur une distribution qu'il ne sait pas servir", () => {
    expect(bootstrap).toMatch(/Installer à la main Node/);
  });
});

describe("le script s'exécute vraiment, y compris en root", () => {
  /**
   * Le seul chemin qui comptait n'était couvert par aucun test, et il était cassé :
   * `$SUDO -E bash -` devenait `-E bash -` quand la variable était vide — donc à chaque
   * exécution en root, celle de tout serveur neuf. Le shell cherchait un programme nommé
   * « -E », `set -e` arrêtait tout, et Node n'était jamais installé.
   *
   * Les vérifications de forme ne pouvaient pas le voir. Celle-ci lance le script pour
   * de bon, avec des doublures qui n'installent rien : c'est la différence entre « le
   * fichier contient les bonnes lignes » et « le programme fait ce qu'il annonce ».
   */
  const doublures = (versionNode: string) => {
    const bac = mkdtempSync(join(tmpdir(), "tacita-bootstrap-"));
    const poser = (nom: string, corps: string) => {
      const chemin = join(bac, nom);
      writeFileSync(chemin, `#!/bin/sh\n${corps}\n`);
      chmodSync(chemin, 0o755);
    };
    poser("id", '[ "$1" = "-u" ] && { echo 0; exit 0; }\n[ "$1" = "-un" ] && { echo root; exit 0; }\nexec /usr/bin/id "$@"');
    poser("node", `echo ${versionNode}`);
    poser("docker", '[ "$1" = "compose" ] && { echo "Docker Compose version v2.40.3"; exit 0; }\necho "Docker version 27.3.1"');
    poser("curl", 'echo "# script simulé"');
    poser("bash", 'echo "BASH_APPELE $*"');
    poser("apt-get", 'echo "APT_APPELE $*"');
    return bac;
  };

  const lancer = (bac: string, args: readonly string[] = []) =>
    execFileSync(
      "sh",
      [new URL("../bootstrap.sh", import.meta.url).pathname, ...args],
      { env: { PATH: `${bac}:${process.env["PATH"] ?? ""}` }, encoding: "utf-8", stdio: "pipe" },
    );

  it("en root, avec un Node trop vieux, il installe sans se casser sur sudo", () => {
    const bac = doublures("v18.19.1");
    const sortie = lancer(bac, ["--oui"]);
    // Le script NodeSource doit atteindre `bash`, et non un programme nommé « -E ».
    expect(sortie).toContain("BASH_APPELE -");
    expect(sortie).toContain("APT_APPELE install -y nodejs");
    expect(sortie).not.toContain("-E");
    rmSync(bac, { recursive: true, force: true });
  });

  it("en root avec tout en place, il sort sans rien faire", () => {
    const bac = doublures("v22.14.0");
    const sortie = lancer(bac);
    expect(sortie).toContain("Rien à faire");
    expect(sortie).not.toContain("APT_APPELE");
    rmSync(bac, { recursive: true, force: true });
  });

  it("sans --oui et hors terminal, il refuse après avoir annoncé son plan", () => {
    const bac = doublures("v18.19.1");
    expect(() => lancer(bac)).toThrow();
    rmSync(bac, { recursive: true, force: true });
  });
});

describe("les scripts du dépôt restent exécutables", () => {
  /**
   * Une perte de bit exécutable est **silencieuse** : le hook de pré-commit cesse de
   * tourner sans que rien ne le dise, et la porte du dépôt disparaît. C'est arrivé — un
   * outil qui régénérait des fichiers depuis `git show` a effacé le mode de quatre
   * scripts d'un coup. Git suit ce mode, mais rien ne le vérifiait.
   *
   * `staging/certs-deploy-hook.sh` n'est **pas** de la liste, et c'est volontaire : il
   * n'est jamais lancé depuis le dépôt, mais posé par `install -D -m 755`, qui fixe son
   * mode à destination. L'exiger ici ferait échouer le test sur un fichier correct.
   */
  it.each([
    "../bootstrap.sh",
    "../proxy/generate-dev-certs.sh",
    "../postgres/10-invite-tokens.sh",
    "../rtc/firewall/host-ufw.sh",
    "../../.husky/pre-commit",
  ])("%s porte le bit exécutable", (chemin) => {
    const { mode } = statSync(new URL(chemin, import.meta.url));
    expect(mode & 0o111, `${chemin} n'est plus exécutable`).not.toBe(0);
  });
});

describe("il ne détruit rien", () => {
  it.each([/\brm -rf\b/, /\bmkfs\b/, /\bdd if=/, /docker system prune/, /--purge\b/])(
    "aucune occurrence de %s",
    (motif) => {
      // Un script d'amorçage tourne en root sur une machine que son auteur ne voit pas.
      expect(bootstrap).not.toMatch(motif);
    },
  );
});
