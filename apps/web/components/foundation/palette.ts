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
  dangerSoft: { clair: "#B3352C33", sombre: "#E5716A33" },
  warning: { clair: "#9A6A00", sombre: "#D9A441" },
  warningSoft: { clair: "#9A6A0033", sombre: "#D9A44133" },
  /** Sur l'accent, le blanc dans les deux modes : il est profond des deux côtés. */
  surAccent: { clair: "#FFFFFF", sombre: "#FFFFFF" },
  /** **Inversé** par rapport au défaut d'Astryx — voir le commentaire plus bas. */
  surWarning: { clair: "#FFFFFF", sombre: "#1A1D1C" },
  voileModale: { clair: "#1A1D1C80", sombre: "#13151499" },
  voileSurvol: { clair: "#1A1D1C0D", sombre: "#E9ECEA0F" },
  voilePresse: { clair: "#1A1D1C1A", sombre: "#E9ECEA1F" },
} as const;

export type Couple = { clair: string; sombre: string };
