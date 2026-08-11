"use client";

import type { MentionCandidate } from "@tacita/messaging";
import { useMemo, useState, type ReactNode } from "react";

import { IconeEnvoyer } from "../foundation/icons";
import { Button, ChatComposerInput, Text, createStaticSource } from "../foundation/primitives";

/**
 * Ce que le composer est en train de faire à un message existant : répondre (REQ-UI-08)
 * ou modifier (REQ-UI-07). **Un seul bandeau pour les deux** — ce sont deux fois la même
 * chose du point de vue de l'écran : un message cité, un moyen d'annuler.
 */
export interface ContexteComposer {
  libelle: string;
  extrait: string;
  onAnnuler: () => void;
}

export interface ComposerProps {
  /** REQ-UI-12 — membres du salon + `@everyone`, tels que le paquet les fournit. */
  mentions: MentionCandidate[];
  contexte?: ContexteComposer;
  /** Texte de départ — le corps du message quand on le modifie. */
  texteInitial?: string;
  onEnvoyer: (texte: string) => void;
  /** REQ-UI-11 — une frappe, pas une émission : le throttling vit dans le paquet. */
  onFrappe: () => void;
  /** REQ-UI-11 — qui écrit en face, déjà filtré par le paquet. */
  ecrivent?: string[];
  /** REQ-UI-14 — les pièces jointes, **à gauche du champ**. Fourni par M-E. */
  actions?: ReactNode;
  /** REQ-UI-15 — la capture photo, entre le champ et l'envoi. Fournie par M-E. */
  actionsEnvoi?: ReactNode;
}

/**
 * REQ-UIX-15 — Conversation input (composant 9).
 *
 * **Une seule rangée** — `[+] [champ] [photo] [envoyer]` —, parce que c'est la forme
 * qu'ont WhatsApp, Discord, iMessage et Telegram, et qu'elle n'est pas un goût : dans une
 * messagerie on écrit dix fois plus souvent qu'on ne joint, donc le champ prend toute la
 * largeur restante et les gestes rares se réduisent à des cibles carrées à ses deux bouts.
 * Le champ grandit vers le haut jusqu'à `maxRows` puis défile, et les boutons restent
 * alignés sur sa dernière ligne (`flex-end`) — sinon ils flottent au milieu d'un pavé.
 *
 * **Pourquoi pas `ChatComposer`** (escalade E-16, `specs/ui/ESCALATIONS.md`) : son corps
 * est une colonne `[en-tête] [champ] [rangée d'actions]`, et la rangée d'actions est
 * rendue **inconditionnellement**, bouton d'envoi compris. C'est la forme d'un composer
 * d'assistant — ChatGPT, Claude —, pas celle d'une messagerie, et aucun de ses props ne
 * la met sur une ligne : `density` ne change que le rembourrage, `xstyle` n'atteint que
 * le corps. Y ranger nos icônes les mettait sur une **seconde ligne sous le champ**.
 *
 * Ce qui reste d'Astryx est ce qui est difficile, et rien n'est recodé : `ChatComposerInput`
 * porte les mentions, Entrée-pour-envoyer, la garde de composition IME, le collage et les
 * jetons. Il lit le contexte du shell en **optionnel** et expose un prop pour chacune de
 * ses valeurs — hors du shell, il fonctionne pleinement. Ce qu'on écrit à sa place, c'est
 * une rangée flex et le prédicat `canSend` : quelques lignes, contre un composant dont la
 * forme est celle d'un autre produit.
 *
 * ponytail: pas de bouton vocal. Il dépend d'un enregistreur que M-E ne livre pas, et un
 * micro inerte serait une fonction affichée qui ne marche pas (interdit n°13). Sa place
 * est prête, entre la capture et l'envoi.
 */
