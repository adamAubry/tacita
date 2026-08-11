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

export const IconeProfil: ReactNode = (
  <svg {...trait}>
    <circle cx="12" cy="8" r="3.75" />
    <path d="M4.75 20a7.25 7.25 0 0 1 14.5 0" />
  </svg>
);

/**
 * La clé de récupération (M-B) — Astryx n'a pas de clé, et sa liste de noms reste fermée.
 *
 * **La seule icône de l'app rendue en grand** : elle est le sujet de l'écran, pas un
 * ornement de contrôle. D'où la taille portée ici plutôt que par l'appelant.
 *
 * Le trait reste celui des autres, 1,5 : à 56 px il rend 3,5 px à l'écran, soit une ligne
 * plus franche qu'à 44 px sans qu'on ait à sortir de la géométrie commune. C'est
 * l'agrandissement qui donne le poids, pas un trait d'exception.
 */
export const IconeCle: ReactNode = (
  <svg {...trait} width={56} height={56}>
    <circle cx="12" cy="6.75" r="3.75" />
    <path d="M12 10.5V20.5" />
    <path d="M12 14.5h3" />
    <path d="M12 17.5h2.25" />
  </svg>
);

/**
 * Les deux actions de son propre profil (REQ-UIX-24). Astryx n'a ni crayon ni sortie, et
 * sa liste de noms reste un type fermé.
 *
 * Le trait du crayon traverse le corps de bord à bord — c'est la virole, et c'est elle
 * qui empêche la forme de se lire comme une simple flèche. La sortie garde le battant
 * ouvert du côté de la flèche : une porte fermée traversée par une flèche dit l'entrée.
 */
export const IconeEdition: ReactNode = (
  <svg {...trait}>
    <path d="m4.5 19.5 1-4 11-11a1.8 1.8 0 0 1 2.5 0l.5.5a1.8 1.8 0 0 1 0 2.5l-11 11z" />
    <path d="m14.5 6.5 3 3" />
  </svg>
);

export const IconeDeconnexion: ReactNode = (
  <svg {...trait}>
    <path d="M15.5 7.5v-2A1.5 1.5 0 0 0 14 4H6a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 6 20h8a1.5 1.5 0 0 0 1.5-1.5v-2" />
    <path d="M9 12h11" />
    <path d="m17 9 3 3-3 3" />
  </svg>
);

/**
 * Les trois icônes des Info buttons (M-H, REQ-UIX-33). Astryx n'a ni cloche, ni
 * réglages, ni « ajouter quelqu'un », et sa liste de noms reste un type fermé.
 *
 * La cloche est **barrée** : le bouton ouvre le réglage de notification, et l'état
 * « en silence » se lit alors sans ouvrir. Une cloche pleine dirait l'inverse.
 */
export const IconeMuet: ReactNode = (
  <svg {...trait}>
    <path d="M18 15.5V11a6 6 0 0 0-9.2-5.1M6 9.7V15.5l-1.5 2h15" />
    <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    <path d="m4 4 16 16" />
  </svg>
);

export const IconeOptions: ReactNode = (
  <svg {...trait}>
    <circle cx="12" cy="12" r="2.75" />
    <path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6" />
  </svg>
);

export const IconeAjouterMembre: ReactNode = (
  <svg {...trait}>
    <circle cx="10" cy="8" r="3.75" />
    <path d="M3.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M18.5 6.5v6M15.5 9.5h6" />
  </svg>
);
