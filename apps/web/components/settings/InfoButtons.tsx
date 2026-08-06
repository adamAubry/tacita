"use client";

import type { ReactNode } from "react";

import { NavIcon, Text } from "../foundation/primitives";

export interface BoutonInfo {
  cle: string;
  libelle: string;
  icone: ReactNode;
  onClick: () => void;
}

/**
 * REQ-UIX-33 — composant 14 du wireframe : les **Info buttons**.
 *
 * Taille navbar et libellé sous l'icône, quatre boutons équirépartis. Le `NavIcon` est
 * la primitive imposée par DESIGN.md pour ce motif — la même que la barre du bas, ce qui
 * fait qu'une icône a le même poids visuel où qu'elle se trouve.
 *
 * `flex: 1` sur chaque cellule plutôt qu'une grille à quatre colonnes : le composant
 * accepte quatre boutons aujourd'hui, mais l'équirépartition ne doit pas dépendre du
 * compte — un jeu à trois se répartirait de travers sur une grille figée.
 */
export function InfoButtons({ boutons }: { boutons: BoutonInfo[] }) {
  return (
    <div
      role="group"
      aria-label="Actions de la conversation"
      style={{ display: "flex", gap: "var(--spacing-2)", padding: "var(--spacing-3)" }}
    >
      {boutons.map(({ cle, libelle, icone, onClick }) => (
        <button
          key={cle}
          type="button"
          onClick={onClick}
          aria-label={libelle}
          style={{
            flex: 1,
            display: "grid",
            justifyItems: "center",
            gap: "var(--spacing-1)",
            // Cibles de 44 px (M-A) : le libellé compte dans la hauteur, l'icône seule
            // ne suffirait pas.
            minHeight: 44,
            padding: "var(--spacing-2)",
            background: "var(--color-background-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-container)",
            color: "var(--color-icon-primary)",
            cursor: "pointer",
          }}
        >
          <NavIcon icon={icone} />
          {/* DESIGN.md : les libellés d'Info buttons sont du `caption` — c'est ce que
              rend `supporting` sous notre thème (M-A). */}
          <Text type="supporting" maxLines={1}>
            {libelle}
          </Text>
        </button>
      ))}
    </div>
  );
}
