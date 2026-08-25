"use client";

import type { Conversation } from "@tacita/messaging";
import { ROOM_MENTION, type Search, type SearchFilters, type SearchStats } from "@tacita/search";
import { useEffect, useMemo, useState } from "react";

import type { Contact } from "../../lib/contacts";
import {
  CHAMP_PERSONNE,
  ecrireRecents,
  empiler,
  filtresDepuis,
  libellePerimetre,
  lireRecents,
  purgerRecents,
  termeDepuis,
  type Token,
} from "../../lib/recherche";
import { ToggleButton } from "../foundation/primitives";
import type { ResultatMessage } from "./MessagePreview";
import { RecentSearches } from "./RecentSearches";
import { SearchBar } from "./SearchBar";
import { SearchResults } from "./SearchResults";
import { useResultats } from "./useResultats";

interface RechercheProps {
  /** Le paquet spec 09. Injecté : ce composant ne crée aucun worker. */
  recherche: Search;
  conversations: Conversation[];
  contacts: Contact[];
  /** Notre identifiant, pour le filtre `mentions` de l'onglet dédié. */
  moi: string;
  /** `search` = l'onglet Recherche ; `mentions` = l'onglet Mentions (REQ-UIX-21). */
  variation?: "search" | "mentions";
  /**
   * REQ-UIX-33 — des tokens pré-posés à l'ouverture, quand l'écran est atteint depuis
   * ailleurs : « Rechercher dans la conversation » (M-H) arme le salon.
   *
   * Ils sont un **état initial**, pas une contrainte : l'utilisateur peut les retirer.
   * C'est pourquoi ils alimentent `useState` plutôt qu'un effet qui les reposerait.
   */
  tokensInitiaux?: readonly Token[];
  onOuvrirConversation: (roomId: string) => void;
  onOuvrirMessage: (resultat: ResultatMessage) => void;
  /** REQ-UIX-19 — le stockage des profils récents. Injecté pour les tests. */
  indexedDB?: IDBFactory;
  maintenant?: number;
}

/**
 * Layout Default, variations search et mentions (M-F).
 *
 * **Aucun appel réseau ne part d'ici** (REQ-SRC-03) : tout passe par `recherche`, qui
 * interroge un index local dans un worker. C'est ce qui fait que la recherche fonctionne
 * hors ligne — et une recherche qui ne rendrait rien hors ligne serait un bug, pas une
 * dégradation (README du paquet).
 */
