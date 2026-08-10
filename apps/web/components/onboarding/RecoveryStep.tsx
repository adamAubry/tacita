"use client";

import type { Session } from "@tacita/client-core";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { IconeCle } from "../foundation/icons";
import {
  Banner,
  Button,
  Card,
  Divider,
  Icon,
  Text,
  VStack,
} from "../foundation/primitives";
import { useSession } from "./SessionProvider";

/**
 * « En savoir plus » sort de l'app : c'est une explication, pas une étape. L'onglet neuf
 * est ce qui garde l'étape bloquante intacte derrière — revenir dessus par le bouton
 * « précédent » rejouerait un montage de session pour rien.
 */
const EN_SAVOIR_PLUS =
  "https://www.google.com/search?q=a+quoi+sert+une+cle+de+recuperation";

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
const groupesDe4 = (cle: string) =>
  cle.replace(/\s+/g, "").match(/.{1,4}/g) ?? [];

export interface RecoveryStepProps {
  session: Session;
  /**
   * REQ-UI-04 — le chemin « je n'ai plus ma clé » (`RecoveryUnlock`). Le même écran, mais
   * **il détruit** : la sauvegarde et l'identité existantes sont remplacées, et tout ce
   * qui était chiffré sous l'ancienne clé devient définitivement illisible.
   *
   * Un écran séparé aurait été deux versions du même propos à maintenir, dont une
   * finirait par mentir. Ce qui change ici est ce qui doit changer : ce que l'écran
   * annonce avant de le faire, et la couleur du bouton qui le fait.
   */
  reinitialiser?: boolean;
}

/**
 * REQ-UI-04 — **la ré-authentification que le serveur exige** pour remplacer une identité
 * cross-signing (voir `setupRecoveryKey`). Elle n'a lieu que sur « j'ai perdu ma clé » :
 * l'inscription, elle, dépose sa première identité sans rien demander.
 *
 * Pourquoi un écran et non une fenêtre ouverte toute seule : un `window.open` qui ne part
 * pas d'un clic est bloqué comme pop-up, et l'étape resterait figée sans que rien ne le
 * dise. Le clic est donc ici, et il est celui de la personne.
 */
function ConfirmationIdentite({
  url,
  faite,
  abandon,
}: {
  url: string;
  faite: () => void;
  abandon: () => void;
}) {
  const [bloquee, setBloquee] = useState(false);

  /*
   * Synapse termine sa page de repli par `window.opener.postMessage("authDone", "*")`
   * (template `sso_auth_success.html`, v1.155.0). C'est le seul signal de fin : l'onglet
   * se ferme parfois tout seul, et rien ne revient par l'URL de cette page-ci.
   *
   * L'origine est vérifiée avant tout : `postMessage` accepte n'importe quel émetteur, et
   * on ne franchit pas une étape de sécurité sur la parole d'une fenêtre inconnue.
   */
  useEffect(() => {
    const origine = new URL(url).origin;
    const ecouter = (evenement: MessageEvent) => {
      if (evenement.origin === origine && evenement.data === "authDone") faite();
    };
    window.addEventListener("message", ecouter);
    return () => window.removeEventListener("message", ecouter);
  }, [url, faite]);

  return (
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
            Confirmez que c&apos;est bien vous
          </Text>
          <VStack gap={4}>
            <Text style={{ textWrap: "pretty" }}>
              Remplacer votre clé donne à cet appareil le droit de lire vos futures
              conversations. Votre compte demande donc une reconnexion avant de
              l&apos;accorder.
            </Text>
            <Text style={{ textWrap: "pretty", marginBottom: "var(--spacing-4)" }}>
              Une fenêtre va s&apos;ouvrir sur votre compte. Une fois la confirmation
              donnée, revenez ici : la nouvelle clé s&apos;affichera.
            </Text>
          </VStack>
        </VStack>

        {bloquee ? (
          <Banner
            status="error"
            title="La fenêtre a été bloquée"
            description="Votre navigateur a empêché son ouverture. Autorisez les fenêtres pour ce site, puis réessayez."
          />
        ) : null}

        <VStack gap={4}>
          <Button
            label="Confirmer avec mon compte"
            variant="primary"
            onClick={() => {
              /*
               * `window.open` et non un lien : depuis 2021, `target="_blank"` implique
               * `rel="noopener"`, et la page de repli n'aurait plus de `window.opener` à
               * qui annoncer la fin. C'est l'exception exacte à la règle qu'on applique
               * partout ailleurs — ici la fenêtre ouverte est notre propre serveur.
               */
              setBloquee(window.open(url, "_blank") === null);
            }}
          />
          <VStack hAlign="center">
            <Button label="Annuler" variant="ghost" onClick={abandon} />
          </VStack>
        </VStack>
      </VStack>
    </VStack>
  );
}

