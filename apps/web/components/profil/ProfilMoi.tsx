"use client";

import type { Profile } from "@tacita/messaging";
import { useState, type ReactNode } from "react";

import { IconeEdition } from "../foundation/icons";
import { Button } from "../foundation/primitives";
import { Sheet } from "../foundation/Sheet";
import { Reglages } from "../settings/Reglages";
import { FormulaireIdentite, type Changements } from "./FormulaireIdentite";
import { ProfileCard } from "./ProfileCard";

/**
 * L'avertissement du choix de photo vit avec le formulaire qui le porte — il est rendu à
 * deux endroits depuis que le parcours d'accueil propose la même chose (M-B). Réexporté
 * ici parce que les tests de M-G le lisent à cette adresse.
 */
export { AVERTISSEMENT_PHOTO } from "./FormulaireIdentite";

interface ProfilMoiProps {
  profil: Profile;
  /** REQ-UIX-24 — n'écrit que ce qui a changé (REQ-MSG-18). */
  onEnregistrer: (changements: Changements) => Promise<void>;
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
  /**
   * REQ-UIX-06 — la déconnexion, posée à droite de « Modifier le profil ».
   *
   * Un `ReactNode` et non un callback : `LogoutButton` porte sa propre confirmation, et
   * celle-ci a besoin de la `Session` — que ce composant ne connaît pas, et ne doit pas
   * connaître (cf. l'en-tête d'`EcranProfil`). Même geste que l'`actions` de `ProfileCard`.
   */
  deconnexion?: ReactNode;
}

/**
 * REQ-UIX-24 — son propre profil : nom et identifiant juxtaposés, et le « Form edit »
 * (composant 22) — un bouton accentué centré qui ouvre le formulaire.
 *
 * Le formulaire est une feuille et non une page : modifier son nom est une action de
 * quelques secondes, et lui donner une route ajouterait une entrée d'historique dont le
 * retour renverrait au profil qu'on n'a jamais quitté.
 *
 * REQ-UIX-31 — **c'est aussi le seul endroit d'où l'on règle l'application** : `/reglages`
 * n'existe plus, et les réglages sont une section de cet écran. Le même raisonnement que
 * ci-dessus, un cran plus loin — l'ancienne route commençait par une carte de profil dont
 * le chevron ramenait ici, et un écran dont le premier élément mène ailleurs est un
 * couloir. L'engrenage du bandeau flottant part avec elle : il n'a plus de destination, et
 * un bouton qui ne mène nulle part est pire qu'un bouton absent.
 */
export function ProfilMoi({ profil, onEnregistrer, onPhoto, deconnexion }: ProfilMoiProps) {
  const [edition, setEdition] = useState(false);

  return (
    <>
      <ProfileCard
        nom={profil.displayName}
        userId={profil.userId}
        avatarUrl={profil.avatarUrl}
        bannerUrl={profil.bannerUrl}
      />

      {/* Composant 22 : les deux actions de son propre profil, centrées (REQ-UIX-24).
          **Une seule des deux est accentuée** — modifier son profil est ce qu'on vient
          faire ici ; se déconnecter est ce qu'on cherche quand on ne le trouve nulle part
          ailleurs, et c'était le cas jusqu'ici (`LogoutButton` n'était rendu par aucun
          écran). Les réglages, juste dessous, restent secondaires par construction.

          L'identité au-dessus est alignée à gauche, cette paire reste centrée : c'est
          l'écart de 32 px qui rend l'axe mixte lisible. À 16 px uniformes elle passait
          pour un membre mal aligné du bloc d'identité ; à 32 px au-dessus et 24 px en
          dessous, elle est son propre temps. Espacement asymétrique, donc, et c'est le
          point — un padding égal sur les quatre côtés ne dit jamais où commence quoi.

          12 px entre les deux, et non 8 : à 8 px ils formeraient un groupe segmenté, une
          seule chose en deux morceaux. Ce sont deux actions sans rapport l'une avec
          l'autre, et l'écart doit le dire — sans les envoyer aux deux bords, ce qui les
          ferait lire comme les boutons d'une barre plutôt que comme les actions de cet
          écran. Les icônes portent la distinction avant la lecture : un crayon modifie,
          une flèche qui sort part. */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: "var(--spacing-3)",
          padding: "var(--spacing-8) var(--spacing-3) var(--spacing-6)",
        }}
      >
        <Button
          label="Modifier le profil"
          variant="primary"
          icon={IconeEdition}
          onClick={() => setEdition(true)}
        />
        {deconnexion}
      </div>

      {/* REQ-UIX-31 — les réglages sont une section de cet écran, plus une route. */}
      <Reglages />

      <Sheet
        ouvert={edition}
        onFermer={() => setEdition(false)}
        nom="Modifier le profil"
      >
        {/* REQ-UIX-24 — **le même formulaire qu'à l'accueil** (M-B), à un autre moment.
            Deux copies auraient divergé au premier champ ajouté, et une seule des deux
            aurait porté l'avertissement le jour où on l'aurait déplacé. */}
        <div style={{ padding: "var(--spacing-4)" }}>
          <FormulaireIdentite
            profil={profil}
            onPhoto={onPhoto}
            onAnnuler={() => setEdition(false)}
            onEnregistrer={async (changements) => {
              // Un patch vide ne part pas : une écriture inutile fait un événement de
              // profil de plus dans tous les salons partagés.
              if (Object.keys(changements).length > 0) await onEnregistrer(changements);
              setEdition(false);
            }}
          />
        </div>
      </Sheet>
    </>
  );
}
