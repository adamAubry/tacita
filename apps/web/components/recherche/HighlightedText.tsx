import { Fragment } from "react";

import { segmenter } from "../../lib/recherche";

interface HighlightedTextProps {
  texte: string;
  /** Les mots à marquer. Vide = rien n'est marqué, le texte passe tel quel. */
  terme: string;
}

/**
 * composant 18, « Highlighted text ». Fond teinté par le token `highlight`
 * de DESIGN.md, **texte inchangé** : la couleur d'encre ne bouge pas, sinon le contraste
 * dépendrait du thème et de la teinte à la fois.
 *
 * `<mark>` et non un `<span>` stylé : l'élément natif porte déjà le sens « pertinent
 * dans le contexte courant » pour les lecteurs d'écran. Son fond par défaut est jaune
 * dans tous les navigateurs — d'où la remise à zéro explicite avec notre token.
 */
export function HighlightedText({ texte, terme }: HighlightedTextProps) {
  return (
    <>
      {segmenter(texte, terme).map((fragment, rang) =>
        fragment.surligne ? (
          <mark
            key={rang}
            style={{
              background: "var(--tacita-highlight)",
              color: "inherit",
              borderRadius: "var(--radius-xs, 2px)",
            }}
          >
            {fragment.texte}
          </mark>
        ) : (
          <Fragment key={rang}>{fragment.texte}</Fragment>
        ),
      )}
    </>
  );
}
