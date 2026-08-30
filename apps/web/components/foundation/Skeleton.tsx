"use client";

import type { ComponentProps } from "react";

import { SkeletonAstryx } from "./primitives";

/**
 * **Le `Skeleton` d'Astryx, avec une classe à nous** (30/08/2026, plainte utilisateur).
 *
 * Rien n'est recodé — DESIGN.md l'interdit, et il n'y a rien à recoder : la primitive est
 * juste. Ce qui ne l'est pas, c'est sa courbe d'animation, `steps(10, end)`, qui remplace
 * le fondu par dix paliers secs et fait clignoter une liste entière de skeletons. La
 * courbe se corrige dans `tokens.css`, qui est hors couche et l'emporte donc sur
 * `astryx-base` ; encore faut-il un sélecteur, et c'est tout ce que ce fichier ajoute.
 *
 * `className` est concaténé plutôt qu'écrasé : un appelant qui passe la sienne la garde.
 */
export function Skeleton({
  className,
  ...props
}: ComponentProps<typeof SkeletonAstryx>) {
  return (
    <SkeletonAstryx
      {...props}
      className={className ? `tacita-skeleton ${className}` : "tacita-skeleton"}
    />
  );
}
