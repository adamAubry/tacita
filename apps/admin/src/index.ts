import { execFile } from "node:child_process";
import { chmodSync, readFileSync, statfsSync, statSync, writeFileSync } from "node:fs";
import { resolve4 } from "node:dns/promises";
import { createServer } from "node:net";
import { networkInterfaces, platform, totalmem } from "node:os";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import { spawn } from "node:child_process";

import {
  apresEmission,
  planifier as planifierCertificat,
} from "./certificat.ts";
import { diagnostiquer, type Contexte, type EtatPort, type Execution } from "./contrat.ts";
import { adressePublique, guideDns } from "./dns.ts";
import { planifier, resteAFaire, valider, type Reponses } from "./init.ts";
import { certificat as verifCertificat } from "./verifications.ts";
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

  init        prépare infra/.env : génère les secrets et la paire VAPID, pose le
              domaine, puis dit ce qui reste à faire à la main
  dns         les deux enregistrements A à créer, et leur état à l'instant
  certificat  émet le certificat TLS, après avoir vérifié ce qui le ferait échouer
  doctor      vérifie que la machine et la configuration permettent de démarrer

Options
  --domaine=<nom>    le nom du serveur, ex. chat.ton-domaine.fr (init)
  --email=<adresse>  contact déclaré aux services de push (init, certificat)
  --dev              machine de développement : le nom d'exemple et le certificat
                     auto-signé y sont attendus, pas des défauts à corriger
  --oui              ne pas demander confirmation (certificat)
  --sans-suite       taire la liste « ce qui reste à faire » (init, quand c'est
                     l'assistant d'installation qui enchaîne lui-même)
  --force            réémettre un certificat encore valide (certificat)

