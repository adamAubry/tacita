# @tacita/client-core — session, crypto, store, sync

Couche fondation du client, headless (zéro DOM). Tous les autres packages
reçoivent le `MatrixClient` via `initSession` : **aucun autre package n'importe
matrix-js-sdk** pour la session.

```ts
// Au démarrage : rouvrir la session locale, sans réseau. `null` = passer par l'OIDC.
const session = (await restoreSession({ homeserverUrl })) ?? (await initSession({ homeserverUrl, loginToken }));

session.client; // accès contrôlé pour les autres packages
session.timeline(roomId).events(); // ordre canonique /sync
await session.timeline(roomId).paginate(); // remonte l'historique ; false = début du salon
await session.recoveryRequired(); // true tant que le backup n'est pas configuré
await session.setupRecoveryKey(); // clé à afficher une fois, puis à oublier
await session.identityResetOf(userId); // true = envoi bloqué jusqu'à confirmation UI
await session.confirmIdentityOf(userId); // la confirmation, qui lève si elle échoue
session.registerWipe("outbox", () => db.clear());
await session.logout(); // révocation + wipe complet
```

## Ce que les autres packages doivent savoir

- **Transport.** `/sync` est du **long-polling HTTP**. Le SDK rouvre la requête
  en boucle ; il n'y a pas de connexion persistante à surveiller.
- **Ordre.** `OrderedTimeline.events()` rend l'ordre d'accumulation `/sync`.
  Ne jamais retrier par `origin_server_ts` : l'horodatage est fixé par le
  serveur d'origine, il est indicatif seulement.
- **Portée.** `events()` ne rend que la fenêtre que `/sync` a laissée dans le
  store, et elle **glisse** : les messages anciens en sortent. `paginate()` va
  chercher la suite au serveur et rend `false` au début du salon. Un écran qui
  affiche un historique sans jamais paginer le verra rétrécir tout seul.
- **Logs.** Utiliser `createLogger()` / `eventRef()`. Le logger filtre
  structurellement les corps d'événements ; un `console.log` direct sur un
  contenu déchiffré viole même en dev.
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
  déverrouillage à chaque ouverture — décision produit encore ouverte.
- **Un jeton restauré n'est pas validé.** Le valider demanderait le réseau, ce que
  `restoreSession` existe pour éviter. Un jeton révoqué se manifeste par un
  `M_UNKNOWN_TOKEN` au premier appel : c'est au shard UI de router vers
  l'OIDC à ce moment-là.
- **La confiance vient de l'identité, pas d'une vérification appareil par appareil.**
  `initSession` verrouille le mode `OnlySignedDevicesIsolationMode` : les clés
  Megolm ne partent qu'aux appareils que leur propriétaire a signés de son identité
  cross-signing, et un événement venu d'un appareil non signé reste illisible. Comme
  l'inscription impose ce bootstrap, aucune étape supplémentaire n'est demandée à
  l'utilisateur.
  **Conséquence découverte en fumée, à connaître côté UI :** sans identité
  cross-signing, un compte ne peut pas chiffrer *du tout* — la crypto Rust rejette
  l'envoi (« Encryption failed because cross-signing is not set up on your account »).
  Le bootstrap n'est donc plus seulement la condition pour être lu, c'est la condition
  pour écrire. L'étape bloquante de l'inscription n'est pas un confort : la sauter rend
  le client muet.
  **Ce que ce modèle ne couvre pas, et qu'il faut dire à l'utilisateur :** si le
  compte d'un correspondant est entièrement compromis — ses secrets cross-signing
  avec — l'attaquant peut signer un appareil à lui, et ses signatures deviennent
  menteuses. Épingler l'identité par vérification interactive (SAS/QR) est la parade ;
  elle est hors V1, spec dédiée post-V1. En attendant, une **réinitialisation
  d'identité** d'un correspondant fait lever le chiffrement : l'UI doit
  exiger une confirmation explicite avant tout nouvel envoi vers lui, pas un
  avertissement ignorable.
  Corollaire : l'override par salon (`Room.setBlacklistUnverifiedDevices`) n'a plus
  d'emprise — le SDK documente `globalBlacklistUnverifiedDevices` comme *ignoré* dans
  ce mode. L'ancienne rédaction verrouillait ce drapeau ; elle exigeait des appareils
  *vérifiés* alors que rien n'outillait la vérification, et deux utilisateurs réels ne
  pouvaient pas se lire.
- **`setupRecoveryKey()` ne rend une clé que si elle a été générée ici.** Si le
  secret storage a déjà été provisionné ailleurs, l'appel échoue plutôt que de
  rendre une clé qui n'ouvrirait rien.
- **La clé de récupération n'est jamais persistée.** Elle est rendue une fois,
  à afficher à l'utilisateur, et perdue ensuite — c'est le point de la
  fonctionnalité.