export function RecoveryStep({ session, reinitialiser = false }: RecoveryStepProps) {
  const { recuperationConfirmee } = useSession();
  const [cle, setCle] = useState<string | undefined>();
  const [copie, setCopie] = useState<"aucune" | "faite" | "impossible">(
    "aucune",
  );
  const [echec, setEchec] = useState<
    "generique" | "origine" | "confirmation" | undefined
  >();
  const [enCours, setEnCours] = useState(false);
  /** La ré-authentification en cours, quand le serveur l'a demandée. */
  const [confirmation, setConfirmation] = useState<{
    url: string;
    faite: () => void;
    abandon: () => void;
  }>();
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

  /** Marqueur interne : « l'utilisateur a annulé », qui n'est pas une panne. */
  const ABANDON = "confirmation abandonnée";

  const generer = async () => {
    setEnCours(true);
    setEchec(undefined);
    try {
      const generee = await session.setupRecoveryKey({
        reinitialiser,
        confirmerIdentite: (url) =>
          new Promise<void>((resoudre, rejeter) => {
            setConfirmation({
              url,
              faite: () => {
                setConfirmation(undefined);
                resoudre();
              },
              abandon: () => {
                setConfirmation(undefined);
                rejeter(new Error(ABANDON));
              },
            });
          }),
      });
      setCle(generee.encodedPrivateKey);
    } catch (erreur) {
      /*
       * L'annulation se dit autrement qu'une panne, et **elle ne se tait pas** : à ce
       * stade la sauvegarde a déjà été remplacée côté serveur, mais l'identité, non. Tant
       * que la confirmation n'a pas eu lieu, cet appareil ne chiffre toujours pas — le
       * laisser croire l'inverse serait l'interdit n°13.
       */
      if (erreur instanceof Error && erreur.message === ABANDON) {
        setEchec("confirmation");
        return; // `finally` relâche `enCours`.
      }
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

  /*
   * La confirmation **remplace** l'écran, elle ne se pose pas dessus : l'appel est déjà
   * parti, il n'y a rien d'autre à faire ici tant qu'elle n'a pas eu lieu. Un dialogue
   * par-dessus aurait laissé un bouton « Créer une nouvelle clé » cliquable derrière.
   */
  if (confirmation) return <ConfirmationIdentite {...confirmation} />;

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
              {reinitialiser ? "Repartir d'une clé neuve" : "Votre clé de récupération"}
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
              {/*
                En réinitialisation, le premier paragraphe n'explique plus ce qu'est une
                clé — la personne le sait, elle en a eu une — mais **ce qu'elle perd**, au
                présent et sans détour. C'est le seul endroit où le dire : après le clic,
                l'ancienne sauvegarde n'existe plus.

                Une phrase sobre et non un bandeau d'alerte (DESIGN.md) : le propos de
                l'écran *est* cette conséquence, pas un avertissement posé à côté.
              */}
              <Text style={{ textWrap: "pretty" }}>
                {reinitialiser
                  ? "Vos conversations d'avant resteront chiffrées avec la clé que vous avez perdue : ni vous, ni nous ne pourrons plus les lire. Une nouvelle clé ne les rouvre pas — elle protège la suite."
                  : "Une clé de récupération est une suite de caractères tirée au hasard. Elle est créée sur cet appareil, et vous êtes seul à la connaître."}
              </Text>
              <Text style={{ textWrap: "pretty" }}>
                {reinitialiser
                  ? "Vos amis et vos conversations, eux, restent en place. Ce sont les messages déjà envoyés qui deviennent illisibles sur tous vos appareils."
                  : "Elle vous permettra de retrouver vos conversations sur un nouvel appareil. Sans elle, votre historique est définitivement perdu — personne, chez nous, ne peut le récupérer."}
              </Text>
              {/*
                Le dernier paragraphe ferme le bloc sur le même écart que celui qui
                sépare les trois : sans cette marge, le texte s'arrêtait net sur le pas
                de niveau 3, et le bloc paraissait coupé plutôt que terminé. L'écart réel
                sous la dernière ligne devient donc 16 + 32.
              */}
              <Text
                style={{ textWrap: "pretty", marginBottom: "var(--spacing-4)" }}
              >
                Vous serez responsable de la conserver. L&apos;écran suivant
                l&apos;affichera une seule fois : prévoyez dès maintenant où
                vous la rangerez.
              </Text>
            </VStack>
          </VStack>

          {echec ? (
            <Banner
              status="error"
              title={
                echec === "confirmation"
                  ? "L'étape n'est pas terminée"
                  : "La clé n'a pas pu être créée"
              }
              description={
                {
                  // Dire ce qui reste vrai, et rien de plus : la nouvelle clé n'est pas
                  // active tant que le compte n'a pas confirmé.
                  confirmation:
                    "Sans la confirmation de votre compte, votre nouvelle clé n'est pas active et cet appareil ne peut toujours pas chiffrer. Reprenez quand vous êtes prêt.",
                  origine:
                    "Cette page est ouverte sur une adresse non sécurisée : le chiffrement y est indisponible, et réessayer ne changera rien. Rouvrez l'application en https, ou sur localhost.",
                  generique: "Vérifiez votre connexion et réessayez.",
                }[echec]
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
            {/*
              `destructive` en réinitialisation : DESIGN.md réserve `danger` au destructif,
              et c'est très exactement ce qu'il est ici. Le libellé nomme l'acte plutôt que
              d'avancer — « Continuer » sur un bouton qui détruit un historique serait la
              définition d'un libellé malhonnête.
            */}
            <Button
              label={reinitialiser ? "Créer une nouvelle clé" : "Continuer"}
              variant={reinitialiser ? "destructive" : "primary"}
              isLoading={enCours}
              onClick={generer}
            />
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
    /*
      **Trois écarts, deux valeurs** (12 · 40 · 40), sur la grille de 4 pt — arbitrés au
      navigateur, là où ils se jugent.

      Serré — titre ↔ sa phrase, et carte ↔ sa phrase : dans les deux cas la ligne
      commente ce qui la précède, elle ne s'en détache pas.
      Large — le bloc de titre ↔ le bloc de la clé, **et** l'ensemble ↔ le bouton qui
      termine l'étape. Les deux partagent la même valeur : l'écran ne compte que trois
      objets, et un troisième palier entre eux ne séparerait plus rien de lisible.

      L'écran d'avant a quatre paliers distincts (16 · 20 · 32 · 48) : il porte une icône
      et trois paragraphes, donc plus de niveaux à distinguer.
    */
    <VStack gap={10}>
      <VStack gap={10}>
        <VStack gap={3}>
          {/*
            **Aucun style de composition ici, rien qu'un écart.** Le titre portait
            `text-wrap: balance`, qui égalise la longueur des lignes au lieu de remplir la
            première : sur deux lignes, ça donne un pavé étroit qu'on lit comme centré ou
            calé au milieu de la colonne, alors que rien n'est centré. Le paragraphe
            portait `pretty` pour la même famille de raisons. Les deux partent : le titre
            remplit sa ligne, comme partout ailleurs dans l'app.

            `tabIndex={-1}` uniquement pour recevoir le focus programmatique ci-dessus : le
            titre ne rejoint pas l'ordre de tabulation, il ne fait qu'accepter d'être visé.
          */}
          <Text type="display-3" as="h1" ref={titre} tabIndex={-1}>
            Notez cette clé maintenant
          </Text>
          {/*
            L'avertissement est **une phrase sobre**, pas un bandeau (DESIGN.md). Un bloc
            d'alerte ambre à côté de la clé devenait l'élément le plus voyant d'un écran
            dont le sujet est la clé — et PRODUCT.md refuse le ton alarmiste.
          */}
          <Text>
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
          {/*
            `padding={0}` sur la carte, et le pas de 16 porté par le bloc de la clé : le
            filet et la bande d'action touchent alors les bords, ce que la carte ne
            permettait pas quand c'était elle qui payait le padding. `isFullBleed` sur le
            filet devient inutile — il n'a plus de padding à rattraper.
          */}
          <Card padding={0} role="group" aria-label="Clé de récupération">
            <VStack padding={4}>
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
            </VStack>

            <Divider />

            {/*
              Le presse-papiers ne reçoit la clé que sur une action explicite (contrainte
              M-B) : beaucoup d'applications y écrivent des secrets sans le dire, et le
              presse-papiers est lisible par d'autres applications.

              `ghost` et non `secondary` : un seul bouton plein sur l'écran, et c'est
              celui qui termine l'étape. Deux aplats de poids voisins ne disaient pas
              lequel des deux était l'action principale.

              **Le bouton est toute la bande sous le filet**, pas un rectangle centré
              dedans. Un survol qui n'allume qu'une partie de la zone cliquable dit que
              le reste ne l'est pas ; ici les deux coïncident, et la carte (`overflow:
              clip`) arrondit d'elle-même les deux coins du bas.

              `--button-focus-offset` négatif : c'est ce même `clip` qui rognerait
              l'anneau de focus une fois le bouton à fleur de bord. Il se dessine donc
              vers l'intérieur — le token d'Astryx existe pour ça, rien n'est recodé.

              L'échec se dit. `navigator.clipboard` n'existe pas hors contexte sécurisé et
              certains navigateurs le refusent : sans message, le bouton semblait avoir
              marché (interdit n°13).
            */}
            <Button
              label={
                {
                  aucune: "Copier la clé",
                  faite: "Copiée",
                  impossible: "Copie impossible",
                }[copie]
              }
              variant="ghost"
              icon={<Icon icon="copy" />}
              width="100%"
              style={{ "--button-focus-offset": "-3px" } as CSSProperties}
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
          </Card>

          <Text type="supporting" style={{ textWrap: "pretty" }}>
            {copie === "impossible"
              ? "Sélectionnez la clé ci-dessus pour la copier à la main, puis rangez-la dans votre gestionnaire de mots de passe ou sur un papier."
              : "Rangez-la dans votre gestionnaire de mots de passe, ou sur un papier."}
          </Text>
        </VStack>
      </VStack>

      <Button
        label="J'ai sauvegardé ma clé"
        variant="primary"
        onClick={recuperationConfirmee}
      />
    </VStack>
  );
}
