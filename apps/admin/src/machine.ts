/**
 * Les vérifications de la machine : ce qui doit être là avant tout le reste.
 *
 * Node, Docker, le plugin compose v2, la plateforme, la mémoire et le disque. Les
 * planchers sont ici (`MEMOIRE_PLANCHER`, `DISQUE_PLANCHER`) parce qu'ils se
 * constatent avant d'installer quoi que ce soit : la construction du shard est le
 * moment le plus lourd de l'installation, et elle échoue tard.
 */
import {
  attention,
  casse,
  enGo,
  GIGA,
  ok,
  type Verification,
} from "./contrat.ts";

/**
 * Les prémisses : ce qui doit être vrai de la machine avant qu'installer ait un sens.
 * Chacune interroge le monde par le `Contexte`, jamais directement — c'est ce qui permet
 * d'éprouver un disque plein, un Docker absent ou un port pris sans en fabriquer un.
 */

const PHASE = "Machine";

export const NODE_MINIMAL = 22;

/**
 * Le doctor tourne, donc Node existe — mais Ubuntu 24.04 livre Node 18 dans apt, et
 * `--experimental-strip-types` n'y est pas. Un administrateur qui suit la doc d'Ubuntu
 * obtient un outil qui refuse de démarrer sans dire que c'est la version.
 */
export const versionDeNode: Verification = {
  nom: "Node",
  phase: PHASE,
  verifier: ({ systeme }) => {
    const majeure = Number.parseInt(systeme.versionNode.replace(/^v/, ""), 10);
    return Number.isFinite(majeure) && majeure >= NODE_MINIMAL
      ? ok("Node", systeme.versionNode)
      : casse(
          "Node",
          `${systeme.versionNode} — il en faut ${NODE_MINIMAL} ou plus`,
          "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs",
        );
  },
};

/** Les images de la pile sont des images Linux : ailleurs, rien de ceci ne s'applique. */
export const plateforme: Verification = {
  nom: "système",
  phase: PHASE,
  verifier: ({ systeme }) =>
    systeme.plateforme === "linux"
      ? ok("système", "Linux")
      : casse(
          "système",
          `${systeme.plateforme} — la pile n'est éprouvée que sur Linux`,
          "déployer sur une machine Linux ; Ubuntu 24.04 LTS est la cible documentée",
        ),
};

export const dockerPresent: Verification = {
  nom: "Docker",
  phase: PHASE,
  verifier: async ({ executer }) => {
    const version = await executer("docker", ["--version"]);
    if (version.code !== 0)
      return casse(
        "Docker",
        "absent — c'est lui qui fait tourner toute la pile",
        "curl -fsSL https://get.docker.com | sudo sh   (le paquet Ubuntu est trop ancien)",
      );

    const info = await executer("docker", ["info", "--format", "{{.ServerVersion}}"]);
    if (info.code !== 0) {
      const refus = /permission denied|Got permission denied/i.test(info.sortie);
      return casse(
        "Docker",
        refus
          ? "installé, mais l'utilisateur courant n'a pas le droit de lui parler"
          : "installé, mais le démon ne répond pas",
        refus
          ? "sudo usermod -aG docker $USER, puis se déconnecter et se reconnecter"
          : "sudo systemctl enable --now docker",
      );
    }
    return ok("Docker", `démon joignable, version ${info.sortie.trim()}`);
  },
};

/** Le compose v1 en Python est mort ; c'est le plugin v2 qu'il faut, et lui seul. */
export const composeV2: Verification = {
  nom: "plugin compose",
  phase: PHASE,
  verifier: async ({ executer }) => {
    const { code, sortie } = await executer("docker", ["compose", "version"]);
    return code === 0
      ? ok("plugin compose", sortie.trim())
      : casse(
          "plugin compose",
          "absent — `docker compose` est le plugin v2, pas l'ancien `docker-compose`",
          "sudo apt install -y docker-compose-plugin",
        );
  },
};

export const MEMOIRE_PLANCHER = 4 * GIGA;
export const MEMOIRE_CONFORTABLE = 8 * GIGA;

