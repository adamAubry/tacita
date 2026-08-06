/**
 * Client du service de liens d'invitation (spec 12). Le service **traduit un token en
 * identifiant, et rien d'autre** — il n'exécute aucune action Matrix. C'est le shard qui
 * invite ensuite, par le chemin natif de D-09.
 *
 * Il vit ici et non dans un paquet : c'est un appel HTTP à notre propre backend, pas de
 * la logique métier Matrix, et aucun autre paquet n'en a besoin.
 */

/** Le préfixe de route, tel que le proxy l'expose (REQ-INF-15). */
const BASE = "/invite";

export interface LienInvitation {
  id: string;
  token: string;
  /** Horodatage ISO rendu par le service. */
  expiresAt: string;
}

/**
 * Le message de l'échec unique du service. **Toutes les causes rendent la même
 * réponse** — token inconnu, expiré, révoqué, épuisé, émetteur disparu, blocage — parce
 * que les distinguer permettrait de sonder l'existence d'un token, et pour le blocage,
 * de confirmer au bloqué qu'il l'est.
 *
 * L'UI dit donc une seule chose, et propose de redemander un lien. La perte de confort
 * est assumée : c'est le prix de la non-énumérabilité (README du service).
 */
export const LIEN_INVALIDE = "Ce lien n'est plus valide. Demandez-en un nouveau à la personne.";

/**
 * REQ-UIX-28 — crée un lien d'invitation d'ami.
 *
 * Le jeton d'accès part en en-tête `Authorization`, comme l'exigent les quatre routes.
 * Il ne transite ni dans l'URL, ni dans un log : un jeton dans une URL se retrouve dans
 * l'historique, une capture d'écran ou un référent.
 */
export async function creerLienAmi(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LienInvitation> {
  const reponse = await fetchImpl(`${BASE}/links`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ kind: "friend" }),
  });
  if (!reponse.ok) throw new Error(LIEN_INVALIDE);
  return (await reponse.json()) as LienInvitation;
}

/** L'URL partageable qui porte le token. C'est elle qu'on met dans le presse-papiers. */
export const urlDuLien = (token: string, origine: string): string =>
  new URL(`/invitation/${encodeURIComponent(token)}`, origine).toString();

/**
 * REQ-UIX-28 — le partage. **Web Share API quand elle existe**, presse-papiers sinon :
 * la feuille de partage native est le geste attendu sur mobile, et la recoder donnerait
 * une liste d'applications qui ne serait jamais celle du système.
 *
 * Rend ce qui s'est réellement passé, pour que l'UI le dise plutôt que de le supposer.
 * Une annulation de la feuille native n'est **pas un échec** : l'utilisateur a changé
 * d'avis, lui afficher une erreur serait mentir sur ce qu'il vient de faire.
 */
export async function partagerLien(
  url: string,
  navigateur: Pick<Navigator, "share" | "clipboard"> = navigator,
): Promise<"partage" | "copie" | "annule"> {
  if (typeof navigateur.share === "function") {
    try {
      await navigateur.share({ url, title: "Rejoignez-moi sur Tacita" });
      return "partage";
    } catch {
      return "annule";
    }
  }

  await navigateur.clipboard.writeText(url);
  return "copie";
}
