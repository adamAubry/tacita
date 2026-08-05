"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { IconeAccueil, IconeMentions, IconeProfil, IconeRecherche } from "./icons";
import { NavIcon } from "./primitives";

/** REQ-UIX-01 — quatre onglets, icônes seules, dans l'ordre du wireframe. */
export const ONGLETS = [
  { href: "/", libelle: "Accueil", icone: IconeAccueil },
  { href: "/recherche", libelle: "Recherche", icone: IconeRecherche },
  { href: "/mentions", libelle: "Mentions", icone: IconeMentions },
  { href: "/profil", libelle: "Profil", icone: IconeProfil },
] as const;

/**
 * REQ-UIX-01 — navbar fixée en bas, navigation **sans rechargement** (`next/link`).
 *
 * DESIGN.md : le bouton actif est « surélevé » par une translation de −1 px et l'accent
 * sur l'icône — pas d'ombre, pas de halo. C'est le seul feedback, et il est volontairement
 * discret : la navbar est un instrument, pas une décoration.
 *
 * Cibles de 44 px minimum (M-A) et `env(safe-area-inset-bottom)` : sans ça, en PWA
 * installée sur iOS, le dernier onglet passe sous la barre de gestes du système.
 */
export function Navbar() {
  const chemin = usePathname();

  return (
    <nav
      aria-label="Navigation principale"
      style={{
        position: "fixed",
        insetInline: 0,
        bottom: 0,
        display: "flex",
        justifyContent: "space-around",
        alignItems: "center",
        gap: "var(--spacing-2)",
        minHeight: 56,
        paddingBlock: "var(--spacing-2)",
        paddingBottom: "calc(var(--spacing-2) + env(safe-area-inset-bottom, 0px))",
        background: "var(--color-background-surface)",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      {ONGLETS.map(({ href, libelle, icone }) => {
        // `/` ne doit être actif que sur lui-même, sinon les quatre onglets s'allument
        // sur la racine.
        const actif = href === "/" ? chemin === "/" : chemin.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-label={libelle}
            aria-current={actif ? "page" : undefined}
            style={{
              display: "grid",
              placeItems: "center",
              minWidth: 44,
              minHeight: 44,
              color: actif ? "var(--color-icon-accent)" : "var(--color-icon-secondary)",
              transform: actif ? "translateY(-1px)" : undefined,
            }}
          >
            <NavIcon icon={icone} />
          </Link>
        );
      })}
    </nav>
  );
}
