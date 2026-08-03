# @tacita/client-core — session, crypto, store, sync (spec 04)

Couche fondation du client, headless (zéro DOM). Tous les autres packages
reçoivent le `MatrixClient` via `initSession` : **aucun autre package n'importe
matrix-js-sdk** pour la session.

```ts
// Au démarrage : rouvrir la session locale, sans réseau. `null` = passer par l'OIDC.
const session = (await restoreSession({ homeserverUrl })) ?? (await initSession({ homeserverUrl, loginToken }));

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

- **Le jeton d'accès est stocké en clair.** `restoreSession` le relit depuis
  IndexedDB (base `tacita-session`) pour rouvrir la session sans réseau. Il n'est
  pas chiffré, et ce n'est pas un oubli : `initRustCrypto` tourne sans clé de
  pickle, donc l'état crypto voisin — clés Megolm comprises — est déjà en clair
  dans la même IndexedDB. Chiffrer le seul jeton en laissant les clés à côté
  présenterait une garantie que le module n'offre pas. **Conséquence : qui a accès
  au profil du navigateur a accès au compte et à l'historique déchiffrable.**
  Relever le niveau suppose une clé de pickle sur le store crypto *et* un écran de
  déverrouillage à chaque ouverture — décision produit, à consigner en `DECISIONS.md`
  (D-06) avant d'être implémentée.
- **Un jeton restauré n'est pas validé.** Le valider demanderait le réseau, ce que
  `restoreSession` existe pour éviter. Un jeton révoqué se manifeste par un
  `M_UNKNOWN_TOKEN` au premier appel : c'est au shard UI (spec 11) de router vers
  l'OIDC à ce moment-là.
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
