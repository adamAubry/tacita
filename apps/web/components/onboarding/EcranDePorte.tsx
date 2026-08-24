import type { ReactNode } from "react";

import { VStack } from "../foundation/primitives";

/**
 * Le cadre des écrans rendus **à la place** de l'app — la porte de récupération
 * (`RecoveryGate`) comme le parcours d'accueil (`Onboarding`).
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
export function EcranDePorte({ children }: { children: ReactNode }) {
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
      <VStack
        gap={6}
        width="100%"
        maxWidth={440}
        style={{ marginInline: "auto", marginBlock: "auto" }}
      >
        {children}
      </VStack>
    </VStack>
  );
}
