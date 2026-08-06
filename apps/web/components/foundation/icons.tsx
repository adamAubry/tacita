import type { ReactNode } from "react";

/**
 * Les quatre icônes de la navbar (REQ-UIX-01). Astryx en livre 26, mais ni « accueil »,
 * ni « mentions », ni « profil » — et sa liste de noms est un type fermé, donc on ne
 * peut pas l'étendre. `NavIcon` accepte n'importe quel nœud : on lui donne les nôtres.
 *
 * DESIGN.md : icône au trait monochrome. Les quatre partagent exactement la même
 * géométrie — 24×24, trait de 1,5, extrémités rondes — parce qu'une navbar dont les
 * traits n'ont pas la même épaisseur se voit immédiatement, même sans savoir pourquoi.
 * `currentColor` : la couleur vient du token, jamais d'ici.
 */
const trait = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export const IconeAccueil: ReactNode = (
  <svg {...trait}>
    <path d="M3.5 10.5 12 4l8.5 6.5V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" />
  </svg>
);

export const IconeRecherche: ReactNode = (
  <svg {...trait}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </svg>
);

export const IconeMentions: ReactNode = (
  <svg {...trait}>
    <circle cx="12" cy="12" r="3.5" />
    <path d="M15.5 8.5v4.75a2.75 2.75 0 0 0 4.5 2.13A9 9 0 1 0 16 20" />
  </svg>
);

/** Appels (M-D) — Astryx n'a ni téléphone ni caméra, et sa liste de noms est fermée. */
export const IconeAppel: ReactNode = (
  <svg {...trait}>
    <path d="M6.5 4h3l1.5 3.5-2 1.5a11 11 0 0 0 6 6l1.5-2 3.5 1.5v3a1.5 1.5 0 0 1-1.7 1.5A16 16 0 0 1 5 5.7 1.5 1.5 0 0 1 6.5 4" />
  </svg>
);

export const IconeVideo: ReactNode = (
  <svg {...trait}>
    <rect x="3" y="6.5" width="12" height="11" rx="2" />
    <path d="m15 11 5-3v8l-5-3z" />
  </svg>
);

/** Création (M-C) — même géométrie que les quatre de la navbar, sans exception. */
export const IconePlus: ReactNode = (
  <svg {...trait}>
    <path d="M12 5.5v13M5.5 12h13" />
  </svg>
);

/** Réglages (M-G) — le registre d'icônes d'Astryx est un type fermé, et n'a pas d'engrenage. */
export const IconeReglages: ReactNode = (
  <svg {...trait}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3.5v2m0 13v2M4.5 12h2m11 0h2M6.7 6.7l1.4 1.4m7.8 7.8 1.4 1.4M17.3 6.7l-1.4 1.4m-7.8 7.8-1.4 1.4" />
  </svg>
);

export const IconeProfil: ReactNode = (
  <svg {...trait}>
    <circle cx="12" cy="8" r="3.75" />
    <path d="M4.75 20a7.25 7.25 0 0 1 14.5 0" />
  </svg>
);
