"use client";

import { PINNED_EVENTS_METADATA } from "@tacita/messaging";
import { useState } from "react";

import { Placeholder } from "../foundation/Placeholder";
import { SegmentedControl, SegmentedControlItem, Text } from "../foundation/primitives";
import { MediaMessage } from "./MediaMessage";
import {
  liensDe,
  mediaDe,
  repartir,
  type EvenementLu,
  type Media,
  type Onglet,
  type Telecharger,
} from "./media";

const ONGLETS: { cle: Onglet; libelle: string; vide: string }[] = [
  { cle: "medias", libelle: "Médias", vide: "Aucune photo ni vidéo dans l'historique téléchargé." },
  { cle: "epingles", libelle: "Épinglés", vide: "Aucun message épinglé." },
  { cle: "liens", libelle: "Liens", vide: "Aucun lien partagé dans l'historique téléchargé." },
  { cle: "fichiers", libelle: "Fichiers", vide: "Aucun fichier dans l'historique téléchargé." },
];

/**
 * REQ-UIX-17 — **la planche contact : trois carrés par ligne**, comme Instagram.
 *
 * Trois colonnes et pas un nombre calculé : c'est le compte qui garde une vignette
 * reconnaissable sur la largeur d'un téléphone, et le même sur un écran large — où la
 * galerie vit dans une colonne, pas dans toute la page. `1fr` et non une largeur fixe :
 * les cellules se partagent ce qu'il y a, quel que soit l'écran.
 *
 * L'espace entre les cases est le plus petit de l'échelle (2 px). Une grille de photos se
 * lit comme une surface continue ; l'écart n'est là que pour séparer deux images de teintes
 * voisines, pas pour aérer.
 */
const GRILLE = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: "var(--spacing-0-5)",
  listStyle: "none",
} as const;

/** Épinglés, liens et fichiers restent une liste : ce sont des lignes de texte. */
const LISTE = { display: "grid", gap: "var(--spacing-2)", listStyle: "none" } as const;

interface ConversationCollectionsProps {
  /** L'historique **déjà téléchargé**, tel que le paquet le rend. */
  evenements: EvenementLu[];
  /** REQ-MSG-08 — les identifiants épinglés, lus par le câblage. */
  epingles: string[];
  telecharger: Telecharger;
  onOuvrirMedia?: (rang: number) => void;
  /** REQ-MED-05 — écrire un fichier sur l'appareil, depuis l'onglet Fichiers. */
  onSauvegarder?: (media: Media) => void;
}

/**
 * REQ-UIX-17 — **un seul** composant de galeries, à quatre onglets, consommé par le
 * layout info (M-H) et l'onglet Activity du profil (M-G). Les variations sont des props,
 * jamais des copies (règle du plan frontend).
 *
 * Le périmètre est affiché, pas sous-entendu : ce qui est listé est ce que cet appareil a
 * synchronisé, et rien d'autre. Une galerie muette laisserait croire à un historique
 * complet — c'est la même honnêteté que le périmètre de recherche (REQ-UI-16).
 */
export function ConversationCollections({
  evenements,
  epingles,
  telecharger,
  onOuvrirMedia,
  onSauvegarder,
}: ConversationCollectionsProps) {
  const [onglet, setOnglet] = useState<Onglet>("medias");
  const contenus = repartir(evenements, epingles);
  const courant = contenus[onglet];
  const vide = ONGLETS.find((o) => o.cle === onglet)!.vide;

  return (
    <section aria-label="Contenus partagés" style={{ display: "grid", gap: "var(--spacing-3)" }}>
      <SegmentedControl
        // Un libellé distinct de celui de la section : le sélecteur choisit un *type*,
        // la section *est* les contenus. Deux étiquettes identiques rendent les deux
        // introuvables à l'assistance technique comme au test.
        label="Type de contenu"
        // Même règle qu'à l'accueil et qu'au sélecteur Actions/Activity juste au-dessus
        // de ce composant : les options se partagent la largeur, à parts égales.
        layout="fill"
        value={onglet}
        onChange={(valeur) => setOnglet(valeur as Onglet)}
      >
        {ONGLETS.map(({ cle, libelle }) => (
          <SegmentedControlItem key={cle} value={cle} label={libelle} />
        ))}
      </SegmentedControl>

      <Text type="supporting" color="secondary">
        Contenu de l'historique téléchargé sur cet appareil.
      </Text>

      {/* REQ-UIX-18 — la liste d'épinglage est un événement d'état, et Matrix ne chiffre
          pas l'état : le serveur voit quels messages sont épinglés. La phrase vient de la
          métadonnée du paquet, elle n'est pas recopiée. */}
      {onglet === "epingles" && PINNED_EVENTS_METADATA.cleartext && (
        <span title={PINNED_EVENTS_METADATA.reason}>
          <Text type="supporting" color="secondary">
            La liste des messages épinglés n'est pas chiffrée : le serveur la voit.
          </Text>
        </span>
      )}

      {courant.length === 0 ? (
        <Placeholder titre={vide} />
      ) : (
        <ul style={onglet === "medias" ? GRILLE : LISTE}>
          {courant.map((evenement, rang) => {
            const media = mediaDe(evenement);
            return (
              <li key={evenement.getId()}>
                {media ? (
                  <MediaMessage
                    media={media}
                    telecharger={telecharger}
                    carre={onglet === "medias"}
                    onOuvrir={onglet === "medias" ? () => onOuvrirMedia?.(rang) : undefined}
                    onSauvegarder={onSauvegarder ? () => onSauvegarder(media) : undefined}
                  />
                ) : (
                  <Text type="body" maxLines={2}>
                    {onglet === "liens"
                      ? liensDe(evenement).join(" ")
                      : ((evenement.getContent() as { body?: string }).body ?? "")}
                  </Text>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
