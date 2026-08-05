"use client";

import { Banner } from "./primitives";

export type EtatConnexion = "en-ligne" | "hors-ligne" | "synchronisation";

/**
 * REQ-UIX-04 / REQ-UI-17 — bandeau d'état de connexion.
 *
 * En ligne, il n'existe pas : un bandeau permanent qui dit « tout va bien » est du bruit,
 * et on cesse de le lire au moment où il aurait quelque chose à dire.
 *
 * Le texte hors ligne est **une promesse tenue**, pas une excuse : l'historique reste
 * lisible et les messages écrits partent à la reconnexion (file d'envoi, spec 07). Dire
 * seulement « hors ligne » laisserait croire que l'app est inutilisable.
 *
 * L'état vient de la Session (spec 04) ; ce composant ne le dérive pas — le shard ne
 * contient aucune logique métier (SPEC 11).
 */
export function ConnectionBanner({ etat }: { etat: EtatConnexion }) {
  if (etat === "en-ligne") return null;

  return etat === "hors-ligne" ? (
    <Banner
      status="warning"
      title="Hors ligne"
      description="Vos conversations restent consultables. Ce que vous écrivez partira à la reconnexion."
    />
  ) : (
    <Banner status="info" title="Synchronisation…" description="Récupération des messages reçus." />
  );
}
