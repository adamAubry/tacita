import type { SearchFilters, SearchStats } from "@tacita/search";

import { ecrireCle, lireCle } from "./preferences";

/**
 * la fenêtre de débounce. Une frappe ne déclenche pas une requête : on
 * attend que la saisie se pose. 300 ms est la valeur de la spec, pas un réglage.
 */
export const DEBOUNCE_MS = 300;

/** Les champs de la barre. Les clés servent aussi de clés de tokens. */
export const CHAMP_TEXTE = "texte";
export const CHAMP_PERSONNE = "personne";
export const CHAMP_CONVERSATION = "conversation";
export const CHAMP_TYPE = "type";
export const CHAMP_APRES = "apres";
export const CHAMP_AVANT = "avant";
/**
 * le token pré-armé de l'onglet Mentions. Il est en lecture seule : c'est
 * l'onglet lui-même, pas un filtre que l'utilisateur aurait ajouté et pourrait retirer.
 */
export const CHAMP_MENTIONS = "mentions";
export const JETON_MOI = "@me";

/**
 * Un token de la barre, réduit à ce dont la traduction a besoin. Le type d'Astryx est
 * plus large (opérateurs, valeurs de dix formes) ; n'en dépendre que par cette forme
 * garde `filtresDepuis` testable sans construire un `PowerSearchFilter` complet.
 */
export interface Token {
  field: string;
  value: { type: string; value?: string; unixSeconds?: number };
}

/**
 * les tokens de la barre deviennent les critères de `search()`. Chaque
 * champ a **un** critère d'index correspondant : rien n'est traduit en
 * plein-texte, ce qui est explicitement proscrit.
 *
 * Les critères se composent en ET côté paquet ; deux tokens rendent donc l'intersection
 * sans que ce module ait à la calculer.
 */
export function filtresDepuis(tokens: readonly Token[]): SearchFilters {
  const filtres: SearchFilters = {};
  for (const { field, value } of tokens) {
    if (field === CHAMP_PERSONNE && value.value) filtres.sender = value.value;
    else if (field === CHAMP_CONVERSATION && value.value) filtres.roomId = value.value;
    else if (field === CHAMP_TYPE && value.value) filtres.msgtype = value.value;
    // Les bornes de l'index sont en millisecondes (`tsOrigin`), le token en secondes.
    else if (field === CHAMP_APRES && value.unixSeconds !== undefined)
      filtres.since = value.unixSeconds * 1000;
    else if (field === CHAMP_AVANT && value.unixSeconds !== undefined)
      filtres.until = value.unixSeconds * 1000;
  }
  return filtres;
}

/** Le terme libre, c'est-à-dire les tokens du champ texte mis bout à bout. */
export const termeDepuis = (tokens: readonly Token[]): string =>
  tokens
    .filter((token) => token.field === CHAMP_TEXTE && token.value.value)
    .map((token) => token.value.value!)
    .join(" ")
    .trim();

/**
 * le périmètre, dit en toutes lettres. La recherche ne couvre que
 * l'historique téléchargé sur cet appareil : le taire laisserait croire à une recherche
 * exhaustive, et un message introuvable passerait pour un bug plutôt que pour une borne
 * connue (interdit n°13).
 *
 * Les bornes viennent de `stats()` et ne se dérivent pas d'ailleurs.
 */
export function libellePerimetre(stats: SearchStats | null): string {
  const base = "Recherche dans l'historique téléchargé sur cet appareil";
  if (!stats || stats.oldestTs === null || stats.newestTs === null) return `${base}.`;

  const jour = (horodatage: number) =>
    new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(horodatage);
  return `${base}, du ${jour(stats.oldestTs)} au ${jour(stats.newestTs)}.`;
}

/**
 * / D-01 — le plafond a mordu : les plus anciens messages sont sortis de
 * l'index. Une seconde phrase, et seulement quand c'est vrai.
 */
