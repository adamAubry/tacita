import { Fragment } from "react";

/** Découpe un texte autour des occurrences d'un terme, sans distinguer la casse. */
export function decouper(texte: string, terme: string): { valeur: string; surligne: boolean }[] {
  const cherche = terme.trim();
  if (cherche === "") return [{ valeur: texte, surligne: false }];

  const morceaux: { valeur: string; surligne: boolean }[] = [];
  const bas = texte.toLowerCase();
  const cible = cherche.toLowerCase();
  let position = 0;

  for (let trouve = bas.indexOf(cible); trouve !== -1; trouve = bas.indexOf(cible, position)) {
    if (trouve > position) morceaux.push({ valeur: texte.slice(position, trouve), surligne: false });
    // La casse d'origine est conservée : on surligne le texte de l'auteur, pas la requête.
    morceaux.push({ valeur: texte.slice(trouve, trouve + cible.length), surligne: true });
    position = trouve + cible.length;
  }

  if (position < texte.length) morceaux.push({ valeur: texte.slice(position), surligne: false });
  return morceaux;
}

/**
 * REQ-UIX-20 — Highlighted text (composant 18).
 *
 * Le fond vient du token `highlight` de DESIGN.md — teinté, **texte inchangé** : c'est ce
 * qui distingue un surlignage d'une coloration, et ce qui garde le contraste quel que soit
 * le thème.
 */
export function HighlightedText({ texte, terme }: { texte: string; terme: string }) {
  return (
    <>
      {decouper(texte, terme).map(({ valeur, surligne }, rang) => (
        <Fragment key={rang}>
          {surligne ? (
            <mark style={{ background: "var(--tacita-highlight)", color: "inherit" }}>{valeur}</mark>
          ) : (
            valeur
          )}
        </Fragment>
      ))}
    </>
  );
}
