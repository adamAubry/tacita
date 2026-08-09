"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { EcranAppel } from "../../../components/appels/EcranAppel";

/**
 * L'écran d'appel (M-I). Une route et non une modale : c'est un plein écran dont on
 * ressort par le retour du navigateur, et un appel doit survivre à un geste de retour
 * mal placé — pas disparaître avec une feuille.
 */
function Contenu() {
  const parametres = useSearchParams();
  const roomId = parametres?.get("room") ?? "";
  return roomId ? <EcranAppel roomId={roomId} video={parametres?.get("video") === "1"} /> : null;
}

export default function PageAppel() {
  return (
    <Suspense fallback={null}>
      <Contenu />
    </Suspense>
  );
}
