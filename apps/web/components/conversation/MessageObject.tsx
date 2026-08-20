"use client";

import type { ReactionTally } from "@tacita/messaging";
import { NOT_ENCRYPTED } from "@tacita/outbox";
import type { ReceiptStatus } from "@tacita/receipts";

import { heure } from "../../lib/dates";
import { useGlissement } from "../../lib/gestes";
import { ConversationAvatar } from "../foundation/ConversationAvatar";
import { MediaMessage } from "../media/MediaMessage";
import type { Media, Telecharger } from "../media/media";
import { Button, Text, ToggleButton } from "../foundation/primitives";
import { texteAffiche, type MessageAffiche } from "./message";

export interface MessageObjectProps {
  message: MessageAffiche;
  /** REQ-UIX-12 — calculé par `shouldShowHeader`, jamais deviné ici. */
  entete: boolean;
  /** REQ-UI-09 — la timeline entière révèle ses heures, pas une ligne isolée. */
  heureVisible: boolean;
  reactions?: ReactionTally[];
  /** REQ-UI-13 — fourni sur le dernier message envoyé, et sur lui seul. */
  recu?: { statut: ReceiptStatus; indecidable: boolean };
  onRepondre: () => void;
  onHold: () => void;
  onRevelerHeures: () => void;
  onReagir?: (emoji: string) => void;
  onRenvoyer?: () => void;
  onAbandonner?: () => void;
  /** REQ-UI-14 — déchiffrement d'une pièce jointe, injecté par le câblage (M-E). */
  telecharger?: Telecharger;
  onOuvrirMedia?: () => void;
  /** REQ-MED-05 — écrire la pièce jointe sur l'appareil. Rendu sur les fichiers, qui
   *  n'ouvrent pas de viewer et n'avaient donc aucune sortie. */
  onSauvegarderMedia?: (media: Media) => void;
}

/** `sending` n'y figure pas : ce statut ne rend aucune coche, il rend `null`. */
const COCHE = { sent: "✓", delivered: "✓✓", read: "✓✓" } as const;

/**
 * REQ-UI-13 — les accusés, et **ce qu'ils ne disent pas**.
 *
 * « Délivré » est une extension à nous (REQ-RCP-06) : Matrix ne définit que `m.read`.
 * L'aide contextuelle le dit au lieu de laisser croire à du standard. Et quand le
 * destinataire est en mode masqué, l'état reste `sent` pour toujours : `deliveryUnknowable`
 * distingue « pas encore » de « on ne saura jamais », que rien à l'écran ne séparerait.
 */
function Recu({ statut, indecidable }: { statut: ReceiptStatus; indecidable: boolean }) {
  if (statut === "sending") return null;

  const aide =
    statut === "sent" && indecidable
      ? "Envoyé. Ce destinataire n'émet pas d'accusé de réception : la progression s'arrête ici."
      : statut === "delivered"
        ? "Délivré — extension propre à Tacita, pas un accusé Matrix standard : reçu par un appareil du destinataire, pas forcément lu."
        : statut === "read"
          ? "Lu."
          : "Envoyé.";

  return (
    <span
      title={aide}
      aria-label={aide}
      style={{
        // DESIGN.md : la coche verte est un trait d'identité, et elle ne l'est que pour
        // « lu ». Les états intermédiaires restent muets.
        color: statut === "read" ? "var(--color-text-accent)" : "var(--color-text-secondary)",
        fontSize: "var(--font-size-xs)",
      }}
    >
      {COCHE[statut]}
    </span>
  );
}

/** REQ-UI-06 — une entrée bloquée par le chiffrement ne se réessaie pas : elle s'explique. */
function EtatEnvoi({
  message,
  onRenvoyer,
  onAbandonner,
}: Pick<MessageObjectProps, "message" | "onRenvoyer" | "onAbandonner">) {
  if (message.envoi === undefined || message.envoi === "sending") return null;
  if (message.envoi === "queued")
    return (
      <Text type="supporting" color="secondary">
        En attente d'envoi
      </Text>
    );

  const bloque = message.errcode === NOT_ENCRYPTED;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-2)" }}>
      <Text type="supporting" color="secondary">
        {bloque
          ? "Non envoyé : ce salon n'est pas chiffré."
          : "Non envoyé. Vérifiez votre connexion."}
      </Text>
      {/* Un bouton « Réessayer » sur une entrée que la garde de chiffrement refusera
          toujours est une promesse non tenue (interdit n°13) : il n'apparaît pas. */}
      {!bloque && onRenvoyer && <Button label="Réessayer" variant="ghost" onClick={onRenvoyer} />}
      {onAbandonner && <Button label="Supprimer" variant="ghost" onClick={onAbandonner} />}
    </div>
  );
}

