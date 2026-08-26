# @tacita/receipts — accusés à 3 niveaux

`createReceipts(session)` suit chaque message sortant à travers **sending → sent →
delivered → read** et rend un statut observable par `event_id`. Zéro DOM, aucun accès
direct à IndexedDB : tout passe par la `Session` de `@tacita/client-core`.

```ts
const receipts = createReceipts(session);
receipts.subscribe((eventId, status) => render(eventId, status));
receipts.status(eventId); // 'sending' | 'sent' | 'delivered' | 'read' | undefined
await receipts.markRead(event);
receipts.setHiddenMode(true);
```

## Ce qui est du Matrix, et ce qui ne l'est pas

| Niveau      | Origine                                                              |
| ----------- | -------------------------------------------------------------------- |
| `sending`   | écho local du SDK, avant réponse serveur                              |
| `sent`      | `event_id` rendu par le serveur — **natif**                           |
| `delivered` | événement `org.tacita.delivered` — **extension maison, non standard** |
| `read`      | reçu `m.read` — **natif**                                             |

**Matrix ne définit aucun accusé « délivré ».** Le protocole s'arrête à `m.read` ; il
n'existe pas de niveau intermédiaire à activer côté serveur. Le nôtre est une extension
propre à Tacita, interopérable avec aucun autre client : un correspondant sous Element
n'émettra jamais de `org.tacita.delivered`, et ses messages resteront à `sent`.
L'UI reprend cette formulation et ne présente jamais le crochet « délivré »
comme une garantie du protocole.

## Limites assumées

- **L'accusé « délivré » circule en clair.** Il part en message *to-device* non chiffré :
  monter une session Megolm pour transporter une liste d'`event_id` serait
  disproportionné. Le serveur apprend donc *qui* a reçu *quel* événement et *quand* —
  le contenu du message, lui, reste chiffré de bout en bout. C'est un arbitrage, pas un
  oubli.
- **`delivered` = premier appareil atteint.** Un compte a N appareils ; « délivré » n'a
  pas de sens unique. Le crochet s'affiche dès le premier accusé reçu, les suivants sont
  ignorés. Il ne signifie donc pas « présent sur tous les appareils du destinataire ».
- **`sent` est terminal-ambigu.** En mode masqué, le destinataire n'émet plus rien : de
  l'expéditeur, « pas encore délivré » et « destinataire masqué » sont indiscernables, et
  le message reste à `sent` indéfiniment. `deliveryUnknowable(eventId)` expose ce cas
  pour que l'UI le rende explicite plutôt que de laisser croire à une progression.
- **`delivered` marque l'entrée en store, pas la lecture ni même l'affichage.** L'accusé
  part à l'insertion de l'événement dans le store local du destinataire, avant tout
  déchiffrement ou rendu.
- **Statuts en mémoire seule.** Ils se reconstruisent au fil du `/sync` ; un message
  antérieur au démarrage reste à `undefined` (aucun crochet affiché) tant qu'il n'est pas
  repassé en timeline. Persistance à ajouter seulement si l'absence de crochet à froid
  se révèle gênante à l'usage.

## Mode masqué

`setHiddenMode(true)` ne désactive pas les accusés, il bascule `markRead` sur
`m.read.private` et suspend l'émission des « délivré ». Pas de coupure pure : le reçu
sert aussi à synchroniser les compteurs de non-lus entre les appareils d'un même compte,
qui doivent continuer à fonctionner.
