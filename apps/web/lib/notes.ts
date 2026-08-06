import type { Session } from "@tacita/client-core";

import { ecrireCle, lireCle, viderStore } from "./preferences";

/**
 * REQ-UIX-27 — la note privée sur un profil.
 *
 * **Locale à l'appareil, jamais synchronisée** (D-09, escalade E-02 tranchée le
 * 05/08/2026). Le mécanisme naturel — l'account data Matrix — est en clair côté serveur :
 * y déposer ce qu'on pense de quelqu'un serait exactement le contenu que le principe
 * directeur protège. La note suit l'appareil, pas l'utilisateur, et c'est **définitif**,
 * pas une étape vers une version synchronisée.
 *
 * Base distincte des préférences : celles-ci promettent « aucun contenu, que des choix
 * d'affichage ». Une note en est.
 */
const BASE = "tacita-notes";
const STORE = "notes";

/**
 * Le libellé est **exigé mot pour mot** par REQ-UIX-27. Il vit ici, en constante, pour
 * qu'aucun écran ne le reformule : « visible uniquement par vous » sans « sur cet
 * appareil » serait une promesse de synchronisation que rien ne tient (interdit n°13).
 */
export const LIBELLE_NOTE = "Note (visible uniquement par vous, sur cet appareil)";

export async function lireNote(indexedDB: IDBFactory, userId: string): Promise<string> {
  const valeur = await lireCle(indexedDB, userId, BASE, STORE);
  return typeof valeur === "string" ? valeur : "";
}

/** Une note vidée est **supprimée**, pas stockée comme chaîne vide. */
export const ecrireNote = (indexedDB: IDBFactory, userId: string, note: string) =>
  ecrireCle(indexedDB, userId, note.trim(), BASE, STORE);

/**
 * REQ-UIX-27 / REQ-COR-10 — enregistré au registre de wipe : la déconnexion efface les
 * notes comme elle efface l'index de recherche. Les laisser derrière ferait qu'un
 * appareil partagé rend au suivant ce que le précédent pensait de ses contacts.
 */
export function enregistrerWipeNotes(session: Session, indexedDB: IDBFactory): void {
  session.registerWipe("notes", () => viderStore(indexedDB, BASE, STORE));
}
