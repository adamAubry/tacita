"use client";

import type { ReactNode } from "react";

import { Placeholder } from "../foundation/Placeholder";
import { Skeleton, VStack } from "../foundation/primitives";
import { EcranDePorte } from "./EcranDePorte";
import { Onboarding } from "./Onboarding";
import { RecoveryUnlock } from "./RecoveryUnlock";
import { useSession } from "./SessionProvider";

/**
 * REQ-UI-04 / REQ-UI-22 / REQ-UIX-06 — la porte d'entrée de toute l'app.
 *
 * **Elle remplace le contenu, elle ne redirige pas.** Un garde de route se contourne en
 * tapant une adresse ; ici, tant que la clé de récupération n'est pas confirmée — puis
 * tant que le parcours d'accueil n'est pas fini —, aucune route ne rend autre chose,
 * quelle que soit l'URL demandée. C'est ce que « ni sautée, ni différée, ni contournée
 * par URL directe » veut dire concrètement.
 *
 * Les deux blocages n'ont pas la même nature et il ne faut pas les confondre : la clé est
 * bloquante parce que **sans elle le compte ne chiffre pas** (D-08) ; le parcours l'est
 * parce qu'il se termine dans une conversation ouverte, et qu'un parcours dont on peut
 * sortir par le milieu laisse quelqu'un sur une application vide. Ses étapes, elles,
 * peuvent être facultatives — c'est le parcours qui le dit, pas cette porte.
 */
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
    /*
     * Deux chemins, pas un. `mode` vient de `recoveryState()` (spec 04) : le shard ne
     * dérive rien. La porte ne proposait que la création, et l'ouvrait donc à chaque
     * reconnexion — chaque `m.login.token` donne un `device_id` neuf, non signé, ce que
     * l'ancienne source confondait avec « ce compte n'a pas de clé ».
     *
     * `creation` **est** le premier pas du parcours d'accueil, et non un écran séparé qui
     * le précéderait : c'est le seul instant où l'on sait que le compte vient de naître
     * (voir `SessionProvider`), et l'indicateur de progression doit compter cette étape-là
     * comme les autres — sans quoi il annoncerait « étape 1 sur 3 » à quelqu'un qui vient
     * déjà d'en franchir une.
     */
    return etat.mode === "creation" ? (
      <Onboarding session={etat.session} depart={0} />
    ) : (
      <EcranDePorte>
        <RecoveryUnlock session={etat.session} />
      </EcranDePorte>
    );
  }

  /*
   * REQ-UI-22 — la clé est confirmée et l'app est joignable, mais le parcours n'est pas
   * fini : il reprend **après** l'étape bloquante, qui vient d'être franchie ou l'avait
   * été avant un rechargement. Les étapes qui suivent sont toutes idempotentes (les
   * images par défaut ne s'écrasent pas, la conversation personnelle ne se duplique pas),
   * donc reprendre au même endroit ne coûte rien et ne casse rien.
   */
  if (etat.onboarding) return <Onboarding session={etat.session} depart={1} />;

  return <>{children}</>;
}
