"use client";

import type { Session } from "@tacita/client-core";
import { profileOf, updateProfile } from "@tacita/messaging";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, type ReactNode } from "react";

import { poserIdentiteParDefaut, televerserImageProfil } from "../../lib/identite-par-defaut";
import { ecrireDemandePushFaite } from "../../lib/preferences";
import { NOM_NOTES, ouvrirNotesPersonnelles } from "../../lib/premiere-conversation";
import { routeConversation } from "../../lib/routes";
import { Banner, Button, Text, VStack } from "../foundation/primitives";
import { NotificationsPush } from "../settings/NotificationsPush";
import { FormulaireIdentite } from "../profil/FormulaireIdentite";
import { ProfileCard } from "../profil/ProfileCard";
import { Preparation, usePreparation } from "./Onboarding";
import { RecoveryStep } from "./RecoveryStep";

/**
 * **la liste des étapes du parcours d'accueil, et le seul endroit où elle
 * vit.**
 *
 * Ajouter une étape, en retirer une, en changer l'ordre : c'est le tableau du bas de ce
 * fichier, et rien d'autre. Le compteur de progression, le bouton « passer » et la fin du
 * parcours se déduisent de lui (`Onboarding`). Une étape est un objet minuscule — une
 * clé, un composant, et le fait d'être facultative ou non — parce que tout le reste
 * appartient à l'écran lui-même : son titre, son bouton principal, ce qu'il prépare.
 *
 * L'ordre suit ce que le parcours doit produire, pas ce qui est le plus facile à
 * demander :
 *
 * 1. **la clé** — bloquante, non négociable : sans elle le compte ne chiffre pas (D-08),
 *    donc rien de ce qui suit n'aurait de sens ;
 * 2. **l'identité** — le premier moment où l'on voit quelque chose de soi ;
 * 3. **les notifications** — la question se pose une fois qu'il y a quelque chose à
 *    manquer, et pas au premier écran d'une application qu'on n'a pas encore ouverte ;
 * 4. **la première conversation** — la fin du parcours *est* l'entrée dans le produit :
 *    on n'y explique pas ce que fait l'application, on la fait ouvrir.
 */
interface ContenuEtapeProps {
  session: Session;
  /** Passe à l'étape suivante — ou termine le parcours, à la dernière. */
  avancer: () => void;
}

export interface EtapeOnboarding {
  /** Identifie l'étape dans le code et remonte l'arbre React. Jamais affichée. */
  cle: string;
  /**
   * L'étape n'oblige à rien : le parcours affiche alors une sortie sous le contenu. Une
   * étape obligatoire n'en affiche pas — un bouton grisé serait une promesse non tenue.
   */
  optionnelle?: boolean;
  /** Le libellé de cette sortie. « Passer » quand on renonce, autre chose sinon. */
  libellePasser?: string;
  Contenu: (props: ContenuEtapeProps) => ReactNode;
}

/**
 * Étape 2 — **l'identité, dessinée pendant que l'écran se monte.**
 *
 * C'est le seul endroit du produit où la photo et la bannière par défaut se fabriquent
 * Elles l'étaient auparavant en arrière-plan, à la confirmation de la clé :
 * personne ne les voyait apparaître, et un échec réseau laissait un compte sur ses
 * initiales sans que rien ne le dise. Ici, l'écran attend le résultat et le montre — le
 * geste a un avant et un après.
 *
 * Le dessin est déterministe (DiceBear, sur l'identifiant Matrix) et local : rien n'est
 * demandé à personne, et la même personne obtiendrait la même image sur un autre
 * appareil. `poserImagesParDefaut` n'écrase jamais ce qui existe, donc rejouer cette
 * étape après un rechargement ne coûte que la relecture du profil.
 */
function EtapeIdentite({ session, avancer }: ContenuEtapeProps) {
  const preparer = useCallback(async () => {
    // Un échec de téléversement ne bloque pas l'étape : le compte garde ses initiales, et
    // le formulaire juste dessous permet de choisir une image soi-même. Rien n'est
    // journalisé — un échec porte l'URL d'un média (interdit n°8).
    await poserIdentiteParDefaut(session).catch(() => {});
    return profileOf(session, session.client.getUserId() ?? "");
  }, [session]);

  const { valeur: profil } = usePreparation(preparer);

  if (!profil) return <Preparation libelle="Création de votre identité…" />;

  return (
    <VStack gap={5}>
      <VStack gap={4}>
        <Text type="display-3" as="h1" style={{ textWrap: "balance" }}>
          Voici votre identité
        </Text>
        <Text style={{ textWrap: "pretty" }}>
          Cette photo et cette bannière ont été dessinées sur cet appareil à partir de
          votre identifiant. Rien n&apos;a été demandé à personne, et elles seront les
          mêmes partout où vous vous connecterez.
        </Text>
      </VStack>

      {/* La carte de profil réelle, celle que l'app affichera ensuite — et non un aperçu
          qui lui ressemblerait. Sans bouton de retour : il n'y a rien derrière cet écran. */}
      <ProfileCard
        nom={profil.displayName}
        userId={profil.userId}
        avatarUrl={profil.avatarUrl}
        bannerUrl={profil.bannerUrl}
        retour={false}
      />

      {/* Le même formulaire que « Modifier le profil » (M-G). ponytail: la carte
          ci-dessus ne se met pas à jour pendant qu'on choisit une image — le bouton dit
          « Photo de profil choisie », ce qui suffit à savoir où on en est. Brancher un
          aperçu vivant le jour où quelqu'un se plaint de ne pas voir son choix. */}
      <FormulaireIdentite
        profil={profil}
        onPhoto={(fichier) => televerserImageProfil(session, fichier)}
        libelleValider="Continuer"
        onEnregistrer={async (changements) => {
          if (Object.keys(changements).length > 0) await updateProfile(session, changements);
          avancer();
        }}
      />
    </VStack>
  );
}

