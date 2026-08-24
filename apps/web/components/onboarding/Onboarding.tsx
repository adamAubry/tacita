"use client";

import type { Session } from "@tacita/client-core";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { ecrireOnboardingEnCours } from "../../lib/preferences";
import { Button, ProgressBar, Spinner, VStack } from "../foundation/primitives";
import { EcranDePorte } from "./EcranDePorte";
import { ETAPES, type EtapeOnboarding } from "./etapes";
import { useSession } from "./SessionProvider";

/**
 * REQ-UI-22 — **le parcours d'accueil**, du compte tout juste créé au premier message
 * écrit.
 *
 * Ce fichier ne connaît aucune étape : il connaît une **liste** d'étapes, qu'il compte,
 * affiche et passe. Ajouter ou retirer une étape se fait dans `etapes.tsx` et nulle part
 * ailleurs — l'indicateur de progression, le bouton « passer » et la fin du parcours en
 * découlent. C'est la condition pour que le parcours puisse changer sans être réécrit.
 *
 * Trois choses lui appartiennent, et rien d'autre :
 *
 * 1. **où l'on en est** — un rang, et sa barre de progression ;
 * 2. **ce qui est facultatif** — le bouton qui passe une étape qui n'oblige à rien ;
 * 3. **la marque de reprise** — posée à l'ouverture, retirée à la fin, pour qu'un
 *    rechargement au milieu ne laisse personne sur une application vide.
 *
 * Ce qu'une étape fait, ce qu'elle prépare et ce que dit son bouton principal
 * appartiennent à l'étape. Le parcours ne rend pas de titre : chaque écran porte le sien,
 * et deux titres empilés donneraient à lire deux fois la même chose.
 */
export interface OnboardingProps {
  session: Session;
  /**
   * Le rang de départ. `0` sur un compte qui vient d'être créé — l'étape bloquante de la
   * clé (REQ-UI-04) est la première du parcours ; `1` quand elle est déjà franchie, ce
   * qui est le cas après un rechargement. Les étapes suivantes étant toutes idempotentes,
   * reprendre à la première d'entre elles est sans conséquence.
   */
  depart: number;
  /** Injectée en test : le parcours réel est celui de `etapes.tsx`. */
  etapes?: EtapeOnboarding[];
  indexedDB?: IDBFactory;
}

