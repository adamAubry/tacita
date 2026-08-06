"use client";

import { PINNED_EVENTS_METADATA, REACTIONS_METADATA } from "@tacita/messaging";
import { DELIVERED_EVENT_TYPE } from "@tacita/receipts";

import { Text } from "../foundation/primitives";

interface Limite {
  cle: string;
  titre: string;
  texte: string;
  /** `false` quand le paquet dit que la limite n'existe pas : la ligne disparaît. */
  reelle?: boolean;
}

/**
 * REQ-UIX-32 — l'écran « limites connues ». **Honnêteté produit** (spec 00, interdit
 * n°13) : ce que le produit ne garantit pas est écrit ici, une fois, en clair.
 *
 * Rédaction sobre et non anxiogène — le but est qu'on puisse décider, pas qu'on ait
 * peur. Chaque limite dit **ce qui est exposé** et **pourquoi**, sans superlatif, sans
 * icône d'alerte, sans rouge. La couleur `danger` est réservée au destructif (DESIGN.md),
 * et un écran d'information n'en est pas.
 *
 * Les deux premières lignes ne sont pas recopiées : elles sont conditionnées par la
 * métadonnée que les paquets exposent. Le jour où l'une devient chiffrée, la ligne
 * disparaît d'elle-même au lieu de mentir jusqu'à ce qu'on pense à la retirer.
 */
const LIMITES: Limite[] = [
  {
    cle: "reactions",
    titre: "Les réactions circulent en clair",
    texte:
      "C'est le serveur qui regroupe les réactions d'un message, il doit donc lire l'emoji. Il voit qui réagit à quoi. Le message lui-même reste chiffré.",
    reelle: REACTIONS_METADATA.cleartext,
  },
  {
    cle: "epingles",
    titre: "La liste des messages épinglés est en clair",
    texte:
      "L'épinglage est un événement d'état, et Matrix ne chiffre pas l'état. Le serveur voit quels messages sont épinglés, et dans quel salon.",
    reelle: PINNED_EVENTS_METADATA.cleartext,
  },
  {
    cle: "delivre",
    titre: "« Délivré » est une extension à nous",
    texte:
      "Matrix ne définit que « lu ». Notre accusé de réception est un type d'événement propre à Tacita : un correspondant qui utilise un autre client ne l'émettra pas, et son message restera à « envoyé ».",
  },
  {
    cle: "metadonnees",
    titre: "Le serveur voit qui parle à qui, et quand",
    texte:
      "Le contenu ne lui est jamais lisible. L'appartenance aux salons, les horodatages, la taille des fichiers et les conversations mises en silence, si — ce sont les métadonnées dont il a besoin pour acheminer.",
  },
  {
    cle: "recherche",
    titre: "La recherche porte sur cet appareil",
    texte:
      "L'index est construit localement à partir des messages déchiffrés ici. Un message plus ancien que ce que cet appareil a synchronisé existe, mais ne sera pas trouvé.",
  },
  {
    cle: "liens",
    titre: "Un lien de groupe ne garantit pas que le groupe reste joignable",
    texte:
      "Le service qui émet les liens n'a aucun pouvoir sur les salons : il ne peut pas voir que l'émetteur a quitté le groupe. Le lien reste valide, l'invitation échoue.",
  },
  {
    cle: "invitations",
    titre: "Le service de liens apprend qui invite qui",
    texte:
      "Il ne voit aucun message et n'en émet aucun. Il sait qu'un lien a été créé, et par qui. L'ajout par identifiant Matrix ne passe pas par lui.",
  },
];

export function LimitesConnues() {
  return (
    <div style={{ display: "grid", gap: "var(--spacing-4)", padding: "var(--spacing-3)" }}>
      <Text type="supporting" color="secondary">
        Tacita chiffre le contenu de bout en bout. Voici ce que cela ne couvre pas — pour
        que vous le sachiez avant d'en avoir besoin.
      </Text>

      {LIMITES.filter((limite) => limite.reelle !== false).map(({ cle, titre, texte }) => (
        <div key={cle} style={{ display: "grid", gap: "var(--spacing-1)" }}>
          <Text type="body" weight="bold" as="h2">
            {titre}
          </Text>
          <Text type="supporting" color="secondary">
            {texte}
          </Text>
        </div>
      ))}

      {/* Le type d'événement est lu du paquet, pas recopié : une chaîne recopiée n'est
          plus un contrat (spec 11). Discret — il n'intéresse que qui sait le lire. */}
      <Text type="code" color="secondary">
        {DELIVERED_EVENT_TYPE}
      </Text>
    </div>
  );
}
