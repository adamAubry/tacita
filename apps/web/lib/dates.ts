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
/** Deux horodatages tombent-ils le même jour, dans le fuseau du lecteur ? */
export const memeJour = (a: number, b: number) =>
  new Date(a).toDateString() === new Date(b).toDateString();

/** L'heure d'un message (REQ-UI-06, REQ-UI-09). Chiffres tabulaires côté rendu. */
export const heure = (horodatage: number): string =>
  new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(horodatage);

/**
 * Le libellé du séparateur de date (composant 13) : `05 août`, sans l'année tant qu'elle
 * est celle en cours — la répéter sur chaque séparateur d'une conversation active est du
 * bruit, et son absence se remarque précisément quand elle compte.
 */
export function jourSeparateur(horodatage: number, maintenant: number = Date.now()): string {
  const memeAnnee = new Date(horodatage).getFullYear() === new Date(maintenant).getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "long",
    year: memeAnnee ? undefined : "numeric",
  }).format(horodatage);
}

export function dateApercu(horodatage: number, maintenant: number = Date.now()): string {
  return memeJour(horodatage, maintenant)
    ? heure(horodatage)
    : new Intl.DateTimeFormat(undefined, { dateStyle: "short" }).format(horodatage);
}
