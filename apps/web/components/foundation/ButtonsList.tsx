import type { ReactNode } from "react";

import { List, ListItem } from "./primitives";

export interface Bouton {
  cle: string;
  libelle: string;
  /** Icône à gauche, comme le Dropdown menu du wireframe. */
  icone?: ReactNode;
  description?: string;
  onClick: () => void;
  /** DESIGN.md : `danger` est réservé au destructif, jamais à de l'emphase. */
  destructif?: boolean;
}

/**
 * REQ-UIX-05 — Buttons list (composant 7 du wireframe) : une liste d'actions.
 *
 * `ListItem` d'Astryx **est** déjà la ligne cliquable, avec son libellé, sa description,
 * son contenu de tête et sa sémantique clavier. DESIGN.md interdit de recoder une
 * primitive existante : ce composant ne fait que donner un nom au motif et poser la
 * couleur du destructif.
 */
export function ButtonsList({ boutons }: { boutons: Bouton[] }) {
  return (
    <List>
      {boutons.map(({ cle, libelle, icone, description, onClick, destructif }) => (
        <ListItem
          key={cle}
          label={libelle}
          description={description}
          startContent={icone}
          onClick={onClick}
          // Cibles de 44 px (M-A) : une liste d'actions est le premier endroit où on
          // rate une cible tactile, parce que les lignes paraissent hautes sur un écran
          // de bureau.
          style={{ minHeight: 44, color: destructif ? "var(--color-error)" : undefined }}
        />
      ))}
    </List>
  );
}
