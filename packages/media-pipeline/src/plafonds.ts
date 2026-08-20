/**
 * REQ-MED-15 — **deux plafonds de taille en réception**, et la fonction pure qui tranche.
 *
 * Le raisonnement « la compression à l'envoi borne la mémoire » ne vaut que pour ce que
 * Tacita émet. Une vidéo reçue d'Element iOS peut faire 400 Mo en HEVC 4K, et sur le
 * chemin tout-ou-rien le chiffré, le clair et le Blob coexistent — environ trois fois la
 * taille du fichier. Sur Safari mobile, l'onglet meurt.
 *
 * `info.size` est connu **avant** tout téléchargement : la décision se prend sans réseau.
 */

export interface Seuils {
  /** Au-delà, aucun lecteur n'est proposé : l'action offerte est le téléchargement. */
  inline: number;
  /** Au-delà, refus explicite — **et seulement quand le flux est indisponible**. */
  dur: number;
}

const Mio = 1024 * 1024;

/**
 * Première calibration, à mesurer sur appareil et à ajuster ensuite — d'où des seuils
 * injectés partout plutôt qu'un accès direct à cette table.
 *
 * `dur` n'est pas trois fois plus haut que `inline` par hasard : il ne s'applique qu'au
 * chemin sans flux, celui qui paie l'amplification de trois. Le mobile est plus bas des
 * deux côtés, parce que l'onglet y meurt sans avertissement.
 */
export const SEUILS: Readonly<Record<"bureau" | "mobile", Seuils>> = {
  bureau: { inline: 80 * Mio, dur: 200 * Mio },
  mobile: { inline: 25 * Mio, dur: 60 * Mio },
};

/**
 * `inline` — lecteur, comportement d'aujourd'hui.
 * `telechargement` — pas de lecteur, on propose d'écrire le fichier sur l'appareil.
 * `refus` — même le téléchargement est hors de portée de cet appareil, et on le dit.
 */
export type Verdict = "inline" | "telechargement" | "refus";

/**
 * `telechargement` est aussi le seul verdict que l'utilisateur peut forcer : au-dessus de
 * `inline` c'est un inconfort, il décide ; au-dessus de `dur` sans flux, c'est un onglet
 * qui meurt, et personne ne décide. Une seule notion, pas un second prédicat qui dirait
 * la même chose d'une autre façon.
 */

/**
 * REQ-MED-15 — la décision, sans UI et sans réseau.
 *
 * `flux` dit si le téléchargement par tranches est disponible (`showSaveFilePicker`).
 * Quand il l'est, `dur` ne s'applique pas : le clair ne coexiste jamais avec lui-même, et
 * le seul plafond qui reste est celui du chiffré — que `inline` ne borne pas non plus.
 *
 * Taille inconnue ⇒ `inline`. **Limite assumée** : un événement sans `info.size` échappe
 * aux deux plafonds. Notre pipeline l'écrit toujours (REQ-MED-04) ; un client tiers qui
 * l'omet retombe sur le comportement d'avant cette REQ, pas sur un refus — refuser ce
 * qu'on ne sait pas mesurer bloquerait des médias parfaitement lisibles.
 */
export function verdictTaille(
  taille: number | undefined,
  { flux, seuils }: { flux: boolean; seuils: Seuils },
): Verdict {
  if (taille === undefined || taille <= seuils.inline) return "inline";
  return flux || taille <= seuils.dur ? "telechargement" : "refus";
}
