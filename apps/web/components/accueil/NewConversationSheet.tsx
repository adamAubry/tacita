"use client";

import { useState } from "react";

import { ButtonsList } from "../foundation/ButtonsList";
import { Sheet } from "../foundation/Sheet";
import { Button, CheckboxList, CheckboxListItem, TextInput } from "../foundation/primitives";
import { Placeholder } from "../foundation/Placeholder";
import type { Contact } from "../../lib/contacts";

type Etape = "choix" | "conversation" | "groupe";

export interface NewConversationSheetProps {
  ouvert: boolean;
  onFermer: () => void;
  contacts: Contact[];
  /** REQ-UIX-11 — le DM, existant ou créé. La déduplication vit dans le package. */
  onConversation: (userId: string) => void;
  onGroupe: (nom: string, userIds: string[]) => void;
}

/**
 * REQ-UIX-11 — le « + » de l'accueil : « nouvelle conversation » ou « nouveau groupe ».
 *
 * Trois étapes dans **une** feuille plutôt que trois écrans : la création est un aller
 * simple, et une pile de navigation pour deux taps coûterait un retour à gérer partout.
 *
 * Le doublon de DM n'est pas évité ici mais dans `openDirectMessage` (REQ-MSG-15) : deux
 * écrans peuvent ouvrir une conversation, et une règle recopiée dérive.
 */
export function NewConversationSheet({
  ouvert,
  onFermer,
  contacts,
  onConversation,
  onGroupe,
}: NewConversationSheetProps) {
  const [etape, setEtape] = useState<Etape>("choix");
  const [selection, setSelection] = useState<string[]>([]);
  const [nom, setNom] = useState("");

  const fermer = () => {
    setEtape("choix");
    setSelection([]);
    setNom("");
    onFermer();
  };

  return (
    <Sheet ouvert={ouvert} onFermer={fermer} sortie="form">
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
          titre="Personne à qui écrire pour l'instant"
          explication="Ajoute quelqu'un par un lien d'invitation, et il apparaîtra ici."
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
