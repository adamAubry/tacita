"use client";

import { useEffect, useState } from "react";

import { Banner } from "./primitives";

export type EtatConnexion = "en-ligne" | "hors-ligne" | "synchronisation";

/**
 * bandeau d'état de connexion.
 *
 * En ligne, il n'existe pas : un bandeau permanent qui dit « tout va bien » est du bruit,
 * et on cesse de le lire au moment où il aurait quelque chose à dire.
 *
 * Le texte hors ligne est **une promesse tenue**, pas une excuse : l'historique reste
 * lisible et les messages écrits partent à la reconnexion (file d'envoi). Dire
 * seulement « hors ligne » laisserait croire que l'app est inutilisable.
 *
 * L'état vient de la Session ; ce composant ne le dérive pas — le shard ne
 * contient aucune logique métier.
 */
export function ConnectionBanner({ etat }: { etat: EtatConnexion }) {
  if (etat === "en-ligne") return null;

  /*
   * `container="section"` : ce bandeau est posé en tête d'application, jamais dans une
   * colonne. En variante `card` — le défaut d'Astryx — il rendait une carte à coins
   * arrondis plaquée contre les deux bords de la fenêtre, sans marge pour l'expliquer.
   * La variante pleine largeur est faite pour ça.
   */
  return etat === "hors-ligne" ? (
    <Banner
      container="section"
      status="warning"
      title="Hors ligne"
      description="Vos conversations restent consultables. Ce que vous écrivez partira à la reconnexion."
    />
  ) : (
    <Banner
      container="section"
      status="info"
      title="Synchronisation…"
      description="Récupération des messages reçus."
    />
  );
}

/**
 * Le bandeau **branché**. Mesuré au navigateur : `ConnectionBanner` était
 * écrit, testé unitairement, et rendu par personne — couper le réseau n'affichait rien.
 * Un composant qu'aucun écran ne monte ne tient aucune promesse.
 *
 * La source est `navigator.onLine` et ses deux événements : c'est un fait du navigateur,
 * pas de la logique métier, et il n'y a rien à réécrire pour l'obtenir.
 *
 * ponytail: `onLine` sait dire « aucun réseau », pas « serveur injoignable » — l'état
 * « synchronisation » reste donc sans source. Le brancher sur l'état de /sync quand la
 * Session l'exposera.
 */
export function ConnectionBannerLive() {
  const [horsLigne, setHorsLigne] = useState(false);

  useEffect(() => {
    const relire = () => setHorsLigne(navigator.onLine === false);
    relire();
    addEventListener("online", relire);
    addEventListener("offline", relire);
    return () => {
      removeEventListener("online", relire);
      removeEventListener("offline", relire);
    };
  }, []);

  return <ConnectionBanner etat={horsLigne ? "hors-ligne" : "en-ligne"} />;
}
