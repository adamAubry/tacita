"use client";

import type { SearchStats } from "@tacita/search";
import { useMemo } from "react";

import type { Contact } from "../../lib/contacts";
import {
  CHAMP_APRES,
  CHAMP_AVANT,
  CHAMP_CONVERSATION,
  CHAMP_MENTIONS,
  CHAMP_PERSONNE,
  CHAMP_TEXTE,
  CHAMP_TYPE,
  JETON_MOI,
  libellePerimetre,
  purgeAMordu,
  type Token,
} from "../../lib/recherche";
import { PowerSearch, Text } from "../foundation/primitives";

/** Les types de contenu proposés au filtre. Les valeurs sont les `msgtype` de Matrix. */
const TYPES = [
  { value: "m.text", label: "Texte" },
  { value: "m.image", label: "Photo" },
  { value: "m.video", label: "Vidéo" },
  { value: "m.audio", label: "Vocal" },
  { value: "m.file", label: "Fichier" },
] as const;

export interface SearchBarProps {
  tokens: readonly Token[];
  onTokens: (tokens: readonly Token[]) => void;
  /** Ce qui alimente les filtres « personne » et « conversation ». */
  contacts: readonly Contact[];
  salons: readonly { roomId: string; nom: string }[];
  /** REQ-UI-16 — les bornes réellement couvertes. `null` tant que `stats()` n'a pas rendu. */
  stats: SearchStats | null;
  /** Nombre de résultats courants, affiché par la primitive. */
  resultats?: number;
  hasAutoFocus?: boolean;
  /** REQ-UIX-21 — l'onglet Mentions : un token `@me` pré-armé et non retirable. */
  mentionFixe?: boolean;
}

/**
 * REQ-UI-16 — la barre de recherche globale, et **le périmètre dit sous elle**.
 *
 * Les tokens de la primitive sont configurés ici, un par critère de REQ-SRC-11 : chaque
 * filtre de l'UI a un critère d'index correspondant, et aucun ne se replie sur du
 * plein-texte (E-01). Le champ libre est `texte` — `contentSearchFieldKey` route la
 * saisie non structurée vers lui.
 *
 * La phrase de périmètre n'est pas un avertissement discret : c'est la limite connue de
 * la fonctionnalité, et l'interdit n°13 veut qu'elle se lise, pas qu'elle se devine.
 */
export function SearchBar({
  tokens,
  onTokens,
  contacts,
  salons,
  stats,
  resultats,
  hasAutoFocus = false,
  mentionFixe = false,
}: SearchBarProps) {
  const config = useMemo(
    () => ({
      name: "recherche",
      contentSearchFieldKey: CHAMP_TEXTE,
      fields: [
        // Déclaré même hors onglet Mentions : la primitive a besoin du champ pour rendre
        // le token, et un champ sans token n'apparaît nulle part.
        {
          key: CHAMP_MENTIONS,
          label: "Mentions",
          operators: [
            {
              key: "est",
              label: "est",
              value: {
                type: "enum" as const,
                values: [{ value: JETON_MOI, label: JETON_MOI }],
              },
            },
          ],
        },
        {
          key: CHAMP_TEXTE,
          label: "Texte",
          operators: [{ key: "contient", label: "contient", value: { type: "string" as const } }],
        },
        {
          key: CHAMP_PERSONNE,
          label: "Personne",
          operators: [
            {
              key: "est",
              label: "est",
              value: {
                type: "enum" as const,
                values: contacts.map(({ userId, nom }) => ({ value: userId, label: nom })),
              },
            },
          ],
        },
        {
          key: CHAMP_CONVERSATION,
          label: "Conversation",
          operators: [
            {
              key: "est",
              label: "est",
              value: {
                type: "enum" as const,
                values: salons.map(({ roomId, nom }) => ({ value: roomId, label: nom })),
              },
            },
          ],
        },
        {
          key: CHAMP_TYPE,
          label: "Type",
          operators: [
            { key: "est", label: "est", value: { type: "enum" as const, values: [...TYPES] } },
          ],
        },
        {
          key: CHAMP_APRES,
          label: "Après le",
          operators: [
            {
              key: "le",
              label: "le",
              value: { type: "date_absolute" as const, isDateOnly: true },
            },
          ],
        },
        {
          key: CHAMP_AVANT,
          label: "Avant le",
          operators: [
            {
              key: "le",
              label: "le",
              value: { type: "date_absolute" as const, isDateOnly: true },
            },
          ],
        },
      ],
    }),
    [contacts, salons],
  );

  /**
   * Le token `@me` est **rendu**, pas stocké : il n'entre pas dans l'état de l'écran,
   * donc aucun geste ne peut le retirer et aucune traduction n'a à l'ignorer. Ce que
   * `onChange` rend est reversé sans lui.
   */
  const affiches = mentionFixe
    ? [
        {
          field: CHAMP_MENTIONS,
          operator: "est",
          value: { type: "enum", value: JETON_MOI },
          isReadOnly: true,
        },
        ...tokens,
      ]
    : tokens;

  return (
    <div style={{ display: "grid", gap: "var(--spacing-2)", padding: "var(--spacing-3)" }}>
      <PowerSearch
        config={config}
        filters={affiches as never}
        onChange={(filtres) =>
          onTokens(
            (filtres as unknown as Token[]).filter((token) => token.field !== CHAMP_MENTIONS),
          )
        }
        label="Rechercher"
        placeholder="Rechercher un message ou une conversation"
        hasAutoFocus={hasAutoFocus}
        resultCount={resultats}
      />

      <Text type="supporting" color="secondary">
        {libellePerimetre(stats)}
      </Text>
      {purgeAMordu(stats) && (
        <Text type="supporting" color="secondary">
          L&apos;index est plein : les messages les plus anciennement indexés en sont sortis.
        </Text>
      )}
    </div>
  );
}
