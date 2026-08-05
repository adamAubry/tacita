/**
 * Format de date des aperçus (REQ-UI-05) : heure:minute si c'est aujourd'hui, date
 * courte sinon.
 *
 * **Localisé, jamais codé en dur** — décision du design owner (ESCALATIONS) : le
 * « 05/17 » du wireframe est un exemple américain, pas un format. `Intl` rend au
 * lecteur l'ordre jour/mois qui est le sien.
 *
 * `maintenant` est un paramètre : sans lui, un test qui vérifie « aujourd'hui vs hier »
 * dépend de l'heure à laquelle il tourne — et casse à minuit, une fois sur mille.
 */
export function dateApercu(horodatage: number, maintenant: number = Date.now()): string {
  const date = new Date(horodatage);
  const memeJour = date.toDateString() === new Date(maintenant).toDateString();

  return new Intl.DateTimeFormat(
    undefined,
    memeJour ? { hour: "2-digit", minute: "2-digit" } : { dateStyle: "short" },
  ).format(date);
}