export function Composer({
  mentions,
  contexte,
  texteInitial = "",
  onEnvoyer,
  onFrappe,
  ecrivent = [],
  actions,
  actionsEnvoi,
}: ComposerProps) {
  const [texte, setTexte] = useState(texteInitial);
  const source = useMemo(() => createStaticSource(mentions), [mentions]);

  const envoyer = (valeur: string) => {
    const message = valeur.trim();
    if (message === "") return;
    onEnvoyer(message);
    setTexte("");
  };

  return (
    // La barre est au bas de la fenêtre, donc au-dessus de la barre de gestes en PWA
    // installée : sans ce dégagement, le bouton d'envoi tombe dessous et devient
    // inatteignable — même réserve que la navbar des onglets.
    <div
      style={{
        display: "grid",
        gap: "var(--spacing-1)",
        padding: "var(--spacing-2)",
        paddingBottom: "calc(var(--spacing-2) + env(safe-area-inset-bottom, 0px))",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      {/* REQ-UI-11 — l'indicateur est au-dessus du composer, là où l'œil revient entre
          deux phrases. Les identifiants ne sont pas jolis, mais ils sont exacts : le nom
          d'affichage se résout dans la timeline, pas ici. */}
      {ecrivent.length > 0 && (
        <Text type="supporting" color="secondary">
          {ecrivent.length === 1
            ? `${ecrivent[0]} est en train d'écrire…`
            : `${ecrivent.length} personnes sont en train d'écrire…`}
        </Text>
      )}

      {/* Le message cité occupe sa propre ligne **au-dessus** de la rangée, comme dans
          toutes les messageries : c'est un bloc de texte, il n'a pas la même largeur
          qu'une icône et ne peut pas partager la ligne du champ sans l'écraser. */}
      {contexte && (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-2)" }}>
          <Text type="supporting" color="secondary" maxLines={1}>
            {contexte.libelle} : {contexte.extrait}
          </Text>
          <Button label="Annuler" variant="ghost" onClick={contexte.onAnnuler} />
        </div>
      )}

      {/* `flex-end` et non `center` : quand le champ grandit sur plusieurs lignes, les
          quatre boutons restent au niveau de la ligne qu'on est en train d'écrire. */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--spacing-1)" }}>
        {actions}

        {/* DESIGN.md e1 — le champ est la seule surface de la rangée : `surface` + filet,
            au rayon `--radius-chat`, qui existe pour lui. Les boutons sont nus autour,
            comme sur Discord : trois cadres côte à côte feraient trois boîtes à lire. */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            padding: "var(--spacing-1) var(--spacing-2)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-chat)",
            background: "var(--color-background-surface)",
          }}
        >
          <ChatComposerInput
            label="Message"
            placeholder="Message"
            // Hors du shell, l'état est ici : `ChatComposerInput` lit son contexte en
            // optionnel et chaque valeur a son prop. Une seule source pour le texte, un
            // seul endroit où `onFrappe` peut être oublié.
            value={texte}
            onChange={(valeur) => {
              setTexte(valeur);
              onFrappe();
            }}
            onSubmit={envoyer}
            triggers={[
              {
                character: "@",
                searchSource: source,
                onSelect: (item) => `@${item.label} `,
              },
            ]}
          />
        </div>

        {actionsEnvoi}

        {/* `Button` et non `ChatSendButton` : ce dernier tire son libellé du dictionnaire
            d'Astryx, dont le `fr-FR.json` **n'a pas la clé** — et il repose son propre
            `aria-label` *après* les props reçues, donc le libellé n'est pas remplaçable.
            Un lecteur d'écran annonçait « Send » au milieu d'une interface française. Le
            défaut passait inaperçu tant que le bouton venait implicitement du shell.

            `canSend` du shell disparu avec lui, la règle est ici — et c'est la même que
            celle d'`envoyer` : un message blanc ne part pas. La tenir à deux endroits
            serait une divergence en attente ; elle tient en un `trim`. */}
        <Button
          label="Envoyer"
          variant="primary"
          isIconOnly
          icon={IconeEnvoyer}
          isDisabled={texte.trim() === ""}
          onClick={() => envoyer(texte)}
        />
      </div>
    </div>
  );
}
