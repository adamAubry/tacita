import { execFile } from "node:child_process";
import { readFileSync, statfsSync, writeFileSync } from "node:fs";
import { resolve4 } from "node:dns/promises";
import { createServer } from "node:net";
import { networkInterfaces, platform, totalmem } from "node:os";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import { diagnostiquer, type Contexte, type EtatPort, type Execution } from "./contrat.ts";
import { planifier, resteAFaire, valider, type Reponses } from "./init.ts";
import { VERIFICATIONS_MACHINE } from "./machine.ts";
import { VERIFICATIONS_PILE } from "./pile.ts";
import { VERIFICATIONS_RESEAU } from "./reseau.ts";
import { codeDeSortie, couleursActives, rendre } from "./rapport.ts";
import {
  FICHIER_ENV,
  FICHIER_ENV_EXEMPLE,
  lireEnv,
  VERIFICATIONS_CONFIG,
} from "./verifications.ts";

/**
 * Le seul endroit du paquet qui touche le monde réel. Tout le reste est pur et se prouve
 * sans machine : c'est ce qui fait qu'un diagnostic peut être testé sans serveur, sans
 * Docker et sans certificat.
 */

const RACINE = resolve(import.meta.dirname, "../../..");

const lire = (chemin: string): string | undefined => {
  try {
    return readFileSync(resolve(RACINE, chemin), "utf-8");
  } catch {
    return undefined;
  }
};

/** N'échoue jamais : un exécutable absent rend un code non nul, pas une exception. */
const executer = (commande: string, args: readonly string[]): Promise<Execution> =>
  new Promise((tenir) => {
    execFile(commande, [...args], { timeout: 10_000 }, (erreur, stdout, stderr) => {
      const sortie = `${stdout}${stderr}`;
      if (erreur === null) return tenir({ code: 0, sortie });
      const code = typeof erreur.code === "number" && erreur.code !== 0 ? erreur.code : 127;
      tenir({ code, sortie });
    });
  });

/**
 * Se lier au port est plus sûr que lire une table de sockets : c'est exactement ce que
 * fera le proxy. `EACCES` n'est pas un échec — c'est l'impossibilité de conclure sans
 * privilèges, et Docker s'y liera en root de toute façon.
 */
const sonderPort = (port: number): Promise<EtatPort> =>
  new Promise((tenir) => {
    const serveur = createServer();
    serveur.once("error", (erreur: NodeJS.ErrnoException) =>
      tenir(erreur.code === "EADDRINUSE" ? "occupe" : "inconnu"),
    );
    serveur.once("listening", () => serveur.close(() => tenir("libre")));
    serveur.listen(port, "0.0.0.0");
  });

const espaceLibreOctets = (chemin: string): number | undefined => {
  try {
    const { bavail, bsize } = statfsSync(resolve(RACINE, chemin));
    return Number(bavail) * Number(bsize);
  } catch {
    return undefined;
  }
};

/** `/proc/meminfo` est la seule source du swap ; `node:os` ne l'expose pas. */
const swapOctets = (): number => {
  try {
    const meminfo = readFileSync("/proc/meminfo", "utf-8");
    const [, kilooctets] = /^SwapTotal:\s+(\d+) kB$/m.exec(meminfo) ?? [];
    return kilooctets === undefined ? 0 : Number(kilooctets) * 1024;
  } catch {
    return 0;
  }
};

/** Un nom qui ne résout pas n'est pas une erreur du programme : c'est un constat. */
const resoudre = async (nom: string): Promise<readonly string[]> => {
  try {
    return await resolve4(nom);
  } catch {
    return [];
  }
};

/** En développement, la boucle locale compte : c'est ce que pose la ligne du fichier hosts. */
const adressesLocales = (): readonly string[] =>
  Object.values(networkInterfaces())
    .flat()
    .filter((interfaceReseau) => interfaceReseau?.family === "IPv4")
    .map((interfaceReseau) => interfaceReseau!.address);

