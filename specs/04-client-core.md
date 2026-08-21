# SPEC 04 — Client core (session, crypto, store, sync)

**Package : `packages/client-core/`. Headless, zéro DOM. Dépendances : aucune (encapsule matrix-js-sdk).**

## Livrable

Couche fondation du client : initialisation et cycle de vie du `MatrixClient`, crypto E2EE, persistance locale, ordre de timeline. Tous les autres packages client reçoivent le client via ce module ; **aucun autre package n'importe matrix-js-sdk directement** pour la session.

Interface exportée (contrat, à affiner sans en changer la nature) :

```ts
initSession(config): Promise<Session>        // login OIDC token → client démarré, crypto prête
restoreSession(config): Promise<Session|null> // rouvre la session persistée, sans réseau ; null = passer par l'OIDC
Session.client: MatrixClient                 // accès contrôlé pour les autres packages
Session.timeline(roomId): OrderedTimeline    // ordre canonique /sync
Session.isEncrypted(roomId): Promise<boolean> // prédicat pour les gardes d'envoi (specs 05, 07)
Session.recoveryState(): Promise<"prete"|"creation"|"deverrouillage"> // REQ-COR-06 — la porte d'onboarding, en trois cas
Session.setupRecoveryKey(opts?): Promise<RecoveryKey> // backup de clés — amorce le cross-signing (D-08) ; `reinitialiser` = destructif, et exige `confirmerIdentite`
Session.unlockRecovery(encodedKey): Promise<void>     // REQ-COR-06 — la deuxième connexion ; lève sur clé fausse
Session.identityResetOf(userId): Promise<boolean> // REQ-COR-07/D-08 — prédicat, ne lève jamais
Session.confirmIdentityOf(userId): Promise<void>  // REQ-COR-07/D-08 — la confirmation ; lève si elle échoue
```

Pas de `verifyDevice` : D-08 renvoie la vérification interactive (SAS/QR) au post-V1, dans sa
spec dédiée, qui définira sa propre interface. *(Retiré le 04/08/2026 — le contrat n'annonce
aucune capacité que le produit ne rend pas, interdit n°13.)*

## Exigences et critères d'acceptation

