"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import {
  IconeAccueil,
  IconeMentions,
  IconeProfil,
  IconeRecherche,
} from "./icons";
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
 * sur l'icône — pas d'ombre, pas de halo. C'est le seul feedback permanent, et il est
 * volontairement discret : la navbar est un instrument, pas une décoration.
 *
 * Cibles de 44 px minimum (M-A) et `env(safe-area-inset-bottom)` : sans ça, en PWA
 * installée sur iOS, le dernier onglet passe sous la barre de gestes du système.
 *
 * ## Le retour au toucher
 *
 * Inspiré du dock flottant d'Aceternity (`.screens/example-navbar.tsx`), mais **pas
 * recopié** : son effet est piloté par `mouseX` et sature à sa taille de repos tant
 * qu'aucune souris ne bouge. Sur une PWA mobile-first (PRODUCT.md), il ne se passerait
 * donc rien — l'original le sait, il gate son dock en `hidden md:flex` et livre un tout
 * autre composant pour le tactile.
 *
 * Ce qu'on lui prend, c'est l'idée juste : le libellé au-dessus du doigt (son tooltip en
 * `-top-8`). Ce qu'on lui laisse, c'est la magnification en place — la pulpe d'un doigt
 * couvre 9 à 11 mm et masque précisément ce qui grossit, et des icônes qui gonflent
 * déplacent les cibles voisines sous le doigt, en contradiction avec les 44 px stables
 * de M-A.
 *
 * D'où la répartition : **la confirmation là où le doigt est** (l'icône s'enfonce, on la
 * devine à ses bords), **l'information là où le doigt n'est pas** (le libellé monte
 * au-dessus de la barre). C'est le geste du clavier iOS, pas celui du dock macOS.
 *
 * `pointerenter`/`pointerleave` et non `mouseenter` : sur tactile, les événements souris
 * synthétisés n'arrivent qu'**après** le relâchement, en rafale — un `onMouseMove` ne
 * reçoit rien pendant le maintien. La spec Pointer Events, elle, crée le pointeur au
 * poser et le détruit au relâchement : le même couple de handlers couvre donc le survol
 * à la souris et le maintien du doigt, sans jamais tester `pointerType`.
 */
export function Navbar() {
  const chemin = usePathname();
  // L'onglet dont on montre le libellé : survolé à la souris, maintenu au doigt, ou
  // atteint au clavier. `null` au repos — la navbar reste en icônes seules.
  const [apercu, setApercu] = useState<string | null>(null);

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
        paddingBottom:
          "calc(var(--spacing-2) + env(safe-area-inset-bottom, 0px))",
        background: "var(--color-background-surface)",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      {ONGLETS.map(({ href, libelle, icone }) => {
        // `/` ne doit être actif que sur lui-même, sinon les quatre onglets s'allument
        // sur la racine.
        const actif = href === "/" ? chemin === "/" : chemin.startsWith(href);
        const montre = apercu === href;
        return (
          <Link
            key={href}
            href={href}
            className="navbar-onglet"
            aria-label={libelle}
            aria-current={actif ? "page" : undefined}
            // Le pointeur naît au poser du doigt et meurt à son relâchement : ces deux
            // handlers sont donc aussi le « appui » du tactile. `pointercancel` (le
            // défilement vole le pointeur) est suivi d'un `pointerleave` par la spec, il
            // n'a pas besoin de son propre handler.
            onPointerEnter={() => setApercu(href)}
            onPointerLeave={() => setApercu(null)}
            // Le clavier n'émet aucun événement de pointeur : sans ces deux-là, la
            // navigation au Tab serait la seule à ne pas savoir où elle est.
            onFocus={() => setApercu(href)}
            onBlur={() => setApercu(null)}
            style={{
              position: "relative",
              display: "grid",
              placeItems: "center",
              minWidth: 44,
              minHeight: 44,
              color: actif
                ? "var(--color-icon-accent)"
                : "var(--color-icon-secondary)",
              transform: actif ? "translateY(-1px)" : undefined,
              transition:
                "transform var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard)",
            }}
          >
            <span
              aria-hidden
              style={{
                position: "absolute",
                // Au-dessus du lien *et* de la barre : le libellé doit dégager la
                // bordure supérieure, sinon il se lit par-dessus son propre fond.
                bottom: "calc(100% + var(--spacing-3))",
                left: "50%",
                paddingBlock: "var(--spacing-1)",
                paddingInline: "var(--spacing-2)",
                borderRadius: "var(--radius-element)",
                background: "var(--color-background-surface)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-primary)",
                fontSize: "var(--font-size-sm)",
                whiteSpace: "nowrap",
                // Il flotte au-dessus de la zone tactile : sans ça, il intercepterait le
                // doigt qui glisse et volerait le `click` de son propre onglet.
                pointerEvents: "none",
                opacity: montre ? 1 : 0,
                transform: montre
                  ? "translate(-50%, 0)"
                  : "translate(-50%, var(--spacing-1))",
                transition:
                  "opacity var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard)",
              }}
            >
              {libelle}
            </span>
            <span
              style={{
                display: "grid",
                placeItems: "center",
                // L'icône s'enfonce au lieu de grossir : ça ne déplace aucune cible
                // voisine, et le mouvement reste visible autour de la pulpe.
                transform: montre ? "scale(0.92)" : undefined,
                transition:
                  "transform var(--duration-fast) var(--ease-standard)",
              }}
            >
              <NavIcon icon={icone} />
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
