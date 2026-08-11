"use client";

import type { ReactNode } from "react";

import { IconePlus, IconeRecherche } from "../foundation/icons";
import {
  DropdownMenu,
  NavIcon,
  SegmentedControl,
  SegmentedControlItem,
} from "../foundation/primitives";
import type { Tri } from "./ConversationsList";

export interface HomeHeaderProps {
  tri: Tri;
  onTri: (tri: Tri) => void;
  /** Bascule vers le layout add-friends (M-G) : l'accueil ne fait que router. */
  onAjouterDesAmis: () => void;
  /** Variation search du Default layout (M-F). */
  onRechercher: () => void;
  onCreer: () => void;
}

/** Cible tactile de 44 px, comme la navbar — c'est là qu'on la rate en premier. */
function BoutonIcone({
  libelle,
  icone,
  onClick,
}: {
  libelle: string;
  icone: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={libelle}
      onClick={onClick}
      style={{
        display: "grid",
        placeItems: "center",
        minWidth: 44,
        minHeight: 44,
        background: "none",
        border: "none",
        color: "var(--color-icon-primary)",
      }}
    >
      <NavIcon icon={icone} />
    </button>
  );
}

/**
 * REQ-UIX-07 — l'en-tête de l'accueil : le sélecteur (composant 1) et la rangée de
 * boutons (composant 7).
 *
 * Le sélecteur ne « filtre » pas la liste : « Ajouter des amis » **change de layout**
 * (M-G). C'est le wireframe qui le veut ainsi, et l'accueil ne fait que router — aucun
 * écran social ne vit ici.
 *
 * Le tri est un `DropdownMenu` et non un NavIcon : c'est le seul contrôle de la rangée
 * qui porte un état à lire (« récentes » ou « anciennes »), et une icône ne le dit pas.
 */
export function HomeHeader({
  tri,
  onTri,
  onAjouterDesAmis,
  onRechercher,
  onCreer,
}: HomeHeaderProps) {
  return (
    <header
      style={{
        display: "grid",
        gap: "var(--spacing-2)",
        padding: "var(--spacing-3)",
        paddingTop: "calc(var(--spacing-3) + env(safe-area-inset-top, 0px))",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      <SegmentedControl
        label="Conversations ou ajout d'amis"
        // DESIGN.md — un sélecteur occupe toute la largeur de son conteneur et ses
        // options se la partagent également. `hug`, le défaut d'Astryx, laissait les
        // deux boutons collés à gauche dans un cadre trop grand pour eux.
        layout="fill"
        value="conversations"
        onChange={(valeur) => {
          if (valeur === "amis") onAjouterDesAmis();
        }}
      >
        <SegmentedControlItem value="conversations" label="Conversations" />
        <SegmentedControlItem value="amis" label="Ajouter des amis" />
      </SegmentedControl>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-2)" }}>
        <DropdownMenu
          button={{ label: tri === "recentes" ? "Récentes" : "Anciennes", variant: "ghost" }}
          items={[
            { label: "Récentes", onClick: () => onTri("recentes") },
            { label: "Anciennes", onClick: () => onTri("anciennes") },
          ]}
        />
        <div style={{ flex: 1 }} />
        <BoutonIcone libelle="Rechercher" icone={IconeRecherche} onClick={onRechercher} />
        <BoutonIcone libelle="Nouvelle conversation ou groupe" icone={IconePlus} onClick={onCreer} />
      </div>
    </header>
  );
}
