import { ecrirePreference, lirePreference } from "./preferences";

/** Une conversation ouverte depuis un résultat de recherche. */
export interface RechercheRecente {
  roomId: string;
  nom: string;
}

const CLE = "recherches-recentes";

/**
 * REQ-UIX-19 — les recherches récentes, en **IndexedDB** comme tout le reste (interdit
 * n°2), dans la base de préférences que M-A a déjà ouverte : une seule base pour tous les
 * choix d'affichage, plutôt qu'une par fonctionnalité.
 *
 * **Ce ne sont pas des termes de recherche, ce sont des conversations ouvertes.** Garder
 * les mots tapés reviendrait à conserver ce que l'utilisateur a cherché — bien plus
 * intime que la liste de ses conversations, et jamais effacé par une purge de messages.
 */
export const MAX_RECENTES = 12;

export async function lireRecentes(indexedDB: IDBFactory): Promise<RechercheRecente[]> {
  const brut = await lirePreference(indexedDB, CLE).catch(() => undefined);
  return Array.isArray(brut) ? (brut as RechercheRecente[]) : [];
}

/** La plus récente en tête, sans doublon, plafonnée. */
export function empiler(
  recentes: RechercheRecente[],
  ajoutee: RechercheRecente,
): RechercheRecente[] {
  return [ajoutee, ...recentes.filter((item) => item.roomId !== ajoutee.roomId)].slice(
    0,
    MAX_RECENTES,
  );
}

export async function ajouterRecente(
  indexedDB: IDBFactory,
  ajoutee: RechercheRecente,
): Promise<RechercheRecente[]> {
  const suivantes = empiler(await lireRecentes(indexedDB), ajoutee);
  await ecrirePreference(indexedDB, CLE, suivantes);
  return suivantes;
}

/** REQ-UIX-19 — purgeable : l'historique de recherche s'efface sans effacer autre chose. */
export async function purgerRecentes(indexedDB: IDBFactory): Promise<void> {
  await ecrirePreference(indexedDB, CLE, []);
}