export function Onboarding({
  session,
  depart,
  etapes = ETAPES,
  indexedDB,
}: OnboardingProps) {
  const { onboardingTermine } = useSession();
  const base = indexedDB ?? globalThis.indexedDB;
  const [rang, setRang] = useState(depart);

  /*
   * L'étape de la clé se termine en changeant la **phase de session**, pas en appelant
   * `avancer` : c'est `recuperationConfirmee` qui ouvre la porte, et ce composant est
   * remonté avec un `depart` de 1. Le `max` est ce qui empêche ce rappel de faire revenir
   * en arrière quelqu'un qui serait déjà plus loin.
   */
  useEffect(() => setRang((precedent) => Math.max(precedent, depart)), [depart]);

  // La marque de reprise, posée dès que le parcours s'affiche. Un échec d'écriture ne
  // l'interrompt pas : elle ne sert qu'à retrouver le parcours après un rechargement.
  useEffect(() => {
    if (base) void ecrireOnboardingEnCours(base, true).catch(() => {});
  }, [base]);

  /*
   * Passer à la suite — ou terminer, quand il n'y a plus de suite. Écrit sans mise à jour
   * fonctionnelle **exprès** : `onboardingTermine` est un effet de bord, et React appelle
   * deux fois le calcul d'un `setState(prev => …)` en développement. Le rang vient donc de
   * la fermeture, qui est refaite à chaque rendu.
   */
  const avancer = useCallback(() => {
    if (rang + 1 >= etapes.length) onboardingTermine();
    else setRang(rang + 1);
  }, [rang, etapes.length, onboardingTermine]);

  const etape = etapes[Math.min(rang, etapes.length - 1)]!;
  const { Contenu } = etape;

  return (
    <EcranDePorte>
      {/*
        REQ-UI-22 — **où l'on en est, dit en toutes lettres.** Une barre seule fait voir
        une avancée sans jamais dire combien il reste ; le libellé d'Astryx est au-dessus
        d'elle et porte le compte, ce qui répond à la seule question qu'on se pose sur un
        parcours qu'on n'a pas choisi d'ouvrir : « c'est encore long ? ».

        Le total vient de la liste, jamais d'un nombre écrit ici : une étape ajoutée sans
        que le compte suive donnerait « étape 4 sur 3 », et l'indicateur mentirait au
        premier changement du parcours.
      */}
      <ProgressBar
        value={rang + 1}
        max={etapes.length}
        label={`Étape ${rang + 1} sur ${etapes.length}`}
      />

      {/* La clé de l'étape remonte l'arbre : chaque écran repart d'un état propre, et
          l'état d'une étape passée ne survit pas à la suivante. */}
      <Contenu key={etape.cle} session={session} avancer={avancer} />

      {/*
        REQ-UI-22 — **ce qui est facultatif se passe, et le dit.** Une étape obligatoire
        n'affiche rien ici : un bouton grisé serait une promesse non tenue (interdit n°13),
        et un bouton absent se comprend sans explication.

        En `ghost` et sous le contenu : l'action attendue est celle de l'écran, celle-ci
        est la sortie. Un seul aplat plein par vue, comme sur l'étape de la clé.
      */}
      {etape.optionnelle && (
        <VStack hAlign="center">
          <Button label={etape.libellePasser ?? "Passer"} variant="ghost" onClick={avancer} />
        </VStack>
      )}
    </EcranDePorte>
  );
}

/**
 * REQ-UI-22 — **une étape qui prépare quelque chose le montre.**
 *
 * Certaines étapes ont du travail à faire avant d'avoir quoi que ce soit à afficher :
 * dessiner et téléverser deux images, créer une conversation. Sans ce crochet, l'écran
 * reste vide pendant deux secondes — et un écran vide se lit comme une panne, pas comme
 * une attente.
 *
 * Le travail part **une fois**, garde-fou compris : en développement React monte deux
 * fois, et une identité téléversée deux fois est deux fois le prix pour la même image.
 */
export function usePreparation<T>(preparer: () => Promise<T>): {
  valeur?: T;
  echec: boolean;
} {
  const [resultat, setResultat] = useState<{ valeur?: T; echec: boolean }>({ echec: false });
  const lance = useRef(false);

  useEffect(() => {
    if (lance.current) return;
    lance.current = true;
    void preparer()
      .then((valeur) => setResultat({ valeur, echec: false }))
      // Rien n'est journalisé : un échec de téléversement porte l'URL d'un média, un
      // échec de création de salon porte un identifiant (interdit n°8). L'écran le dit,
      // là où c'est utile.
      .catch(() => setResultat({ echec: true }));
  }, [preparer]);

  return resultat;
}

/**
 * L'attente d'une étape qui prépare. **Localisée, jamais plein écran** : DESIGN.md
 * refuse le spinner d'application, et celui-ci ne couvre que la place du contenu qu'il
 * remplace — la barre de progression, elle, reste lisible au-dessus.
 *
 * Un spinner et non un skeleton, contrairement aux listes : il n'y a ici aucune géométrie
 * finale à annoncer — l'écran qui vient n'a pas la forme de celui-ci —, et ce qu'il faut
 * dire n'est pas « ça arrive » mais « on est en train de le faire pour vous ».
 */
export function Preparation({ libelle }: { libelle: string }): ReactNode {
  return (
    <VStack hAlign="center" style={{ paddingBlock: "var(--spacing-12)" }}>
      <Spinner size="xl" label={libelle} />
    </VStack>
  );
}
