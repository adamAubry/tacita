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

members(session, roomId);
canKick(session, roomId, userId); // niveau requis ET au-dessus de la cible
await kick(session, roomId, userId);
await invite(session, roomId, userId);

roomNotificationLevel(session, roomId); // "all" | "mentions" | "mute"
await setRoomNotificationLevel(session, roomId, "mentions");
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
- **L'épingle de conversation est en clair, elle aussi.** `m.favourite` est un tag,
  donc de l'account data de salon : c'est ce qui le rend synchronisé entre les
  appareils, et **le serveur voit quelles conversations sont épinglées**. Métadonnée,
  jamais du contenu.
- **La liste des conversations est ordonnée par récence du dernier message.** C'est le
  seul signal disponible : `getRooms()` rend l'ordre d'insertion du store, et /sync ne
  définit aucun ordre entre salons. L'interdit de tri par `origin_server_ts` reste entier
  là où il porte — **dans** une timeline (REQ-MSG-12), où rien n'a changé. La réserve est
  écrite dans la spec 05 sous REQ-MSG-13, son motif dans `specs/ui/ESCALATIONS.md` § E-09.
- **`@everyone` devient `@room` dans le corps du message.** C'est ce littéral que
  la push rule native `.m.rule.roomnotif` cherche ; `m.mentions.room` est posé en
  parallèle pour `.m.rule.is_room_mention`. Le réaffichage en `@everyone` est du
  rendu, donc spec 11.
- **Seuls les pseudos sans espace sont résolus en mention.** `@luca` et
  `@luca:tacita.test` deviennent une mention, `@Jean Dupont` reste du texte —
  la syntaxe n'a pas de délimiteur de fin.
- **Pas de rôles nommés.** L'échelle de power levels Matrix est exposée telle
  quelle, en entiers. Toute traduction en libellés est du rendu.
- **Le niveau de notification d'un salon est une métadonnée que le serveur voit.**
  Les push rules sont de l'account data en clair : le serveur sait quelles
  conversations vous avez mises en silence. C'est le prix d'un filtrage qui
  fonctionne quand l'application est fermée — un filtrage local ne réveillerait
  rien. Même nature que `m.favourite`.
- **`mentions` ne coupe que ce que les règles par défaut allument.** Une règle de
  genre `room` passe après les `override` natifs : c'est ce qui laisse les mentions
  sonner, et c'est aussi ce qui fait qu'un compte dont les règles par défaut ont été
  modifiées ailleurs peut se comporter autrement. Le niveau lu vient toujours de
  l'état réel du compte, jamais d'une mémoire locale.
- **Le refus d'envoi en salon non chiffré est une vérification, pas la
  garantie.** La garantie vient de la config Synapse (spec 01) ; `assertEncrypted`
  est là pour que la régression d'une config distante casse l'envoi au lieu de
  fuiter du clair.
