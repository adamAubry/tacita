"use client";

import type { Session } from "@tacita/client-core";
import {
  canEdit,
  canRedact,
  conversations,
  createTypingIndicator,
  edit,
  getPinnedEvents,
  memberCount,
  mentionCandidates,
  messages as listerMessages,
  messageText,
  parseMentions,
  react,
  reactions as listerReactions,
  redact,
  setPinnedEvents,
  subscribe,
  subscribeTyping,
  typingUsers,
  type MentionCandidate,
} from "@tacita/messaging";
import { createOutbox, type Outbox } from "@tacita/outbox";
import { createReceipts, type Receipts, type ReceiptStatus } from "@tacita/receipts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LayoutHeader } from "../foundation/LayoutHeader";
import { IconeAppel, IconeVideo } from "../foundation/icons";
import { Button } from "../foundation/primitives";
import { useSession } from "../onboarding/SessionProvider";
import { Composer } from "./Composer";
import { ConversationStarter } from "./ConversationStarter";
import { HoldMenu } from "./HoldMenu";
import { Timeline } from "./Timeline";
import { depuisFile, fusionner, texteAffiche, type MessageAffiche } from "./message";

/** Ce que le composer est en train de faire : rien, une réponse, ou une modification. */
type Intention =
  | { quoi: "repondre"; message: MessageAffiche }
  | { quoi: "modifier"; message: MessageAffiche };

/**
 * Layout Conversation (M-D) — le cœur de l'app.
 *
 * Tout ce qui est métier vient des paquets : l'ordre de la timeline (specs 04/05), la
 * file d'envoi (07), les accusés (06), le typing et les mentions (05). Ce composant les
 * compose et rend ; il ne dérive rien — pas même le nom du salon, qui vient de
 * `conversations()` plutôt que d'un accès au SDK que la spec 00 interdit au shard.
 */
