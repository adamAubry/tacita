# @tacita/client-core — session, crypto, store, sync (spec 04)

Couche fondation du client, headless (zéro DOM). Tous les autres packages
reçoivent le `MatrixClient` via `initSession` : **aucun autre package n'importe
matrix-js-sdk** pour la session.

```ts
const session = await initSession({ homeserverUrl, loginToken });

session.client; // accès contrôlé pour les autres packages
session.timeline(roomId).events(); // ordre canonique /sync
await session.recoveryRequired(); // true tant que le backup n'est pas configuré
await session.setupRecoveryKey(); // clé à afficher une fois, puis à oublier
await session.verifyDevice(userId, deviceId);
session.registerWipe("outbox", () => db.clear());
await session.logout(); // révocation + wipe complet
```

## Ce que les autres packages doivent savoir

- **Transport.** `/sync` est du **long-polling HTTP**. Le SDK rouvre la requête
  en boucle ; il n'y a pas de connexion persistante à surveiller.
- **Ordre.** `OrderedTimeline.events()` rend l'ordre d'accumulation `/sync`.
  Ne jamais retrier par `origin_server_ts` : l'horodatage est fixé par le
  serveur d'origine, il est indicatif seulement.
- **Logs.** Utiliser `createLogger()` / `eventRef()`. Le logger filtre
  structurellement les corps d'événements ; un `console.log` direct sur un
  contenu déchiffré viole REQ-COR-09 même en dev.
- **Wipe.** Tout package qui persiste des données appelle `registerWipe` à
  l'initialisation, sinon ses données survivent à la déconnexion.

## Limites assumées

- **L'override par salon prime sur la politique globale.** REQ-COR-07 verrouille
  `globalBlacklistUnverifiedDevices`, mais le SDK consulte d'abord
  `Room.getBlacklistUnverifiedDevices()` et ne retombe sur le réglage global que
  s'il vaut `null` (`rust-crypto/RoomEncryptor`). Aucun package Tacita n'appelle
  `Room.setBlacklistUnverifiedDevices` ; c'est une discipline de code, pas une
  garantie que le SDK impose.
- **`setupRecoveryKey()` ne rend une clé que si elle a été générée ici.** Si le
  secret storage a déjà été provisionné ailleurs, l'appel échoue plutôt que de
  rendre une clé qui n'ouvrirait rien.
- **La clé de récupération n'est jamais persistée.** Elle est rendue une fois,
  à afficher à l'utilisateur, et perdue ensuite — c'est le point de la
  fonctionnalité.
