"use client";

import { subscribeConversations, conversations as listerConversations } from "@tacita/messaging";
import { useCallback, useEffect, useState } from "react";

import { abonnerAuxNotifications, apercuLocal, permissionPush, TYPE_APERCU } from "../../lib/push";
import { Sheet } from "../foundation/Sheet";
import { Button, Text, VStack } from "../foundation/primitives";
import { IosPushEducation } from "../onboarding/IosPushEducation";
import { useSession } from "../onboarding/SessionProvider";

/**
 * REQ-UI-18 — la chaîne push côté fenêtre. Elle ne rend presque jamais rien.
 *
 * Deux rôles, tous deux invisibles la plupart du temps :
 *
 * 1. **répondre au service worker.** Réveillé par un push, il ne peut pas déchiffrer :
 *    les clés Megolm sont dans le store crypto de cette fenêtre. Il demande donc
 *    l'aperçu ici, et nous le rendons — rien n'est conservé de part ni d'autre
 *    (REQ-UIX-40) ;
 * 2. **demander la permission au bon moment.** Jamais au premier lancement : au premier
 *    message reçu, quand la question a un sens et une réponse évidente. La demande passe
 *    par une feuille avec un bouton — les navigateurs exigent un geste, et une invite
 *    système surgie seule est le plus court chemin vers un refus définitif.
 */
export function PushNotifications() {
  const { etat } = useSession();
  const session = etat.phase === "prete" ? etat.session : null;

  const [propose, setPropose] = useState(false);
  const [refuse, setRefuse] = useState(false);

  // Rôle 1 — le pont avec le service worker.
  useEffect(() => {
    if (!session || !("serviceWorker" in navigator)) return;

    const repondre = (evenement: MessageEvent) => {
      const donnees = evenement.data as { type?: string; roomId?: string; eventId?: string };
      if (donnees?.type !== TYPE_APERCU || !donnees.roomId) return;
      // `null` est une réponse : le SW affiche alors « Nouveau message ».
      evenement.ports[0]?.postMessage(apercuLocal(session, donnees.roomId, donnees.eventId));
    };

    navigator.serviceWorker.addEventListener("message", repondre);
    return () => navigator.serviceWorker.removeEventListener("message", repondre);
  }, [session]);

  // Rôle 2 — le déclencheur : un message non lu est arrivé.
  useEffect(() => {
    if (!session || permissionPush() !== "default") return;

    const verifier = () => {
      if (listerConversations(session).some((conversation) => conversation.unread > 0)) {
        setPropose(true);
      }
    };

    verifier();
    return subscribeConversations(session, verifier);
  }, [session]);

  const accepter = useCallback(async () => {
    setPropose(false);
    if (!session) return;
    // Un échec (passerelle injoignable, refus) laisse simplement l'app sans push : les
    // réglages disent l'état et proposent de réessayer. Rien n'est journalisé.
    setRefuse(!(await abonnerAuxNotifications(session).catch(() => false)));
  }, [session]);

  return (
    <>
      {/* REQ-PSH-05 — sur iPhone hors écran d'accueil, aucun abonnement n'est possible :
          l'éducation (M-B) passe avant la demande de permission, qui échouerait. */}
      <IosPushEducation declenche={propose} />

      {/* Rien de monté tant que la question n'a pas lieu d'être : `<dialog>` garde son
          contenu dans le DOM même fermé, et une proposition non pertinente y resterait
          lisible — même raison que l'écran d'éducation iOS (M-B). */}
      {propose && (
        <Sheet ouvert onFermer={() => setPropose(false)} titre="Être prévenu des nouveaux messages ?">
          <VStack gap={4}>
            <Text>
              Votre appareil vous préviendra à l&apos;arrivée d&apos;un message. Le serveur ne
              transmet que de quoi réveiller l&apos;application — le contenu est déchiffré ici,
              sur votre appareil.
            </Text>
            <Button
              label="Activer les notifications"
              variant="primary"
              onClick={() => void accepter()}
            />
            <Button label="Plus tard" variant="ghost" onClick={() => setPropose(false)} />
          </VStack>
        </Sheet>
      )}

      {refuse && (
        <Sheet ouvert onFermer={() => setRefuse(false)} titre="Notifications non activées">
          <VStack gap={4}>
            <Text>
              Elles peuvent être réactivées à tout moment depuis Profil › Réglages ›
              Notifications.
            </Text>
            <Button label="Compris" variant="primary" onClick={() => setRefuse(false)} />
          </VStack>
        </Sheet>
      )}
    </>
  );
}
