import type { Session } from "@tacita/client-core";
import type { MatrixEvent } from "matrix-js-sdk";

import { CALL_MEMBER_EVENT_TYPE, isLiveMembership } from "./matrixrtc";

/**
 * **Un appel manqué doit laisser une trace.** Sans elle, un appel non décroché n'a
 * simplement jamais existé : rien dans la conversation, rien dans la liste, aucun moyen
 * de rappeler. C'est la deuxième panne la plus grave d'une messagerie qui appelle, juste
 * après « le téléphone ne sonne pas ».
 *
 * Rien n'est écrit pour ça — **aucun événement inventé**. Le journal se dérive des
 * appartenances MatrixRTC déjà présentes dans la timeline : une appartenance non vide
 * ouvre, une appartenance vide (`{}`) referme, et l'appel est le créneau entre le moment
 * où le salon passe de zéro à un participant et celui où il revient à zéro.
 */

export interface CallLogEntry {
  /** L'`event_id` de l'appartenance qui ouvre l'appel : clé de rendu stable. */
  id: string;
  /** Qui l'a ouvert. */
  from: string;
  debut: number;
  /**
   * Quand le salon est revenu à zéro participant. **Absent** quand personne n'a refermé :
   * un client parti sans nettoyer laisse son appartenance expirer en silence, et la fin
   * réelle est alors inconnue. Une durée inventée serait pire que pas de durée.
   */
  fin?: number;
  /** Tous ceux qui y ont pris part, dans l'ordre d'arrivée, l'initiateur compris. */
  participants: string[];
  /** L'appel est encore vivant : c'est le bandeau du salon qui le porte, pas le journal. */
  enCours: boolean;
  /** J'y étais, depuis n'importe lequel de mes appareils. */
  mien: boolean;
  /** Terminé, sans moi, et je ne l'ai pas ouvert. */
  manque: boolean;
  /**
   * L'`event_id` du dernier événement **non-RTC** qui précède l'ouverture de l'appel.
   *
   * C'est l'ancre de rendu, et elle existe pour ne pas trier : l'ordre canonique est
   * celui du flux `/sync` (interdit n°6), or un journal rendu à côté des messages doit
   * bien se placer quelque part. Fusionner les deux listes par horodatage serait
   * exactement le tri interdit ; les rattacher au message qu'ils suivent redonne l'ordre
   * de `/sync` sans jamais comparer deux dates. Absent : l'appel ouvre la fenêtre chargée.
   */
  apres?: string;
}

const estOuverture = (event: MatrixEvent): boolean =>
  Object.keys(event.getContent()).length > 0;

/**
 * Le journal d'un salon, du plus ancien au plus récent, tel que la fenêtre de timeline
 * chargée permet de le reconstruire. Remonter plus loin dans l'historique en révèle
 * davantage : c'est la même règle que pour les messages, et elle ne se contourne pas.
 */
export function callHistory(session: Session, roomId: string): CallLogEntry[] {
  const moi = session.client.getUserId() ?? "";
  const room = session.client.getRoom(roomId);
  const tout = room?.getLiveTimeline().getEvents() ?? [];
  const evenements = tout.filter((event) => event.getType() === CALL_MEMBER_EVENT_TYPE);

  const journal: CallLogEntry[] = [];
  /** Les appartenances ouvertes, par state key : c'est le compte qui borne l'appel. */
  const presents = new Set<string>();
  let courant: (CallLogEntry & { participants: string[] }) | undefined;
  /** Le dernier message croisé : l'ancre de rendu du prochain appel qui s'ouvre. */
  let ancre: string | undefined;

  for (const event of tout) {
    if (event.getType() !== CALL_MEMBER_EVENT_TYPE) {
      ancre = event.getId() ?? ancre;
      continue;
    }

    const cle = event.getStateKey();
    const auteur = event.getSender();
    if (cle === undefined || auteur === undefined) continue;

    if (estOuverture(event)) {
      if (presents.size === 0) {
        courant = {
          id: event.getId() ?? `${roomId}-${event.getTs()}`,
          from: auteur,
          debut: event.getTs(),
          participants: [],
          enCours: true,
          mien: false,
          manque: false,
          ...(ancre === undefined ? {} : { apres: ancre }),
        };
        journal.push(courant);
      }
      presents.add(cle);
      // Une même personne sur deux appareils reste une personne dans la liste rendue.
      if (courant && !courant.participants.includes(auteur)) courant.participants.push(auteur);
      continue;
    }

    presents.delete(cle);
    if (presents.size === 0 && courant) {
      courant.fin = event.getTs();
      courant.enCours = false;
      courant = undefined;
    }
  }

  /**
   * Le dernier appel peut être resté ouvert de deux façons très différentes : il tourne
   * encore, ou son dernier participant est parti sans le dire et son appartenance a
   * expiré. Le premier cas appartient au bandeau du salon, le second au journal — et sans
   * cette distinction, un appel abandonné restait « en cours » quatre heures durant.
   */
  if (courant) {
    const vivant = evenements.some(
      (event) =>
        presents.has(event.getStateKey() ?? "") &&
        estOuverture(event) &&
        isLiveMembership(event.getContent(), event.getTs()),
    );
    courant.enCours = vivant;
  }

  for (const entree of journal) {
    entree.mien = entree.participants.includes(moi);
    entree.manque = !entree.enCours && !entree.mien && entree.from !== moi;
  }
  return journal;
}
