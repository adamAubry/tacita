import type { Session } from "@tacita/client-core";
import { conversations, createGroupChat, registerDirect } from "@tacita/messaging";

/**
 * REQ-UI-23 — **la conversation personnelle**, celle avec laquelle un compte neuf
 * n'arrive plus dans une application vide.
 *
 * Pourquoi elle existe. Un compte qui vient d'être créé n'a aucun correspondant : la
 * liste est vide, l'écran l'explique poliment, et la seule chose qu'on puisse y faire est
 * d'attendre quelqu'un d'autre. Tout ce que le produit sait faire — écrire, joindre une
 * photo, chiffrer — reste invisible tant que personne n'a répondu. Un salon à soi lève ce
 * verrou sans rien promettre de faux : il est réel, il est chiffré comme les autres, et
 * ce qu'on y écrit y reste.
 *
 * Ce n'est pas un salon d'exception. C'est un salon privé chiffré ordinaire
 * (`createGroupChat`, REQ-MSG-02) dont personne d'autre n'est membre, inscrit dans
 * `m.direct` sous son propre identifiant : c'est ce qui le fait lire comme une
 * conversation et non comme un groupe d'une personne — nom, avatar, et l'en-tête de
 * timeline qui dit « c'est le début de votre conversation » plutôt que « de ce groupe ».
 * Le corollaire est dans `lib/contacts.ts` : on n'est pas son propre ami, et cette
 * inscription-là ne fait entrer personne dans la liste d'amis.
 *
 * **Jamais deux fois** : la déduplication est la même que celle de REQ-MSG-15 — un DM
 * rejoint avec ce correspondant existe, on le rend. C'est ce qui rend l'appel sûr depuis
 * une étape qu'un rechargement peut rejouer.
 */
export const NOM_NOTES = "Mes notes";

export async function ouvrirNotesPersonnelles(session: Session): Promise<string> {
  const moi = session.client.getUserId();
  if (!moi) throw new Error("session sans identifiant");

  const existante = conversations(session).find((conversation) => conversation.peerId === moi);
  if (existante) return existante.roomId;

  const { room_id } = await createGroupChat(session, NOM_NOTES);
  // Sans cette ligne, la recherche ci-dessus ne retrouvera jamais ce salon et un second
  // sera créé au prochain passage — et il se lirait comme un groupe, pas comme un DM.
  await registerDirect(session, moi, room_id);
  return room_id;
}
