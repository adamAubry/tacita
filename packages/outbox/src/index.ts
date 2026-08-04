// `NOT_ENCRYPTED` est un contrat de passation vers le shard UI (spec 11) : c'est
// l'`errcode` que porte une entrée bloquée par REQ-OBX-09, et l'UI doit le distinguer
// d'un échec réseau. Il était défini mais pas réexporté — le shard aurait dû
// recopier la chaîne en dur, ce qui n'est plus un contrat mais une coïncidence.
export { backoffMs, BASE_BACKOFF_MS, createOutbox, MAX_BACKOFF_MS, NOT_ENCRYPTED } from "./outbox";
export type { Outbox, OutboxOptions } from "./outbox";
export type { OutboxEntry, OutboxStatus } from "./entry";