Sans --domaine ni --email, init les demande — à condition d'être dans un
terminal. Le code de sortie de doctor vaut 1 si une vérification bloque.
`;

const COMMANDES = ["init", "dns", "certificat", "doctor"];
const OPTIONS = ["--domaine", "--email", "--dev", "--oui", "--force", "--sans-suite", "--help", "-h"];

const argv = process.argv.slice(2);

/**
 * Une option inconnue s'arrête ici plutôt que d'être ignorée. `--domain` au lieu de
 * `--domaine` produisait « passe les options en ligne de commande » à quelqu'un qui
 * venait de le faire — le pire message possible, puisqu'il envoie chercher au mauvais
 * endroit.
 */
const inconnue = argv.find(
  (a) => a.startsWith("-") && !OPTIONS.some((o) => a === o || a.startsWith(`${o}=`)),
);
if (inconnue !== undefined) {
  const nom = inconnue.split("=")[0] ?? inconnue;
  const proche = OPTIONS.find((o) => o.startsWith(nom) || nom.startsWith(o));
  process.stderr.write(
    `option inconnue : ${nom}${proche === undefined ? "" : ` — voulais-tu dire ${proche} ?`}\n\n${USAGE}`,
  );
  process.exit(2);
}

const dev = argv.includes("--dev");
const sansDemander = argv.includes("--oui");
const force = argv.includes("--force");
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
  process.stdout.write(rendre(constats, verifications, couleurs, process.stdout.columns));
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
  const chemin = resolve(RACINE, FICHIER_ENV);

  /**
   * `writeFileSync` n'applique son `mode` qu'à la **création** : un `.env` déjà présent
   * en 644 le restait, et ses six secrets, sa clé privée VAPID et son mot de passe
   * PostgreSQL demeuraient lisibles par tout compte de la machine. Le `chmod` explicite
   * est ce qui resserre le fichier quel que soit son état d'avant.
   */
  const modeAvant =
    existant === undefined ? undefined : (statSync(chemin).mode & 0o777).toString(8);
  writeFileSync(chemin, contenu, { mode: 0o600 });
  chmodSync(chemin, 0o600);

  const largeur = Math.max(...modifications.map((m) => m.cle.length)) + 2;
  const lignes: string[] = [
    "",
    existant === undefined
      ? "infra/.env créé depuis .env.example, en permissions 600"
      : "infra/.env mis à jour — aucune valeur déjà posée n'a été touchée",
    ...(modeAvant !== undefined && modeAvant !== "600"
      ? [`permissions resserrées de ${modeAvant} à 600 — il portait des secrets lisibles par tous`]
      : []),
    "",
    ...modifications.map(
      ({ cle, action, apercu }) => `  ${cle.padEnd(largeur)}${action.padEnd(14)}${apercu}`,
    ),
    "",
    // L'assistant d'installation enchaîne lui-même sur ces étapes : les annoncer
    // comme « restant à faire » les ferait passer pour un travail à la charge du
    // lecteur, juste avant que le script ne les exécute sous ses yeux.
    ...(argv.includes("--sans-suite")
      ? []
      : [
          "Ce qui reste, et que cet outil ne peut pas faire à ta place :",
          "",
          ...resteAFaire(reponses.domaine, dev).map((etape, index) => `  ${index + 1}. ${etape}`),
          "",
        ]),
  ];
  process.stdout.write(lignes.join("\n"));
  process.exit(0);
}

function nomDuServeur(): string {
  const ctx = contexteCourant();
  const nom = ctx.env?.get("SERVER_NAME") ?? "";
  if (nom === "") {
    process.stderr.write(
      "SERVER_NAME est absent d'infra/.env — lancer d'abord : pnpm admin init\n",
    );
    process.exit(2);
  }
  return nom;
}

async function dns(): Promise<never> {
  const domaine = nomDuServeur();
  const noms = [domaine, `call.${domaine}`];
  const etats = await Promise.all(
    noms.map(async (nom) => ({ nom, adresses: await resoudre(nom) })),
  );
  const publique = adressePublique(adressesLocales());
  process.stdout.write(`${guideDns(domaine, publique, etats).join("\n")}\n`);
  process.exit(etats.every((e) => e.adresses.length > 0) ? 0 : 1);
}

/** Exécute en laissant passer la sortie : certbot pose des questions et fait attendre. */
const executerVisible = (commande: string, args: readonly string[]): Promise<number> =>
  new Promise((tenir) => {
    const enfant = spawn(commande, [...args], { stdio: "inherit", cwd: RACINE });
    enfant.on("close", (code) => tenir(code ?? 1));
    enfant.on("error", () => tenir(127));
  });

async function confirmer(question: string): Promise<boolean> {
  if (sansDemander) return true;
  if (process.stdin.isTTY !== true) {
    process.stderr.write("Hors terminal : relancer avec --oui pour accepter sans qu'on demande.\n");
    return false;
  }
  const lecteur = createInterface({ input: process.stdin, output: process.stdout });
  const reponse = (await lecteur.question(`${question} [o/N] `)).trim().toLowerCase();
  lecteur.close();
  return ["o", "oui", "y", "yes"].includes(reponse);
}

async function certificat(): Promise<never> {
  const ctx = contexteCourant();
  const domaine = nomDuServeur();
  const email = option("email") ?? (ctx.env?.get("VAPID_SUBJECT") ?? "").replace(/^mailto:/, "");

  const noms = [domaine, `call.${domaine}`];
  const resolutions = await Promise.all(
    noms.map(async (nom) => ({ nom, vides: (await resoudre(nom)).length === 0 })),
  );
  const constatCert = await verifCertificat.verifier(ctx);
  const [, jours] = /expire dans (\d+) jours/.exec(constatCert.constat) ?? [];

  const plan = planifierCertificat({
    domaine,
    email,
    dev,
    certbotPresent: dev || (await executer("certbot", ["--version"])).code === 0,
    nomsMuets: resolutions.filter((r) => r.vides).map((r) => r.nom),
    port80: await sonderPort(80),
    certificatExistant:
      jours === undefined ? undefined : { joursRestants: Number(jours) },
    force,
  });

  const lignes = ["", dev ? "Certificat de développement" : `Certificat pour ${domaine}`, ""];
  if (plan.obstacles.length > 0) {
    lignes.push("Ce qui empêche l'émission :", "");
    for (const { quoi, remede } of plan.obstacles) lignes.push(`  ✗ ${quoi}`, `    └ ${remede}`);
    lignes.push("");
    process.stdout.write(`${lignes.join("\n")}\n`);
    process.exit(1);
  }

  for (const { titre, commande: c, args, motif } of plan.etapes) {
    lignes.push(`  ${titre}`, `    ${[c, ...args].join(" ")}`, `    ${motif}`, "");
  }
  if (plan.avertissements.length > 0) lignes.push(...plan.avertissements, "");
  process.stdout.write(`${lignes.join("\n")}\n`);

  if (!(await confirmer("Émettre le certificat ?"))) {
    process.stdout.write("Abandon — rien n'a été fait.\n");
    process.exit(1);
  }

  for (const { titre, commande: c, args } of plan.etapes) {
    process.stdout.write(`\n→ ${titre}\n`);
    const code = await executerVisible(c, args);
    if (code !== 0) {
      process.stderr.write(`\n« ${titre} » a échoué (code ${code}). Rien de plus n'est tenté.\n`);
      process.exit(code);
    }
  }

  process.stdout.write(
    `\nCertificat en place. La suite :\n\n${apresEmission(dev)
      .map((etape, index) => `  ${index + 1}. ${etape}`)
      .join("\n")}\n\n`,
  );
  process.exit(0);
}

if (!COMMANDES.includes(commande)) {
  process.stderr.write(`commande inconnue : ${commande}\n\n${USAGE}`);
  process.exit(2);
}
if (commande === "doctor") await doctor();
else if (commande === "init") await init();
else if (commande === "dns") await dns();
else await certificat();
