# Remédiation des bugs critiques — note aux seniors

Audit du 03/08/2026 sur `main` (`f015e56`). Quatre défauts critiques, plus deux non critiques
promus parce qu'ils bloquaient un correctif critique.

Le point commun : aucun n'est une bavure locale. Ce sont des **jonctions entre modules que
personne ne possède**. Chaque spec est respectée ; c'est l'espace entre les specs qui ne l'est pas.

**Trois sur quatre sont corrigés, sur trois branches locales indépendantes. Rien n'est poussé,
rien n'est mergé, `main` est intacte.** Il reste C1, et une liste de points qui demandent un
arbitrage — section « À statuer par le CM » en fin de document.

---

## 1. État

| # | Défaut | Branche | État |
|---|---|---|---|
| C3 | Écritures IndexedDB résolues avant le commit | `fix-c3-c2` | ✅ corrigé |
| C2 | Texte en clair réécrit sur disque après déconnexion | `fix-c3-c2` | ✅ corrigé |
| N3 | Flush de l'outbox avant un sync sain | `fix-n3-n2` | ✅ corrigé |
| N2 | Jeton expiré classé échec définitif | `fix-n3-n2` | ✅ corrigé |
| C4 | Aucune reprise de session | `fix-c4` | ✅ corrigé |
| C1 | L'outbox envoie sans la garde de chiffrement | — | ⏳ à faire |

```
main f015e56
 ├── fix-c3-c2   3 commits   C3, C2, docs        186 tests (185 + 1)
 ├── fix-n3-n2   2 commits   N3+N2, revue        187 tests (185 + 2)
 └── fix-c4      2 commits   C4, revue           189 tests (185 + 4)
```

Les trois branches partent de `main` et ne se touchent pas : chacune se relit, se valide et se
merge seule, dans n'importe quel ordre. Les compteurs de tests ne s'additionnent pas — chacun est
mesuré depuis les 185 tests de `main`.

Sur chaque branche : `lint`, `typecheck` et la suite complète passent, hooks de pré-commit inclus.
`--no-verify` n'a jamais été utilisé.

---

## 2. Ce qui a été corrigé

Pour chaque défaut : le bug, pourquoi ce correctif-là, et ce que ça change pour la suite.

### C3 — Les écritures IndexedDB résolvaient avant le commit
`packages/outbox/src/store.ts` · `packages/search/src/snapshot.ts` — branche `fix-c3-c2`

**Le bug.** `promisify()` résolvait sur `request.onsuccess`, qui signale que la *requête* a été
acceptée — pas que la *transaction* est committée. Une transaction peut encore avorter après ce
point. REQ-OBX-01 promet « persisté en IndexedDB **avant** toute tentative réseau » : `await
save(entry)` rendait la main avant le commit, donc une fermeture d'onglet dans cette fenêtre
perdait un message que l'UI avait déjà affiché comme mis en file. C'est exactement la garantie que
la spec 07 existe pour fournir.

**Le correctif.** Un helper `commit(mutate)` dans chacun des deux fichiers : il ouvre la
transaction, applique la mutation, et résout sur `oncomplete`. Les lectures gardent `promisify` —
elles ont besoin du résultat, et une lecture réussie a lu un état committé.

Le rejet retombe sur `transaction.error ?? new Error(...)`. Ce repli n'est pas décoratif :
`transaction.error` n'est pas encore posé quand `onerror` se déclenche (il l'est pendant l'abort,
qui suit). Sans lui on rejetait avec `null`, et `errcodeOf()` côté outbox lit `.errcode` sur ce
qu'il reçoit — `TypeError` sur `null`, à l'intérieur d'un `catch`.

**Conséquences.**
- Les écritures sont plus lentes : `enqueue()` attend un vrai commit avant de rendre la main.
  C'est le comportement voulu, mais c'est mesurable sur mobile bas de gamme.
