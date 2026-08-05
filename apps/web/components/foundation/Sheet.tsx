"use client";

import type { ReactNode } from "react";

import { Dialog } from "./primitives";

export interface SheetProps {
  ouvert: boolean;
  onFermer: () => void;
  /**
   * `bas` = bottom-sheet (le geste attendu sur mobile), `centre` = modal.
   * DESIGN.md : r12 pour les sheets, r10 pour les modals — porté par le thème.
   */
  ancrage?: "bas" | "centre";
  /**
   * `info` laisse toutes les sorties, `form` bloque le clic sur le fond, `required`
   * n'en laisse aucune. **`required` est réservé aux flux qu'on ne peut pas abandonner
   * sans casse** — la clé de récupération (REQ-UI-04). Ailleurs, DESIGN.md interdit la
   * modale d'interruption hors action destructive.
   */
  sortie?: "info" | "form" | "required";
  children: ReactNode;
}

/** REQ-UIX-05 — la modale et le bottom-sheet de l'app, un seul composant. */
export function Sheet({ ouvert, onFermer, ancrage = "bas", sortie = "info", children }: SheetProps) {
  return (
    <Dialog
      isOpen={ouvert}
      onOpenChange={(o) => {
        if (!o) onFermer();
      }}
      purpose={sortie}
      position={ancrage === "bas" ? { bottom: 0, left: 0, right: 0 } : undefined}
    >
      {children}
    </Dialog>
  );
}
