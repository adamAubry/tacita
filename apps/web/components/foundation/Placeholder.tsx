import type { ReactNode } from "react";

import { EmptyState } from "./primitives";

export interface PlaceholderProps {
  /** Pourquoi c'est vide, en une phrase. */
  titre: string;
  /** Ce qui remplira l'écran, ou pourquoi il restera vide. */
  explication?: string;
  /** Icône au trait monochrome (DESIGN.md) — jamais d'illustration cartoon. */
  icone?: ReactNode;
  /** L'action suivante, quand il y en a une. Un état vide sans issue n'en propose pas. */
  action?: ReactNode;
}

/**
 * REQ-UIX-03 — **le** composant d'état vide de l'app. Un seul, paramétrable : « aucun
 * état vide brut ailleurs » (M-A) ne tient que s'il n'y a rien d'autre à utiliser.
 *
 * Il explique toujours *pourquoi* c'est vide. Un écran vide sans phrase laisse croire à
 * une panne — et sur un client chiffré, où l'historique dépend de ce qui a été
 * synchronisé, la différence entre « rien ici » et « pas encore chargé » est réelle.
 */
export function Placeholder({ titre, explication, icone, action }: PlaceholderProps) {
  return <EmptyState title={titre} description={explication} icon={icone} actions={action} />;
}