/**
 * Étape 3 — **les notifications, avec l'écran qui les règle et le dit honnêtement.**
 *
 * C'est le composant des réglages (M-H) qui est rendu ici, pas une copie : il connaît les
 * six états de la chaîne push, il nomme le maillon qui manque, et il sait déjà quoi dire
 * sur un iPhone hors écran d'accueil, où aucun abonnement n'est possible.
 * Un écran d'accueil qui redemanderait tout ça en plus simple aurait fini par mentir.
 *
 * La marque « la question a été posée » est posée **à l'affichage**, comme ailleurs
 * une proposition montrée est une question posée, quelle qu'en soit la
 * suite. Sans elle, la même question reviendrait au premier message reçu — la voie qui
 * reste pour les appareils qui n'ont pas fait ce parcours.
 */
function EtapeNotifications() {
  useEffect(() => {
    if (globalThis.indexedDB) void ecrireDemandePushFaite(globalThis.indexedDB).catch(() => {});
  }, []);

  return (
    <VStack gap={5}>
      <VStack gap={4}>
        <Text type="display-3" as="h1" style={{ textWrap: "balance" }}>
          Ne ratez pas un message
        </Text>
        <Text style={{ textWrap: "pretty" }}>
          Votre appareil peut vous prévenir à l&apos;arrivée d&apos;un message, même
          application fermée. Le serveur n&apos;envoie que de quoi la réveiller : le
          contenu est déchiffré ici.
        </Text>
      </VStack>

      <NotificationsPush />
    </VStack>
  );
}

/**
 * Étape 4 — **la fin du parcours est une conversation ouverte.**
 *
 * Un compte neuf n'a personne à qui écrire, et c'est le seul vrai obstacle du premier
 * jour : tout ce que l'application sait faire reste invisible tant qu'il n'y a pas un
 * salon. Cette étape en ouvre un — le sien — puis y emmène. Ce qui se passe
 * ensuite n'est plus un écran d'accueil : c'est le produit.
 *
 * Le salon est créé **pendant** que l'explication se lit, pas au clic : ce sont deux ou
 * trois allers-retours réseau, et les faire attendre derrière un bouton aurait rendu le
 * dernier geste du parcours le plus lent de tous.
 */
function EtapePremiereConversation({ session, avancer }: ContenuEtapeProps) {
  const router = useRouter();
  const preparer = useCallback(() => ouvrirNotesPersonnelles(session), [session]);
  const { valeur: roomId, echec } = usePreparation(preparer);

  if (echec) {
    return (
      <VStack gap={5}>
        {/* Interdit n°13 : un bouton « ouvrir » sans salon à ouvrir ne serait pas une
            imprécision, ce serait un bouton mort. On dit ce qui a échoué, et on laisse
            entrer — l'accueil sait proposer de démarrer une conversation. */}
        <Banner
          status="error"
          title="La conversation n'a pas pu être créée"
          description="Votre connexion n'a pas répondu. Vous pourrez la créer depuis l'accueil, avec le bouton « Nouvelle conversation »."
        />
        <Button label="Entrer dans l'application" variant="primary" onClick={avancer} />
      </VStack>
    );
  }

  if (!roomId) return <Preparation libelle="Préparation de votre conversation…" />;

  return (
    <VStack gap={5}>
      <VStack gap={4}>
        <Text type="display-3" as="h1" style={{ textWrap: "balance" }}>
          Écrivez votre premier message
        </Text>
        <Text style={{ textWrap: "pretty" }}>
          « {NOM_NOTES} » est une conversation avec vous-même : un endroit pour un lien,
          une adresse, une idée qu&apos;on ne veut pas perdre. Elle est chiffrée comme
          toutes les autres, et vous êtes seul dedans.
        </Text>
        <Text style={{ textWrap: "pretty" }}>
          C&apos;est aussi le plus court chemin pour essayer : écrivez un mot, il
          s&apos;affichera aussitôt. Vous inviterez du monde quand vous voudrez, depuis
          l&apos;accueil.
        </Text>
      </VStack>

      <Button
        label="Ouvrir et écrire"
        variant="primary"
        onClick={() => {
          // Le parcours se termine **avant** la navigation : sinon la porte rendrait
          // encore le parcours à l'arrivée sur la conversation, et l'écran ne changerait
          // pas.
          avancer();
          router.push(routeConversation(roomId));
        }}
      />
    </VStack>
  );
}

export const ETAPES: EtapeOnboarding[] = [
  {
    // bloquante, et donc sans sortie. Elle termine en ouvrant la porte
    // (`recuperationConfirmee`), ce qui remonte ce composant au rang suivant.
    cle: "cle-de-recuperation",
    Contenu: ({ session }) => <RecoveryStep session={session} />,
  },
  { cle: "identite", optionnelle: true, Contenu: EtapeIdentite },
  {
    cle: "notifications",
    optionnelle: true,
    // « Passer » serait faux pour quelqu'un qui vient d'activer : l'étape est facultative,
    // mais ce bouton est surtout celui qui la termine dans les deux cas.
    libellePasser: "Continuer",
    Contenu: EtapeNotifications,
  },
  { cle: "premiere-conversation", Contenu: EtapePremiereConversation },
];
