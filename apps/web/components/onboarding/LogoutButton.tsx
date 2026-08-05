"use client";

import type { Session } from "@tacita/client-core";
import { useState } from "react";

import { Button, List, ListItem, Text, VStack } from "../foundation/primitives";
import { Sheet } from "../foundation/Sheet";
import { useSession } from "./SessionProvider";

/**
 * REQ-UIX-06 / REQ-COR-10 — la déconnexion **efface tout localement**, et la confirmation
 * dit quoi, précisément. « Voulez-vous vraiment vous déconnecter ? » ne permet à personne
 * de décider : ici, la déconnexion détruit l'historique déchiffré, l'index de recherche et
 * la file d'envoi de cet appareil.
 *
 * Ce qui part avec, et qu'il faut nommer : les messages non encore envoyés.
 */
export function LogoutButton({ session }: { session: Session }) {
  const { deconnecter } = useSession();
  const [confirmation, setConfirmation] = useState(false);
  const [enCours, setEnCours] = useState(false);

  return (
    <>
      <Button
        label="Se déconnecter"
        variant="ghost"
        onClick={() => setConfirmation(true)}
      />
      <Sheet ouvert={confirmation} onFermer={() => setConfirmation(false)} sortie="form">
        <VStack gap={4}>
          <Text type="display-3">Se déconnecter de cet appareil</Text>
          <Text>Cet appareil oubliera :</Text>
          <List>
            <ListItem label="Vos messages déjà déchiffrés" />
            <ListItem label="L'index de recherche local" />
            <ListItem label="Les messages en attente d'envoi" />
          </List>
          <Text type="supporting">
            Vos conversations restent sur le serveur, chiffrées. Vous les retrouverez à la
            prochaine connexion avec votre clé de récupération.
          </Text>
          <Button
            label="Se déconnecter"
            variant="destructive"
            isLoading={enCours}
            onClick={() => {
              setEnCours(true);
              void deconnecter(session).finally(() => setEnCours(false));
            }}
          />
          <Button label="Annuler" variant="ghost" onClick={() => setConfirmation(false)} />
        </VStack>
      </Sheet>
    </>
  );
}
