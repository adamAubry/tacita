"use client";

import type { MentionCandidate } from "@tacita/messaging";
import { useMemo, useState, type ReactNode } from "react";

import {
  Button,
  ChatComposer,
  ChatComposerInput,
  Text,
  createStaticSource,
} from "../foundation/primitives";

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
  /** REQ-UI-14/15 — pièces jointes et capture, fournis par M-E. */
  actions?: ReactNode;
}

/**
 * REQ-UIX-15 — Conversation input (composant 9), sur `@astryxdesign/core/Chat`.
 *
 * REQ-UI-12 — l'autocomplétion des mentions est le `trigger` natif du composer : le `@`
 * ouvre le menu, `createStaticSource` filtre. `MentionCandidate` a déjà la forme
 * `{ id, label }` qu'Astryx attend — rien à adapter, et surtout aucun menu à recoder.
 *
 * ponytail: ni bouton fichiers, ni bouton vocal. Les deux dépendent du pipeline média
 * (spec 08) et de M-E, qui n'est pas livré : un bouton trombone inerte serait une
 * fonction affichée qui ne marche pas (interdit n°13). Les emplacements d'Astryx qui les
 * accueilleront sont `footerActions` (fichiers) et `sendActions` (vocal) — deux props à
 * remplir, pas une refonte.
 */
export function Composer({
  mentions,
  contexte,
  texteInitial = "",
  onEnvoyer,
  onFrappe,
  ecrivent = [],
  actions,
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
    <div style={{ padding: "var(--spacing-2)" }}>
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

      <ChatComposer
        value={texte}
        onChange={(valeur) => {
          setTexte(valeur);
          onFrappe();
        }}
        onSubmit={envoyer}
        placeholder="Message"
        // L'emplacement qu'Astryx réserve aux actions de gauche : c'est là que M-E pose
        // le trombone et la capture, sans que le composer ait à les connaître.
        footerActions={actions}
        headerContext={
          contexte ? (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-2)" }}>
              <Text type="supporting" color="secondary" maxLines={1}>
                {contexte.libelle} : {contexte.extrait}
              </Text>
              <Button label="Annuler" variant="ghost" onClick={contexte.onAnnuler} />
            </div>
          ) : undefined
        }
        input={
          <ChatComposerInput
            value={texte}
            onChange={(valeur) => {
              setTexte(valeur);
              onFrappe();
            }}
            label="Message"
            placeholder="Message"
            triggers={[
              {
                character: "@",
                searchSource: source,
                onSelect: (item) => `@${item.label} `,
              },
            ]}
          />
        }
      />
    </div>
  );
}
