import type { Session } from "@tacita/client-core";

/**
 * L'état d'entrée dans l'app, tel que l'UI a besoin de le connaître. Rien de plus :
 * la logique vit dans `client-core` (spec 04), le shard ne fait que router dessus.
 */
export type EtatSession =
  | { phase: "chargement" }
  /** Aucune session restaurable : REQ-UIX-06 renvoie à l'OIDC, sans écran intermédiaire. */
  | { phase: "hors-session" }
  /** REQ-COR-06 / REQ-UI-04 — la clé de récupération n'est pas configurée. Bloquant. */
  | { phase: "recuperation-requise"; session: Session }
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
 * REQ-COR-06 / REQ-UI-04 — la porte. `recoveryRequired()` est la source ; le shard ne
 * dérive rien lui-même.
 *
 * Sans clé de récupération, **le compte ne peut pas chiffrer du tout** (D-08) :
 * `setupRecoveryKey()` est ce qui amorce le cross-signing, et la sauter rend le client
 * muet — l'utilisateur pourrait lire, jamais écrire. L'étape n'est donc pas un confort
 * qu'on pourrait différer, et c'est pour ça qu'elle bloque.
 */
export async function etatDe(
  session: Session,
  /** Cet appareil a déjà mené ce compte au bout de l'étape (trace locale, voir plus bas). */
  dejaConfiguree = false,
): Promise<EtatSession> {
  if (!(await session.recoveryRequired())) return { phase: "prete", session };

  /*
   * `recoveryRequired()` confond deux choses : « il n'y a pas de clé » et « je ne peux
   * pas le vérifier maintenant ». Sa source est la version de sauvegarde active, que le
   * SDK n'a pas avant d'avoir pu la relire au serveur — hors ligne, donc, elle est nulle.
   * La porte se refermait sur un compte parfaitement configuré à chaque rechargement sans
   * réseau, et comme elle *remplace* l'application (RecoveryGate), l'historique que
   * REQ-UI-17 promet consultable disparaissait avec elle. Mesuré au navigateur le
   * 08/08/2026 : « Votre clé de récupération / Créer ma clé », réseau coupé.
   *
   * Traiter cet inconnu comme « requise » n'est pas prudent : c'est faux dans le sens
   * qui coûte cher — redemander de créer une clé à quelqu'un qui en a déjà une.
   *
   * La trace locale répond, elle, à une question qui a une réponse locale : *cet
   * appareil* a-t-il déjà mené *ce compte* au bout de l'étape. Si oui, D-08 est satisfait
   * et il n'y a rien à redemander.
   *
   * ponytail: une clé réellement détruite côté serveur ne rouvrira donc plus cette porte
   * sur cet appareil. C'est correct — la porte est un onboarding, pas un contrôle continu.
   * Le jour où il faudra le cas, c'est un parcours de re-vérification qu'il faut, pas ce
   * gardien-ci.
   */
  return dejaConfiguree ? { phase: "prete", session } : { phase: "recuperation-requise", session };
}
