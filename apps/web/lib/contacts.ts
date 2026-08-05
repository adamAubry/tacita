import type { Session } from "@tacita/client-core";
import { conversations } from "@tacita/messaging";

export interface Contact {
  userId: string;
  nom: string;
}

/**
 * L'interface contre laquelle l'UI se code (E-04). Matrix n'a **aucun graphe social** :
 * un « ami » est un DM existant, et c'est le produit final, pas une étape (D-09).
 *
 * Elle existe pour que la substitution reste possible sans réécriture — du découplage
 * ordinaire, pas un pari sur une V2. M-G en portera l'implémentation complète (demandes,
 * blocage, liens d'invitation) ; M-C n'a besoin que de lister.
 */
export interface Contacts {
  lister(): Contact[];
}

/** L'implémentation native : les correspondants des DM rejoints, et rien d'autre. */
export function contactsDeLaSession(session: Session): Contacts {
  return {
    lister: () =>
      conversations(session)
        .filter((conversation) => conversation.peerId !== undefined)
        .map((conversation) => ({ userId: conversation.peerId!, nom: conversation.name })),
  };
}
