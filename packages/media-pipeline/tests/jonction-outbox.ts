import type { Outbox } from "@tacita/outbox";

import type { AttachmentContent, PieceJointePreparee } from "../src";

/**
 * Audit des jonctions — le site de compilation qui n'existait pas.
 *
 * `@tacita/media-pipeline` : « le pipeline produit un contenu prêt à `enqueue` ». C'est une
 * promesse inter-modules, et **aucun paquet ne dépendait des deux** : rien ne la
 * vérifiait, ni compilateur, ni test. Elle était fausse — `AttachmentContent` était
 * déclarée en `interface`, qui n'a pas d'index signature implicite et n'est donc pas
 * assignable au `Record<string, unknown>` d'`enqueue`. Le développeur de `apps/web`
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

/**
 * **La seconde moitié de la même jonction, ajoutée le 20/08/2026 avec.**
 *
 * La file possède désormais la reprise du téléversement, et le pipeline lui remet des
 * blobs chiffrés accompagnés du chemin où poser leur URL. C'est une seconde promesse
 * inter-modules — la forme de `Televersement` d'un côté, celle de `TeleversementEnAttente`
 * de l'autre — et elle n'a, elle non plus, aucun autre site de compilation : le paquet
 * `outbox` ne connaît pas les médias, et c'est voulu.
 *
 * La conversion `Bytes` → `ArrayBuffer` est faite par l'appelant (le shard) : elle est
 * délibérément **hors** de la promesse, parce que c'est IndexedDB qui l'impose et que
 * c'est la file, pas le pipeline, qui persiste.
 */
export function passationTeleversement(
  outbox: Outbox,
  roomId: string,
  { contenu, televersements }: PieceJointePreparee,
) {
  return outbox.enqueue(
    roomId,
    contenu,
    undefined,
    televersements.map(({ chemin, ciphertext }) => ({
      chemin,
      octets: ciphertext.buffer.slice(
        ciphertext.byteOffset,
        ciphertext.byteOffset + ciphertext.byteLength,
      ),
    })),
  );
}
