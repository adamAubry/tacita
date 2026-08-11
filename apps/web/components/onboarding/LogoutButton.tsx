"use client";

import type { Session } from "@tacita/client-core";
import { useState } from "react";

import { IconeDeconnexion } from "../foundation/icons";
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
      {/* `secondary` et non `ghost` : depuis qu'il est posé à côté de « Modifier le
          profil » (REQ-UIX-24), il forme une paire avec un bouton plein, et un fantôme
          dans cette paire se lit comme du texte plutôt que comme une action. Il reste
          plus clair que l'accentué — c'est l'écart qui dit lequel des deux est l'action
          courante. Le destructif est dans la feuille, là où il détruit vraiment. */}
      <Button
        label="Se déconnecter"
        variant="secondary"
        icon={IconeDeconnexion}
        onClick={() => setConfirmation(true)}
      />
      <Sheet
        ouvert={confirmation}
        onFermer={() => setConfirmation(false)}
        sortie="form"
        nom="Se déconnecter de cet appareil"
      >
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
