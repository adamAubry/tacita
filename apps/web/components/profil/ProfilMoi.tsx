"use client";

import type { Profile } from "@tacita/messaging";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { IconeReglages } from "../foundation/icons";
import { Button, Text, TextInput } from "../foundation/primitives";
import { Sheet } from "../foundation/Sheet";
import { ProfileCard } from "./ProfileCard";

/**
 * REQ-MED-11 / REQ-UI-20 — la phrase d'honnêteté du choix de photo (E-12, voie A).
 *
 * Exportée parce que le test la lit : c'est la condition qui rend le chemin public
 * acceptable, pas une décoration. Même registre que les « limites connues » — on dit ce
 * qui est exposé, sobrement, sans rouge ni icône d'alerte.
 */
export const AVERTISSEMENT_PHOTO =
  "Votre photo de profil est visible de tous et n'est pas chiffrée.";

export interface ProfilMoiProps {
  profil: Profile;
  /** REQ-UIX-24 — n'écrit que ce qui a changé (REQ-MSG-18). */
  onEnregistrer: (changements: { displayName?: string; avatarUrl?: string }) => Promise<void>;
  /**
   * REQ-UI-20 — téléverse la photo par l'unique chemin public du pipeline et rend son
   * `mxc://`. Injecté plutôt qu'appelé ici : le shard ne connaît pas la `Session`, et
   * c'est le câblage (M-G) qui tient le site d'appel unique de REQ-MED-11.
   */
  onPhoto: (fichier: File) => Promise<string>;
}

/**
 * REQ-UIX-24 — son propre profil : nom et identifiant juxtaposés, et le « Form edit »
 * (composant 22) — un bouton accentué centré qui ouvre le formulaire.
 *
 * Le formulaire est une feuille et non une page : modifier son nom est une action de
 * quelques secondes, et lui donner une route ajouterait une entrée d'historique dont le
 * retour renverrait au profil qu'on n'a jamais quitté.
 */
export function ProfilMoi({ profil, onEnregistrer, onPhoto }: ProfilMoiProps) {
  const router = useRouter();
  const [edition, setEdition] = useState(false);
  const [nom, setNom] = useState(profil.displayName);
  const [enCours, setEnCours] = useState(false);
  const champPhoto = useRef<HTMLInputElement>(null);
  // Le `mxc://` de la photo choisie pendant cette édition, pas encore enregistrée.
  const [photo, setPhoto] = useState<string>();
  const [echecPhoto, setEchecPhoto] = useState(false);

  const enregistrer = async () => {
    setEnCours(true);
    try {
      // Rien à écrire si rien n'a changé : une écriture inutile fait un événement de
      // profil de plus dans tous les salons partagés. La photo suit la même règle —
      // elle n'est dans le patch que si on vient d'en choisir une.
      const changements = {
        ...(nom !== profil.displayName ? { displayName: nom } : {}),
        ...(photo ? { avatarUrl: photo } : {}),
      };
      if (Object.keys(changements).length > 0) await onEnregistrer(changements);
      setEdition(false);
      setPhoto(undefined);
    } finally {
      setEnCours(false);
    }
  };

  const choisirPhoto = async (fichier: File) => {
    setEnCours(true);
    setEchecPhoto(false);
    try {
      setPhoto(await onPhoto(fichier));
    } catch {
      // Rien n'est journalisé : le nom du fichier vient de l'appareil. On le dit à
      // l'écran, où c'est utile, plutôt que dans une console où ça ne l'est pas.
      setEchecPhoto(true);
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

          {/* REQ-UI-20 — le champ photo, livré depuis E-12. Il est **là**, et non grisé :
              une option grisée est une promesse non tenue affichée (interdit n°13). */}
          <div style={{ display: "grid", gap: "var(--spacing-2)" }}>
            <input
              ref={champPhoto}
              type="file"
              accept="image/*"
              aria-label="Choisir une photo de profil"
              hidden
              onChange={(evenement) => {
                const fichier = evenement.target.files?.[0];
                evenement.target.value = "";
                if (fichier) void choisirPhoto(fichier);
              }}
            />
            <Button
              label={photo ? "Photo choisie — en changer" : "Choisir une photo"}
              variant="secondary"
              onClick={() => champPhoto.current?.click()}
            />
            {/* L'honnêteté au moment du choix, pas dans un écran qu'on ne lira pas. */}
            <Text type="supporting" color="secondary">
              {AVERTISSEMENT_PHOTO}
            </Text>
            {echecPhoto && (
              <Text type="supporting" color="secondary">
                La photo n&apos;a pas pu être envoyée. Réessayez, ou enregistrez sans elle.
              </Text>
            )}
          </div>

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
