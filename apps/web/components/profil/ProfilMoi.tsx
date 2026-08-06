"use client";

import type { Profile } from "@tacita/messaging";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { IconeReglages } from "../foundation/icons";
import { Button, TextInput } from "../foundation/primitives";
import { Sheet } from "../foundation/Sheet";
import { ProfileCard } from "./ProfileCard";

export interface ProfilMoiProps {
  profil: Profile;
  /** REQ-UIX-24 — n'écrit que ce qui a changé (REQ-MSG-18). */
  onEnregistrer: (changements: { displayName?: string }) => Promise<void>;
}

/**
 * REQ-UIX-24 — son propre profil : nom et identifiant juxtaposés, et le « Form edit »
 * (composant 22) — un bouton accentué centré qui ouvre le formulaire.
 *
 * Le formulaire est une feuille et non une page : modifier son nom est une action de
 * quelques secondes, et lui donner une route ajouterait une entrée d'historique dont le
 * retour renverrait au profil qu'on n'a jamais quitté.
 */
export function ProfilMoi({ profil, onEnregistrer }: ProfilMoiProps) {
  const router = useRouter();
  const [edition, setEdition] = useState(false);
  const [nom, setNom] = useState(profil.displayName);
  const [enCours, setEnCours] = useState(false);

  const enregistrer = async () => {
    setEnCours(true);
    try {
      // Rien à écrire si rien n'a changé : une écriture inutile fait un événement de
      // profil de plus dans tous les salons partagés.
      if (nom !== profil.displayName) await onEnregistrer({ displayName: nom });
      setEdition(false);
    } finally {
      setEnCours(false);
    }
  };

  return (
    <>
      <ProfileCard
        nom={profil.displayName}
        userId={profil.userId}
        actions={
          <Button
            label="Réglages"
            variant="ghost"
            isIconOnly
            icon={IconeReglages}
            onClick={() => router.push("/reglages")}
          />
        }
      />

      {/* Composant 22 : bouton accentué, centré. C'est la seule action de l'écran. */}
      <div style={{ display: "grid", justifyItems: "center", padding: "var(--spacing-4)" }}>
        <Button label="Modifier le profil" variant="primary" onClick={() => setEdition(true)} />
      </div>

      <Sheet ouvert={edition} onFermer={() => setEdition(false)} sortie="form">
        <div style={{ display: "grid", gap: "var(--spacing-3)", padding: "var(--spacing-4)" }}>
          <TextInput label="Nom d'affichage" value={nom} onChange={setNom} />

          <div style={{ display: "flex", gap: "var(--spacing-2)", justifyContent: "flex-end" }}>
            <Button label="Annuler" variant="ghost" onClick={() => setEdition(false)} />
            <Button
              label="Enregistrer"
              variant="primary"
              isLoading={enCours}
              onClick={() => void enregistrer()}
            />
          </div>
        </div>
      </Sheet>
    </>
  );
}
