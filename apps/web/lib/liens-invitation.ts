import type { Session } from "@tacita/client-core";

/**
 * Le client du service de liens d'invitation. **Une API HTTP, pas un paquet** :
 * le service est une app à part, jointe sous `/invite/` par le proxy. Son
 * nom de dossier n'est pas écrit ici : un test de `invite-tokens` vérifie qu'aucun autre
 * module ne le connaît, et c'est la bonne frontière.
 *
 * L'interface existe pour la même raison que `Contacts` : les écrans se codent
 * contre elle, et la substitution en test ne demande aucune réécriture.
 *
 * Ce module ne connaît **aucune** des règles du service — non-énumérabilité, atomicité,
 * blocage, émetteur disparu. Elles vivent dans le service, qui rend un seul échec pour
 * toutes. L'UI dit « ce lien n'est plus valide », et c'est tout ce qu'elle
 * peut honnêtement dire.
 */
export interface LienActif {
  id: string;
  kind: "friend" | "group";
  /**
   * Le salon d'un lien `group`. **Le panneau de liens est celui d'un groupe** : sans lui,
   * il ne pouvait pas distinguer ses liens de ceux des autres groupes de l'émetteur, et
   * ouvrait donc le sas d'un salon sur la foi d'un lien qui menait ailleurs.
   */
  roomId?: string;
  /** Millisecondes epoch. L'horloge qui fait foi est celle du serveur. */
  expiresAt: number;
  usesLeft: number;
}

/**
 * ce que la résolution rend, et **rien de plus** : le service s'arrête là.
 * `roomId` n'existe que pour un lien de groupe.
 *
 * Ce que le porteur fait ensuite dépend du `kind` et vit dans l'écran de réception
 * (M-G) : `friend` → invitation de DM native vers l'émetteur ; `group` → `knock` sur le
 * salon, qu'un membre confirmera (voie A). Le service n'émet ni l'un ni l'autre —
 * c'est la ratification n°1 de `invite-tokens`, et elle n'a pas bougé.
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
  /** un lien de groupe, borné en usages et en durée. */
  emettreGroupe(roomId: string, options?: { maxUses?: number; ttlSeconds?: number }): Promise<LienEmis>;
  /**
   * (M-G) — un lien d'ami. Même route, même bornes : seul `kind` change.
   * Le service refuse `roomId` sur un lien `friend`, et n'en a pas besoin — l'émetteur
   * est déduit du jeton d'accès.
   */
  emettreAmi(options?: { maxUses?: number; ttlSeconds?: number }): Promise<LienEmis>;
  revoquer(id: string): Promise<void>;
  /**
   * résout un token porté par quelqu'un d'autre. Échoue de la **même
   * façon** pour un token inconnu, expiré, révoqué ou bloqué : l'UI ne peut
   * honnêtement dire que « ce lien n'est plus valide ».
   */
  resoudre(token: string): Promise<LienResolu>;
}

/** défauts du service, repris ici pour que l'UI puisse les afficher. */
export const USAGES_PAR_DEFAUT = 1;
export const DUREE_PAR_DEFAUT_S = 86_400;

/** Le préfixe de la route, écrit une fois : `urlDInvitation` l'émet, `estCheminInvitation` le reconnaît. */
const PREFIXE_INVITATION = "/i/";

/**
 * L'URL qu'on partage. **Une seule définition dans le dépôt** : M-H l'émet pour les
 * groupes, M-G pour les amis, et la route qui la consomme doit correspondre à la
 * lettre. Deux constructions séparées dériveraient au premier renommage.
 *
 * elle ne porte que le token : ni émetteur, ni salon, ni nom lisible.
 */
export const urlDInvitation = (origine: string, token: string) =>
  `${origine}${PREFIXE_INVITATION}${token}`;

/**
 * Reconnaître un chemin d'invitation, **depuis la même définition que celle qui l'émet**.
 * Le parcours d'accueil en a besoin : sa dernière étape navigue, et naviguer par-dessus
 * une invitation la jette — un lien à usage unique valable un jour ne se retrouve pas.
 */
export const estCheminInvitation = (chemin: string) => chemin.startsWith(PREFIXE_INVITATION);

/**
 * le partage. **Web Share API quand elle existe**, presse-papiers sinon :
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
 * L'échec du service, **avec son statut**. C'est lui qui permet de classer (règle 2) : le
 * service confond délibérément ses quatre causes d'invalidité en un seul 404, mais « ce
 * lien n'est plus valide » et « le service ne répond pas » ne se résolvent pas du tout de
 * la même façon — l'un demande un autre lien, l'autre d'attendre. Sans le statut, l'écran
 * de réception affichait le second pour le premier, et conseillait d'attendre là où
 * attendre ne pouvait rien donner.
 */
export class ErreurLien extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`service de liens : ${status}`);
    this.status = status;
  }
}

/**
 * Un refus du service, par opposition à une panne. `404` couvre les quatre causes que le
 * service refuse de distinguer, `400` le seul cas qu'il nomme (son propre lien) : dans
 * les deux, il n'y a rien à réessayer. Tout le reste — 429, 5xx, réseau absent — est une
 * panne, et pour celle-là réessayer est le bon conseil.
 */
export const estLienRefuse = (erreur: unknown) =>
  erreur instanceof ErreurLien && (erreur.status === 404 || erreur.status === 400);

/**
 * Le service est joint avec le **jeton d'accès Matrix** de l'appelant : il ne croit
 * jamais un identifiant qu'on lui donne, il le valide auprès de Synapse.
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
    if (!reponse.ok) throw new ErreurLien(reponse.status);
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