- **`search` paie le plus cher** : `engine.index()` appelle `persist()` en fin de chaque appel, qui
  sérialise tout l'index. Attendre son commit à chaque vague de sync rend urgent le `ponytail:`
  déjà posé dans `engine.ts` (débattre l'écriture derrière un timer). Non traité ici, à ouvrir.
- Pas de test dédié — voir « Limites de la vérification » plus bas.

### C2 — Du texte en clair pouvait se réécrire sur disque après la déconnexion
`packages/search/src/index.ts` · `packages/search/src/worker.ts` — branche `fix-c3-c2`

**Le bug.** Deux courses, même cause : le wipe ne connaissait pas ce qui était en vol.

1. Le tampon du thread principal n'était vidé que par `dispose()`, pas par le wipe. Séquence :
   événements déchiffrés accumulés → déconnexion → le worker vide l'index et efface le snapshot →
   250 ms plus tard le timer se déclenche, réindexe ce qu'il retenait, et `persist()` réécrit le
   snapshot.
2. `scope.onmessage` était `async` sans sérialisation : un `wipe` reçu pendant qu'un `index`
   déroulait ses lots s'exécutait entre deux `await`, puis la boucle reprenait et repersistait.

Dans les deux cas, du contenu déchiffré subsistait en IndexedDB après une déconnexion. Viole
REQ-SRC-08 et l'interdit absolu n°8 de CLAUDE.md.

**Le correctif.** `resetBuffer()` extrait de `dispose()` et appelé aussi par `wipe()`, **avant** de
poster le wipe au worker. Et les messages du worker s'enchaînent dans une file
(`queue = queue.then(...)`) : deux lignes qui suppriment la *classe* de bugs plutôt que l'instance
connue. Les requêtes se disputaient déjà une seule base Orama — il n'y avait pas de parallélisme
réel à perdre.

**Conséquences.**
- **Une recherche peut désormais attendre derrière une indexation.** Un `index()` porte tous ses
  lots dans un seul message : un rattrapage de 50 000 événements bloque la barre de recherche
  pendant toute sa durée. Marqué d'un `ponytail:` dans `worker.ts`. Seuil de bascule : si la spec 11
  constate une latence visible, découper côté proxy (un message par lot) rend la main sans
  réintroduire la course.
- `wipe()` étant public, une UI qui l'appellerait directement bénéficie de la même protection.

### N3 — L'outbox flushait avant que `/sync` soit sain
`packages/outbox/src/outbox.ts` — branche `fix-n3-n2`

Non critique à l'origine. Promu parce que c'est un **prérequis dur de C1**, et parce que C4 le rend
systématique : sans reprise de session il n'existait pas de chemin « rechargement », donc le bug
était presque inatteignable. C4 crée exactement ce chemin.

**Le bug.** `schedule()` armait un flush à 0 ms dès la construction : la file partait avant que
`/sync` ait atteint `Prepared`. `onSync` ne servait qu'aux transitions ultérieures, et `pass()` ne
consultait jamais l'état de sync.

**Le correctif.** Une garde dans `flush()`, point de passage unique de `enqueue`, `retry`, `onSync`,
du timer et de l'API publique.

**Pas dans `pass()`** : le `finally` de `flush()` rappelle `schedule()`, donc une passe sortant à
vide réarmerait un timer à 0 ms, qui rappellerait `flush`, en boucle. Placée dans `flush()`, la
garde coupe avant le `finally` : le timer déjà armé se déclenche une fois sans rien faire, personne
ne le réarme, et c'est `onSync` qui relance.

**Point de conception non évident.** L'état de sync est **retenu dans une variable** mise à jour
depuis l'argument de l'événement, et non relu par `getSyncState()` au moment du flush. Relire
supposerait que le SDK a déjà publié le nouvel état quand il émet `ClientEvent.Sync`. Si l'ordre
était l'inverse, le flush de reconnexion verrait encore l'ancien état et **la file ne repartirait
jamais**. Aucun test sur Session mockée ne peut voir cette panne : c'est le mock qui fixe l'ordre.
`getSyncState()` n'est plus lu qu'une fois, à la construction, hors de toute question de timing.

**Conséquences.**
- `await outbox.flush()` peut résoudre sans rien avoir tenté. C'était déjà vrai quand tout était en
  backoff, ça devient fréquent. Les tests qui montent une outbox doivent poser un état de sync sain
  sur le mock — `getSyncState` a été ajouté au mock, défaut `SYNCING`.
- Moins de bruit réseau hors ligne : les tentatives vouées à l'échec ne sont plus émises.

### N2 — Un jeton expiré condamnait toute la file
`packages/outbox/src/outbox.ts` — branche `fix-n3-n2`

**Le bug.** `isPermanent()` classait définitif tout 4xx sauf `M_LIMIT_EXCEEDED`. Un
`401 M_UNKNOWN_TOKEN` (jeton expiré, soft logout) est un 4xx : **toute la file passait `failed` en
une passe** et exigeait un renvoi manuel, entrée par entrée, par l'utilisateur.

**Le correctif.** Un jeu `RETRYABLE = { M_LIMIT_EXCEEDED, M_UNKNOWN_TOKEN }` — généralisation de la
forme existante, pas une nouvelle mécanique.

**Conséquences.**
- N2 et N3 se composent : un jeton invalide fait sortir le SDK des états sains, donc la garde N3
  empêche même de tenter. Le backoff ne tourne pas à vide.
- `M_MISSING_TOKEN` avait été ajouté puis retiré : le soft logout rend `M_UNKNOWN_TOKEN`, pas
  celui-là. Aucun chemin connu, aucun test — donc dehors.
- **Ce correctif dévie du texte de REQ-OBX-04** (voir « À statuer par le CM »).

### C4 — Aucune reprise de session
`packages/client-core/` — branche `fix-c4`

**Le bug.** `initSession` exigeait un `loginToken` OIDC frais à chaque appel, rien ne persistait les
credentials, et `localStorage` est interdit. Trois modules livrés reposaient donc sur une
persistance locale qu'aucun chemin ne savait rouvrir :

| Promesse | Où | Pourquoi elle ne tenait pas |
|---|---|---|
| « historique consultable hors ligne » | REQ-COR-03 | rouvrir la session exigeait un aller-retour OIDC |
| « la file survit au rechargement » | REQ-OBX-01 | la file survivait, rien ne pouvait la vider |
| « l'index survit au rechargement » | REQ-SRC-02 | l'index survivait, l'app ne s'ouvrait pas |

**Le correctif.** `restoreSession(config)` relit les credentials en IndexedDB et reconstruit la
session sans réseau ; la queue commune aux deux entrées passe dans `buildSession`.

```ts
const session = (await restoreSession({ homeserverUrl })) ?? (await initSession({ homeserverUrl, loginToken }));
```

`null` n'est pas une erreur : c'est « aucune session locale, passe par l'OIDC », le signal
qu'attend la spec 11.

**Choix de conception.**
- **Jeton stocké en clair.** `initRustCrypto` tourne sans clé de pickle, donc l'état crypto voisin —
  clés Megolm comprises — l'est déjà. Chiffrer le seul jeton en laissant les clés à côté
  présenterait une garantie que le module n'offre pas (interdit n°13). **À ratifier par le CM.**
- **`logout()` efface les credentials en premier** : si le reste échoue, mieux vaut une session
  locale morte qu'un jeton qui survit à la déconnexion.
- **Un échec de restauration rend `null` sans rien effacer.** Le réflexe inverse — effacer les
  credentials douteux — refaisait le bug de N2 : un `initRustCrypto` qui échoue parce que le wasm
  n'a pas chargé est souvent passager, et effacer forcerait un OIDC, donc du réseau, précisément ce
  que l'utilisateur hors ligne n'a pas. Si la panne est définitive, l'OIDC réécrira ces credentials
  de toute façon.
- **~50 lignes de store dans `session.ts`**, pas de fichier séparé. Marqué d'un `ponytail:` : c'est
  la 3ᵉ copie du motif open/commit IndexedDB, à factoriser une fois C3 et C4 tous deux sur `main`.
  Refactorer à cheval sur deux branches coûterait plus que la duplication.

**Conséquences.**
- **Un jeton restauré n'est pas validé** — le valider demanderait le réseau. Un jeton révoqué se
  manifeste par un `M_UNKNOWN_TOKEN` au premier appel, que la spec 11 doit router vers l'OIDC.
  C'est exactement le scénario de N2 : **C4 sans N2 condamnerait toute la file d'envoi au premier
  démarrage avec un jeton périmé.** Les deux branches vont ensemble.
- `REQ-COR-11` est une **exigence nouvelle** : la spec 04 doit être amendée.
- `fake-indexeddb` ajouté en devDependency de `client-core` ; `pnpm-lock.yaml` modifié.
- Une base IndexedDB de plus (`tacita-session`). Sous pression disque, le navigateur peut évincer
  l'origine : la reprise échoue alors proprement en `null` → OIDC.

---

## 3. Ce qui reste : C1

`packages/outbox/src/outbox.ts:147` · `packages/messaging/src/rooms.ts:17-22`

**Le bug.** `messaging` fait passer tout envoi par une fonction unique qui appelle
`assertEncrypted()` — c'est REQ-MSG-02, dont la justification est explicite dans `rooms.ts` : « un
envoi en clair est une fuite irréversible : on vérifie côté client avant chaque écriture plutôt que
de faire confiance à une config distante ». **L'outbox appelle `sendEvent()` en direct, sans aucune
vérification.**

L'exposition est faible aujourd'hui (le serveur force `encryption_enabled_by_default_for_room_type:
all`) — mais c'est précisément la confiance que REQ-MSG-02 refuse d'accorder, et quand la spec 11
branchera l'UI sur l'outbox, ce sera **le** chemin d'envoi principal, celui sans garde.

**Le correctif prévu.** Remonter la garde dans `client-core` plutôt que la dupliquer :

| Option | Verdict |
|---|---|
| `outbox` importe depuis `@tacita/messaging` | ✗ arête que la spec 00 interdit sans déclaration |
| Dupliquer les quatre lignes | ✗ deux copies d'un contrôle de sécurité dérivent |
| **`isEncrypted(roomId)` sur l'interface `Session`** | ✓ un seul endroit, aucune arête nouvelle |

Un **prédicat**, pas un `assertEncrypted` qui lève. Raison : le contrôle va **avant** le `try` de
`attempt()`, avec son propre échec.

```ts
if (!(await session.isEncrypted(entry.roomId))) {
  await save({ ...entry, status: "failed", errcode: "TACITA_NOT_ENCRYPTED" });
  return false;
}
```

Mettre `await assertEncrypted(...)` en tête du `try` serait le réflexe, et le piège : l'échec
tomberait dans le `catch`, où `errcodeOf()` d'une `Error` nue rend `"network"` et `isPermanent()`
rend `false` faute de `httpStatus` — **l'entrée réessaierait indéfiniment sur une condition qui ne
changera jamais.** `messaging/rooms.ts` garde son `assertEncrypted`, qui devient une ligne au-dessus
du prédicat.

**Prérequis : N3, déjà fait.** `isEncrypted` lit l'état du salon, inconnu avant la fin du premier
`/sync` — la fonction rend alors `false`. Avec l'ancien flush immédiat au montage, C1 aurait marqué
toute la file `failed` à chaque rechargement. La branche `fix-n3-n2` lève ce blocage ; **C1 ne doit
pas être mergé sans elle.**

**Impacts attendus.** Une méthode de plus sur `Session` → **les trois** `session-mock.ts` (outbox,
messaging, search) doivent la fournir, sinon toute la suite passe au rouge d'un coup. Specs 04 et 07
à amender.

**Effets secondaires attendus.** Nouveau mode d'échec visible : un salon non chiffré produit un
`failed` définitif au lieu d'un envoi silencieux — la spec 11 doit prévoir le libellé, sinon l'UI
affichera « échec » sans dire pourquoi. Un appel crypto de plus par tentative ; si ça se voit,
mémoriser par `roomId` **avec invalidation sur `m.room.encryption`**, jamais un cache permanent : la
garde qui ment est pire que pas de garde.

---

## 4. Limites de la vérification

À lire avant de considérer ces bugs « fermés ».

- **La suite est intégralement à base de mocks.** Aucun test n'exécute le vrai matrix-js-sdk, un
  vrai `Worker`, un vrai IndexedDB (fake-indexeddb), ni Synapse. Les tests infra parsent les YAML :
  ils attestent du contenu des fichiers, pas de leur interprétation par le serveur. **C4 en
  particulier — la reprise de session — ne sera réellement prouvée qu'à l'intégration de la spec
  11.** Le point de conception N3 sur l'ordre d'émission du SDK illustre le risque : le mock
  confirme ce qu'on lui a fait dire.
- **C3 n'a pas de test dédié.** Reproduire de façon déterministe une transaction qui avorte après
  l'acceptation de la requête demanderait plus de mécanique de test que le correctif n'a de code.
  Le filet reste les tests existants, qui couvrent le chemin nominal et passent toujours. Dit tel
  quel plutôt que masqué derrière un test décoratif.
- **Chaque nouveau test a été vérifié en cassant volontairement son correctif.** C2, N3, N2 et C4
  échouent bien sans leur fix. C'est la seule garantie qu'ils mordent.

---

## 5. À statuer par le CM

Rien de ce qui suit n'a été tranché dans le code. Trois points bloquent un merge, les autres
appellent une décision de priorité.

### Bloquants pour merger

**1. REQ-OBX-04 — amender ou revert N2.** La spec 07 dit « Échec définitif (4xx non-ratelimit) →
`failed` ». Le code dit désormais « 4xx définitif », en excluant aussi `M_UNKNOWN_TOKEN`. Le texte
et le code divergent. Formulation proposée : « Échec définitif (4xx qui ne se résout ni par
l'attente ni par un renouvellement de jeton) → `failed` ». **Sans cet amendement, `fix-n3-n2` ne
doit pas partir.** `specs/07-outbox.md` n'a pas été touché.

**2. REQ-COR-11 — exigence nouvelle à créer.** La reprise de session n'existe dans aucune spec.
Proposition : « REQ-COR-11 — `restoreSession()` rouvre la session persistée sans aucun appel
réseau ; l'absence de session locale se signale par `null` et non par une erreur. » Plus une
extension de REQ-COR-10 : le wipe couvre les credentials. **Sans ça, `fix-c4` ne doit pas partir.**
`specs/04-client-core.md` n'a pas été touché.

**3. D-06 — stockage du jeton d'accès en clair.** Décision prise en séance et à ratifier. Le fait
qui la motive : `initRustCrypto` tourne **sans clé de pickle**, donc l'état crypto — clés Megolm
comprises — est déjà en clair dans IndexedDB. **Conséquence à assumer explicitement : qui a accès au
profil du navigateur a accès au compte et à l'historique déchiffrable.** La limite est documentée
dans `packages/client-core/README.md`. Relever le niveau suppose une clé de pickle sur le store
crypto *et* un écran de déverrouillage à chaque ouverture : décision produit, qui touche la spec 11,
et qui mérite sa propre spec plutôt que d'être glissée dans C4. `DECISIONS.md` n'a pas été touché.

### Arbitrages de priorité

**4. C1 est-il plus exploitable que je ne l'estime ?** Je l'ai classé « exposition faible » parce que
le serveur force le chiffrement sur tout nouveau salon. Si les seniors voient un chemin qui crée un
salon non chiffré (invitation externe, salon créé hors `createDirectMessage`, migration), C1 remonte
en tête de liste.

**5. N6 — la recherche retrouve les messages supprimés.** L'index n'écoute que `Decrypted` : une
redaction ne retire pas le document, une édition en ajoute un second sans retirer l'ancien. La
recherche rend donc le texte de messages supprimés et l'ancienne version des messages édités. **Ni
la spec 09 ni le code ne traitent le cas** — c'est autant un trou de spec qu'un bug. « Supprimer un
message » qui laisse le texte trouvable est une promesse produit non tenue.

**6. N1 — `ts` porte deux sémantiques dans l'index.** Le moteur documente « horodatage local
d'indexation, sert à l'éviction » ; le code y met `origin_server_ts`. Conséquence : une pagination
arrière insère des documents anciens, que l'éviction supprime en premier — **le rattrapage
s'auto-évince**. Or `stats()` a besoin, lui, de `origin_server_ts` pour afficher la période couverte
(REQ-SRC-06). Deux besoins, un champ. Correctif : deux champs, donc amendement de la spec 09.

**7. A1 — la passerelle push n'est déployée nulle part.** Pas de Dockerfile, absente de
`infra/docker-compose.yml`, aucune route nginx, aucune variable `VAPID_*` dans `.env.example`. La
spec 03 la déclare « service Node autonome », la spec 01 ne la provisionne pas : **personne ne
possède le raccordement.** Le module est terminé et inutilisable en l'état. Qui le prend ?

**8. A2 — `retention.enabled: true` contre l'intention de D-02.** D-02 dit « ne jamais purger ».
Activer la rétention ouvre la porte aux politiques par salon (`m.room.retention`), et il reste à
vérifier sur la v1.155 déployée que `purge_jobs: []` est bien respecté comme liste vide et non
remplacé par un job par défaut. CLAUDE.md impose de relire la doc de la version déployée : c'est ce
cas. Le test REQ-INF-07 assère le contenu du YAML, pas le comportement de Synapse.

**9. A5 — financer une cible de fumée avant la spec 11 ?** Voir « Limites de la vérification ». Sept
modules seront intégrés d'un coup, validés jusque-là par des mocks. Une seule cible — `docker
compose up`, login OIDC, envoi/réception dans un salon chiffré, en Vitest contre un Synapse
éphémère — rendrait le risque visible maintenant plutôt qu'à l'intégration.

---

## 6. Fichiers touchés

Inventaire par branche. Tout est local, rien n'est poussé.

### `fix-c3-c2` — 3 commits
```
packages/outbox/src/store.ts            modifié   C3
packages/search/src/snapshot.ts         modifié   C3
packages/search/src/index.ts            modifié   C2
packages/search/src/worker.ts           modifié   C2
packages/search/tests/proxy.test.ts     modifié   C2 — 1 test ajouté (REQ-SRC-08)
REMEDIATION-CRITIQUES.md                créé      ce document
correctif/                              créé      trace de la revue, doublonne packages/
```

### `fix-n3-n2` — 2 commits
```
packages/outbox/src/outbox.ts           modifié   N3 + N2
packages/outbox/tests/outbox.test.ts    modifié   2 tests ajoutés (REQ-OBX-02, REQ-OBX-04)
packages/outbox/tests/session-mock.ts   modifié   getSyncState ajouté au mock
```

### `fix-c4` — 2 commits
```
packages/client-core/src/session.ts          modifié   C4 — store credentials, buildSession, restoreSession
packages/client-core/src/index.ts            modifié   export de restoreSession
packages/client-core/README.md               modifié   2 limites assumées documentées
packages/client-core/package.json            modifié   fake-indexeddb en devDependency
packages/client-core/tests/session.test.ts   modifié   4 tests ajoutés (REQ-COR-11)
packages/client-core/tests/recovery.test.ts  modifié   IDBFactory réelle
packages/client-core/tests/timeline.test.ts  modifié   IDBFactory réelle
pnpm-lock.yaml                               modifié   fake-indexeddb
```

### Jamais touchés, volontairement
```
specs/           contrats — amendements 1, 2 et 6 à faire par le CM
DECISIONS.md     territoire PM — D-06 à consigner
CLAUDE.md        inchangé
main             f015e56, alignée sur origin/main
```
