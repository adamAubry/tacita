/**
 * REQ-OBX-04 — « envoyé » n'est pas un statut : c'est la sortie de la file. Ce qui
 * arrive après relève de la spec 06.
 */
export type OutboxStatus = "queued" | "sending" | "failed";

export interface OutboxEntry {
  /** REQ-OBX-03 — généré à l'enqueue, réutilisé tel quel à chaque tentative. */
  txnId: string;
  roomId: string;
  /**
   * Contenu prêt à envoyer, stocké tel quel : c'est la Session qui le chiffre au
   * moment de l'envoi (REQ-OBX-06). Il ne transite par aucun log.
   */
  content: Record<string, unknown>;
  status: OutboxStatus;
  attempts: number;
  /** REQ-OBX-02/05 — l'ordre FIFO par salon en découle. */
  queuedAt: number;
  nextAttemptAt: number;
  /** Code d'erreur Matrix, ou `network`. Jamais le message d'erreur, qui peut citer le contenu. */
  errcode?: string;
}

export const byQueuedAt = (a: OutboxEntry, b: OutboxEntry): number => a.queuedAt - b.queuedAt;
