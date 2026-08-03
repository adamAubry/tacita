# Cible de fumée

Arbitrage PM du 03/08/2026, point 9. **Une seule cible**, pas une suite : elle vérifie
que nos packages tiennent contre une pile réelle, pas contre des mocks.

```sh
cd infra
cp .env.example .env                       # remplir les secrets
./proxy/generate-dev-certs.sh
docker compose -f docker-compose.yml -f smoke/docker-compose.yml up -d

cd .. && npm run smoke
```

## Ce qu'elle prouve, et que 189 tests ne prouvaient pas

- **La crypto Rust réellement chargée** : `getVersion()` doit dire vodozemac, pas la
  config qui l'annonce (REQ-COR-01).
- **Un salon effectivement chiffré côté serveur** : l'événement d'état est enregistré
  et le SDK le voit (REQ-MSG-02, REQ-INF-03) — pas « la config dit que ça devrait ».
- **Le tour complet du chiffrement** : chiffré sur l'appareil, stocké par Synapse,
  rendu par `/sync`, déchiffré ici. On assère aussi que ce que Synapse a stocké est
  bien `m.room.encrypted` et ne contient pas le texte (REQ-COR-02).
- **La reprise de session** : objets neufs, même IndexedDB, aucun jeton fourni. La
  session se rouvre, garde le même `device_id`, et l'historique reste déchiffrable
  (REQ-COR-11).

## Ce qu'elle ne couvre pas

**Le tronçon OIDC.** Le jeton vient du secret partagé de REQ-INF-04, pas du flux SSO,
qui ne fonctionne pas en local — trois causes documentées dans `../README.md`. C'est
un choix arbitré : un tronçon bloqué ne prend pas en otage la validation de sept
modules. Le ticket OIDC ajoutera un `describe` nommé `REQ-INF-09` ici même, et c'est
lui qui fera passer la spec 01 de « non terminée » à « terminée ».

`seedCredentials` est le seul endroit où la cible triche, et exactement du montant de
ce tronçon : en production ces trois valeurs viennent de `initSession()`.

## Pourquoi elle est hors de la suite par défaut

Elle exige Docker debout. Le hook de pré-commit lance la suite complète à chaque
commit ; l'y inclure la casserait pour tout le monde. D'où une config à part
(`vitest.config.ts` ici), un suffixe distinct (`*.smoke.test.ts`) et l'exclusion de
`smoke/**` dans `../vitest.config.ts`.

## L'overlay

`docker-compose.yml` de ce dossier ne contient que des écarts dev/prod, D-07 :
alias réseau pour résoudre `SERVER_NAME` en interne, confiance dans le certificat
auto-signé, `SYNAPSE_IP_RANGE_WHITELIST`, et le port de Synapse publié sur la boucle
locale (l'API d'admin est bloquée au proxy, REQ-INF-11). Aucun artefact de production
n'est modifié.

## Ce qu'elle a déjà trouvé

Au premier lancement, un bug réel dans `client-core` : `IndexedDBStore.startup()` était
appelé **avant** l'affectation du store au client. Sur une base vierge l'ordre inverse
passe — donc un premier lancement marchait, et la suite sur mocks aussi. Seule la
reprise de session échouait, systématiquement. Le code venait de la spec 04 d'origine :
le défaut était sur `main` depuis le début.
