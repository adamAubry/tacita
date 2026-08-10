"use client";

import type { Session } from "@tacita/client-core";
import { useState } from "react";

import { Banner, Button, Text, VStack } from "../foundation/primitives";
import { useSession } from "./SessionProvider";

/**
 * REQ-UI-04 — **l'étape bloquante.** Elle n'est ni sautable, ni différable, et il n'y a
 * pas d'URL qui la contourne : ce n'est pas une route, c'est ce que le shell rend tant
 * que `recoveryRequired()` est vrai (voir `RecoveryGate`). Un garde de route se contourne
 * en tapant une adresse ; un écran qui remplace l'app, non.
 *
 * Pourquoi elle bloque, en une phrase que l'UI doit tenir : **sans clé de récupération,
 * le compte ne peut pas chiffrer du tout** (D-08). Ce n'est pas une précaution pour plus
 * tard, c'est ce qui rend l'envoi possible.
 */
export function RecoveryStep({ session }: { session: Session }) {
  const { recuperationConfirmee } = useSession();
  const [cle, setCle] = useState<string | undefined>();
  const [copiee, setCopiee] = useState(false);
  const [echec, setEchec] = useState<"generique" | "origine" | undefined>();
  const [enCours, setEnCours] = useState(false);

  const generer = async () => {
    setEnCours(true);
    setEchec(undefined);
    try {
      const generee = await session.setupRecoveryKey();
      setCle(generee.encodedPrivateKey);
    } catch {
      // Aucun détail affiché ni journalisé : le message d'erreur du SDK peut porter du
      // matériel de clé. La seule chose qu'on ait le droit de lire, c'est l'origine de la
      // page : hors *secure context* (`https://` ou `localhost`), `crypto.subtle` n'existe
      // pas et le secret storage ne peut pas être chiffré — l'échec est alors certain, et
      // « réessayez » serait un mensonge. Lu après coup, jamais avant : le serveur rend la
      // même page pour toutes les origines.
      setEchec(globalThis.isSecureContext === false ? "origine" : "generique");
    } finally {
      setEnCours(false);
    }
  };

  if (!cle) {
    return (
      <VStack gap={4}>
        <Text type="display-3">Votre clé de récupération</Text>
        <Text>
          Elle vous permettra de retrouver vos conversations sur un nouvel appareil. Sans elle,
          votre historique est définitivement perdu — personne, chez nous, ne peut le récupérer.
        </Text>
        {echec ? (
          <Banner
            status="error"
            title="La clé n'a pas pu être créée"
            description={
              echec === "origine"
                ? "Cette page est ouverte sur une adresse non sécurisée : le chiffrement y est indisponible, et réessayer ne changera rien. Rouvrez l'application en https, ou sur localhost."
                : "Vérifiez votre connexion et réessayez."
            }
          />
        ) : null}
        <Button label="Créer ma clé" variant="primary" isLoading={enCours} onClick={generer} />
      </VStack>
    );
  }

  return (
    <VStack gap={4}>
      <Text type="display-3">Notez cette clé maintenant</Text>
      {/* Affichée **une seule fois** : le SDK ne la conserve pas, et nous non plus. */}
      <Text type="code" data-testid="cle-de-recuperation">
        {cle}
      </Text>
      <Banner
        status="warning"
        title="Elle ne sera plus affichée"
        description="Rangez-la dans votre gestionnaire de mots de passe ou sur un papier. Nous n'en gardons aucune copie."
      />
      {/*
        Le presse-papiers ne reçoit la clé que sur une action explicite (contrainte M-B) :
        beaucoup d'applications y écrivent des secrets sans le dire, et le presse-papiers
        est lisible par d'autres applications.
      */}
      <Button
        label={copiee ? "Copiée" : "Copier la clé"}
        variant="secondary"
        onClick={() => {
          void navigator.clipboard?.writeText(cle).then(
            () => setCopiee(true),
            () => setCopiee(false),
          );
        }}
      />
      <Button
        label="J'ai sauvegardé ma clé"
        variant="primary"
        onClick={recuperationConfirmee}
      />
    </VStack>
  );
}