/**
 * REQ-UIX-12 — Message object (composant 11), regroupement Discord.
 *
 * DESIGN.md : timeline **sans bulles**. Un message groupé s'appende sous le précédent,
 * sans avatar ni nom — c'est le blanc qui sépare, pas un cadre.
 *
 * REQ-UI-08 / REQ-UI-09 — glissement gauche pour répondre, glissement droit pour révéler
 * les heures, avec la zone morte de 20 px au bord gauche.
 */
export function MessageObject({
  message,
  entete,
  heureVisible,
  reactions = [],
  recu,
  onRepondre,
  onHold,
  onRevelerHeures,
  onReagir,
  onRenvoyer,
  onAbandonner,
  telecharger,
  onOuvrirMedia,
  onSauvegarderMedia,
}: MessageObjectProps) {
  // Lié une fois : `message.media` est optionnel, et le rebrancher dans chaque garde
  // redemanderait un `!` au compilateur à chaque usage.
  const media = message.media;

  const geste = useGlissement({
    onGauche: onRepondre,
    onDroite: onRevelerHeures,
    onAppuiLong: onHold,
    zoneMorteBord: true,
  });

  return (
    <article
      aria-label={`Message de ${message.nom}`}
      {...geste}
      style={{
        ...geste.style,
        display: "flex",
        gap: "var(--spacing-3)",
        // L'alignement de l'avatar est réservé même sans en-tête : sans lui, un message
        // groupé rentrerait sous l'avatar et la colonne de texte danserait.
        padding: entete ? "var(--spacing-2) var(--spacing-3) 0" : "0 var(--spacing-3)",
        // Un envoi en cours ou en échec est plus pâle : l'information est dans l'état,
        // pas dans une icône de plus.
        opacity: message.envoi === undefined || message.envoi === "queued" ? 1 : 0.6,
      }}
    >
      <div style={{ width: 40, flexShrink: 0 }}>
        {/* ponytail: un `useImageMxc` par en-tête, donc un `fetch` par en-tête pour le
            même auteur. C'est le cache HTTP du navigateur qui absorbe les suivants, un
            média Matrix étant immuable. À mutualiser dans `ConversationAvatar` le jour où
            une timeline longue le fait sentir — pas avant, ce serait un cache de plus. */}
        {entete && <ConversationAvatar nom={message.nom} mxc={message.avatar} direct taille={40} />}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {entete && (
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--spacing-2)" }}>
            <Text type="body" weight="bold">
              {message.nom}
            </Text>
            <Text type="supporting" color="secondary" hasTabularNumbers>
              {heure(message.horodatage)}
            </Text>
          </div>
        )}

        {/* REQ-UI-14 — une pièce jointe remplace le corps de texte : le `body` d'un
            média est son nom de fichier, que la tuile porte déjà. */}
        {media && telecharger && (
          <MediaMessage
            media={media}
            telecharger={telecharger}
            onOuvrir={onOuvrirMedia}
            onSauvegarder={onSauvegarderMedia ? () => onSauvegarderMedia(media) : undefined}
          />
        )}

        <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--spacing-2)" }}>
          {!message.media && <Text type="body">{texteAffiche(message.texte)}</Text>}

          {/* REQ-UI-09 — révélées par le geste, jamais affichées en permanence : une
              heure sur chaque ligne, c'est une colonne de bruit. */}
          {heureVisible && !entete && (
            <Text type="supporting" color="secondary" hasTabularNumbers>
              {heure(message.horodatage)}
            </Text>
          )}

          {recu && <Recu statut={recu.statut} indecidable={recu.indecidable} />}
        </div>

        {reactions.length > 0 && (
          <div style={{ display: "flex", gap: "var(--spacing-1)", paddingTop: "var(--spacing-1)" }}>
            {/* Une réaction est un bouton à deux états : `ToggleButton` **est** cette
                primitive, et `aria-pressed` vient avec elle (DESIGN.md interdit de la
                recoder). Le tap retire la mienne ou ajoute la sienne. */}
            {reactions.map(({ key, count, mine }) => (
              <ToggleButton
                key={key}
                label={`${key} ${count}`}
                size="sm"
                isPressed={mine}
                onPressedChange={() => onReagir?.(key)}
              />
            ))}
          </div>
        )}

        <EtatEnvoi message={message} onRenvoyer={onRenvoyer} onAbandonner={onAbandonner} />
      </div>
    </article>
  );
}
