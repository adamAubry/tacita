"use client";

import { useEffect, useRef, useState } from "react";

import { ecrireNote, LIBELLE_NOTE, lireNote } from "../../lib/notes";
import { Text, TextArea } from "../foundation/primitives";

/** Le délai avant enregistrement. Assez court pour être sûr, assez long pour ne pas écrire par frappe. */
export const DELAI_ENREGISTREMENT_MS = 500;

interface NoteProps {
  userId: string;
  indexedDB: IDBFactory;
}

/**
 * REQ-UIX-27 — composant 23, la note privée.
 *
 * **Le libellé est celui de l'exigence, mot pour mot** (`LIBELLE_NOTE`) : « visible
 * uniquement par vous, sur cet appareil ». La seconde moitié n'est pas une précision de
 * confort — sans elle, l'utilisateur suppose une synchronisation qui n'existe pas et
 * perdra sa note en changeant de téléphone. C'est l'interdit n°13 appliqué à six mots.
 *
 * Enregistrement automatique et débouncé : une note qu'il faut penser à valider est une
 * note perdue. Aucun bouton « enregistrer », donc aucun état « non enregistré » à gérer.
 */
export function Note({ userId, indexedDB }: NoteProps) {
  const [note, setNote] = useState("");
  const [charge, setCharge] = useState(false);
  // La note en cours d'écriture, hors du rendu : un `setTimeout` capture la valeur du
  // rendu où il a été posé, et enregistrerait une frappe en retard.
  const derniere = useRef("");
  /**
   * L'utilisateur a-t-il déjà tapé ? La lecture IndexedDB est asynchrone : sans ce
   * drapeau, quelqu'un qui commence à écrire avant qu'elle rende voit sa saisie
   * **écrasée** par la valeur chargée. C'est rare et c'est exactement le genre de perte
   * silencieuse qu'on ne remarque qu'en production.
   */
  const touche = useRef(false);

  useEffect(() => {
    let annule = false;
    setCharge(false);
    touche.current = false;
    void lireNote(indexedDB, userId)
      .then((valeur) => {
        if (annule) return;
        // Une saisie commencée pendant la lecture gagne : elle est plus récente que ce
        // que la base rend, et l'écraser perdrait ce que l'utilisateur vient de taper.
        if (!touche.current) {
          setNote(valeur);
          derniere.current = valeur;
        }
        setCharge(true);
      })
      .catch(() => {
        // Une lecture qui échoue laisse un champ vide et éditable, pas un écran cassé.
        if (!annule) setCharge(true);
      });
    return () => {
      annule = true;
    };
  }, [indexedDB, userId]);

  useEffect(() => {
    // Ne pas écrire avant d'avoir lu : le premier rendu vaut `""`, et l'enregistrer
    // effacerait la note existante avant même qu'elle s'affiche.
    if (!charge || note === derniere.current) return;

    const minuteur = setTimeout(() => {
      derniere.current = note;
      void ecrireNote(indexedDB, userId, note).catch(() => {});
    }, DELAI_ENREGISTREMENT_MS);
    return () => clearTimeout(minuteur);
  }, [note, charge, indexedDB, userId]);

  return (
    <section
      aria-labelledby="note-libelle"
      style={{ display: "grid", gap: "var(--spacing-2)", padding: "var(--spacing-3)" }}
    >
      <Text id="note-libelle" type="supporting" weight="bold" color="secondary">
        {LIBELLE_NOTE}
      </Text>
      <TextArea
        label={LIBELLE_NOTE}
        isLabelHidden
        value={note}
        onChange={(valeur) => {
          touche.current = true;
          setNote(valeur);
        }}
        placeholder="Où vous vous êtes rencontrés, ce dont vous deviez reparler…"
        rows={3}
      />
    </section>
  );
}
