# @tacita/messaging — domaine conversations (spec 05)

Façade métier headless au-dessus de la Session (spec 04) : DM et groupes, envoi
chiffré, réponses, réactions, édition/suppression, épinglage, typing, mentions.
Fonctions pures et fonctions prenant la `Session` en premier argument ; l'état
n'existe que là où il est nécessaire (`createTypingIndicator`).

```ts
await sendText(session, roomId, "salut @everyone");
await reply(session, roomId, targetId, "d'accord");
await edit(session, roomId, targetId, "corrigé");
await react(session, roomId, targetId, "👍");
await redact(session, roomId, targetId);

messages(session, roomId); // ordre /sync, filtré aux m.room.message
messageText(event); // texte pour le presse-papiers
canEdit(session, roomId, event);
canRedact(session, roomId, event);

const typing = createTypingIndicator(session);
typing.keystroke(roomId); // throttlé, arrêt automatique
```

## Limites assumées

- **Les réactions circulent en clair.** `m.reaction` n'est pas chiffré en salon
  chiffré, et ce n'est pas un oubli : l'agrégation des annotations est faite par
  le serveur, qui doit donc lire la clé de la réaction. Les chiffrer casserait
  l'agrégation. **Le serveur voit qui réagit à quoi, et avec quel emoji.**
  Exposé par `REACTIONS_METADATA.cleartext`.
- **L'épinglage est en clair.** `m.room.pinned_events` est un événement d'état,
  et Matrix ne chiffre pas l'état. **Le serveur voit quels messages sont
  épinglés, dans quel salon et par qui.** Exposé par
  `PINNED_EVENTS_METADATA.cleartext`.
- **`@everyone` devient `@room` dans le corps du message.** C'est ce littéral que
  la push rule native `.m.rule.roomnotif` cherche ; `m.mentions.room` est posé en
  parallèle pour `.m.rule.is_room_mention`. Le réaffichage en `@everyone` est du
  rendu, donc spec 11.
- **Seuls les pseudos sans espace sont résolus en mention.** `@luca` et
  `@luca:tacita.test` deviennent une mention, `@Jean Dupont` reste du texte —
  la syntaxe n'a pas de délimiteur de fin.
- **Pas de rôles nommés.** L'échelle de power levels Matrix est exposée telle
  quelle, en entiers. Toute traduction en libellés est du rendu.
- **Le refus d'envoi en salon non chiffré est une vérification, pas la
  garantie.** La garantie vient de la config Synapse (spec 01) ; `assertEncrypted`
  est là pour que la régression d'une config distante casse l'envoi au lieu de
  fuiter du clair.
