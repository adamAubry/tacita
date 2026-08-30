"use client";

import type { Profile } from "@tacita/messaging";
import { useRef, useState } from "react";

import { Button, Text, TextInput } from "../foundation/primitives";

/**
 * la phrase d'honnêteté du choix de photo (voie A).
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

export interface Changements {
  displayName?: string;
  avatarUrl?: string;
  bannerUrl?: string;
}

interface FormulaireIdentiteProps {
  profil: Profile;
  /**
   * reçoit **ce qui a changé, et rien d'autre**. Un patch vide
   * est une issue légitime : « valider sans rien avoir touché » est un geste courant à
   * l'accueil, et c'est à l'appelant de ne pas écrire pour rien.
   */
  onEnregistrer: (changements: Changements) => Promise<void>;
  /**
   * téléverse une image de profil par l'unique chemin public du pipeline et
   * rend son `mxc://`. Injecté plutôt qu'appelé ici : le shard ne connaît pas la
   * `Session`, et c'est le câblage qui tient le site d'appel unique de.
   *
   * **Le même callback pour la photo et pour la bannière** : ce sont deux images
   * publiques compressées de la même façon, et leur donner deux chemins ferait deux
   * sites d'appel du chemin public là où le contrat de en autorise un.
   */
  onPhoto: (fichier: File) => Promise<string>;
  /** Le bouton qui écrit. « Enregistrer » sur le profil, « Continuer » à l'accueil. */
  libelleValider?: string;
  /** L'issue sans écriture. Absente à l'accueil, où c'est le parcours qui la porte. */
  onAnnuler?: () => void;
}

/**
 * **le formulaire d'identité, un seul dans l'app.**
 *
 * Il est rendu à deux endroits : la feuille « Modifier le profil » (M-G) et l'étape
 * d'identité du parcours d'accueil (M-B). Ce sont deux moments, pas deux écrans — nom,
 * photo, bannière, et la phrase qui dit ce qui est public. Les dupliquer aurait donné
 * deux formulaires qui divergent au premier champ ajouté, et une seule des deux copies
 * aurait porté l'avertissement le jour où on l'aurait déplacé.
 *
 * Il ne connaît ni `Session` ni les paquets : un `Profile`, deux callbacks. C'est ce qui
 * lui permet d'être testé avec des interfaces mockées, et ce qui garde le site d'appel du
 * chemin public comptable là où il est câblé.
 */
export function FormulaireIdentite({
  profil,
  onEnregistrer,
  onPhoto,
  libelleValider = "Enregistrer",
  onAnnuler,
}: FormulaireIdentiteProps) {
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
      await onEnregistrer(changements);
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
    <div style={{ display: "grid", gap: "var(--spacing-3)" }}>
      <TextInput label="Nom d'affichage" value={nom} onChange={setNom} />

      {/* les deux images, livrées depuis E-12. Elles sont
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
        {onAnnuler && <Button label="Annuler" variant="ghost" onClick={onAnnuler} />}
        <Button
          label={libelleValider}
          variant="primary"
          isLoading={enCours}
          onClick={() => void enregistrer()}
        />
      </div>
    </div>
  );
}
