import { attente, attention, casse, ok, type Verification } from "./contrat.ts";

/**
 * Le DNS, vérifié avant certbot plutôt qu'après. Un nom qui ne résout pas fait échouer
 * l'émission du certificat sur un message qui ne dit pas que c'est le DNS, et la
 * propagation prend le temps qu'elle prend — mieux vaut l'apprendre en dix secondes.
 */

const PHASE = "DNS";

const sousDomaineAppels = (serveur: string) => `call.${serveur}`;

/**
 * En développement, les deux noms doivent pointer sur la boucle locale : c'est la ligne
 * du fichier hosts, et l'alias réseau du compose ne sert **qu'entre conteneurs**. En
 * production, ils doivent désigner cette machine.
 */
export const resolutionDesNoms: Verification = {
  nom: "résolution des noms",
  phase: PHASE,
  verifier: async ({ env, resoudre, adressesLocales, dev }) => {
    const serveur = env?.get("SERVER_NAME") ?? "";
    if (serveur === "") return attente("résolution des noms", "en attente de SERVER_NAME");

    const noms = [serveur, sousDomaineAppels(serveur)];
    const resolus = await Promise.all(noms.map(async (nom) => [nom, await resoudre(nom)] as const));

    const muets = resolus.filter(([, adresses]) => adresses.length === 0).map(([nom]) => nom);
    if (muets.length > 0)
      return casse(
        "résolution des noms",
        `${muets.join(" et ")} ne résout nulle part — certbot échouera sans dire que c'est le DNS`,
        dev
          ? `ajouter « 127.0.0.1 ${noms.join(" ")} » au fichier hosts (celui de Windows, sous WSL2)`
          : `créer un enregistrement A pour ${muets.join(" et ")} vers l'IP de cette machine`,
      );

    const locales = new Set(adressesLocales());
    const ailleurs = resolus
      .filter(([, adresses]) => !adresses.some((adresse) => locales.has(adresse)))
      .map(([nom, adresses]) => `${nom} → ${adresses.join(", ")}`);

    if (ailleurs.length > 0)
      return attention(
        "résolution des noms",
        `${ailleurs.join(" ; ")} — aucune de ces adresses n'est portée par cette machine`,
        "normal derrière un NAT ou un DNS à horizon partagé ; à vérifier sinon, avant d'émettre le certificat",
      );

    return ok("résolution des noms", `${noms.join(" et ")} désignent cette machine`);
  },
};

/**
 * `call.${SERVER_NAME}` doit être déclaré **dès l'émission** du certificat, même sans
 * appels déployés : l'ajouter plus tard oblige à réémettre. Le vérifier séparément évite
 * de découvrir l'oubli le jour où l'on branche les appels.
 */
export const sousDomaineDesAppels: Verification = {
  nom: "sous-domaine des appels",
  phase: PHASE,
  verifier: async ({ env, resoudre }) => {
    const serveur = env?.get("SERVER_NAME") ?? "";
    if (serveur === "") return attente("sous-domaine des appels", "en attente de SERVER_NAME");
    const nom = sousDomaineAppels(serveur);
    const adresses = await resoudre(nom);
    return adresses.length > 0
      ? ok("sous-domaine des appels", `${nom} résout`)
      : attention(
          "sous-domaine des appels",
          `${nom} ne résout pas — le certificat devra être réémis pour l'ajouter plus tard`,
          `le déclarer maintenant, même sans appels : le certificat doit le porter dès l'émission`,
        );
  },
};

export const VERIFICATIONS_RESEAU: readonly Verification[] = [
  resolutionDesNoms,
  sousDomaineDesAppels,
];
