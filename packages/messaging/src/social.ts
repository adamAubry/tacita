import type { Session } from "@tacita/client-core";

import { registerDirect } from "./conversations";

/**
 * Le modèle social de D-09, et rien de plus.
 *
 * Chaque fonction d'ici est un appel Matrix **natif** : accepter une demande d'ami est un
 * `join`, la refuser un `leave`, bloquer une écriture dans `m.ignored_user_list`. Il n'y
 * a pas de graphe social derrière, et il n'y en aura pas — D-09 l'a refusé, pas reporté.
 *
 * Ces fonctions vivent dans le paquet et non dans un écran pour la même raison qu'en
 * M-C : « ami », « bloqué » et « demande en attente » sont de la logique métier, et une
 * définition dispersée dans trois composants dérive au premier écran suivant.
 */

/**
 * REQ-MSG-16 — accepter une demande d'ami. C'est un `join` sur le DM invité, pas une
 * écriture dans un registre : D-09 fait de l'invitation de salon **la** demande d'ami.
 *
 * Rend l'identifiant du salon rejoint, celui que l'UI ouvre ensuite.
 */
export async function acceptInvitation(session: Session, roomId: string): Promise<string> {
  // L'invitant est lu **avant** le join : une fois entré, le salon n'est plus une
  // invitation et `getDMInviter()` ne rend plus rien.
  const invitant = session.client.getRoom(roomId)?.getDMInviter();
  await session.client.joinRoom(roomId);

  // REQ-MSG-15 — côté invité aussi, `m.direct` est à écrire : le drapeau `is_direct` de
  // l'invitation ne devient jamais de l'account data tout seul. Sans cela, accepter une
  // demande d'ami donne une conversation qui n'est un DM pour aucun des deux.
  if (invitant) await registerDirect(session, invitant, roomId);
  return roomId;
}

/**
 * REQ-MSG-16 — refuser une demande, ou retirer un ami : dans les deux cas un `leave`.
 *
 * Le geste est le même côté protocole ; ce qui diffère est ce que l'UI en dit, et c'est
 * à elle de le dire. Deux fonctions identiques ici ne feraient qu'inviter à les faire
 * diverger.
 */
export async function leaveConversation(session: Session, roomId: string): Promise<void> {
  await session.client.leave(roomId);
}

/**
 * REQ-MSG-17 — la liste d'ignorés du compte, telle que le serveur la porte.
 *
 * Le SDK la tient à jour depuis l'account data ; on ne la recopie pas ailleurs, sinon
 * deux sources répondraient « est-ce que je l'ai bloqué ? ».
 */
export const ignoredUsers = (session: Session): string[] => session.client.getIgnoredUsers();

/**
 * REQ-MSG-17 — bloquer et débloquer, par `m.ignored_user_list` natif.
 *
 * **Ce que le blocage fait réellement**, et que l'UI doit dire sans l'embellir (interdit
 * n°13) : le serveur cesse de nous **envoyer** les événements de cette personne. Elle
 * n'est pas empêchée d'écrire, elle n'est pas prévenue, et elle reste membre des salons
 * partagés. C'est une mise en sourdine côté réception, pas une expulsion.
 *
 * L'écriture remplace la liste entière — c'est la forme de l'account data. On relit
 * donc l'état courant juste avant, plutôt que de tenir un cache qui divergerait.
 */
export async function ignoreUser(session: Session, userId: string): Promise<void> {
  const courants = ignoredUsers(session);
  if (courants.includes(userId)) return;
  await session.client.setIgnoredUsers([...courants, userId]);
}

export async function unignoreUser(session: Session, userId: string): Promise<void> {
  const courants = ignoredUsers(session);
  if (!courants.includes(userId)) return;
  await session.client.setIgnoredUsers(courants.filter((id) => id !== userId));
}

/** Ce qu'un profil Matrix porte. Les deux champs sont facultatifs côté protocole. */
export interface Profile {
  userId: string;
  /** Le nom d'affichage, ou l'identifiant si le compte n'en a pas posé. */
  displayName: string;
  /** URL `mxc://`, à déchiffrer/résoudre par le pipeline média — jamais une URL http. */
  avatarUrl?: string;
}

