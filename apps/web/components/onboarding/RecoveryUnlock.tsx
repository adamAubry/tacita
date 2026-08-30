"use client";

import type { Session } from "@tacita/client-core";
import { useState } from "react";

import { IconeCle } from "../foundation/icons";
import { Banner, Button, Text, TextInput, VStack } from "../foundation/primitives";
import { RecoveryStep } from "./RecoveryStep";
import { useSession } from "./SessionProvider";

/**
 * **la deuxième connexion.** L'autre moitié de la porte, celle qui manquait.
 *
 * Chaque connexion OIDC donne un `device_id` neuf : l'appareil n'est pas signé par
 * l'identité de son propriétaire, et D-08 le laisse alors muet *et* sourd — il n'enverra
 * rien et ne déchiffrera rien. Ce n'est donc pas un écran de confort qu'on pourrait
 * différer, exactement comme celui de la création.
 *
 * Ce qu'il ne fait pas : proposer de créer une clé. C'était le défaut — l'écran de
 * création s'ouvrait devant quelqu'un qui avait la sienne depuis des mois, et le seul
 * bouton disponible aurait écrasé sa sauvegarde. Créer reste atteignable, mais derrière un
 * geste qui dit son nom.
 *
 * Le cadre de page (largeur de mesure, marges, safe-areas) appartient à `RecoveryGate`.
 */
export function RecoveryUnlock({ session }: { session: Session }) {
  const { recuperationConfirmee } = useSession();
  const [cle, setCle] = useState("");
  const [echec, setEchec] = useState<"clef" | "generique" | undefined>();
  const [enCours, setEnCours] = useState(false);
  const [perdue, setPerdue] = useState(false);

  /*
   * « Je n'ai plus ma clé » ne fait pas un écran de plus : il bascule sur l'écran de
   * création, en mode réinitialisation. Celui-ci dit déjà ce qu'une clé engage et affiche
   * la nouvelle une seule fois — le redire ici en aurait fait deux versions à maintenir,
   * dont une finirait par mentir.
   */
  if (perdue) return <RecoveryStep session={session} reinitialiser />;

  const deverrouiller = async () => {
    setEnCours(true);
    setEchec(undefined);
    try {
      await session.unlockRecovery(cle);
      recuperationConfirmee();
    } catch (erreur) {
      /*
       * Deux cas seulement, et la différence compte : une clé refusée se corrige en la
       * retapant, une panne ne se corrige pas comme ça. Le message du SDK n'est jamais
       * affiché — il peut porter du matériel de clé (interdit n°8).
       */
      const refus = erreur instanceof Error && /incorrecte|parity|prefix|length|base|Non-base/i.test(erreur.message);
      setEchec(refus ? "clef" : "generique");
    } finally {
      setEnCours(false);
    }
  };

  return (
    /* Les quatre pas de l'écran de création (16 · 20 · 32 · 48), pour la même raison :
       une icône à détacher, un titre, des paragraphes d'un seul propos, une zone
       d'action. Deux écrans du même parcours qui respireraient différemment se liraient
       comme deux applications. */
    <VStack style={{ gap: "var(--spacing-12)" }}>
      <VStack hAlign="center">
        <div
          aria-hidden
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 88,
            height: 88,
            borderRadius: "var(--radius-full)",
            backgroundColor: "var(--color-accent-muted)",
            color: "var(--color-accent)",
          }}
        >
          {IconeCle}
        </div>
      </VStack>

      <VStack gap={8}>
        <VStack gap={5}>
          <Text type="display-3" as="h1" style={{ textWrap: "balance" }}>
            Entrez votre clé de récupération
          </Text>
          {/*
            Deux paragraphes : pourquoi on la demande *maintenant*, puis où la chercher.
            Le premier répond à la question qu'on se pose devant un écran qu'on n'a pas
            demandé — « je viens de me connecter, qu'est-ce qu'il me veut ? ». Sans lui,
            la demande passe pour une défiance.

            Rien sur ce que la clé « protège » : c'est l'écran de création qui l'explique,
            et le répéter à quelqu'un qui l'a déjà lu une fois serait une leçon.
          */}
          <VStack gap={4}>
            <Text style={{ textWrap: "pretty" }}>
              Cet appareil est nouveau pour votre compte. Votre clé lui donne accès à vos
              conversations : sans elle, il ne peut ni les lire, ni en envoyer.
            </Text>
            <Text style={{ textWrap: "pretty", marginBottom: "var(--spacing-4)" }}>
              Elle vous a été affichée une seule fois, à votre première connexion — dans
              votre gestionnaire de mots de passe, ou là où vous l&apos;avez rangée.
            </Text>
          </VStack>
        </VStack>

        {echec === "generique" ? (
          <Banner
            status="error"
            title="Le déverrouillage n'a pas abouti"
            description="Votre clé n'est pas en cause. Vérifiez votre connexion et réessayez."
          />
        ) : null}

        <VStack gap={4}>
          {/*
            Les trois garde-fous de clavier **portés par le parent**, pas par le champ :
            `autocapitalize`, `autocorrect` et `spellcheck` s'héritent en HTML, et les
            props d'Astryx les omettent délibérément de `BaseProps`. On ne recode pas une
            primitive parce qu'il lui manque une prop — surtout quand
            la plateforme donne le même résultat d'un cran plus haut.

            Ils ne sont pas cosmétiques : une clé est du base58, sensible à la casse. Une
            majuscule ajoutée par un clavier mobile, ou un mot « corrigé », la rend fausse
            sans que personne ne voie ce qui a changé.
          */}
          <div autoCapitalize="none" autoCorrect="off" spellCheck={false}>
            <TextInput
              label="Clé de récupération"
              value={cle}
              onChange={(valeur) => {
                setCle(valeur);
                // Le message de refus part dès la première correction : le laisser sous
                // un champ qu'on vient de modifier le fait accuser la nouvelle saisie.
                setEchec(undefined);
              }}
              onEnter={() => void deverrouiller()}
              placeholder="EsTb ABCD EFGH …"
              hasAutoFocus
              hasClear
              width="100%"
              status={
                echec === "clef"
                  ? {
                      type: "error",
                      message: "Cette clé ne correspond pas à ce compte. Vérifiez la recopie.",
                    }
                  : undefined
              }
            />
          </div>

          <Button
            label="Déverrouiller"
            variant="primary"
            isLoading={enCours}
            isDisabled={cle.trim() === ""}
            onClick={() => void deverrouiller()}
          />

          {/*
            La sortie destructive est en `ghost`, sous l'action attendue, et elle nomme la
            situation plutôt que l'acte : « Je n'ai plus ma clé » est ce que la personne
            sait d'elle-même à cet instant. Ce qu'elle déclenche — une nouvelle clé, et
            l'historique d'avant définitivement illisible — est dit sur l'écran suivant,
            avant que quoi que ce soit ne soit détruit.
          */}
          <VStack hAlign="center">
            <Button
              label="Je n'ai plus ma clé"
              variant="ghost"
              onClick={() => setPerdue(true)}
            />
          </VStack>
        </VStack>
      </VStack>
    </VStack>
  );
}
