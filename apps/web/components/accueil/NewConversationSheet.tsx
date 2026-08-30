"use client";

import { useState } from "react";

import { ButtonsList } from "../foundation/ButtonsList";
import { Sheet } from "../foundation/Sheet";
import { Button, CheckboxList, CheckboxListItem, TextInput } from "../foundation/primitives";
import { IconeAjouterMembre } from "../foundation/icons";
import { Placeholder } from "../foundation/Placeholder";
import type { Contact } from "../../lib/contacts";

type Etape = "choix" | "conversation" | "groupe";

interface NewConversationSheetProps {
  ouvert: boolean;
  onFermer: () => void;
  contacts: Contact[];
  /** le DM, existant ou créé. La déduplication vit dans le package. */
  onConversation: (userId: string) => void;
  onGroupe: (nom: string, userIds: string[]) => void;
  /**
   * « créer un groupe avec cette personne » ouvre la même feuille, mais
   * directement sur l'étape groupe et avec la personne déjà cochée. Deux props plutôt
   * qu'une copie du composant : c'est la règle du plan frontend, et le premier
   * changement d'étape aurait dérivé entre les deux exemplaires.
   */
  etapeInitiale?: "choix" | "groupe";
  selectionInitiale?: string[];
}

/**
 * le « + » de l'accueil : « nouvelle conversation » ou « nouveau groupe ».
 *
 * Trois étapes dans **une** feuille plutôt que trois écrans : la création est un aller
 * simple, et une pile de navigation pour deux taps coûterait un retour à gérer partout.
 *
 * Le doublon de DM n'est pas évité ici mais dans `openDirectMessage` : deux
 * écrans peuvent ouvrir une conversation, et une règle recopiée dérive.
 */
export function NewConversationSheet({
  ouvert,
  onFermer,
  contacts,
  onConversation,
  onGroupe,
  etapeInitiale = "choix",
  selectionInitiale = [],
}: NewConversationSheetProps) {
  const [etape, setEtape] = useState<Etape>(etapeInitiale);
  const [selection, setSelection] = useState<string[]>(selectionInitiale);
  const [nom, setNom] = useState("");

  const fermer = () => {
    setEtape(etapeInitiale);
    setSelection(selectionInitiale);
    setNom("");
    onFermer();
  };

  return (
    <Sheet ouvert={ouvert} onFermer={fermer} nom="Nouvelle conversation">
      {etape === "choix" && (
        <ButtonsList
          boutons={[
            {
              cle: "conversation",
              libelle: "Nouvelle conversation",
              onClick: () => setEtape("conversation"),
            },
            { cle: "groupe", libelle: "Nouveau groupe", onClick: () => setEtape("groupe") },
          ]}
        />
      )}

      {/* Aucune source honnête de « suggestions » n'existe (E-04) : sans DM, il n'y a
          personne à proposer, et l'écran le dit au lieu de rester vide. */}
      {etape !== "choix" && contacts.length === 0 && (
        <Placeholder
          icone={IconeAjouterMembre}
          titre="Personne à qui écrire pour l'instant"
          explication="Ajoutez quelqu'un par un lien d'invitation, et il apparaîtra ici."
        />
      )}

      {etape === "conversation" && contacts.length > 0 && (
        <ButtonsList
          boutons={contacts.map((contact) => ({
            cle: contact.userId,
            libelle: contact.nom,
            description: contact.userId,
            onClick: () => {
              onConversation(contact.userId);
              fermer();
            },
          }))}
        />
      )}

      {etape === "groupe" && contacts.length > 0 && (
        <div style={{ display: "grid", gap: "var(--spacing-3)", padding: "var(--spacing-3)" }}>
          <TextInput label="Nom du groupe" value={nom} onChange={setNom} />

          <CheckboxList label="Membres" value={selection} onChange={setSelection}>
            {contacts.map((contact) => (
              <CheckboxListItem key={contact.userId} value={contact.userId} label={contact.nom} />
            ))}
          </CheckboxList>

          <Button
            label="Créer le groupe"
            // Un groupe sans nom ni membre n'est pas un groupe. Le bouton reste visible
            // et désactivé — DESIGN.md interdit l'option grisée *sans explication*, pas
            // le bouton dont la condition est sous les yeux.
            isDisabled={nom.trim() === "" || selection.length === 0}
            tooltip="Donne un nom au groupe et choisis au moins un membre."
            onClick={() => {
              onGroupe(nom.trim(), selection);
              fermer();
            }}
          />
        </div>
      )}
    </Sheet>
  );
}
