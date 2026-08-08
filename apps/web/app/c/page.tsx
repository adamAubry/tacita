"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { Conversation } from "../../components/conversation/Conversation";

/**
 * Layout Conversation (M-D). Le salon vient de `?room=`, **pas d'un segment de chemin** :
 * une route statique est précachable, une route dynamique ne l'est pas. Voir `lib/routes.ts`
 * pour ce que ce choix a coûté en hors-ligne avant d'être fait.
 */
function Contenu() {
  const roomId = useSearchParams()?.get("room") ?? "";
  return roomId ? <Conversation roomId={roomId} /> : null;
}

export default function PageConversation() {
  // `useSearchParams` dans une page statique exige une frontière : sans elle, le rendu
  // se fait au moment de la requête et la route redevient dynamique.
  return (
    <Suspense fallback={null}>
      <Contenu />
    </Suspense>
  );
}