export function Conversation({ roomId }: { roomId: string }) {
  const { etat } = useSession();
  const session: Session | null = etat.phase === "prete" ? etat.session : null;

  const [outbox, setOutbox] = useState<Outbox | null>(null);
  const receipts = useRef<Receipts | null>(null);
  const typing = useRef<ReturnType<typeof createTypingIndicator> | null>(null);

  const [version, setVersion] = useState(0);
  const [pret, setPret] = useState(false);
  const [intention, setIntention] = useState<Intention | undefined>();
  const [holdSur, setHoldSur] = useState<MessageAffiche | undefined>();

  const rafraichir = useCallback(() => setVersion((v) => v + 1), []);

  // Les trois services de session, créés une fois par salon et **arrêtés au démontage** :
  // sans cet arrêt, un aller-retour entre deux conversations laisse deux files et deux
  // jeux d'accusés branchés sur le même `/sync`.
  useEffect(() => {
    if (!session) return;
    let vivant = true;

    receipts.current = createReceipts(session);
    typing.current = createTypingIndicator(session);

    const desabonner = [
      subscribe(session, roomId, rafraichir),
      subscribeTyping(session, roomId, rafraichir),
      receipts.current.subscribe(rafraichir),
    ];

    void createOutbox(session).then((file) => {
      if (!vivant) {
        file.dispose();
        return;
      }
      setOutbox(file);
      setPret(true);
    });

    return () => {
      vivant = false;
      for (const off of desabonner) off();
      receipts.current?.stop();
      typing.current?.dispose();
      receipts.current = null;
      typing.current = null;
    };
  }, [session, roomId, rafraichir]);

  useEffect(() => {
    if (!outbox) return;
    const off = outbox.subscribe(rafraichir);
    return () => {
      off();
      outbox.dispose();
    };
  }, [outbox, rafraichir]);

  const candidats: MentionCandidate[] = useMemo(
    () => (session ? mentionCandidates(session, roomId) : []),
    [session, roomId, version],
  );

  /**
   * Le nom d'affichage d'un auteur. `mentionCandidates` **est** l'annuaire des membres du
   * salon avec leurs libellés (REQ-MSG-10) : le relire ici évite une API de plus dans le
   * paquet et un accès SDK dans le shard.
   */
  const nomDe = useCallback(
    (userId: string) => candidats.find((candidat) => candidat.id === userId)?.label ?? userId,
    [candidats],
  );

  const salon = useMemo(
    () => (session ? conversations(session).find((c) => c.roomId === roomId) : undefined),
    [session, roomId, version],
  );

  const messages: MessageAffiche[] = useMemo(() => {
    if (!session) return [];
    const moi = session.client.getUserId() ?? "";

    const timeline = listerMessages(session, roomId).map((evenement) => {
      const auteur = evenement.getSender() ?? "";
      return {
        cle: evenement.getId() ?? "",
        eventId: evenement.getId(),
        auteur,
        nom: nomDe(auteur),
        texte: messageText(evenement),
        horodatage: evenement.getTs(),
        moi: auteur === moi,
        // REQ-MSG-06 — les droits viennent du paquet, message par message. Les calculer
        // ici, où l'on tient déjà l'événement, évite de le rechercher au moment du menu.
        modifiable: canEdit(session, roomId, evenement),
        supprimable: canRedact(session, roomId, evenement),
      } satisfies MessageAffiche;
    });

    const attente = (outbox?.pending(roomId) ?? []).map((entree) =>
      depuisFile(entree, nomDe(moi), moi),
    );
    // `version` est la dépendance qui compte : les paquets rendent des vues, et c'est
    // l'abonnement qui dit qu'elles ont changé.
    return fusionner(timeline, attente);
  }, [session, roomId, outbox, nomDe, version]);

  // REQ-UI-13 — l'accusé se rend sur le dernier message envoyé, et sur lui seul.
  const dernierEnvoye = [...messages].reverse().find((message) => message.moi && message.eventId);
  const recu = dernierEnvoye?.eventId
    ? {
        statut: (receipts.current?.status(dernierEnvoye.eventId) ?? "sent") as ReceiptStatus,
        indecidable: receipts.current?.deliveryUnknowable(dernierEnvoye.eventId) ?? false,
      }
    : undefined;

  const envoyer = (texte: string) => {
    if (!session) return;
    const contenu = { msgtype: "m.text", ...parseMentions(texte, candidats) };

    if (intention?.quoi === "modifier" && intention.message.eventId) {
      // REQ-UI-07 — une modification part directement : elle porte sur un événement qui
      // existe déjà côté serveur, la file d'envoi n'a rien à en faire.
      void edit(session, roomId, intention.message.eventId, texte, { mentions: candidats });
    } else {
      // REQ-UIX-15 — envoi optimiste : l'entrée entre dans la file, la timeline la rend
      // aussitôt. Chiffrement et reprises sont l'affaire de la spec 07.
      void outbox?.enqueue(roomId, {
        ...contenu,
        ...(intention?.quoi === "repondre"
          ? { "m.relates_to": { "m.in_reply_to": { event_id: intention.message.cle } } }
          : {}),
      } as Record<string, unknown>);
    }

    typing.current?.stop(roomId);
    setIntention(undefined);
  };

  const epingler = (eventId: string) => {
    if (!session) return;
    const epingles = getPinnedEvents(session, roomId);
    void setPinnedEvents(
      session,
      roomId,
      epingles.includes(eventId) ? epingles.filter((id) => id !== eventId) : [...epingles, eventId],
    );
  };

  const reagir = (message: MessageAffiche, emoji: string) => {
    if (session && message.eventId) void react(session, roomId, message.eventId, emoji);
  };

  return (
    <>
      <LayoutHeader
        titre={salon?.name ?? "Conversation"}
        fin={
          <div style={{ display: "flex", gap: "var(--spacing-1)" }}>
            {/* M-I porte la logique d'appel ; M-D ne rend que les deux boutons et route
                vers l'écran d'appel — il ne compose rien lui-même (interdit n°7). */}
            <Button label="Appel audio" variant="ghost" isIconOnly icon={IconeAppel} />
            <Button label="Appel vidéo" variant="ghost" isIconOnly icon={IconeVideo} />
          </div>
        }
      />

      <Timeline
        messages={messages}
        chargement={!pret}
        starter={
          <ConversationStarter
            nom={salon?.name ?? ""}
            sousTitre={
              salon?.direct
                ? (salon.peerId ?? "")
                : `${session ? memberCount(session, roomId) : 0} membres`
            }
            direct={salon?.direct ?? false}
          />
        }
        reactions={(message) =>
          session && message.eventId ? listerReactions(session, roomId, message.eventId) : []
        }
        recu={recu}
        onRepondre={(message) => setIntention({ quoi: "repondre", message })}
        onHold={setHoldSur}
        onReagir={reagir}
        onRenvoyer={(message) => void outbox?.retry(message.cle)}
        onAbandonner={(message) => void outbox?.remove(message.cle)}
      />

      <Composer
        // Remonter le composer sur changement d'intention est ce qui remplit le champ
        // avec le texte à modifier : un état contrôlé par le parent ferait un aller-retour
        // à chaque frappe pour un besoin qui n'existe qu'au changement.
        key={intention?.quoi === "modifier" ? intention.message.cle : "nouveau"}
        mentions={candidats}
        texteInitial={intention?.quoi === "modifier" ? intention.message.texte : ""}
        contexte={
          intention && {
            libelle: intention.quoi === "repondre" ? `Réponse à ${intention.message.nom}` : "Modification",
            extrait: texteAffiche(intention.message.texte),
            onAnnuler: () => setIntention(undefined),
          }
        }
        onEnvoyer={envoyer}
        onFrappe={() => typing.current?.keystroke(roomId)}
        ecrivent={session ? typingUsers(session, roomId).map(nomDe) : []}
      />

      <HoldMenu
        ouvert={holdSur !== undefined}
        onFermer={() => setHoldSur(undefined)}
        modifiable={holdSur?.modifiable ?? false}
        supprimable={holdSur?.supprimable ?? false}
        epingle={
          session && holdSur?.eventId
            ? getPinnedEvents(session, roomId).includes(holdSur.eventId)
            : false
        }
        onReagir={(emoji) => holdSur && reagir(holdSur, emoji)}
        onRepondre={() => holdSur && setIntention({ quoi: "repondre", message: holdSur })}
        // REQ-MSG-07 — le texte vient du paquet, l'accès presse-papiers est à l'UI.
        onCopier={() => holdSur && void navigator.clipboard?.writeText(holdSur.texte)}
        onModifier={() => holdSur && setIntention({ quoi: "modifier", message: holdSur })}
        onSupprimer={() => {
          if (session && holdSur?.eventId) void redact(session, roomId, holdSur.eventId);
        }}
        onEpingler={() => holdSur?.eventId && epingler(holdSur.eventId)}
      />
    </>
  );
}
