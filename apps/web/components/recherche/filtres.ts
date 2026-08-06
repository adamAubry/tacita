import type { SearchFilters } from "@tacita/search";

import type { PowerSearchConfig, PowerSearchFilter } from "../foundation/primitives";

/**
 * REQ-UI-16 / REQ-UIX-21 — la configuration des tokens de `PowerSearch`. M-A a posé la
 * barre sans tokens ; ils se décident ici, où l'on sait ce que l'index sait filtrer.
 *
 * **Un champ par critère réellement servi par REQ-SRC-11**, et pas un de plus : un token
 * que le moteur ne saurait pas honorer serait un filtre qui ne filtre rien (interdit n°13).
 */
export const CHAMP_TEXTE = "texte";
export const CHAMP_PERSONNE = "personne";
export const CHAMP_CONVERSATION = "conversation";
export const CHAMP_TYPE = "type";
export const CHAMP_APRES = "apres";
export const CHAMP_AVANT = "avant";
export const CHAMP_MENTIONS = "mentions";

const chaine = { key: "est", label: "est", value: { type: "string" as const, isArbitraryStringAllowed: true } };
const date = { key: "le", label: "le", value: { type: "date_absolute" as const, isDateOnly: true } };

export const CONFIG_RECHERCHE: PowerSearchConfig = {
  name: "Recherche",
  contentSearchFieldKey: CHAMP_TEXTE,
  fields: [
    { key: CHAMP_TEXTE, label: "Texte", operators: [chaine] },
    { key: CHAMP_PERSONNE, label: "Personne", operators: [chaine] },
    { key: CHAMP_CONVERSATION, label: "Conversation", operators: [chaine] },
    { key: CHAMP_TYPE, label: "Type", operators: [chaine] },
    { key: CHAMP_APRES, label: "Après le", operators: [date] },
    { key: CHAMP_AVANT, label: "Avant le", operators: [date] },
    // Le token de l'onglet Mentions : pré-armé et non modifiable, il **est** la requête.
    { key: CHAMP_MENTIONS, label: "Mentionne", operators: [chaine] },
  ],
};

const valeurTexte = (filtre: PowerSearchFilter): string | undefined =>
  filtre.value.type === "string" ? filtre.value.value : undefined;

const valeurDate = (filtre: PowerSearchFilter): number | undefined =>
  filtre.value.type === "date_absolute" ? filtre.value.unixSeconds * 1000 : undefined;

/**
 * Traduit les tokens de la barre en critères du paquet (REQ-SRC-11).
 *
 * Fonction **pure**, et c'est ce qui la rend vérifiable : chaque filtre de l'UI doit
 * arriver au moteur sous le nom qu'il comprend, sans qu'aucun ne se perde en route.
 * Un token vide est ignoré plutôt que traduit en critère vide — un `sender: ""` ne
 * rendrait aucun résultat au lieu de n'être pas un filtre.
 */
export function versCriteres(filtres: readonly PowerSearchFilter[]): {
  terme: string;
  criteres: SearchFilters;
} {
  let terme = "";
  const criteres: SearchFilters = {};

  for (const filtre of filtres) {
    switch (filtre.field) {
      case CHAMP_TEXTE:
        terme = valeurTexte(filtre) ?? terme;
        break;
      case CHAMP_PERSONNE:
        if (valeurTexte(filtre)) criteres.sender = valeurTexte(filtre);
        break;
      case CHAMP_CONVERSATION:
        if (valeurTexte(filtre)) criteres.roomId = valeurTexte(filtre);
        break;
      case CHAMP_TYPE:
        if (valeurTexte(filtre)) criteres.msgtype = valeurTexte(filtre);
        break;
      case CHAMP_MENTIONS:
        if (valeurTexte(filtre)) {
          criteres.mentions = [...(asTableau(criteres.mentions) ?? []), valeurTexte(filtre)!];
        }
        break;
      case CHAMP_APRES:
        criteres.since = valeurDate(filtre) ?? criteres.since;
        break;
      case CHAMP_AVANT:
        criteres.until = valeurDate(filtre) ?? criteres.until;
        break;
      default:
        break;
    }
  }

  return { terme, criteres };
}

const asTableau = (valeur: string | string[] | undefined) =>
  valeur === undefined ? undefined : Array.isArray(valeur) ? valeur : [valeur];

/** Le token de texte courant, pour réarmer la barre sans perdre les autres filtres. */
export const tokenTexte = (terme: string): PowerSearchFilter => ({
  field: CHAMP_TEXTE,
  operator: "est",
  value: { type: "string", value: terme },
});

/**
 * REQ-UIX-33 — la recherche lancée depuis les informations d'une conversation arrive
 * armée sur ce salon. Le token **reste modifiable**, contrairement à celui des mentions :
 * c'est un point de départ, pas la définition de l'écran, et le retirer pour élargir à
 * tout l'historique est un geste légitime.
 */
export const tokenConversation = (roomId: string): PowerSearchFilter => ({
  field: CHAMP_CONVERSATION,
  operator: "est",
  value: { type: "string", value: roomId },
});

/**
 * REQ-UIX-21 — l'onglet Mentions arrive avec sa requête déjà armée : `mentions` contient
 * mon identifiant **et** `@room`, parce qu'une mention de salon en est une pour chacun.
 *
 * Le token est en lecture seule : il n'est pas un filtre qu'on ajoute, c'est ce que
 * l'onglet **est**. Le retirer laisserait une recherche globale sous un titre « Mentions ».
 */
export const tokensMentions = (moi: string, mentionSalon: string): PowerSearchFilter[] =>
  [moi, mentionSalon].map((identifiant) => ({
    field: CHAMP_MENTIONS,
    operator: "est",
    value: { type: "string", value: identifiant },
    isReadOnly: true,
  }));
