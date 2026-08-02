# @tacita/outbox — file d'envoi persistante (spec 07)

Le local echo de matrix-js-sdk ne survit pas à un rechargement de page. Ce module
comble exactement ce trou : la file vit en IndexedDB, part à la reconnexion, et
se retrouve intacte après un F5.

```ts
const outbox = await createOutbox(session);

await outbox.enqueue(roomId, { msgtype: "m.text", body: "salut" });
outbox.pending(roomId); // entrées FIFO, à fusionner avec la timeline
outbox.subscribe(() => rerender());
await outbox.retry(txnId); // renvoi manuel après échec définitif
await outbox.remove(txnId); // abandon
outbox.dispose(); // au démontage : coupe le timer et ferme la base
```

## Ce qu'il faut savoir

- **La connectivité vient de l'état de sync de la Session**, pas de
  `navigator.onLine` : le navigateur peut se croire en ligne avec le homeserver
  injoignable. Un flush part sur toute transition vers `PREPARED`/`SYNCING`
  depuis un état qui ne l'est pas.
- **FIFO par salon, pas global.** Si la tête de file d'un salon ne part pas, les
  suivantes de ce salon attendent — sinon le message 2 doublerait le message 1.
  Les autres salons continuent.
- **`await flush()` veut dire « tout ce qui était en file a été tenté ».** Un
  appel pendant une passe en cours réarme une passe suivante.
- **Le `txnId` ne bouge jamais.** C'est lui qui rend les retries sûrs : même
  transaction, même `event_id` côté serveur. `retry()` remet le backoff à zéro,
  pas l'identifiant.

## Limites assumées

- **Seul `m.room.message` est mis en file.** C'est le seul type qui se compose
  hors ligne — le texte (spec 05) comme le média (spec 08, qui fournit le
  contenu prêt à envoyer) produisent ce type. Un autre type à différer
  demanderait un champ `eventType` sur l'entrée.
- **Le module ne vérifie pas que le salon est chiffré.** Il ne dépend que de la
  spec 04 ; la garde vit dans `@tacita/messaging` (REQ-MSG-02) et le chiffrement
  effectif est fait par la Session à l'envoi.
- **Un échec définitif est décidé sur le code HTTP.** 4xx hors
  `M_LIMIT_EXCEEDED` → `failed`, plus aucune tentative automatique. Un serveur
  qui renverrait 400 sur une panne transitoire condamnerait l'entrée au renvoi
  manuel.
- **Une entrée trouvée en `sending` au démarrage repart en file.** Elle vient
  d'un onglet tué en plein envoi : le message est peut-être déjà parti. Le
  `txnId` stable fait que le serveur dédupliquera plutôt que de doubler.
