"use client";

import type { ReactNode } from "react";

import { Button, Dialog, DialogHeader, Icon } from "./primitives";

interface SheetProps {
  ouvert: boolean;
  onFermer: () => void;
  /**
   * Le titre de la feuille. Il **nomme** la modale pour l'assistance technique — sans
   * lui, Astryx avertit qu'une boîte de dialogue s'ouvre sans nom accessible, et un
   * lecteur d'écran annonce « dialogue » sans dire lequel.
   *
   * Facultatif : les feuilles d'action déjà titrées par leur contenu (M-C, M-D) n'en
   * ont pas besoin, et l'ajouter changerait leur mise en page. Dans ce cas, `nom` est
   * **obligatoire** — sans l'un ni l'autre, la modale s'ouvre sans nom accessible.
   */
  titre?: string;
  /**
   * Le nom accessible, quand il ne peut pas être visible. Une feuille d'action tire son
   * sens de ses boutons, et lui coller un en-tête changerait sa mise en page pour rien —
   * mais un lecteur d'écran, lui, annonce alors « boîte de dialogue » et s'arrête là.
   *
   * Ignoré quand `titre` est fourni : le titre visible fait déjà le nom (WCAG 4.1.2), et
   * deux noms concurrents en donnent un de trop.
   */
  nom?: string;
  /** Une phrase sous le titre, quand la modale a besoin d'un cadre avant son contenu. */
  sousTitre?: string;
  /**
   * `bas` = bottom-sheet (le geste attendu sur mobile), `centre` = modal.
   * DESIGN.md : r12 pour les sheets, r10 pour les modals.
   */
  ancrage?: "bas" | "centre";
  children: ReactNode;
}

/**
 * **Deux sorties, toujours les deux, sur toutes les feuilles** (11/08/2026) : ce bouton,
 * et le clic sur le fond.
 *
 * Il n'y a **pas de touche Échap sur un téléphone.** `purpose="form"` d'Astryx, qui bloque
 * le clic sur le fond et ne laisse qu'Échap, transformait donc en cul-de-sac les cinq
 * feuilles qui l'utilisaient : `PhotoCapture` sur caméra refusée n'affichait qu'un
 * paragraphe — aucun bouton, aucune sortie —, et l'écran de nouvelle conversation ne
 * proposait que deux boutons qui s'enfoncent d'un cran. La prop a disparu plutôt que
 * d'être corrigée cas par cas : tant qu'elle existait, la prochaine feuille pouvait
 * refaire le piège.
 *
 * Le libellé est **écrit ici, en français**. Celui d'Astryx vient de son dictionnaire, et
 * son `fr-FR.json` porte 3 clés sur 219 : `DialogHeader` annonçait « Close » au milieu
 * d'une interface française. On lui passe donc notre bouton par `endContent` au lieu de
 * lui demander le sien (`onOpenChange` volontairement omis).
 */
function BoutonFermer({ onFermer }: { onFermer: () => void }) {
  return (
    <Button
      label="Fermer"
      variant="ghost"
      isIconOnly
      icon={<Icon icon="close" />}
      onClick={onFermer}
    />
  );
}

