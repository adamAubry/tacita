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
  /*
   * **Normalisé, et pas recopié tel quel.** Synapse compare l'URL de retour aux entrées
   * de `sso.client_whitelist` par **préfixe de chaîne**, sans normaliser quoi que ce soit
   * (`handlers/auth.py`, v1.155.0). L'entrée rendue par `synapse/entrypoint.sh` se termine
   * par `/` — et elle doit s'y terminer, sinon `https://tacita.test.evil.com` en serait
   * un préfixe valide. C'est donc à l'appelant de fournir une URL qui commence par cette
   * entrée, et `location.origin` n'en est pas une : il ne porte jamais de barre finale.
   *
   * Ce qu'un décalage d'un caractère coûtait, avant correction : la comparaison échouait,
   * Synapse renonçait à rediriger et servait `sso_redirect_confirm.html` — une page à
   * bouton « Continuer », **à chaque connexion de chaque utilisateur**. Rien ne cassait,
   * personne ne voyait d'erreur, et le parcours gagnait un clic sur une page qui n'est
   * pas la nôtre.
   *
   * `new URL(...).href` fait la normalisation que la plateforme sait déjà faire : une
   * origine nue gagne sa barre, un chemin (`/i/<token>`) est laissé intact — et reste
   * couvert par le même préfixe.
   */
  url.searchParams.set("redirectUrl", new URL(retour).href);
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
