"use client";

import type { ReactNode } from "react";

import { Dialog, DialogHeader } from "./primitives";

export interface SheetProps {
  ouvert: boolean;
  onFermer: () => void;
  /**
   * Le titre de la feuille. Il **nomme** la modale pour l'assistance technique — sans
   * lui, Astryx avertit qu'une boîte de dialogue s'ouvre sans nom accessible, et un
   * lecteur d'écran annonce « dialogue » sans dire lequel.
   *
   * Facultatif : les feuilles d'action déjà titrées par leur contenu (M-C, M-D) n'en
   * ont pas besoin, et l'ajouter changerait leur mise en page. Dans ce cas, `nom` est
   * **obligatoire** — sans l'un ni l'autre, la modale s'ouvre sans nom accessible.
   */
  titre?: string;
  /**
   * Le nom accessible, quand il ne peut pas être visible. Une feuille d'action tire son
   * sens de ses boutons, et lui coller un en-tête changerait sa mise en page pour rien —
   * mais un lecteur d'écran, lui, annonce alors « boîte de dialogue » et s'arrête là.
   *
   * Ignoré quand `titre` est fourni : le titre visible fait déjà le nom (WCAG 4.1.2), et
   * deux noms concurrents en donnent un de trop.
   */
  nom?: string;
  /** Une phrase sous le titre, quand la modale a besoin d'un cadre avant son contenu. */
  sousTitre?: string;
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
export function Sheet({
  ouvert,
  onFermer,
  titre,
  nom,
  sousTitre,
  ancrage = "bas",
  sortie = "info",
  children,
}: SheetProps) {
  return (
    <Dialog
      isOpen={ouvert}
      onOpenChange={(o) => {
        if (!o) onFermer();
      }}
      purpose={sortie}
      position={ancrage === "bas" ? { bottom: 0, left: 0, right: 0 } : undefined}
      // WCAG 4.1.2 — sans nom, un lecteur d'écran annonce « boîte de dialogue » et
      // s'arrête là. Le titre visible le fournit déjà : on ne pose `aria-label` que
      // pour les feuilles d'action, qui n'ont pas d'en-tête et n'en veulent pas.
      aria-label={titre ? undefined : nom}
    >
      {titre && <DialogHeader title={titre} subtitle={sousTitre} onOpenChange={onFermer} />}
      {children}
    </Dialog>
  );
}