/**
 * REQ-MSG-18 — le profil public d'un utilisateur.
 *
 * Un profil absent n'est pas une erreur : un compte peut n'avoir jamais posé de nom, et
 * le serveur répond alors `404`. On retombe sur l'identifiant, qui est toujours vrai et
 * toujours affichable — laisser lever ferait échouer l'écran entier pour un champ vide.
 */
export async function profileOf(session: Session, userId: string): Promise<Profile> {
  try {
    const profil = await session.client.getProfileInfo(userId);
    return {
      userId,
      displayName: profil.displayname ?? userId,
      avatarUrl: profil.avatar_url,
    };
  } catch {
    return { userId, displayName: userId };
  }
}

/**
 * REQ-MSG-18 — modifier son propre profil. Deux écritures distinctes côté protocole ;
 * on ne pose que ce qui est fourni, pour qu'un formulaire qui ne change que le nom
 * n'efface pas la photo.
 *
 * `avatarUrl` est un `mxc://` déjà téléversé — le téléversement appartient au pipeline
 * média (spec 08), pas à ce paquet.
 */
export async function updateProfile(
  session: Session,
  changements: { displayName?: string; avatarUrl?: string },
): Promise<void> {
  if (changements.displayName !== undefined) {
    await session.client.setDisplayName(changements.displayName);
  }
  if (changements.avatarUrl !== undefined) {
    await session.client.setAvatarUrl(changements.avatarUrl);
  }
}

/**
 * REQ-MSG-19 — recherche d'utilisateur dans l'**annuaire** du homeserver.
 *
 * À ne pas confondre avec la recherche de contenu : l'annuaire porte des identifiants et
 * des noms d'affichage, jamais de messages. `/search` de Synapse reste interdit
 * (interdit n°3) et n'a rien à voir avec cet endpoint.
 *
 * Un terme vide ne part pas : l'annuaire rendrait un échantillon arbitraire du serveur,
 * ce qui n'est pas une réponse à « qui cherchez-vous ? ».
 */
export async function searchUsers(
  session: Session,
  terme: string,
  limite = 20,
): Promise<Profile[]> {
  const recherche = terme.trim();
  if (recherche.length === 0) return [];

  /**
   * REQ-MSG-19 — **un identifiant complet se résout par son profil, pas par l'annuaire.**
   *
   * Mesuré contre un vrai Synapse le 07/08/2026 : `/user_directory/search` rend
   * `results: []` pour un compte qui existe pourtant, tandis que `/profile/@…` rend son
   * nom d'affichage. Ce n'est pas une panne — c'est le défaut de Synapse
   * (`search_all_users: false`) : l'annuaire ne montre que les gens avec qui on partage
   * déjà un salon, ou qui sont dans un salon public. Notre déploiement n'en a aucun.
   *
   * Conséquence sans ce chemin : « Ajouter par identifiant » (D-09, REQ-UIX-28) ne
   * trouve **jamais** personne, et il est impossible d'entamer une première
   * conversation — le parcours d'entrée du produit.
   *
   * On ne rend pas pour autant tout le serveur cherchable (`search_all_users: true`
   * côté infra) : cela exposerait chaque compte à tout autre. Quand on connaît déjà
   * l'identifiant, on n'a pas besoin d'un annuaire — on a une adresse.
   */
  if (/^@[^:\s]+:[^:\s]+$/.test(recherche)) {
    const profil = await profileOf(session, recherche);
    // Un identifiant inexistant rend un profil de repli portant l'identifiant lui-même
    // (REQ-MSG-18) : on ne propose que ce que le serveur a vraiment reconnu.
    return profil.displayName === recherche ? [] : [profil];
  }

  const reponse = await session.client.searchUserDirectory({ term: recherche, limit: limite });
  return reponse.results.map((resultat) => ({
    userId: resultat.user_id,
    displayName: resultat.display_name ?? resultat.user_id,
    avatarUrl: resultat.avatar_url,
  }));
}
