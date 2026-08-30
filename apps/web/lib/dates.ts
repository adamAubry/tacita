/**
 * Format de date des aperçus : heure:minute si c'est aujourd'hui, date
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

/** L'heure d'un message. Chiffres tabulaires côté rendu. */
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

/**
 * Une durée d'appel, telle qu'un journal la lit. Jamais de secondes au-delà d'une minute :
 * « 4 min 07 » n'apprend rien de plus que « 4 min » et se lit deux fois moins vite.
 *
 * Aux chiffres tabulaires du rendu (DESIGN.md) revient de garder la ligne stable quand la
 * durée change ; ce formateur ne fait que le texte.
 */
export function dureeAppel(millisecondes: number): string {
  const secondes = Math.max(0, Math.round(millisecondes / 1000));
  if (secondes < 60) return `${secondes} s`;
  const minutes = Math.round(secondes / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * **Une date absolue, écrite pareil partout** (30/08/2026, revue de conception E-02).
 *
 * Elle vivait en deux exemplaires : `Appareils` composait « Vu le 30 août 09:12 » avec une
 * locale et des options explicites, `LienInvitation` appelait `toLocaleString()` nu — donc
 * « 31/08/2026 14:02:33 », avec les secondes et un format qui change de navigateur en
 * navigateur. C'était la seule date que le système ne contrôlait pas, dans une application
 * dont DESIGN.md impose les chiffres tabulaires « pour toute heure et tout compteur ».
 *
 * Ici et pas dans les deux composants : un format écrit à deux endroits diverge au premier
 * ajustement, et c'est alors celui qu'on ne relit pas qui ment.
 */
export const dateComplete = (horodatage: number): string =>
  new Date(horodatage).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
