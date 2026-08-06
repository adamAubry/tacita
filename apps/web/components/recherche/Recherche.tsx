"use client";

import type { Session } from "@tacita/client-core";
import { conversations as listerConversations, type Conversation } from "@tacita/messaging";
import { createSearch, ROOM_MENTION, type Search, type SearchHit, type SearchStats } from "@tacita/search";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ajouterRecente, lireRecentes, purgerRecentes, type RechercheRecente } from "../../lib/recherches-recentes";
import { ConversationPreview } from "../accueil/ConversationPreview";
import { Placeholder } from "../foundation/Placeholder";
import { Button, PowerSearch, Skeleton, Text, type PowerSearchFilter } from "../foundation/primitives";
import { useSession } from "../onboarding/SessionProvider";
import { MessagePreview } from "./MessagePreview";
import { RecentSearches } from "./RecentSearches";
import { CONFIG_RECHERCHE, tokenConversation, tokensMentions, versCriteres } from "./filtres";

/** REQ-UIX-22 — la frappe se pose avant que la requête parte. */
export const DEBOUNCE_MS = 300;

export interface RechercheProps {
  /** Deux variations du même layout : la recherche libre, et les mentions pré-armées. */
  variation: "search" | "mentions";
}

/**
 * REQ-UI-16 / REQ-UIX-19 à 22 — les trois états de la variation search, et l'onglet
 * Mentions.
 *
 * **Aucun appel réseau** : l'index est local (spec 09), la recherche fonctionne hors
 * ligne, et le périmètre est affiché plutôt que sous-entendu — c'est l'historique
 * téléchargé sur cet appareil, pas celui du serveur.
 */