/**
 * Sous 4 Go sans swap, le compilateur se fait tuer par l'OOM killer pendant `next build`
 * ou la construction de l'image Synapse — et le message ne dit jamais que c'est la
 * mémoire. C'est une panne coûteuse parce qu'elle envoie chercher ailleurs.
 */
export const memoireEtSwap: Verification = {
  nom: "mémoire",
  phase: PHASE,
  verifier: ({ systeme }) => {
    const { memoireOctets, swapOctets } = systeme;
    const résumé = `${enGo(memoireOctets)} de RAM, ${swapOctets === 0 ? "aucun swap" : `${enGo(swapOctets)} de swap`}`;

    if (memoireOctets < MEMOIRE_PLANCHER && swapOctets === 0)
      return casse(
        "mémoire",
        `${résumé} — les builds se feront tuer par l'OOM killer, sans que le message le dise`,
        "sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile",
      );
    if (memoireOctets < MEMOIRE_CONFORTABLE)
      return attention(
        "mémoire",
        `${résumé} — 8 Go sont recommandés ; en dessous, le swap est un filet, pas un remplacement`,
        swapOctets === 0 ? "ajouter 4 Go de swap avant le premier build" : "surveiller les builds",
      );
    return ok("mémoire", résumé);
  },
};

export const DISQUE_PLANCHER = 10 * GIGA;
export const DISQUE_RECOMMANDE = 40 * GIGA;

export const espaceDisque: Verification = {
  nom: "disque",
  phase: PHASE,
  verifier: ({ espaceLibreOctets }) => {
    const libre = espaceLibreOctets(".");
    if (libre === undefined)
      return attention("disque", "espace libre illisible", "vérifier à la main avec df -h");
    if (libre < DISQUE_PLANCHER)
      return casse(
        "disque",
        `${enGo(libre)} libres — les images, la base et les médias n'y tiendront pas`,
        "libérer de l'espace ou agrandir le volume ; 40 Go est la taille documentée",
      );
    if (libre < DISQUE_RECOMMANDE)
      return attention(
        "disque",
        `${enGo(libre)} libres — 40 Go sont recommandés, médias compris`,
        "surveiller la croissance du stockage média",
      );
    return ok("disque", `${enGo(libre)} libres`);
  },
};

/**
 * Le proxy veut le 443, et certbot veut le 80 le temps de son défi. Un port déjà pris se
 * découvre sinon au `docker compose up`, après le téléchargement des images.
 */
export const portsLibres: Verification = {
  nom: "ports 80 et 443",
  phase: PHASE,
  verifier: async ({ sonderPort, systeme }) => {
    const etats = await Promise.all([sonderPort(80), sonderPort(443)]);
    const occupes = [80, 443].filter((_, index) => etats[index] === "occupe");
    if (occupes.length > 0)
      return casse(
        "ports 80 et 443",
        `${occupes.join(" et ")} déjà pris — le proxy ne pourra pas s'y lier`,
        "sudo ss -ltnp 'sport = :443' pour voir qui l'occupe, puis l'arrêter",
      );
    if (etats.includes("inconnu"))
      return attention(
        "ports 80 et 443",
        systeme.estRoot
          ? "état indéterminé"
          : "non vérifiables sans privilèges — Docker s'y liera en root, ce n'est pas bloquant",
        "sudo ss -ltn 'sport = :443' pour trancher",
      );
    return ok("ports 80 et 443", "libres");
  },
};

/**
 * Nécessaire seulement au moment d'émettre un certificat, et jamais en développement où
 * le certificat est auto-signé. Un avertissement, donc, pas un blocage.
 */
export const certbotPresent: Verification = {
  nom: "certbot",
  phase: PHASE,
  verifier: async ({ executer, dev }) => {
    if (dev) return ok("certbot", "inutile en développement, le certificat est auto-signé");
    const { code } = await executer("certbot", ["--version"]);
    return code === 0
      ? ok("certbot", "présent")
      : attention(
          "certbot",
          "absent — il faudra l'installer avant d'émettre le certificat",
          "sudo apt install -y certbot",
        );
  },
};

export const VERIFICATIONS_MACHINE: readonly Verification[] = [
  plateforme,
  versionDeNode,
  memoireEtSwap,
  espaceDisque,
  dockerPresent,
  composeV2,
  portsLibres,
  certbotPresent,
];
