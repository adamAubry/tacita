import type { Outbox } from "@tacita/outbox";

import type { AttachmentContent } from "../src";

/**
 * Audit des jonctions — le site de compilation qui n'existait pas.
 *
 * Spec 08 : « le pipeline produit un contenu prêt à `enqueue` » (spec 07). C'est une
 * promesse inter-modules, et **aucun paquet ne dépendait des deux** : rien ne la
 * vérifiait, ni compilateur, ni test. Elle était fausse — `AttachmentContent` était
 * déclarée en `interface`, qui n'a pas d'index signature implicite et n'est donc pas
 * assignable au `Record<string, unknown>` d'`enqueue`. Le développeur de la spec 11
 * l'aurait découvert au premier envoi de photo.
 *
 * Ce fichier n'a pas de test à exécuter : il **est** le test. S'il cesse de compiler,
 * la passation est cassée. `npm run typecheck` le couvre.
 *
 * Si la passation doit changer de forme, c'est un arbitrage de spec (07 et 08 se
 * contredisent alors), pas une ligne à réécrire ici.
 */
export function passationVerifiee(outbox: Outbox, roomId: string, contenu: AttachmentContent) {
  return outbox.enqueue(roomId, contenu);
}