export function Recherche({ variation }: RechercheProps) {
  const { etat } = useSession();
  const router = useRouter();
  const parametres = useSearchParams();
  const session: Session | null = etat.phase === "prete" ? etat.session : null;
  const moi = session?.client.getUserId() ?? "";

  const [recherche, setRecherche] = useState<Search | null>(null);
  const [filtres, setFiltres] = useState<readonly PowerSearchFilter[]>([]);
  const [resultats, setResultats] = useState<SearchHit[] | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [bornes, setBornes] = useState<SearchStats | null>(null);
  const [recentes, setRecentes] = useState<RechercheRecente[]>([]);
  const [sansGroupes, setSansGroupes] = useState(false);

  const salons = useMemo(() => (session ? listerConversations(session) : []), [session]);
  const nomDuSalon = useCallback(
    (roomId: string) => salons.find((salon) => salon.roomId === roomId)?.name ?? roomId,
    [salons],
  );

  // Le worker est créé une fois par écran, et **terminé** au démontage : deux allers-
  // retours entre onglets laisseraient sinon deux moteurs Orama ouverts sur la même base.
  useEffect(() => {
    if (!session) return;
    const worker = new Worker(new URL("../../lib/search-worker.ts", import.meta.url));
    const service = createSearch(session, worker);
    setRecherche(service);
    void service.stats().then(setBornes).catch(() => setBornes(null));

    return () => {
      service.dispose();
      setRecherche(null);
    };
  }, [session]);

  useEffect(() => {
    void lireRecentes(globalThis.indexedDB).then(setRecentes).catch(() => {});
  }, []);

  // REQ-UIX-21 — l'onglet Mentions arrive avec sa requête armée. Elle est posée une fois,
  // pas à chaque rendu : l'utilisateur peut ajouter d'autres filtres par-dessus.
  useEffect(() => {
    if (variation === "mentions" && moi) setFiltres(tokensMentions(moi, ROOM_MENTION));
  }, [variation, moi]);

  // REQ-UIX-33 — « rechercher dans la conversation » (M-H) arrive par l'URL. Même
  // mécanisme que l'onglet Mentions : un token posé une fois, que l'utilisateur peut
  // retirer pour élargir.
  useEffect(() => {
    const salon = parametres.get("salon");
    if (variation === "search" && salon) setFiltres([tokenConversation(salon)]);
  }, [variation, parametres]);

  const { terme, criteres } = versCriteres(filtres);
  const interroge = terme.trim() !== "" || Object.keys(criteres).length > 0;

  // REQ-UIX-22 — une seule requête par pause de frappe, exécutée dans le worker.
  const dernierAppel = useRef(0);
  useEffect(() => {
    if (!recherche || !interroge) {
      setResultats(null);
      return;
    }

    setEnCours(true);
    const appel = ++dernierAppel.current;
    const minuterie = setTimeout(() => {
      void recherche
        .search(terme, criteres)
        .then((hits) => {
          // Une réponse plus lente qu'une frappe suivante ne doit pas écraser la plus
          // récente : sans ce garde, les résultats reviennent en arrière.
          if (appel === dernierAppel.current) setResultats(hits);
        })
        .catch(() => setResultats([]))
        .finally(() => appel === dernierAppel.current && setEnCours(false));
    }, DEBOUNCE_MS);

    return () => clearTimeout(minuterie);
    // `criteres` est reconstruit à chaque rendu : c'est sa **forme** qui compte.
  }, [recherche, terme, JSON.stringify(criteres), interroge]);

  const ouvrir = (roomId: string, eventId?: string) => {
    void ajouterRecente(globalThis.indexedDB, { roomId, nom: nomDuSalon(roomId) })
      .then(setRecentes)
      .catch(() => {});
    router.push(eventId ? `/c/${roomId}?message=${eventId}` : `/c/${roomId}`);
  };

  /**
   * REQ-UIX-21 — « exclure les groupes » n'existe pas dans l'index : le schéma connaît le
   * salon, pas sa nature. Le croisement se fait ici, entre deux paquets — c'est ce que le
   * shard a le droit de faire, et le seul endroit d'où les deux sont visibles.
   */
  const directs = new Set(salons.filter((salon) => salon.direct).map((salon) => salon.roomId));
  const messages = (resultats ?? []).filter((hit) => !sansGroupes || directs.has(hit.roomId));

  const conversationsTrouvees: Conversation[] = interroge
    ? salons.filter((salon) => salon.name.toLowerCase().includes(terme.trim().toLowerCase()))
    : [];

  return (
    <div style={{ display: "grid", gap: "var(--spacing-3)", paddingBlock: "var(--spacing-2)" }}>
      <div style={{ paddingInline: "var(--spacing-3)" }}>
        <PowerSearch
          config={CONFIG_RECHERCHE}
          filters={filtres}
          onChange={(suivants) => setFiltres(suivants)}
          label={variation === "mentions" ? "Rechercher dans les mentions" : "Rechercher"}
          placeholder="Rechercher"
          hasClear
        />

        {/* REQ-UI-16 — le périmètre, avec ses bornes réelles. Une recherche muette sur son
            étendue laisse croire qu'elle couvre tout l'historique du serveur. */}
        <Text type="supporting" color="secondary">
          Recherche dans l'historique téléchargé
          {bornes?.oldestTs && bornes.newestTs
            ? ` — du ${new Date(bornes.oldestTs).toLocaleDateString()} au ${new Date(bornes.newestTs).toLocaleDateString()}`
            : ""}
          {bornes ? ` (${bornes.size} messages indexés sur ${bornes.max})` : ""}
        </Text>
      </div>

      {variation === "mentions" && (
        <div style={{ paddingInline: "var(--spacing-3)" }}>
          <Button
            label={sansGroupes ? "Inclure les groupes" : "Exclure les groupes"}
            variant="ghost"
            onClick={() => setSansGroupes((exclus) => !exclus)}
          />
        </div>
      )}

      {!interroge && variation === "search" && (
        <RecentSearches
          recentes={recentes}
          onOuvrir={(recente) => ouvrir(recente.roomId)}
          onPurger={() => {
            void purgerRecentes(globalThis.indexedDB).then(() => setRecentes([])).catch(() => {});
          }}
        />
      )}

      {enCours && (
        <div
          aria-label="Recherche en cours"
          aria-busy="true"
          style={{ display: "grid", gap: "var(--spacing-2)", paddingInline: "var(--spacing-3)" }}
        >
          {[0, 1, 2].map((rang) => (
            <Skeleton key={rang} height={56} />
          ))}
        </div>
      )}

      {!enCours && interroge && conversationsTrouvees.length === 0 && messages.length === 0 && (
        <Placeholder
          titre="Aucun résultat"
          explication="La recherche porte sur l'historique téléchargé sur cet appareil : un message plus ancien peut exister sans être trouvable ici."
        />
      )}

      {!enCours && conversationsTrouvees.length > 0 && (
        <section aria-label="Conversations" style={{ display: "grid", gap: "var(--spacing-1)" }}>
          <Text type="body" weight="bold" as="h2">
            Conversations
          </Text>
          {conversationsTrouvees.map((conversation) => (
            // `simple` : ni badge ni épingle. Un résultat de recherche montre ce qu'on
            // cherche, pas l'état de la boîte de réception.
            <ConversationPreview
              key={conversation.roomId}
              conversation={conversation}
              simple
              onOuvrir={ouvrir}
              onEpingler={() => {}}
            />
          ))}
        </section>
      )}

      {!enCours && messages.length > 0 && (
        <section
          aria-label={variation === "mentions" ? "Mentions" : "Messages"}
          style={{ display: "grid", gap: "var(--spacing-1)", paddingInline: "var(--spacing-3)" }}
        >
          <Text type="body" weight="bold" as="h2">
            {variation === "mentions" ? "Mentions" : "Messages"}
          </Text>
          {messages.map((hit) => (
            <MessagePreview
              key={hit.eventId}
              conversation={nomDuSalon(hit.roomId)}
              extrait={hit.body}
              horodatage={hit.tsOrigin}
              // Dans l'onglet Mentions, le terme est vide : ce sont les mentions qui sont
              // surlignées, et c'est mon identifiant qu'on cherche des yeux.
              terme={variation === "mentions" ? moi.split(":")[0]! : terme}
              onOuvrir={() => ouvrir(hit.roomId, hit.eventId)}
            />
          ))}
        </section>
      )}
    </div>
  );
}
