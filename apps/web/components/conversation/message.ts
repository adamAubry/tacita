import { ROOM_MENTION, EVERYONE } from "@tacita/messaging";
import type { OutboxEntry, OutboxStatus } from "@tacita/outbox";

import { memeJour } from "../../lib/dates";
import type { Media } from "../media/media";

/**
 * Un message tel que la timeline le rend — venu du flux `/sync` **ou** de la file
 * d'envoi (spec 07). Les deux origines se rendent pareil : c'est tout l'intérêt de
 * l'envoi optimiste, l'utilisateur voit son message avant que le serveur le confirme.
 */
export interface MessageAffiche {
  /** `event_id` s'il existe, `txnId` sinon. Jamais les deux. */
  cle: string;
  auteur: string;
  /** Nom d'affichage, ou l'identifiant à défaut. */
  nom: string;
  texte: string;
  horodatage: number;
  /** Absent = le message est dans la timeline ; présent = encore dans la file. */
  envoi?: OutboxStatus;
  /** `errcode` de la dernière tentative. `NOT_ENCRYPTED` ne se réessaie pas. */
  errcode?: string;
  /** `undefined` tant que le serveur n'a pas attribué d'identifiant. */
  eventId?: string;
  moi: boolean;
  /** REQ-MSG-06 — droits exposés par le paquet, jamais dérivés ici. */
  modifiable?: boolean;
  supprimable?: boolean;
  /** REQ-UI-14 — la pièce jointe, quand le message en porte une (M-E). */
  media?: Media;
}

/** Une entrée de file, rendue comme un message. Le contenu n'est jamais journalisé. */
export function depuisFile(entree: OutboxEntry, nom: string, auteur: string): MessageAffiche {
  const body = entree.content.body;
  return {
    cle: entree.txnId,
    auteur,
    nom,
    texte: typeof body === "string" ? body : "",
    horodatage: entree.queuedAt,
    envoi: entree.status,
    errcode: entree.errcode,
    moi: true,
  };
}

/**
 * REQ-MSG-10 dit que le corps porte `@room` — c'est ce littéral que la push rule native
 * cherche. L'utilisateur, lui, a tapé `@everyone` et doit le relire tel quel : le rendu
 * inverse est explicitement à la charge de l'UI (spec 05).
 */
export const texteAffiche = (texte: string) => texte.replaceAll(ROOM_MENTION, EVERYONE);

/** REQ-UIX-12 — la fenêtre de regroupement Discord. */
export const FENETRE_GROUPE_MS = 5 * 60 * 1000;

/**
 * REQ-UI-06 — un séparateur de date à **chaque changement de jour**, et un avant le
 * premier message : sans lui, le haut de la timeline est le seul endroit où l'on ne sait
 * pas quel jour on lit.
 */
export function nouveauJour(
  precedent: MessageAffiche | undefined,
  message: MessageAffiche,
): boolean {
  return precedent === undefined || !memeJour(precedent.horodatage, message.horodatage);
}

/**
 * REQ-UIX-12 — l'en-tête (avatar + nom) se rend au premier message, au changement
 * d'auteur, au changement de jour, et après cinq minutes de silence du même auteur.
 *
 * Fonction **pure** de deux messages voisins, comme la spec l'exige. « Sans activité
 * intermédiaire » est gratuit ici : `precedent` est le message immédiatement au-dessus,
 * donc quelqu'un qui a parlé entre les deux est déjà un changement d'auteur.
 */
export function shouldShowHeader(
  precedent: MessageAffiche | undefined,
  message: MessageAffiche,
): boolean {
  if (!precedent) return true;
  if (precedent.auteur !== message.auteur) return true;
  if (nouveauJour(precedent, message)) return true;
  return message.horodatage - precedent.horodatage > FENETRE_GROUPE_MS;
}
