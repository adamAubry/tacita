"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { InfosConversation } from "../../../components/settings/InfosConversation";

/** Layout Conversation info — M-H, à 37. Salon en `?room=` (`lib/routes.ts`). */
function Contenu() {
  const roomId = useSearchParams()?.get("room") ?? "";
  return roomId ? <InfosConversation roomId={roomId} /> : null;
}

export default function PageInfosConversation() {
  return (
    <Suspense fallback={null}>
      <Contenu />
    </Suspense>
  );
}
