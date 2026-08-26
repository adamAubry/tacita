import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const bootstrap = readFileSync(new URL("../bootstrap.sh", import.meta.url), "utf-8");
const machine = readFileSync(new URL("../../apps/admin/src/machine.ts", import.meta.url), "utf-8");


const doublures = (versionNode: string, presents: readonly string[] = []) => {
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
  poser("corepack", 'echo "COREPACK_APPELE $*"');
  for (const outil of presents) poser(outil, `echo "${outil} présent"`);
  return bac;
};

/** Rend le code et la sortie plutôt que de lever : un échec est ici un cas à éprouver. */
const lancer = (bac: string, args: readonly string[] = []) => {
  const resultat = spawnSync("sh", [new URL("../bootstrap.sh", import.meta.url).pathname, ...args], {
    // PATH délibérément restreint : hériter de celui de la machine ferait dépendre le
    // test de ce qui y est installé — un `pnpm` réel masquerait l'étape qu'on éprouve.
    env: { PATH: `${bac}:/usr/bin:/bin` },
    encoding: "utf-8",
  });
  return { code: resultat.status ?? -1, sortie: `${resultat.stdout ?? ""}${resultat.stderr ?? ""}` };
};



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

describe("tout ce qui se demande, se demande avant", () => {
  it("le mot de passe sudo est réclamé avant la première étape, pas au milieu", () => {
    // Une invite qui surgit entre deux lignes du compte rendu casse l'affichage et
    // laisse devant un écran qui n'avance plus, sans dire qu'il attend quelque chose.
    const preAutorisation = bootstrap.indexOf("sudo -v");
    expect(preAutorisation).toBeGreaterThan(-1);
    expect(preAutorisation).toBeLessThan(bootstrap.indexOf("titre \"Installation\""));
  });

  it("sans terminal pour saisir le mot de passe, il le dit au lieu de bloquer", () => {
    expect(bootstrap).toMatch(/sudo réclame un mot de passe/);
  });
});

