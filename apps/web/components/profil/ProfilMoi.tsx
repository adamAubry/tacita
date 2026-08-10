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
  "Votre photo de profil et votre bannière sont visibles de tous et ne sont pas chiffrées.";

/** Les deux images du profil, mêmes règles et même chemin d'envoi. */
const IMAGES = [
  { cle: "avatar", libelle: "photo de profil", choisie: "Photo de profil choisie" },
  { cle: "banniere", libelle: "bannière", choisie: "Bannière choisie" },
] as const;

type CleImage = (typeof IMAGES)[number]["cle"];

export interface ProfilMoiProps {
  profil: Profile;
  /** REQ-UIX-24 — n'écrit que ce qui a changé (REQ-MSG-18). */
  onEnregistrer: (changements: {
    displayName?: string;
    avatarUrl?: string;
    bannerUrl?: string;
  }) => Promise<void>;
  /**
   * REQ-UI-20 — téléverse une image de profil par l'unique chemin public du pipeline et
   * rend son `mxc://`. Injecté plutôt qu'appelé ici : le shard ne connaît pas la
   * `Session`, et c'est le câblage (M-G) qui tient le site d'appel unique de REQ-MED-11.
   *
   * **Le même callback pour la photo et pour la bannière** : ce sont deux images
   * publiques compressées de la même façon, et leur donner deux chemins ferait deux
   * sites d'appel du chemin public là où le contrat de REQ-MED-11 en autorise un.
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
  const champs = {
    avatar: useRef<HTMLInputElement>(null),
    banniere: useRef<HTMLInputElement>(null),
  };
  // Les `mxc://` choisis pendant cette édition, pas encore enregistrés.
  const [choisies, setChoisies] = useState<Partial<Record<CleImage, string>>>({});
  const [echec, setEchec] = useState<CleImage>();

  const enregistrer = async () => {
    setEnCours(true);
    try {
      // Rien à écrire si rien n'a changé : une écriture inutile fait un événement de
      // profil de plus dans tous les salons partagés. Les images suivent la même règle —
      // elles ne sont dans le patch que si on vient d'en choisir une.
      const changements = {
        ...(nom !== profil.displayName ? { displayName: nom } : {}),
        ...(choisies.avatar ? { avatarUrl: choisies.avatar } : {}),
        ...(choisies.banniere ? { bannerUrl: choisies.banniere } : {}),
      };
      if (Object.keys(changements).length > 0) await onEnregistrer(changements);
      setEdition(false);
      setChoisies({});
    } finally {
      setEnCours(false);
    }
  };

  const choisirImage = async (cle: CleImage, fichier: File) => {
    setEnCours(true);
    setEchec(undefined);
    try {
      const mxc = await onPhoto(fichier);
      setChoisies((precedentes) => ({ ...precedentes, [cle]: mxc }));
    } catch {
      // Rien n'est journalisé : le nom du fichier vient de l'appareil. On le dit à
      // l'écran, où c'est utile, plutôt que dans une console où ça ne l'est pas.
      setEchec(cle);
    } finally {
      setEnCours(false);
    }
  };

  return (
    <>
      <ProfileCard
        nom={profil.displayName}
        userId={profil.userId}
        avatarUrl={profil.avatarUrl}
        bannerUrl={profil.bannerUrl}
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

      <Sheet
        ouvert={edition}
        onFermer={() => setEdition(false)}
        sortie="form"
        nom="Modifier le profil"
      >
        <div style={{ display: "grid", gap: "var(--spacing-3)", padding: "var(--spacing-4)" }}>
          <TextInput label="Nom d'affichage" value={nom} onChange={setNom} />

          {/* REQ-UI-20 / REQ-UIX-41 — les deux images, livrées depuis E-12. Elles sont
              **là**, et non grisées : une option grisée est une promesse non tenue
              affichée (interdit n°13). */}
          <div style={{ display: "grid", gap: "var(--spacing-2)" }}>
            {IMAGES.map(({ cle, libelle, choisie }) => (
              <div key={cle} style={{ display: "grid", gap: "var(--spacing-2)" }}>
                <input
                  ref={champs[cle]}
                  type="file"
                  accept="image/*"
                  aria-label={`Choisir une ${libelle}`}
                  hidden
                  onChange={(evenement) => {
                    const fichier = evenement.target.files?.[0];
                    evenement.target.value = "";
                    if (fichier) void choisirImage(cle, fichier);
                  }}
                />
                <Button
                  label={choisies[cle] ? `${choisie} — en changer` : `Choisir une ${libelle}`}
                  variant="secondary"
                  onClick={() => champs[cle].current?.click()}
                />
                {echec === cle && (
                  <Text type="supporting" color="secondary">
                    La {libelle} n&apos;a pas pu être envoyée. Réessayez, ou enregistrez sans
                    elle.
                  </Text>
                )}
              </div>
            ))}
            {/* L'honnêteté au moment du choix, pas dans un écran qu'on ne lira pas. Une
                phrase pour les deux : c'est la même limite, et la répéter la banaliserait. */}
            <Text type="supporting" color="secondary">
              {AVERTISSEMENT_PHOTO}
            </Text>
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