const USAGE = `Usage : pnpm admin <commande> [options]

  init      prépare infra/.env : génère les secrets et la paire VAPID, pose le
            domaine, puis dit ce qui reste à faire à la main
  doctor    vérifie que la machine et la configuration permettent de démarrer

Options
  --domaine=<nom>    le nom du serveur, ex. chat.ton-domaine.fr (init)
  --email=<adresse>  contact déclaré aux services de push (init)
  --dev              machine de développement : le nom d'exemple et le certificat
                     auto-signé y sont attendus, pas des défauts à corriger

Sans --domaine ni --email, init les demande — à condition d'être dans un
terminal. Le code de sortie de doctor vaut 1 si une vérification bloque.
`;

const argv = process.argv.slice(2);
const dev = argv.includes("--dev");
const option = (nom: string): string | undefined =>
  argv.find((argument) => argument.startsWith(`--${nom}=`))?.slice(nom.length + 3);
const commande = argv.find((argument) => !argument.startsWith("-")) ?? "doctor";

if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const contexteCourant = (): Contexte => {
  const contenu = lire(FICHIER_ENV);
  return {
    env: contenu === undefined ? undefined : lireEnv(contenu),
    lire,
    maintenant: new Date(),
    dev,
    systeme: {
      plateforme: platform(),
      versionNode: process.version,
      memoireOctets: totalmem(),
      swapOctets: swapOctets(),
      estRoot: process.getuid?.() === 0,
    },
    espaceLibreOctets,
    executer,
    sonderPort,
    resoudre,
    adressesLocales,
  };
};

async function doctor(): Promise<never> {
  const verifications = [
    ...VERIFICATIONS_MACHINE,
    ...VERIFICATIONS_CONFIG,
    ...VERIFICATIONS_RESEAU,
    ...VERIFICATIONS_PILE,
  ];
  const constats = await diagnostiquer(contexteCourant(), verifications);
  const couleurs = couleursActives(process.env, process.stdout.isTTY === true);
  process.stdout.write(rendre(constats, verifications, couleurs));
  process.exit(codeDeSortie(constats));
}

async function demander(question: string): Promise<string> {
  if (process.stdin.isTTY !== true) {
    process.stderr.write(
      "Hors terminal : passer les valeurs en options — pnpm admin init --domaine=… --email=…\n",
    );
    process.exit(2);
  }
  const lecteur = createInterface({ input: process.stdin, output: process.stdout });
  const reponse = (await lecteur.question(`${question} : `)).trim();
  lecteur.close();
  return reponse;
}

async function init(): Promise<never> {
  const reponses: Reponses = {
    domaine: option("domaine") ?? (await demander("Nom du serveur (ex. chat.ton-domaine.fr)")),
    email: option("email") ?? (await demander("Adresse e-mail de contact")),
  };

  const probleme = valider(reponses);
  if (probleme !== undefined) {
    process.stderr.write(`${probleme}\n`);
    process.exit(2);
  }

  const existant = lire(FICHIER_ENV);
  const source = existant ?? lire(FICHIER_ENV_EXEMPLE);
  if (source === undefined) {
    process.stderr.write(
      `${FICHIER_ENV_EXEMPLE} est introuvable — ce n'est pas un dépôt Tacita complet.\n`,
    );
    process.exit(2);
  }

  const { contenu, modifications } = planifier(source, reponses);
  writeFileSync(resolve(RACINE, FICHIER_ENV), contenu, { mode: 0o600 });

  const largeur = Math.max(...modifications.map((m) => m.cle.length)) + 2;
  const lignes: string[] = [
    "",
    existant === undefined
      ? "infra/.env créé depuis .env.example, en permissions 600"
      : "infra/.env mis à jour — aucune valeur déjà posée n'a été touchée",
    "",
    ...modifications.map(
      ({ cle, action, apercu }) => `  ${cle.padEnd(largeur)}${action.padEnd(14)}${apercu}`,
    ),
    "",
    "Ce qui reste, et que cet outil ne peut pas faire à ta place :",
    "",
    ...resteAFaire(reponses.domaine, dev).map((etape, index) => `  ${index + 1}. ${etape}`),
    "",
  ];
  process.stdout.write(lignes.join("\n"));
  process.exit(0);
}

if (commande === "doctor") await doctor();
else if (commande === "init") await init();
else {
  process.stderr.write(`commande inconnue : ${commande}\n\n${USAGE}`);
  process.exit(2);
}
