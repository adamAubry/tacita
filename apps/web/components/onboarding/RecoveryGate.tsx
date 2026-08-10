"use client";

import type { ReactNode } from "react";

import { Placeholder } from "../foundation/Placeholder";
import { Skeleton, VStack } from "../foundation/primitives";
import { RecoveryStep } from "./RecoveryStep";
import { useSession } from "./SessionProvider";

/**
 * REQ-UI-04 / REQ-UIX-06 — la porte d'entrée de toute l'app.
 *
 * **Elle remplace le contenu, elle ne redirige pas.** Un garde de route se contourne en
 * tapant une adresse ; ici, tant que la clé de récupération n'est pas confirmée, aucune
 * route ne rend autre chose que l'étape — quelle que soit l'URL demandée. C'est ce que
 * « ni sautée, ni différée, ni contournée par URL directe » veut dire concrètement.
 */
/**
 * Le cadre des écrans que la porte rend **à la place** de l'app.
 *
 * Il existe parce que ces écrans-là n'ont aucun layout de route au-dessus d'eux : ils ne
 * sont pas des pages, ils remplacent le shell. Sans lui, leur contenu était collé aux
 * quatre bords de la fenêtre et s'étirait sur toute la largeur d'un écran de bureau —
 * mesuré au navigateur le 10/08/2026. Le mettre ici plutôt que dans chaque écran fait
 * que le suivant l'aura sans y penser.
 *
 * `marginBlock: auto` et non `justify-content: center` : un contenu plus haut que la
 * fenêtre reste alors atteignable par le haut, là où le centrage par flexbox le rogne.
 * `100dvh` et non `100vh` — la barre d'URL rétractable des mobiles (même raison qu'au
 * fond d'application, `providers.tsx`).
 */
function EcranDePorte({ children }: { children: ReactNode }) {
  return (
    <VStack
      as="main"
      minHeight="100dvh"
      style={{
        paddingInline: "var(--spacing-5)",
        // Les encoches et la barre de gestes : en PWA installée, elles mordent sinon sur
        // le titre en haut et sur le bouton primaire en bas (DESIGN.md, safe-areas iOS).
        paddingTop: "calc(var(--spacing-8) + env(safe-area-inset-top, 0px))",
        paddingBottom: "calc(var(--spacing-8) + env(safe-area-inset-bottom, 0px))",
      }}
    >
      {/* 440 px : la mesure confortable de DESIGN.md pour de la prose en corps 15. */}
      <VStack gap={6} width="100%" maxWidth={440} style={{ marginInline: "auto", marginBlock: "auto" }}>
        {children}
      </VStack>
    </VStack>
  );
}

export function RecoveryGate({ children }: { children: ReactNode }) {
  const { etat } = useSession();

  if (etat.phase === "chargement") {
    // DESIGN.md : pas de spinner plein écran. Une géométrie d'attente, localisée.
    return (
      <EcranDePorte>
        <VStack gap={2}>
          <Skeleton height={44} />
          <Skeleton height={44} />
          <Skeleton height={44} />
        </VStack>
      </EcranDePorte>
    );
  }

  if (etat.phase === "hors-session") {
    // La redirection vers l'OIDC est déjà partie (REQ-UIX-06 : sans écran intermédiaire).
    // Ce qui s'affiche entre-temps ne doit ni ressembler à une erreur, ni à un formulaire.
    return (
      <EcranDePorte>
        <Placeholder titre="Connexion…" explication="Redirection vers votre fournisseur." />
      </EcranDePorte>
    );
  }

  if (etat.phase === "recuperation-requise") {
    return (
      <EcranDePorte>
        <RecoveryStep session={etat.session} />
      </EcranDePorte>
    );
  }

  return <>{children}</>;
}