/**
 * REQ-UIX-05 — la modale et le bottom-sheet de l'app, un seul composant.
 *
 * **La géométrie est portée ici, parce qu'Astryx la porte pour un dialogue de bureau.**
 * Ses défauts sont `width: 400px` et `maxWidth: 90vw` ; avec `left: 0` et `right: 0`, une
 * largeur explicite rend `right` inopérant (règle CSS de la boîte sur-contrainte) — le
 * bottom-sheet sortait donc à 400 px **collé au bord gauche**, soit 351 px et 39 px de vide
 * à droite sur un téléphone de 390 px, et un panneau perdu dans le coin d'un écran de
 * bureau. C'était le principal défaut visuel des feuilles.
 *
 * Trois autres écarts, tous mesurés dans la source d'Astryx 0.2.0 et le CSS livré :
 *
 * - **le rayon** — `--radius-container` (r10) pour tout, quand DESIGN.md § Overview dit
 *   r12 pour les bottom-sheets. Et les quatre coins étaient arrondis alors que la feuille
 *   est collée au bas de l'écran : les deux du bas entaillaient le bord. Seuls ceux du
 *   haut le sont désormais, comme sur toutes les messageries ;
 * - **la surface** — `surface` + `--shadow-high` sans filet, quand DESIGN.md § Elevation
 *   range modales et feuilles en e2 : `surface-raised` + hairline + ombre basse. « Jamais
 *   d'ombre sans hairline » est une règle du même fichier ;
 * - **le débordement** — le conteneur interne d'Astryx est en `overflow: hidden`, et rien
 *   dedans ne défile. Passé `maxHeight`, le contenu était **coupé et inatteignable** : la
 *   liste des membres d'un groupe, les réglages. Le corps défile maintenant sous un
 *   en-tête qui reste en place, et il dégage la barre de gestes en PWA installée.
 *
 * ponytail: pas de poignée de glissement, et pas de fermeture au glissement vers le bas.
 * La poignée est le signe **du glissement** : la poser sans le geste serait une promesse
 * non tenue (interdit n°13), et le geste demanderait de suivre le doigt en `transform`
 * sur un `<dialog>` dont l'animation d'entrée écrit déjà cette propriété. Les deux sorties
 * demandées existent et suffisent. À reprendre ensemble, jamais l'une sans l'autre.
 */
export function Sheet({
  ouvert,
  onFermer,
  titre,
  nom,
  sousTitre,
  ancrage = "bas",
  children,
}: SheetProps) {
  const bas = ancrage === "bas";

  return (
    <Dialog
      isOpen={ouvert}
      onOpenChange={(o) => {
        if (!o) onFermer();
      }}
      // `info` (le défaut) est la seule valeur : Échap **et** clic sur le fond ferment.
      position={bas ? { bottom: 0, left: 0, right: 0 } : undefined}
      width={bas ? "100%" : 400}
      // `dvh` et non `vh` : la barre d'URL rétractable des mobiles, comme partout ailleurs.
      maxHeight={bas ? "85dvh" : "80dvh"}
      // WCAG 4.1.2 — sans nom, un lecteur d'écran annonce « boîte de dialogue » et
      // s'arrête là. Le titre visible le fournit déjà : on ne pose `aria-label` que
      // pour les feuilles d'action, qui n'ont pas d'en-tête et n'en veulent pas.
      aria-label={titre ? undefined : nom}
      // En ligne, et c'est voulu : ces déclarations doivent battre les classes atomiques
      // d'Astryx, que rien d'autre ne surcharge depuis l'extérieur du paquet.
      style={{
        // DESIGN.md e2 — modales et feuilles : `surface-raised`, hairline, ombre basse.
        background: "var(--color-background-popover)",
        border: "1px solid var(--color-border)",
        boxShadow: "var(--shadow-low)",
        ...(bas
          ? {
              maxWidth: "none",
              borderRadius: "var(--radius-page) var(--radius-page) 0 0",
            }
          : {}),
      }}
    >
      {titre ? (
        <DialogHeader
          title={titre}
          subtitle={sousTitre}
          endContent={<BoutonFermer onFermer={onFermer} />}
        />
      ) : (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <BoutonFermer onFermer={onFermer} />
        </div>
      )}

      {/* Le corps, et lui seul, défile : l'en-tête et sa sortie restent atteignables quel
          que soit le contenu. `minHeight: 0` parce qu'un enfant de flex refuse par défaut
          de descendre sous la taille de son contenu — sans lui, `overflow` n'a rien à
          faire et le débordement reste coupé. */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        {children}
      </div>
    </Dialog>
  );
}
