import type { Session } from "@tacita/client-core";

/**
 * Le client du service de liens d'invitation (spec 12). **Une API HTTP, pas un paquet** :
 * le service est une app à part, jointe sous `/invite/` par le proxy (REQ-INF-15). Son
 * nom de dossier n'est pas écrit ici : un test de la spec 12 vérifie qu'aucun autre
 * module ne le connaît, et c'est la bonne frontière.
 *
 * L'interface existe pour la même raison que `Contacts` (E-04) : les écrans se codent
 * contre elle, et la substitution en test ne demande aucune réécriture.
 *
 * Ce module ne connaît **aucune** des règles du service — non-énumérabilité, atomicité,
 * blocage, émetteur disparu. Elles vivent dans le service, qui rend un seul échec pour
 * toutes (REQ-INV-08). L'UI dit « ce lien n'est plus valide », et c'est tout ce qu'elle
 * peut honnêtement dire.
 */
export interface LienActif {
  id: string;
  kind: "friend" | "group";
  /** Millisecondes epoch. L'horloge qui fait foi est celle du serveur (REQ-INV-17). */
  expiresAt: number;
  usesLeft: number;
}

/**
 * REQ-INV-06 — ce que la résolution rend, et **rien de plus** : le service s'arrête là.
 * `roomId` n'existe que pour un lien de groupe.
 *
 * Ce que le porteur fait ensuite dépend du `kind` et vit dans l'écran de réception
 * (M-G) : `friend` → invitation de DM native vers l'émetteur ; `group` → `knock` sur le
 * salon, qu'un membre confirmera (E-13, voie A). Le service n'émet ni l'un ni l'autre —
 * c'est la ratification n°1 de la spec 12, et elle n'a pas bougé.
 */
export interface LienResolu {
  kind: "friend" | "group";
  issuer: string;
  roomId?: string;
}

/** Ce que l'émission rend. Le token n'est lisible **qu'ici** : le service le stocke haché. */
export interface LienEmis {
  id: string;
  token: string;
  expiresAt: number;
}

export interface LiensInvitation {
  lister(): Promise<LienActif[]>;
  /** REQ-INV-01 — un lien de groupe, borné en usages et en durée. */
  emettreGroupe(roomId: string, options?: { maxUses?: number; ttlSeconds?: number }): Promise<LienEmis>;
  /**
   * REQ-UIX-28 (M-G) — un lien d'ami. Même route, même bornes : seul `kind` change.
   * Le service refuse `roomId` sur un lien `friend`, et n'en a pas besoin — l'émetteur
   * est déduit du jeton d'accès.
   */
  emettreAmi(options?: { maxUses?: number; ttlSeconds?: number }): Promise<LienEmis>;
  revoquer(id: string): Promise<void>;
  /**
   * REQ-INV-06 — résout un token porté par quelqu'un d'autre. Échoue de la **même
   * façon** pour un token inconnu, expiré, révoqué ou bloqué (REQ-INV-08) : l'UI ne peut
   * honnêtement dire que « ce lien n'est plus valide ».
   */
  resoudre(token: string): Promise<LienResolu>;
}

/** REQ-INV-01 — défauts du service, repris ici pour que l'UI puisse les afficher. */
export const USAGES_PAR_DEFAUT = 1;
export const DUREE_PAR_DEFAUT_S = 86_400;

/**
 * L'URL qu'on partage. **Une seule définition dans le dépôt** : M-H l'émet pour les
 * groupes, M-G pour les amis, et la route qui la consomme doit correspondre à la
 * lettre. Deux constructions séparées dériveraient au premier renommage.
 *
 * REQ-INV-03 — elle ne porte que le token : ni émetteur, ni salon, ni nom lisible.
 */
export const urlDInvitation = (origine: string, token: string) => `${origine}/i/${token}`;

/**
 * REQ-UIX-28 — le partage. **Web Share API quand elle existe**, presse-papiers sinon :
 * la feuille native est le geste attendu sur mobile, et la recoder donnerait une liste
 * d'applications qui ne serait jamais celle du système.
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

const BASE = "/invite";

/**
 * Le service est joint avec le **jeton d'accès Matrix** de l'appelant : il ne croit
 * jamais un identifiant qu'on lui donne, il le valide auprès de Synapse (REQ-INV-01).
 */
export function liensDeLaSession(session: Session, fetch = globalThis.fetch): LiensInvitation {
  const appeler = async (chemin: string, init: RequestInit = {}): Promise<unknown> => {
    const jeton = session.client.getAccessToken();
    if (!jeton) throw new Error("session sans jeton d'accès : aucun lien ne peut être émis");

    const reponse = await fetch(`${BASE}${chemin}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${jeton}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    });

    // Le corps d'erreur du service est délibérément indifférencié : on ne le décortique
    // pas pour en tirer une cause qu'il refuse de donner.
    if (!reponse.ok) throw new Error(`service de liens : ${reponse.status}`);
    return reponse.status === 204 ? undefined : await reponse.json();
  };

  const emettre = (corps: Record<string, unknown>, options: { maxUses?: number; ttlSeconds?: number }) =>
    appeler("/links", {
      method: "POST",
      body: JSON.stringify({
        ...corps,
        maxUses: options.maxUses ?? USAGES_PAR_DEFAUT,
        ttlSeconds: options.ttlSeconds ?? DUREE_PAR_DEFAUT_S,
      }),
    }) as Promise<LienEmis>;

  return {
    lister: () => appeler("/links") as Promise<LienActif[]>,

    emettreGroupe: (roomId, options = {}) => emettre({ kind: "group", roomId }, options),
    emettreAmi: (options = {}) => emettre({ kind: "friend" }, options),

    revoquer: async (id) => {
      await appeler(`/links/${encodeURIComponent(id)}`, { method: "DELETE" });
    },

    resoudre: (token) =>
      appeler(`/links/${encodeURIComponent(token)}/resolve`, { method: "POST" }) as Promise<LienResolu>,
  };
}