describe("il annonce avant d'agir, et demande une fois", () => {
  /**
   * Un script d'amorçage tourne en root sur une machine que son auteur ne voit pas, et
   * la première version enchaînait `curl … | sudo sh` sans rien demander. Annoncer le
   * plan puis demander une seule fois est le minimum ; `--oui` reste pour les scripts.
   */
  it("il constate tout avant de modifier quoi que ce soit", () => {
    const constat = bootstrap.indexOf("BESOIN_APT=0");
    const premiereAction = bootstrap.indexOf("curl -fsSL https://get.docker.com");
    expect(constat).toBeGreaterThan(-1);
    expect(constat).toBeLessThan(premiereAction);
  });

  it("il énumère ce qu'il va faire, en tant que root, avant de demander", () => {
    const annonce = bootstrap.indexOf("Ce script va installer, en tant que root");
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
  it("en root, avec un Node trop vieux, il installe sans se casser sur sudo", () => {
    const bac = doublures("v18.19.1", ["pnpm", "certbot"]);
    const { code, sortie } = lancer(bac, ["--oui"]);
    expect(code).toBe(0);

    // Le détail vit désormais dans le journal, plus à l'écran : c'est là qu'on vérifie
    // que le script NodeSource a bien atteint `bash`, et non un programme nommé « -E ».
    const [, journal] = /Journal détaillé : (\S+)/.exec(sortie) ?? [];
    expect(journal).toBeDefined();
    const detail = readFileSync(journal!, "utf-8");
    expect(detail).toContain("BASH_APPELE -");
    expect(detail).toContain("APT_APPELE install -y nodejs");
    expect(detail).not.toContain("-E:");

    expect(sortie).toMatch(/\[1\/1] Node 22 +ok/);
    rmSync(bac, { recursive: true, force: true });
    rmSync(journal!, { force: true });
  });

  it("en root avec tout en place, il sort sans rien faire", () => {
    const bac = doublures("v22.14.0", ["pnpm", "certbot"]);
    const { code, sortie } = lancer(bac);
    expect(code).toBe(0);
    expect(sortie).toContain("Rien à faire");
    expect(sortie).not.toContain("APT_APPELE");
    rmSync(bac, { recursive: true, force: true });
  });

  it("sans --oui et hors terminal, il refuse après avoir annoncé son plan", () => {
    const bac = doublures("v18.19.1", ["pnpm", "certbot"]);
    const { code, sortie } = lancer(bac);
    expect(code).toBe(1);
    expect(sortie).toContain("Ce script va installer");
    expect(sortie).toContain("relancer avec --oui");
    rmSync(bac, { recursive: true, force: true });
  });
});

describe("l'écran ne porte qu'une ligne par étape, le détail va au journal", () => {
  /**
   * La demande est explicite : une installation crache des centaines de lignes, dont
   * aucune ne dit où l'on en est. L'écran porte « [3/6] Node 22 … ok », et le détail
   * n'apparaît que là où il sert — quand ça casse.
   */
  it("chaque étape tient sur une ligne numérotée, et le bruit n'y est pas", () => {
    const bac = doublures("v18.19.1");
    const { code, sortie } = lancer(bac, ["--oui"]);
    expect(code).toBe(0);
    const etapes = sortie.split("\n").filter((l) => /^ {2}\[\d+\/\d+]/.test(l));
    expect(etapes.length).toBeGreaterThanOrEqual(3);
    for (const ligne of etapes) expect(ligne).toMatch(/ (ok|ÉCHEC)$/);
    // La sortie des installations elle-même n'a rien à faire à l'écran.
    expect(sortie).not.toContain("APT_APPELE install -y certbot");
    rmSync(bac, { recursive: true, force: true });
  });

  it("le compteur va bien jusqu'au total annoncé", () => {
    const bac = doublures("v18.19.1");
    const { code, sortie } = lancer(bac, ["--oui"]);
    expect(code).toBe(0);
    const [, dernier, total] = /\[(\d+)\/(\d+)] (?!.*\[)/s.exec(sortie) ?? [];
    void dernier;
    expect(sortie).toContain(`[${total}/${total}]`);
    rmSync(bac, { recursive: true, force: true });
  });

  it("une étape en échec affiche les dernières lignes du journal, et s'arrête là", () => {
    const bac = doublures("v18.19.1", ["certbot"]);
    writeFileSync(join(bac, "corepack"), '#!/bin/sh\necho "E: dépôt injoignable" >&2\nexit 100\n');
    chmodSync(join(bac, "corepack"), 0o755);
    const { code, sortie } = lancer(bac, ["--oui"]);
    expect(code).toBe(1);
    expect(sortie).toContain("ÉCHEC");
    expect(sortie).toContain("E: dépôt injoignable");
    expect(sortie).toContain("Relancer le script reprendra où il en est");
    // Le court-circuit : la seconde commande de l'étape ne doit pas s'exécuter.
    expect(sortie.match(/dépôt injoignable/g)).toHaveLength(1);
    rmSync(bac, { recursive: true, force: true });
  });
});

describe("les prérequis couverts", () => {
  it.each(["curl", "git", "docker", "compose", "node", "pnpm", "certbot"])(
    "%s a son étape d'installation",
    (outil) => {
      expect(bootstrap).toMatch(new RegExp(`^ *${outil}\\)`, "m"));
    },
  );

  it("pnpm vient de corepack, à la version que déclare package.json", () => {
    // La jonction : une version recopiée dans le script finirait par diverger de celle
    // du dépôt, et personne ne le verrait avant qu'un serveur neuf pose la mauvaise.
    expect(bootstrap).toMatch(/packageManager/);
    expect(bootstrap).toMatch(/corepack prepare "\$PNPM_VOULU" --activate/);
    expect(bootstrap).not.toMatch(/pnpm@\d+\.\d+\.\d+/);
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
