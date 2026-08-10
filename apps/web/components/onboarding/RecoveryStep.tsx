"use client";

import type { Session } from "@tacita/client-core";
import { useEffect, useRef, useState } from "react";

import { IconeCle } from "../foundation/icons";
import { Banner, Button, Card, Divider, Icon, Text, VStack } from "../foundation/primitives";
import { useSession } from "./SessionProvider";

/**
 * « En savoir plus » sort de l'app : c'est une explication, pas une étape. L'onglet neuf
 * est ce qui garde l'étape bloquante intacte derrière — revenir dessus par le bouton
 * « précédent » rejouerait un montage de session pour rien.
 */
const EN_SAVOIR_PLUS = "https://www.google.com/search?q=a+quoi+sert+une+cle+de+recuperation";

/**
 * REQ-UI-04 — **l'étape bloquante.** Elle n'est ni sautable, ni différable, et il n'y a
 * pas d'URL qui la contourne : ce n'est pas une route, c'est ce que le shell rend tant
 * que `recoveryRequired()` est vrai (voir `RecoveryGate`). Un garde de route se contourne
 * en tapant une adresse ; un écran qui remplace l'app, non.
 *
 * Pourquoi elle bloque, en une phrase que l'UI doit tenir : **sans clé de récupération,
 * le compte ne peut pas chiffrer du tout** (D-08). Ce n'est pas une précaution pour plus
 * tard, c'est ce qui rend l'envoi possible.
 *
 * Le cadre de page (largeur de mesure, marges, safe-areas) appartient à `RecoveryGate` :
 * cet écran n'est pas le seul que la porte rende à la place de l'app.
 */

/**
 * La clé, telle qu'on la donne **à lire et à recopier** : des groupes de quatre posés sur
 * une grille exacte.
 *
 * Ce n'est pas de la décoration. Une chaîne de 48 caractères rendue en paragraphe se
 * transcrit à la main en perdant sa place ; une grille donne des repères de position, et
 * c'est ce que font toutes les applications qui affichent un secret à recopier. Le
 * regroupement est recalculé plutôt que repris tel quel du SDK : `encodeRecoveryKey`
 * espace déjà par quatre, mais rien dans le contrat de `Session` ne le promet, et un
 * format non espacé rendrait un bloc illisible sans que personne ne le voie venir.
 *
 * La copie, elle, part de la clé d'origine — jamais de ce découpage d'affichage.
 */
const groupesDe4 = (cle: string) => cle.replace(/\s+/g, "").match(/.{1,4}/g) ?? [];