- **REQ-COR-01** — Crypto via **vodozemac** à travers le SDK (`initRustCrypto`). libolm interdit (déprécié). Conformité spec Matrix : Olm (Double Ratchet) pour la négociation entre appareils, Megolm pour les salons, rotation périodique des sessions.
- **REQ-COR-02** — Chiffrement effectué sur l'appareil avant tout envoi réseau. Aucun contenu en clair ne sort du module vers le réseau.
- **REQ-COR-03** — Persistance locale exclusivement via le store **IndexedDB** de matrix-js-sdk (historique consultable hors ligne). localStorage/sessionStorage interdits pour toute donnée utilisateur.
- **REQ-COR-04** — `OrderedTimeline` restitue l'ordre du flux **/sync** (ordre canonique). Tout tri par `origin_server_ts` est interdit — l'horodatage est indicatif seulement.
- **REQ-COR-05** — Transport temps réel = long-polling HTTP sur `/sync`. Aucun code ni doc ne le décrit comme du WebSocket.
- **REQ-COR-06** — **Clé de récupération E2EE obligatoire à l'inscription** : `setupRecoveryKey()` fait partie du flux d'onboarding et l'état « backup configuré » est exposé pour que l'UI bloque tant qu'il ne l'est pas (sans elle, l'utilisateur perd son historique à chaque nouvel appareil — première cause d'abandon des déploiements Matrix). **Le remplacement d'une clé perdue passe par une ré-authentification, et le contrat l'expose** : Synapse laisse déposer une première identité cross-signing sans authentification (MSC3967) mais exige une UIA pour en remplacer une, et sans mot de passe natif (REQ-INF-09) le seul flow offert est `m.login.sso`. Le module rend l'URL de repli du serveur via `confirmerIdentite` et attend que l'appelant confirme ; ouvrir une fenêtre est un geste d'UI, qui doit partir d'un clic sous peine d'être bloqué. Sans ce rappel, un 401 remonte tel quel — il n'est jamais avalé. *(Ajouté le 10/08/2026 : `setupRecoveryKey({ reinitialiser: true })` partait sans rappel d'UIA, remplaçait le secret storage, puis échouait sur le dépôt de l'identité — le compte restait à moitié réinitialisé et l'écran parlait de réseau.)*
- **REQ-COR-07** — Politique client : les clés Megolm ne sont **jamais** partagées avec un appareil que son propriétaire n'a pas signé (cross-signing). Mode d'isolation « appareils signés uniquement » de la crypto Rust, activé et verrouillé — mécanisme exact à vérifier sur la version épinglée du SDK ; s'il ne sait pas l'exprimer, escalade avant d'implémenter. La signature d'identité existe pour tout utilisateur légitime : REQ-COR-06 rend le bootstrap cross-signing obligatoire à l'inscription. Une **réinitialisation d'identité** (nouvelle clé maîtresse) est exposée par le module comme un état bloquant par utilisateur ; l'UI (spec 11) exige une confirmation explicite avant tout nouvel envoi vers cet utilisateur. Critère, en **deux** membres de `Session` — détecter et lever : `identityResetOf(userId)` rend l'état bloquant, `confirmIdentityOf(userId)` épingle la nouvelle identité et rouvre les envois. Exposer le premier sans le second laisserait le shard détecter sans pouvoir résoudre, donc appeler le crypto lui-même — ce que ce critère existe pour interdire (spec 00 : zéro logique métier dans le shard). Leurs contrats d'erreur diffèrent et c'est normatif : `identityResetOf` est un **prédicat**, il ne lève jamais et replie sur `false` (la protection vient du mode d'isolation, pas de lui) ; `confirmIdentityOf` **lève** — une confirmation qui échoue en silence ferait débloquer l'UI alors que le chiffrement refusera toujours (interdit n°13). La vérification interactive (SAS/QR) est hors V1 — spec dédiée post-V1, et `verifyDevice` ne fait donc pas partie du contrat V1. *(Amendée le 04/08/2026, D-08 : l'ancienne rédaction exigeait une vérification manuelle par appareil qu'aucune spec ne fournissait — deux utilisateurs réels ne pouvaient pas se lire. Critère d'exposition précisé le 04/08/2026, puis complété le même jour par `confirmIdentityOf` : la moitié qui détecte avait été spécifiée sans celle qui lève.)*
- **REQ-COR-08** — Authentification : le module consomme le flux OIDC (fournisseur externe, spec 01) ; il ne stocke aucun mot de passe et n'implémente aucune méthode d'auth propre.
- **REQ-COR-09** — Aucun contenu déchiffré dans les logs, la télémétrie ou les traces d'erreur du module, y compris en dev : le logger du package filtre structurellement les corps d'événements.
- **REQ-COR-10** — Déconnexion = wipe complet des données locales (stores SDK + stores applicatifs déclarés par les autres packages via un registre de wipe exposé ici). Le wipe couvre aussi les credentials de session persistés (REQ-COR-11) ; ils sont effacés **en premier** — si le reste du wipe échoue, mieux vaut une session locale morte qu'un jeton qui survit à la déconnexion. *(Étendue le 03/08/2026.)*
- **REQ-COR-11** — `restoreSession(config)` rouvre la session persistée **sans aucun appel réseau** ; l'absence de session locale se signale par `null`, jamais par une erreur. Un échec de restauration rend `null` sans effacer les credentials (une panne passagère — wasm non chargé, éviction partielle — ne doit pas forcer un aller-retour OIDC que l'utilisateur hors ligne ne peut pas faire). Limite assumée, documentée : un jeton restauré n'est pas validé hors ligne ; un jeton révoqué se manifeste par `M_UNKNOWN_TOKEN` au premier appel réseau, que le shard UI (spec 11) route vers l'OIDC. *(Créée le 03/08/2026 — sans elle, les promesses hors ligne de REQ-COR-03, REQ-OBX-01 et REQ-SRC-02 sont intenables.)*
- **REQ-COR-12** — `Session.isEncrypted(roomId)` expose l'état de chiffrement du salon comme **prédicat** (il rend `false`, il ne lève jamais) pour les gardes d'envoi des autres packages (specs 05 et 07). Tant que l'état du salon est inconnu — avant le premier `/sync` abouti — le prédicat rend `false`. Toute mémorisation s'invalide sur `m.room.encryption` ; jamais de cache permanent : une garde qui ment est pire que pas de garde. *(Créée le 03/08/2026 — support du défaut C1, voir REQ-OBX-09.)*

- **REQ-COR-13** — `OrderedTimeline.paginate(limit?)` **remonte l'historique au serveur** (`/messages`, pagination arrière) et rend `false` quand le début du salon est atteint. Ce que `/sync` laisse dans le store est une fenêtre courte et glissante : sans cette remontée, les messages plus anciens que la fenêtre disparaissent de l'app quelques jours après avoir été lus, et rien ne va les rechercher. Les événements rejoignent la timeline **en tête**, dans l'ordre du serveur — REQ-COR-04 est inchangée, rien n'est trié. Critères d'acceptation : `paginate()` appelle la pagination arrière du SDK sur le salon ; un salon sans jeton de pagination après l'appel rend `false` ; un salon inconnu rend `false` sans appel réseau ; les événements remontés sont visibles par `events()`. *(Créée le 21/08/2026 — retour utilisateur : « quelques jours après, mes anciens messages ne se chargeaient plus ». Aucun appel à `/messages` n'existait dans le dépôt : la promesse d'« historique complet » de D-01 n'était tenue que par le serveur, jamais par le client.)*

## Méthode et contraintes

- Wrapper mince : ne pas réabstraire ce que le SDK fait déjà (sync multi-appareils et fanout de groupe par sender keys sont natifs — ne rien réécrire).
- Hors scope : envoi de messages (spec 05), reçus (06), file d'envoi (07), média (08), UI d'onboarding (11).

## Objectif mesurable

Suite Vitest avec matrix-js-sdk mocké/instrumenté : REQ-COR-01 (init appelle `initRustCrypto`, aucune référence libolm dans le graphe de deps — test lisant le lockfile) ; REQ-COR-04 (événements injectés dans le désordre de timestamps → ordre restitué = ordre /sync) ; REQ-COR-06 (session sans backup → état `recoveryRequired`) ; REQ-COR-09 (spy logger : corps d'événement jamais sérialisé) ; REQ-COR-10 (wipe appelle chaque store enregistré) ; REQ-COR-13 (pagination arrière appelée sur le salon ; jeton épuisé → `false` ; salon inconnu → `false` sans appel). Une describe par REQ, nommée par son ID.