export const purgeAMordu = (stats: SearchStats | null): boolean =>
  stats !== null && stats.size >= stats.max;

/** Un fragment de texte, surligné ou non (composant 18). */
export interface Fragment {
  texte: string;
  surligne: boolean;
}

/** Une chaîne littérale dans une expression régulière. */
const echapper = (terme: string) => terme.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Le repli d'accents. Il s'applique **des deux côtés** — au texte et aux mots cherchés :
 * ne plier que le texte ferait que « réunion » ne trouve plus « réunion », puisque le
 * motif accentué ne rencontrerait plus que du texte déplié.
 */
const plier = (valeur: string) => valeur.normalize("NFD").replace(/\p{Diacritic}/gu, "");

/**
 * découpe un extrait en fragments, ceux qui correspondent à un terme étant
 * marqués. Orama fait de l'OR sur les tokens (README du paquet) : chaque mot du terme
 * est cherché séparément, sinon « réunion demain » ne surlignerait rien dans un message
 * qui ne contient que « réunion ».
 *
 * Insensible à la casse et aux accents : `toLocaleLowerCase` seul raterait « Réunion »
 * pour « reunion ». La normalisation ne change pas la longueur des segments — `NFD`
 * la changerait, et les index ne colleraient plus au texte d'origine.
 */
export function segmenter(texte: string, terme: string): Fragment[] {
  const mots = terme
    .split(/\s+/)
    .filter((mot) => mot.length > 0)
    .map((mot) => echapper(plier(mot)));
  if (mots.length === 0) return [{ texte, surligne: false }];

  const motif = new RegExp(`(${mots.join("|")})`, "giu");
  // On segmente sur le texte plié, puis on rend les tranches du texte **d'origine** :
  // l'accent doit rester visible dans le résultat. Le repli ne conserve les positions
  // que s'il ne change pas la longueur — sinon on cherche sur le texte tel quel, quitte
  // à rater un accent plutôt qu'à surligner de travers.
  const plie = plier(texte);
  const source = plie.length === texte.length ? plie : texte;

  const fragments: Fragment[] = [];
  let curseur = 0;
  for (const trouve of source.matchAll(motif)) {
    const debut = trouve.index;
    if (debut > curseur) fragments.push({ texte: texte.slice(curseur, debut), surligne: false });
    fragments.push({ texte: texte.slice(debut, debut + trouve[0].length), surligne: true });
    curseur = debut + trouve[0].length;
  }
  if (curseur < texte.length) fragments.push({ texte: texte.slice(curseur), surligne: false });
  return fragments.length === 0 ? [{ texte, surligne: false }] : fragments;
}

/**
 * les profils récemment recherchés, en **IndexedDB** (interdit n°2). Ce
 * sont des identifiants d'utilisateur, pas du contenu déchiffré : rien de ce que
 * l'interdit n°8 protège n'entre ici — ni corps de message, ni terme cherché.
 */
const CLE_RECENTS = "recherches-recentes";
export const MAX_RECENTS = 8;

export async function lireRecents(indexedDB: IDBFactory): Promise<string[]> {
  const valeur = await lireCle(indexedDB, CLE_RECENTS);
  return Array.isArray(valeur) ? valeur.filter((id): id is string => typeof id === "string") : [];
}

/** Le plus récent en tête, sans doublon, plafonné. */
export function empiler(recents: readonly string[], userId: string): string[] {
  return [userId, ...recents.filter((id) => id !== userId)].slice(0, MAX_RECENTS);
}

export const ecrireRecents = (indexedDB: IDBFactory, recents: readonly string[]) =>
  ecrireCle(indexedDB, CLE_RECENTS, [...recents]);

/** « Purgeable » : l'utilisateur peut vider la liste, sans détour. */
export const purgerRecents = (indexedDB: IDBFactory) => ecrireCle(indexedDB, CLE_RECENTS, []);