export function RecoveryStep({ session }: { session: Session }) {
  const { recuperationConfirmee } = useSession();
  const [cle, setCle] = useState<string | undefined>();
  const [copie, setCopie] = useState<"aucune" | "faite" | "impossible">("aucune");
  const [echec, setEchec] = useState<"generique" | "origine" | undefined>();
  const [enCours, setEnCours] = useState(false);
  const titre = useRef<HTMLElement>(null);

  /*
   * L'écran change **entièrement** sous le doigt qui vient d'appuyer : le bouton d'où
   * part l'action n'existe plus après elle. Sans ce déplacement du focus, un lecteur
   * d'écran reste sur un élément disparu et n'annonce jamais la clé — la seule chose que
   * cet écran ait à dire, et la seule qu'on n'affichera pas deux fois.
   */
  useEffect(() => {
    if (cle) titre.current?.focus();
  }, [cle]);

  /*
   * La confirmation de copie est **transitoire**. Un libellé « Copiée » définitif ne dit
   * plus rien à la deuxième copie : on ne saurait pas si elle a eu lieu.
   */
  useEffect(() => {
    if (copie !== "faite") return;
    const minuteur = setTimeout(() => setCopie("aucune"), 3000);
    return () => clearTimeout(minuteur);
  }, [copie]);

  const generer = async () => {
    setEnCours(true);
    setEchec(undefined);
    try {
      const generee = await session.setupRecoveryKey();
      setCle(generee.encodedPrivateKey);
    } catch {
      // Aucun détail affiché ni journalisé : le message d'erreur du SDK peut porter du
      // matériel de clé. La seule chose qu'on ait le droit de lire, c'est l'origine de la
      // page : hors *secure context* (`https://` ou `localhost`), `crypto.subtle` n'existe
      // pas et le secret storage ne peut pas être chiffré — l'échec est alors certain, et
      // « réessayez » serait un mensonge. Lu après coup, jamais avant : le serveur rend la
      // même page pour toutes les origines.
      setEchec(globalThis.isSecureContext === false ? "origine" : "generique");
    } finally {
      setEnCours(false);
    }
  };

  if (!cle) {
    return (
      /*
        **Quatre pas d'espacement, et un seul niveau par pas** (16 · 20 · 32 · 48) :
        entre paragraphes et entre les deux boutons, puis titre → paragraphes, puis
        texte → boutons, puis icône → tout le reste. Chaque écart dit à quel point les
        deux blocs qu'il sépare appartiennent au même propos ; deux écarts égaux à des
        niveaux différents, et la page redevient une liste.

        L'écran porte **ses quatre pas lui-même**, dans un seul arbre, plutôt que
        d'emprunter le `gap` de `RecoveryGate` pour son troisième niveau : la porte rend
        d'autres écrans, et sa valeur bougerait un jour sans que celui-ci soit relu.
        Elle ne voit donc plus qu'un enfant.

        Tous sur la grille de 4 pt (DESIGN.md) — pas 4, 5 et 8 d'Astryx. Le quatrième
        passe par le token et non par la prop : `gap` s'arrête au pas 10 (40 px), et
        `--spacing-12` est le pas suivant de la **même** échelle. Une valeur en dur
        aurait été un écart à DESIGN.md ; le token n'en est pas un.
      */
      <VStack style={{ gap: "var(--spacing-12)" }}>
        {/*
          L'icône **avant** le titre : sur un écran qui arrive sans prévenir et bloque
          tout, elle dit de quoi il s'agit avant qu'une ligne soit lue. Disque
          `accent-soft` et trait `accent` — pas d'aplat plein : DESIGN.md garde l'accent
          sous 5 % de l'écran, et un aplat de 72 px le ferait à lui seul.

          Elle est seule à son niveau : le plus grand écart de l'écran la détache du
          bloc qu'on lit, ce qui est exactement son rôle — on la voit, on ne la lit pas.
        */}
        <VStack hAlign="center">
          <div
            aria-hidden
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              // Le disque grandit avec la clé : c'est l'anneau autour d'elle qui doit
              // rester constant, pas le disque. Un glyphe agrandi dans un disque figé
              // l'aurait fait toucher les bords.
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
              Votre clé de récupération
            </Text>
            {/*
              **Trois paragraphes, dans cet ordre : quoi, pourquoi, ce que ça vous
              demande.** L'objet d'abord — le titre le nomme sans le définir, et on ne
              peut pas peser un bénéfice avant de savoir de quoi il parle. Le bénéfice
              ensuite. La charge en dernier : commencer par la responsabilité, sur un
              écran qu'on n'a pas demandé et qui bloque tout, se lit comme une mise en
              garde — PRODUCT.md refuse le ton alarmiste et la leçon de sécurité.

              L'écart entre eux (16) est le plus petit de l'écran, et celui du titre au
              premier paragraphe (20) vient juste au-dessus : les trois paragraphes sont
              un seul propos, le titre en est le palier.

              Aucun nombre de caractères annoncé, contrairement à l'écran d'Apple qui
              promet « 28 » : la longueur vient de `encodeRecoveryKey`, rien dans le
              contrat de `Session` ne la fixe, et une promesse qu'on ne tient pas est ce
              que l'interdit n°13 refuse.

              La prose reste alignée à gauche sous une icône centrée : des lignes
              centrées se relisent en cherchant chaque début de ligne.
            */}
            <VStack gap={4}>
              <Text style={{ textWrap: "pretty" }}>
                Une clé de récupération est une suite de caractères tirée au hasard. Elle est créée
                sur cet appareil, et vous êtes seul à la connaître.
              </Text>
              <Text style={{ textWrap: "pretty" }}>
                Elle vous permettra de retrouver vos conversations sur un nouvel appareil. Sans
                elle, votre historique est définitivement perdu — personne, chez nous, ne peut le
                récupérer.
              </Text>
              {/*
                Le dernier paragraphe ferme le bloc sur le même écart que celui qui
                sépare les trois : sans cette marge, le texte s'arrêtait net sur le pas
                de niveau 3, et le bloc paraissait coupé plutôt que terminé. L'écart réel
                sous la dernière ligne devient donc 16 + 32.
              */}
              <Text style={{ textWrap: "pretty", marginBottom: "var(--spacing-4)" }}>
                Vous serez responsable de la conserver. L&apos;écran suivant l&apos;affichera une
                seule fois : prévoyez dès maintenant où vous la rangerez.
              </Text>
            </VStack>
          </VStack>

          {echec ? (
            <Banner
              status="error"
              title="La clé n'a pas pu être créée"
              description={
                echec === "origine"
                  ? "Cette page est ouverte sur une adresse non sécurisée : le chiffrement y est indisponible, et réessayer ne changera rien. Rouvrez l'application en https, ou sur localhost."
                  : "Vérifiez votre connexion et réessayez."
              }
            />
          ) : null}

          {/*
            « Continuer » et non « Créer ma clé » : l'étape n'est pas sautable, il n'y a
            donc rien à choisir — le seul bouton avance, et le nommer par ce qu'il
            fabrique laissait croire à une option qu'on pouvait refuser.

            « En savoir plus » est **sous** le bouton et en `ghost` : c'est une sortie de
            l'écran, jamais l'action attendue. Un seul aplat plein sur la vue, comme sur
            l'écran suivant.

            Les deux boutons au plus petit écart, le même qu'entre les paragraphes : ils
            sont une seule zone d'action, et l'écart qui compte est celui qui les sépare
            du texte, pas celui qui les sépare l'un de l'autre.
          */}
          <VStack gap={4}>
            <Button label="Continuer" variant="primary" isLoading={enCours} onClick={generer} />
            <VStack hAlign="center">
              <Button
                label="En savoir plus"
                variant="ghost"
                icon={<Icon icon="info" />}
                href={EN_SAVOIR_PLUS}
                target="_blank"
                // `noopener` d'abord pour ce qu'il empêche : sans lui, la page ouverte
                // garde une poignée sur celle-ci via `window.opener`.
                rel="noopener noreferrer"
                style={{ color: "var(--color-accent)" }}
              />
            </VStack>
          </VStack>
        </VStack>
      </VStack>
    );
  }

  return (
    <>
      <VStack gap={3}>
        {/*
          `tabIndex={-1}` uniquement pour recevoir le focus programmatique ci-dessus : le
          titre ne rejoint pas l'ordre de tabulation, il ne fait qu'accepter d'être visé.
        */}
        <Text type="display-3" as="h1" ref={titre} tabIndex={-1} style={{ textWrap: "balance" }}>
          Notez cette clé maintenant
        </Text>
        {/*
          L'avertissement est **une phrase sobre**, pas un bandeau (DESIGN.md). Un bloc
          d'alerte ambre à côté de la clé devenait l'élément le plus voyant d'un écran
          dont le sujet est la clé — et PRODUCT.md refuse le ton alarmiste.
        */}
        <Text style={{ textWrap: "pretty" }}>
          Elle ne sera plus affichée : nous n&apos;en gardons aucune copie.
        </Text>
      </VStack>

      {/*
        La clé et son bouton de copie dans un seul objet : l'action appartient à ce
        qu'elle copie. C'est aussi ce qui remet la hiérarchie d'aplomb — auparavant
        « Copier » et « J'ai sauvegardé » étaient deux boutons pleine largeur de poids
        identique, et rien ne disait lequel terminait l'étape.
      */}
      <VStack gap={3}>
        <Card padding={4} role="group" aria-label="Clé de récupération">
          <VStack gap={4}>
            <div
              data-testid="cle-de-recuperation"
              style={{
                /*
                 * Enroulement plutôt que colonnes figées : les groupes font tous la même
                 * largeur (mono, quatre signes), donc ils s'alignent en colonnes de toute
                 * façon, et le nombre de colonnes suit la place. Quatre colonnes figées
                 * débordaient de la carte sur un écran de 320 px.
                 *
                 * La largeur est plafonnée à **quatre groupes** : au-delà, la clé s'étale
                 * en deux longues lignes qu'on relit sans savoir où on en est. `ch` exige
                 * que le conteneur porte les mêmes métriques que les groupes — d'où la
                 * police et le corps répétés ici, sur la seule ligne qui les mesure.
                 */
                display: "flex",
                flexWrap: "wrap",
                columnGap: "var(--spacing-4)",
                rowGap: "var(--spacing-2)",
                justifyContent: "center",
                fontFamily: "var(--font-family-code)",
                fontSize: "var(--font-size-xl)",
                // Quatre fois « un groupe et sa gouttière » : le compte tombe juste pour
                // quatre groupes, et la gouttière en trop est ce qui empêche un arrondi
                // sous-pixel de renvoyer le quatrième à la ligne. Cinq n'entrent jamais.
                maxWidth: "calc(4 * (4ch + var(--spacing-4)))",
                marginInline: "auto",
                // Un clic long ou un triple-clic prend la clé entière : le seul recours
                // quand le presse-papiers est refusé par le navigateur.
                userSelect: "all",
              }}
            >
              {groupesDe4(cle).map((groupe, rang) => (
                <Text key={`${rang}-${groupe}`} type="code" size="xl">
                  {groupe}
                </Text>
              ))}
            </div>
            <Divider isFullBleed />
            <VStack hAlign="center">
              {/*
                Le presse-papiers ne reçoit la clé que sur une action explicite (contrainte
                M-B) : beaucoup d'applications y écrivent des secrets sans le dire, et le
                presse-papiers est lisible par d'autres applications.

                `ghost` et non `secondary` : un seul bouton plein sur l'écran, et c'est
                celui qui termine l'étape. Deux aplats de poids voisins ne disaient pas
                lequel des deux était l'action principale.

                L'échec se dit. `navigator.clipboard` n'existe pas hors contexte sécurisé et
                certains navigateurs le refusent : sans message, le bouton semblait avoir
                marché (interdit n°13).
              */}
              <Button
                label={
                  { aucune: "Copier la clé", faite: "Copiée", impossible: "Copie impossible" }[copie]
                }
                variant="ghost"
                onClick={() => {
                  void (async () => {
                    try {
                      await navigator.clipboard.writeText(cle);
                      setCopie("faite");
                    } catch {
                      setCopie("impossible");
                    }
                  })();
                }}
              />
            </VStack>
          </VStack>
        </Card>

        <Text type="supporting" style={{ textWrap: "pretty" }}>
          {copie === "impossible"
            ? "Sélectionnez la clé ci-dessus pour la copier à la main, puis rangez-la dans votre gestionnaire de mots de passe ou sur un papier."
            : "Rangez-la dans votre gestionnaire de mots de passe, ou sur un papier."}
        </Text>
      </VStack>

      <Button label="J'ai sauvegardé ma clé" variant="primary" onClick={recuperationConfirmee} />
    </>
  );
}
