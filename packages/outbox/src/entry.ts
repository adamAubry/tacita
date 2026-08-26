/**
 * « envoyé » n'est pas un statut : c'est la sortie de la file. Ce qui
 * arrive après relève de `@tacita/receipts`.
 */
export type OutboxStatus = "queued" | "sending" | "failed";

/**
 * un blob chiffré qui attend son téléversement, et l'endroit du contenu où
 * son URL ira.
 *
 * La file ne sait rien des médias : elle transporte des octets et un chemin, et c'est le
 * pipeline qui a décidé des deux. C'est ce qui permet à la reprise d'exister ici
 * sans que ce paquet dépende de celui-là.
 */
export interface TeleversementEnAttente {
  chemin: string[];
  /** `ArrayBuffer` et non `Uint8Array` : c'est ce qu'IndexedDB rend tel quel. */
  octets: ArrayBuffer;
}

export interface OutboxEntry {
  /** généré à l'enqueue, réutilisé tel quel à chaque tentative. */
  txnId: string;
  roomId: string;
  /**
   * Contenu prêt à envoyer, stocké tel quel : c'est la Session qui le chiffre au
   * moment de l'envoi. Il ne transite par aucun log.
   */
  content: Record<string, unknown>;
  /**
   * ce qu'il reste à téléverser avant que l'événement puisse partir.
   *
   * Chaque téléversement réussi **sort de cette liste et l'entrée est réécrite** : une
   * reprise après échec ou après redémarrage ne rechiffre rien et ne re-téléverse que ce
   * qui manquait.
   */
  televersements?: TeleversementEnAttente[];
  status: OutboxStatus;
  attempts: number;
  /** l'ordre FIFO par salon en découle. */
  queuedAt: number;
  nextAttemptAt: number;
  /** Code d'erreur Matrix, ou `network`. Jamais le message d'erreur, qui peut citer le contenu. */
  errcode?: string;
}

export const byQueuedAt = (a: OutboxEntry, b: OutboxEntry): number => a.queuedAt - b.queuedAt;
