/**
 * Le contrat partagé par toutes les vérifications. Chacune est une fonction de son
 * `Contexte` : elle ne touche ni le disque, ni le réseau, ni Docker par elle-même.
 * L'accès au monde est injecté, et un test lui donne un monde inventé — c'est ce qui
 * permet d'éprouver un disque plein sans en remplir un.
 */

export type Etat = "ok" | "casse" | "attention" | "attente";

export type Constat = {
  readonly nom: string;
  readonly etat: Etat;
  /** Ce qui est constaté, au présent, sans jargon. */
  readonly constat: string;
  /** La commande ou le geste exact. Un constat cassé sans remède est un cul-de-sac. */
  readonly remede?: string;
};

export type Execution = {
  readonly code: number;
  readonly sortie: string;
};

export type EtatPort = "libre" | "occupe" | "inconnu";

export type Systeme = {
  readonly plateforme: string;
  readonly versionNode: string;
  readonly memoireOctets: number;
  readonly swapOctets: number;
  readonly estRoot: boolean;
};

export type Contexte = {
  /** `infra/.env` déjà lu. Absent = le fichier n'existe pas. */
  readonly env: ReadonlyMap<string, string> | undefined;
  /** Lit un fichier relatif à la racine du dépôt ; `undefined` s'il n'existe pas. */
  readonly lire: (chemin: string) => string | undefined;
  /** Injectée pour que l'expiration d'un certificat se teste sans fabriquer un périmé. */
  readonly maintenant: Date;
  /**
   * Machine de développement. Le nom d'exemple y est le nom voulu — il est écrit dans
   * le fichier hosts et porté par le certificat auto-signé. Le déclarer bloquant
   * enverrait le développeur réparer ce qui marche.
   */
  readonly dev: boolean;
  readonly systeme: Systeme;
  /** Octets disponibles sur le système de fichiers du chemin ; `undefined` si illisible. */
  readonly espaceLibreOctets: (chemin: string) => number | undefined;
  /** N'échoue jamais : un exécutable absent rend un code non nul, pas une exception. */
  readonly executer: (commande: string, args: readonly string[]) => Promise<Execution>;
  readonly sonderPort: (port: number) => Promise<EtatPort>;
  /** Adresses A d'un nom ; tableau vide s'il ne résout pas. Ne lève jamais. */
  readonly resoudre: (nom: string) => Promise<readonly string[]>;
  /** Les IPv4 portées par cette machine, hors boucle locale en production. */
  readonly adressesLocales: () => readonly string[];
};

export type Verification = {
  readonly nom: string;
  readonly phase: string;
  readonly verifier: (ctx: Contexte) => Constat | Promise<Constat>;
};

export const ok = (nom: string, constat: string): Constat => ({ nom, etat: "ok", constat });

export const casse = (nom: string, constat: string, remede: string): Constat => ({
  nom,
  etat: "casse",
  constat,
  remede,
});

export const attention = (nom: string, constat: string, remede?: string): Constat => ({
  nom,
  etat: "attention",
  constat,
  remede,
});

/**
 * Ni bon ni cassé : indécidable tant qu'une autre vérification n'est pas réglée. Sans cet
 * état, l'absence d'`infra/.env` produisait huit constats rouges pour une seule cause, et
 * l'administrateur ne savait plus par où commencer.
 */
export const attente = (nom: string, constat: string): Constat => ({
  nom,
  etat: "attente",
  constat,
});

export const GIGA = 1024 ** 3;

/** Rend « 7,7 Go » plutôt que 8261672960 : un diagnostic se lit, il ne se convertit pas. */
export const enGo = (octets: number): string =>
  `${(octets / GIGA).toFixed(1).replace(".", ",")} Go`;

/** Séquentiel et non parallèle : l'ordre de lecture du rapport est celui du déroulé. */
export async function diagnostiquer(
  ctx: Contexte,
  verifications: readonly Verification[],
): Promise<Constat[]> {
  const constats: Constat[] = [];
  for (const verification of verifications) constats.push(await verification.verifier(ctx));
  return constats;
}
