"use client";

import type { Search, SearchFilters, SearchHit } from "@tacita/search";
import { useEffect, useState } from "react";

import { DEBOUNCE_MS } from "../../lib/recherche";

export interface Resultats {
  hits: SearchHit[] | null;
  chargement: boolean;
}

/**
 * la recherche débouncée, exécutée dans le worker du paquet.
 *
 * Le `clearTimeout` du nettoyage est **tout le mécanisme** : chaque changement annule le
 * minuteur du précédent avant d'en poser un neuf, donc une rafale de changements ne
 * produit qu'un appel, celui du dernier état.
 *
 * *Note de portée (M-F, écart relevé et escaladé — E-11).* Le débounce porte sur les
 * **critères**, pas sur les caractères : `PowerSearch` 0.2.0 ne notifie pas la frappe
 * brute, son texte libre ne devient un token qu'à la validation. La fenêtre reste utile
 * — éditer, ajouter et retirer des tokens produit bien des rafales — mais elle ne rend
 * pas la recherche « au fil de la frappe », que la primitive ne permet pas.
 *
 * Extrait en hook plutôt que laissé dans le composant : c'est la seule façon d'éprouver
 * la coalescence sans passer par une primitive qui ne l'expose pas.
 */
export function useResultats(
  recherche: Search,
  terme: string,
  criteres: SearchFilters,
  actif: boolean,
): Resultats {
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [chargement, setChargement] = useState(false);

  // Une valeur stable pour l'effet : l'objet de critères est reconstruit à chaque rendu,
  // et le lister tel quel relancerait une recherche en boucle.
  const cle = JSON.stringify([terme, criteres]);

  useEffect(() => {
    if (!actif) {
      setHits(null);
      setChargement(false);
      return;
    }

    let annule = false;
    setChargement(true);
    const minuteur = setTimeout(() => {
      void recherche
        .search(terme, criteres)
        .then((resultats) => {
          // Une requête ancienne qui rendrait après une récente écraserait le bon
          // résultat par le mauvais. Le drapeau la fait taire.
          if (annule) return;
          setHits(resultats);
          setChargement(false);
        })
        .catch(() => {
          // Le paquet n'a aucun canal d'erreur (son README le dit) : on retombe sur
          // « aucun résultat » plutôt que de laisser des skeletons tourner sans fin.
          // Rien n'est journalisé — le terme cherché est du contenu (interdit n°8).
          if (!annule) {
            setHits([]);
            setChargement(false);
          }
        });
    }, DEBOUNCE_MS);

    return () => {
      annule = true;
      clearTimeout(minuteur);
    };
    // `cle` porte le terme et les critères ; les lister en plus relancerait l'effet sur
    // des objets neufs à chaque rendu.
  }, [actif, cle, recherche]);

  return { hits, chargement };
}
