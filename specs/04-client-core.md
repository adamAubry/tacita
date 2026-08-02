# SPEC 04 — Client core (session, crypto, store, sync)

**Package : `packages/client-core/`. Headless, zéro DOM. Dépendances : aucune (encapsule matrix-js-sdk).**

## Livrable

Couche fondation du client : initialisation et cycle de vie du `MatrixClient`, crypto E2EE, persistance locale, ordre de timeline. Tous les autres packages client reçoivent le client via ce module ; **aucun autre package n'importe matrix-js-sdk directement** pour la session.

Interface exportée (contrat, à affiner sans en changer la nature) :

```ts
initSession(config): Promise<Session>        // login OIDC token → client démarré, crypto prête
Session.client: MatrixClient                 // accès contrôlé pour les autres packages
Session.timeline(roomId): OrderedTimeline    // ordre canonique /sync
setupRecoveryKey(): Promise<RecoveryKey>     // backup de clés, obligatoire
verifyDevice(...)                            // vérification interactive d'appareil
```

## Exigences et critères d'acceptation

- **REQ-COR-01** — Crypto via **vodozemac** à travers le SDK (`initRustCrypto`). libolm interdit (déprécié). Conformité spec Matrix : Olm (Double Ratchet) pour la négociation entre appareils, Megolm pour les salons, rotation périodique des sessions.
- **REQ-COR-02** — Chiffrement effectué sur l'appareil avant tout envoi réseau. Aucun contenu en clair ne sort du module vers le réseau.
- **REQ-COR-03** — Persistance locale exclusivement via le store **IndexedDB** de matrix-js-sdk (historique consultable hors ligne). localStorage/sessionStorage interdits pour toute donnée utilisateur.
- **REQ-COR-04** — `OrderedTimeline` restitue l'ordre du flux **/sync** (ordre canonique). Tout tri par `origin_server_ts` est interdit — l'horodatage est indicatif seulement.
- **REQ-COR-05** — Transport temps réel = long-polling HTTP sur `/sync`. Aucun code ni doc ne le décrit comme du WebSocket.
- **REQ-COR-06** — **Clé de récupération E2EE obligatoire à l'inscription** : `setupRecoveryKey()` fait partie du flux d'onboarding et l'état « backup configuré » est exposé pour que l'UI bloque tant qu'il ne l'est pas (sans elle, l'utilisateur perd son historique à chaque nouvel appareil — première cause d'abandon des déploiements Matrix).
- **REQ-COR-07** — Politique client : les clés Megolm ne sont **jamais** partagées avec un appareil non vérifié (réglage SDK correspondant activé et verrouillé).
- **REQ-COR-08** — Authentification : le module consomme le flux OIDC (fournisseur externe, spec 01) ; il ne stocke aucun mot de passe et n'implémente aucune méthode d'auth propre.
- **REQ-COR-09** — Aucun contenu déchiffré dans les logs, la télémétrie ou les traces d'erreur du module, y compris en dev : le logger du package filtre structurellement les corps d'événements.
- **REQ-COR-10** — Déconnexion = wipe complet des données locales (stores SDK + stores applicatifs déclarés par les autres packages via un registre de wipe exposé ici).

## Méthode et contraintes

- Wrapper mince : ne pas réabstraire ce que le SDK fait déjà (sync multi-appareils et fanout de groupe par sender keys sont natifs — ne rien réécrire).
- Hors scope : envoi de messages (spec 05), reçus (06), file d'envoi (07), média (08), UI d'onboarding (11).

## Objectif mesurable

Suite Vitest avec matrix-js-sdk mocké/instrumenté : REQ-COR-01 (init appelle `initRustCrypto`, aucune référence libolm dans le graphe de deps — test lisant le lockfile) ; REQ-COR-04 (événements injectés dans le désordre de timestamps → ordre restitué = ordre /sync) ; REQ-COR-06 (session sans backup → état `recoveryRequired`) ; REQ-COR-09 (spy logger : corps d'événement jamais sérialisé) ; REQ-COR-10 (wipe appelle chaque store enregistré). Une describe par REQ, nommée par son ID.