export function Recherche({
  recherche,
  conversations,
  contacts,
  moi,
  variation = "search",
  tokensInitiaux,
  onOuvrirConversation,
  onOuvrirMessage,
  indexedDB,
  maintenant,
}: RechercheProps) {
  const [tokens, setTokens] = useState<readonly Token[]>(tokensInitiaux ?? []);
  const [stats, setStats] = useState<SearchStats | null>(null);
  const [sansGroupes, setSansGroupes] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);

  const mentions = variation === "mentions";
  const terme = termeDepuis(tokens);
  const filtres = filtresDepuis(tokens);

  /**
   * REQ-UIX-21 — l'onglet Mentions **filtre, il ne cherche pas** : terme vide, et le
   * seul critère `mentions`. Une recherche plein-texte sur un nom d'affichage raterait
   * les mentions en pièce jointe et prendrait un homonyme pour une mention (README du
   * paquet search) — c'est précisément ce que l'exigence interdit.
   *
   * `ROOM_MENTION` accompagne toujours notre identifiant : côté Matrix, une mention de
   * salon en est une pour chacun.
   */
  const criteres: SearchFilters = mentions
    ? { ...filtres, mentions: [moi, ROOM_MENTION] }
    : filtres;

  // Sans terme ni critère, il n'y a rien à chercher : c'est l'état initial (REQ-UIX-19).
  const actif = mentions || terme.length > 0 || Object.keys(filtres).length > 0;

  const { hits, chargement } = useResultats(recherche, terme, criteres, actif);

  useEffect(() => {
    let annule = false;
    void recherche.stats().then((valeur) => {
      if (!annule) setStats(valeur);
    });
    return () => {
      annule = true;
    };
  }, [recherche]);

  useEffect(() => {
    if (!indexedDB) return;
    let annule = false;
    void lireRecents(indexedDB).then((liste) => {
      if (!annule) setRecents(liste);
    });
    return () => {
      annule = true;
    };
  }, [indexedDB]);

  /** REQ-UIX-19 — un filtre « personne » utilisé entre dans les profils récents. */
  useEffect(() => {
    const personne = filtres.sender;
    if (!indexedDB || !personne || recents[0] === personne) return;
    const suivants = empiler(recents, personne);
    setRecents(suivants);
    void ecrireRecents(indexedDB, suivants).catch(() => {});
  }, [filtres.sender, indexedDB, recents]);

  const directs = useMemo(
    () => new Set(conversations.filter((item) => item.direct).map((item) => item.roomId)),
    [conversations],
  );

  /**
   * REQ-UIX-21 — « exclure les groupes ». L'index ne porte pas la nature du salon : le
   * critère se pose donc sur l'ensemble des DM connus, localement, après coup.
   *
   * ponytail: post-filtre sur les résultats plutôt qu'un critère d'index. Ajouter
   * `direct` au schéma de la spec 09 jetterait le snapshot de tous les utilisateurs
   * (limite assumée du paquet) pour un filtre que l'ensemble des DM rend déjà exact.
   * À reprendre si un `roomId` inconnu du client devient possible.
   */
  const garder = (roomId: string) => !sansGroupes || directs.has(roomId);

  /** L'index ne connaît aucun nom de salon : il se résout ici, à partir des conversations. */
  const messages: ResultatMessage[] = (hits ?? []).map((hit) => ({
    eventId: hit.eventId,
    roomId: hit.roomId,
    conversation: conversations.find((item) => item.roomId === hit.roomId)?.name ?? "Conversation",
    extrait: hit.body,
    horodatage: hit.tsOrigin,
  }));

  const conversationsTrouvees = terme
    ? conversations.filter(
        (item) => garder(item.roomId) && item.name.toLocaleLowerCase().includes(terme.toLocaleLowerCase()),
      )
    : [];
  const messagesTrouves = messages.filter((hit) => garder(hit.roomId));

  const profils = useMemo(
    () =>
      recents
        .map((userId) => contacts.find((contact) => contact.userId === userId))
        .filter((contact): contact is Contact => contact !== undefined),
    [recents, contacts],
  );

  const salons = useMemo(
    () => conversations.map(({ roomId, name }) => ({ roomId, nom: name })),
    [conversations],
  );

  return (
    <>
      <SearchBar
        tokens={tokens}
        onTokens={setTokens}
        contacts={contacts}
        salons={salons}
        stats={stats}
        mentionFixe={mentions}
        hasAutoFocus={!mentions}
        resultats={actif && !chargement ? conversationsTrouvees.length + messagesTrouves.length : undefined}
      />

      {mentions && (
        <div style={{ padding: "0 var(--spacing-3) var(--spacing-2)" }}>
          <ToggleButton
            label="Exclure les groupes"
            isPressed={sansGroupes}
            onPressedChange={setSansGroupes}
          />
        </div>
      )}

      {actif ? (
        <SearchResults
          conversations={conversationsTrouvees}
          messages={messagesTrouves}
          terme={terme}
          chargement={chargement}
          perimetre={libellePerimetre(stats)}
          titreMessages={mentions ? "Mentions" : "Messages"}
          onOuvrirConversation={onOuvrirConversation}
          onOuvrirMessage={onOuvrirMessage}
          maintenant={maintenant}
        />
      ) : (
        <RecentSearches
          profils={profils}
          onChoisir={(contact) =>
            setTokens((precedents) => [
              ...precedents.filter((token) => token.field !== CHAMP_PERSONNE),
              { field: CHAMP_PERSONNE, value: { type: "enum", value: contact.userId } },
            ])
          }
          onPurger={
            indexedDB
              ? () => {
                  setRecents([]);
                  void purgerRecents(indexedDB).catch(() => {});
                }
              : undefined
          }
        />
      )}
    </>
  );
}
