import type { Receipts } from "@tacita/receipts";

import { ecrireModeMasque, lireModeMasque } from "./preferences";

/**
 * REQ-UI-13 / REQ-RCP-07 — le mode masqué se règle dans un écran (M-H) et s'applique
 * dans un autre (la conversation, M-D). Ce module est le seul lien entre les deux.
 *
 * Le service d'accusés porte l'état en mémoire (`setHiddenMode`) et la préférence le
 * porte entre deux lancements : ni l'un ni l'autre ne suffit seul. Écrire seulement la
 * préférence laisserait un service déjà monté continuer d'émettre des reçus publics ;
 * n'appeler que le service perdrait le réglage au rechargement.
 *
 * ponytail: un ensemble de services vivants plutôt qu'un contexte React. Le réglage
 * traverse deux routes qui ne se contiennent pas, et un provider commun coûterait plus
 * que ces quatre lignes. À reprendre le jour où le shard tient une seule instance de
 * `Receipts` pour toute la session — ce serait le bon endroit.
 */
type ServiceMasquable = Pick<Receipts, "setHiddenMode">;

const vivants = new Set<ServiceMasquable>();

/**
 * Branche un service d'accusés sur la préférence, et rend le débranchement.
 *
 * L'application est asynchrone (IndexedDB l'est) : un service naît en mode normal et
 * bascule au premier tour de boucle. La fenêtre est celle du premier `/sync`, avant
 * qu'un reçu ait pu partir.
 */
export function brancherModeMasque(
  indexedDB: IDBFactory,
  receipts: ServiceMasquable,
): () => void {
  vivants.add(receipts);
  // Un échec de lecture laisse le défaut — refuser de démarrer les accusés parce qu'une
  // préférence d'affichage est illisible serait une panne pour rien.
  void lireModeMasque(indexedDB)
    .then((masque) => receipts.setHiddenMode(masque))
    .catch(() => {});

  return () => {
    vivants.delete(receipts);
  };
}

/** Le réglage lui-même : persisté, puis appliqué à ce qui tourne déjà. */
export async function basculerModeMasque(
  indexedDB: IDBFactory,
  masque: boolean,
): Promise<void> {
  await ecrireModeMasque(indexedDB, masque);
  for (const receipts of vivants) receipts.setHiddenMode(masque);
}
