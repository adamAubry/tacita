/**
 * La palette de DESIGN.md, telle qu'elle y est écrite : un nom, un couple clair/sombre.
 * **Le seul endroit du dépôt où une valeur hexadécimale de DESIGN.md est recopiée.**
 *
 * Ce fichier n'importe rien, et c'est délibéré : il est lu par le thème (composant
 * client) **et** par le layout racine (composant serveur), qui a besoin de la couleur de
 * la barre système. Laisser la palette dans `theme.ts` fait appeler `defineTheme()` — une
 * fonction client — depuis le serveur, et le build échoue. Vécu.
 */
export const PALETTE = {
  bg: { clair: "#F6F7F6", sombre: "#131514" },
  surface: { clair: "#FFFFFF", sombre: "#1B1E1D" },
  surfaceRaised: { clair: "#FFFFFF", sombre: "#232726" },
  hairline: { clair: "#E2E5E3", sombre: "#303534" },
  text: { clair: "#1A1D1C", sombre: "#E9ECEA" },
  textMuted: { clair: "#5E6663", sombre: "#9AA39F" },
  accent: { clair: "#155E4D", sombre: "#4FBD96" },
  /** `accent` à 10 % en clair, 16 % en sombre. */
  accentSoft: { clair: "#155E4D1A", sombre: "#4FBD9629" },
  danger: { clair: "#B3352C", sombre: "#E5716A" },
  /**
   * Les fonds d'état, **à 10 %** — le seul taux que DESIGN.md écrive pour un « soft »
   * (`accent-soft`). Ils étaient à 20 % : assez teintés pour que la description d'un
   * bandeau, rendue par Astryx en texte muet, tombe à 4,0:1 sur le fond d'erreur, sous le
   * seuil AA que DESIGN.md exige de chaque paire. Mesuré au navigateur le 10/08/2026.
   */
  dangerSoft: { clair: "#B3352C1A", sombre: "#E5716A1A" },
  warning: { clair: "#9A6A00", sombre: "#D9A441" },
  warningSoft: { clair: "#9A6A001A", sombre: "#D9A4411A" },
  /**
   * Sur l'accent — **inversé en sombre**, exactement comme `surWarning` juste en dessous
   * et pour la même raison. L'accent n'est profond que du côté clair : en sombre c'est un
   * vert *pâle* (#4FBD96), et le blanc dessus tombe à **2,3:1**. DESIGN.md exige AA sur
   * chaque paire, donc 4,5:1 ; l'encre sombre y donne 8,2:1.
   *
   * Le défaut portait sur tous les boutons primaires de l'app en thème sombre — mesuré au
   * navigateur le 10/08/2026. jsdom ne calcule aucune couleur : un test de contraste sur
   * la palette (`theme.test.ts`) garde désormais la règle sans navigateur.
   */
  surAccent: { clair: "#FFFFFF", sombre: "#131514" },
  /** **Inversé** par rapport au défaut d'Astryx — voir le commentaire plus bas. */
  surWarning: { clair: "#FFFFFF", sombre: "#1A1D1C" },
  voileModale: { clair: "#1A1D1C80", sombre: "#13151499" },
  voileSurvol: { clair: "#1A1D1C0D", sombre: "#E9ECEA0F" },
  voilePresse: { clair: "#1A1D1C1A", sombre: "#E9ECEA1F" },
} as const;

export type Couple = { clair: string; sombre: string };
