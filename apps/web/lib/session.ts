import type { RecoveryState, Session } from "@tacita/client-core";

/**
 * L'état d'entrée dans l'app, tel que l'UI a besoin de le connaître. Rien de plus :
 * la logique vit dans `client-core` (spec 04), le shard ne fait que router dessus.
 */
export type EtatSession =
  | { phase: "chargement" }
  /** Aucune session restaurable : REQ-UIX-06 renvoie à l'OIDC, sans écran intermédiaire. */
  | { phase: "hors-session" }
  /**
   * REQ-COR-06 / REQ-UI-04 — cet appareil ne peut pas encore chiffrer. Bloquant.
   *
   * `mode` dit **laquelle des deux étapes** : fabriquer la clé (inscription) ou recevoir
   * celle qui existe déjà (toute reconnexion). Les confondre était le défaut : chaque
   * `m.login.token` donne un `device_id` neuf, donc un appareil non signé, et l'écran de
   * création s'ouvrait devant quelqu'un qui avait sa clé depuis longtemps.
   */
  | { phase: "recuperation-requise"; session: Session; mode: Exclude<RecoveryState, "prete"> }
  | { phase: "prete"; session: Session };

/** Le paramètre que Synapse ajoute au retour du fournisseur OIDC. */
export const PARAM_JETON = "loginToken";

/**
 * REQ-UIX-06 — l'URL de départ vers le fournisseur. C'est Synapse qui redirige : nous
 * n'avons **aucune UI de mot de passe**, et nous n'en aurons pas (REQ-UI-04).
 */
export function urlConnexion(homeserverUrl: string, retour: string): string {
  const url = new URL("/_matrix/client/v3/login/sso/redirect", homeserverUrl);
  url.searchParams.set("redirectUrl", retour);
  return url.toString();
}

/**
 * Le jeton de connexion arrive dans l'URL. Il doit **disparaître de la barre d'adresse
 * et de l'historique** aussitôt consommé (contrainte M-B) : un jeton dans l'historique
 * se retrouve dans une capture d'écran, une synchronisation de navigateur, ou un
 * copier-coller d'URL.
 *
 * `replaceState` et non `pushState` : l'entrée d'historique qui portait le jeton est
 * remplacée, pas doublée.
 */
export function retirerJetonDeLUrl(location: Location, history: History): string | null {
  const url = new URL(location.href);
  const jeton = url.searchParams.get(PARAM_JETON);
  if (!jeton) return null;

  url.searchParams.delete(PARAM_JETON);
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  return jeton;
}

/**
 * REQ-COR-06 / REQ-UI-04 — la porte. `recoveryState()` est la source ; le shard ne dérive
 * rien lui-même — il ne fait que router les trois cas sur deux phases.
 *
 * Sans identité cross-signing sur cet appareil, **le compte ne peut pas chiffrer du
 * tout** (D-08) : il ne recevrait pas les clés Megolm des autres, et les siennes ne
 * partiraient à personne. L'étape n'est donc pas un confort qu'on pourrait différer, et
 * c'est pour ça qu'elle bloque.
 *
 * Il n'y a plus de trace locale à consulter (l'ancien `recuperation-faite`, 08/08/2026) :
 * `recoveryState()` lit le magasin crypto, ce qui répond juste hors ligne **et** distingue
 * les deux étapes. La trace, elle, ne savait rien du `device_id` — après une
 * déconnexion/reconnexion dans le même navigateur, elle laissait passer un appareil non
 * signé, muet et sourd, avec l'application entière derrière.
 */
export async function etatDe(session: Session): Promise<EtatSession> {
  const etat = await session.recoveryState();
  return etat === "prete"
    ? { phase: "prete", session }
    : { phase: "recuperation-requise", session, mode: etat };
}
