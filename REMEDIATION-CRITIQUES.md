# Remédiation des bugs critiques — note aux seniors

Audit du 03/08/2026 sur `main` (`f015e56`). Quatre défauts critiques, un par module ou presque.
Ce document dit **quoi corriger, comment, ce que ça casse, et dans quel ordre**. Il ne corrige rien.

Le point commun des quatre : aucun n'est une bavure locale. Ce sont des **jonctions entre modules
que personne ne possède**. Chaque spec est respectée ; c'est l'espace entre les specs qui ne l'est pas.
Deux conséquences pratiques :

1. **Chaque correctif touche un contrat exporté → la spec s'amende avant le code.** CLAUDE.md :
   « les specs sont exécutables, le code les implémente, jamais l'inverse ». Les IDs de REQ proposés
   plus bas sont à valider par le PM, pas à inventer dans la PR.
2. **Une branche par correctif, sur le modèle des branches `spec-NN-*` existantes.** Le hook de
   pré-commit lance `typecheck` + `test` sur tout le dépôt : deux correctifs qui touchent
   `Session` en parallèle bloqueront mutuellement leurs commits.

---

## Ordre d'exécution recommandé

```
C3 ─┐ (isolés, modules différents, parallélisables)
C2 ─┘
      N3 ──> C4 ──> C1
      (prérequis)   (dépend du refactor C4)
```

| # | Correctif | Modules | Dépend de | Taille |
|---|---|---|---|---|
| C3 | Commit IndexedDB | `outbox`, `search` | — | S |
| C2 | Wipe vs tampon de recherche | `search` | — | S |
| N3 | Flush initial de l'outbox | `outbox` | — | XS |
| C4 | Reprise de session | `client-core` (+ PM) | — | L |
| C1 | Garde de chiffrement dans l'outbox | `client-core`, `outbox` | **N3**, C4 | M |

**Pourquoi C1 en dernier alors que c'est le trou de sécurité ?** Deux raisons, développées en §C1 :
poser la garde avant d'avoir corrigé N3 transforme un risque théorique en panne certaine au
démarrage ; et C1 comme C4 modifient l'interface `Session`, autant refactorer `session.ts` une fois.
Si le PM veut C1 tout de suite, **N3 est le seul prérequis dur** — C4 n'est qu'une économie de refactor.

---

## C3 — Les écritures IndexedDB résolvent avant le commit

`packages/outbox/src/store.ts:6-10` · `packages/search/src/snapshot.ts:7-11`

### Le défaut

`promisify()` résout sur `request.onsuccess`. Cet événement signale que la **requête** a été acceptée
par le store, pas que la **transaction** est committée sur disque. Une transaction IndexedDB peut
encore avorter après ce point (quota, fermeture de la base, erreur d'une autre requête de la même
transaction).

REQ-OBX-01 promet « persisté en IndexedDB **avant** toute tentative réseau ». `await save(entry)`
(`outbox.ts:238`) rend la main avant le commit : fermeture d'onglet dans cette fenêtre = message
perdu, alors que l'UI l'a affiché comme mis en file. C'est exactement le manque que le module
existe pour combler — le local echo du SDK échoue déjà sur ce point, c'est la justification de la spec 07.

### Le correctif

Un helper d'écriture, dans **chacun des deux fichiers**. Les **lectures** gardent `promisify` (elles
ont besoin du résultat, et une lecture qui a réussi a lu un état committé) ; les écritures ne s'en
servent plus du tout :

```ts
const write = (fn: (store: IDBObjectStore) => void): Promise<void> =>
  new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
```

Les trois méthodes d'écriture deviennent des one-liners :

```ts
put:    (entry) => write((s) => { s.put(entry); }),
remove: (txnId) => write((s) => { s.delete(txnId); }),
clear:  ()      => write((s) => { s.clear(); }),
```

Idem `write` / `clear` côté search. Net : **moins de lignes qu'aujourd'hui**, `objectStore()` et le
`async` des trois méthodes disparaissent.

**Pourquoi dupliquer le helper plutôt que factoriser dans un `@tacita/idb` ?** Huit lignes par
fichier contre une arête de dépendance supplémentaire entre packages et une entrée à déclarer dans
deux specs. La duplication est moins chère ici. À reconsidérer au troisième store IndexedDB.

### Impacts

- **`packages/outbox/src/store.ts`** : les quatre méthodes changent de forme. Aucun appelant ne
  change (`OutboxStore` garde sa signature).
- **`packages/search/src/snapshot.ts`** : idem.
- Aucune interface publique modifiée. Aucun autre module touché.

### Effets secondaires

- **Les écritures deviennent plus lentes.** `enqueue()` attend désormais un vrai commit avant de
  rendre la main : l'écho optimiste de l'UI apparaît quelques millisecondes plus tard. C'est le
  comportement voulu, mais c'est un changement mesurable sur mobile bas de gamme.
- **`search` paie le plus cher.** `engine.index()` appelle `persist()` en fin de chaque appel
  (`engine.ts:131`), qui sérialise **tout** l'index. Attendre son commit à chaque vague de sync rend
  urgent le `ponytail:` déjà posé en `engine.ts:98-101` (débattre l'écriture derrière un timer).
  Ne pas traiter dans cette PR, mais ouvrir le ticket : C3 dégrade un coût déjà signalé comme
  provisoire.
- **Churn de tests attendu dans `outbox/tests/persistence.test.ts`.** Attendre `oncomplete` ajoute
  un tour de boucle d'événements. Les tests utilisent des fake timers avec `toFake: ["setTimeout",
  "clearTimeout", "Date"]` en gardant `setImmediate` réel (voir le commentaire `outbox.test.ts:19`,
  fake-indexeddb en dépend) — ça reste valable, mais certains `await` supplémentaires seront
  nécessaires. **Si un test se met à expirer, c'est fake-indexeddb qui attend un `setImmediate`
  réel, pas un deadlock applicatif.**
- **La forme des erreurs change.** Un quota dépassé arrive maintenant par `tx.error` et non plus par
  `request.error`. Rien ne filtre sur le message aujourd'hui ; à vérifier avant de merger.

### Validation

Test à ajouter (`outbox/tests/persistence.test.ts`) : `enqueue()` puis, **sans laisser passer de
tour de boucle supplémentaire**, rouvrir le store et vérifier que l'entrée est lisible. Avec le code
actuel il est difficile de faire échouer ce test de façon déterministe avec fake-indexeddb — c'est
attendu : le correctif ferme une fenêtre de course, il ne change pas le chemin nominal. Documenter
ce point dans la PR plutôt que de fabriquer un test qui ne prouve rien.

---

## C2 — Du texte en clair peut se réécrire sur disque après la déconnexion

`packages/search/src/index.ts:74-95` · `packages/search/src/worker.ts:23` · `packages/search/src/engine.ts:118-132`

### Le défaut

Deux courses distinctes, même cause : le wipe ne connaît pas ce qui est en vol.

**Course 1 — le tampon du thread principal.** `createSearch` accumule les événements déchiffrés dans
`buffer` et les poste au worker 250 ms plus tard (`BUFFER_MS`). `registerWipe("search", wipe)`
(ligne 95) ne vide **ni `buffer` ni `timer`** ; seul `dispose()` le fait (lignes 104-106).

```
événements déchiffrés → buffer rempli, timer armé
  → logout() → wipes exécutés → le worker vide l'index et efface le snapshot
    → 250 ms plus tard, le timer se déclenche → index(batch)
      → engine.index() réinsère ET termine par persist() → snapshot réécrit sur disque
```

**Course 2 — l'entrelacement dans le worker.** `scope.onmessage` est `async` sans sérialisation
(`worker.ts:23`) : un `wipe` reçu pendant qu'un `index()` déroule sa boucle de lots s'exécute entre
deux `await`. La boucle reprend ensuite et repersiste.

Résultat dans les deux cas : du contenu déchiffré subsiste en IndexedDB après une déconnexion.
Viole REQ-SRC-08 et l'interdit absolu n°8 de CLAUDE.md. Le test REQ-SRC-08 actuel ne le voit pas :
il indexe, wipe, vérifie — sans rien laisser en vol.

### Le correctif

**Course 1 — trois lignes.** Extraire ce que `dispose()` fait déjà et l'appeler aussi depuis le wipe :

```ts
const resetBuffer = (): void => {
  if (timer) clearTimeout(timer);
  timer = undefined;
  buffer = [];
};

const wipe = async () => { resetBuffer(); await call<void>("wipe", []); };
```

L'ordre compte : vider le tampon **avant** de poster le wipe, sinon un `drain()` peut se glisser entre.

**Course 2 — sérialiser le worker.** Une ligne dans `worker.ts` :

```ts
let queue: Promise<void> = Promise.resolve();
scope.onmessage = (event) => { queue = queue.then(() => handle(event)); };
```

Préférer ça à un garde d'époque dans le moteur : ça supprime **la classe** de bugs (tout
entrelacement futur `index`/`wipe`/`search`) au lieu de patcher l'instance connue. Les requêtes se
disputaient déjà une seule base Orama — il n'y a pas de parallélisme réel à perdre.

### Impacts

- **`packages/search/src/index.ts`** : `wipe` n'est plus l'alias direct de `call("wipe")`. `dispose()`
  réutilise `resetBuffer()`. Interface publique inchangée.
- **`packages/search/src/worker.ts`** : le corps du handler passe dans une fonction `handle`, le
  handler devient synchrone et enchaîne. `serve()` garde sa signature — les tests qui l'appellent
  à la main (`proxy.test.ts:25`) continuent de fonctionner.
- **`packages/search/src/engine.ts`** : inchangé. C'est le point de ce choix.

### Effets secondaires

- **Une recherche peut désormais attendre derrière une indexation.** C'est le prix de la
  sérialisation. Avec `BATCH_SIZE = 500` les lots sont petits, mais un `index()` porte **tous** ses
  lots dans un seul message : un rattrapage de 50 000 événements bloque la barre de recherche
  pendant toute sa durée, là où l'entrelacement actuel la laissait passer.
  **Seuil de bascule :** si la spec 11 constate une latence visible, découper côté proxy (un message
  par lot au lieu d'un message par appel) rend la main entre les lots sans réintroduire la course.
  À noter dans la PR comme dette assumée, avec un `ponytail:`.
- **`wipe()` est public** (`Search.wipe`) : l'UI qui l'appellerait directement bénéficie de la même
  protection. Aucune régression.
- **Aucun impact sur D-05.** Ce correctif ne touche pas à la politique de réindexation : il garantit
  seulement que `wipe()` fait ce qu'il annonce.

### Validation

Test à ajouter (`search/tests/proxy.test.ts`, sous REQ-SRC-08) : émettre des événements déchiffrés,
**déclencher les wipes avant `BUFFER_MS`**, avancer les timers au-delà, puis vérifier
`stats().size === 0` **et** que le snapshot relu depuis une nouvelle instance de moteur est vide.
Le second point est le vrai test : c'est la persistance qui pose le problème, pas l'état mémoire.

---

## N3 — Flush initial de l'outbox sans attendre un sync sain

`packages/outbox/src/outbox.ts:223`

Non critique en soi, **prérequis dur de C1**. Traité ici pour cette raison.

### Le défaut

`schedule()` est appelé à la construction. Les entrées réhydratées ont un `nextAttemptAt` dans le
passé, donc le `setTimeout` part à 0 ms : la file s'envoie avant que `/sync` ait atteint `Prepared`.
`onSync` ne sert qu'aux transitions ultérieures, et `pass()` ne consulte jamais l'état de sync.

### Le correctif

Une garde, dans `flush()` — le point de passage unique de `enqueue`, `retry`, `onSync`, du timer et
de l'API publique :

```ts
const healthy = () => HEALTHY.has(session.client.getSyncState());

function flush(): Promise<void> {
  if (disposed || !healthy()) return Promise.resolve();
  // ...inchangé
}
```

**Ne pas la mettre dans `pass()`** : `flush()` appelle `schedule()` dans son `finally`, qui réarme un
`setTimeout(0)` puisque `nextAttemptAt` est dans le passé, qui rappelle `flush()`, qui sort
aussitôt... et rearme. Boucle de timers à vide tant que le client est hors ligne. Placée dans
`flush()`, la garde coupe avant le `finally` : le timer déjà armé se déclenche une fois, ne fait
rien, et rien ne le réarme — c'est `onSync` qui relance, comme aujourd'hui.

### Effets secondaires

- **Un `await outbox.flush()` peut ne rien tenter** et résoudre sans avoir envoyé. C'est déjà le cas
  quand tout est en backoff, mais ça devient beaucoup plus fréquent. Les tests qui appellent
  `flush()` après avoir monté l'outbox devront poser un état de sync sain sur le mock
  (`outbox/tests/session-mock.ts` n'expose pas `getSyncState` aujourd'hui — à ajouter).
- Le comportement hors ligne ne change pas : les tentatives échouaient et partaient en backoff,
  elles ne sont maintenant plus tentées du tout. Moins de bruit réseau, même résultat.

---

## C4 — Aucune reprise de session

`packages/client-core/src/session.ts:10-21, 77-103`

Le plus gros, et le seul qui exige un arbitrage PM avant d'écrire du code.

### Le défaut

`SessionConfig` exige un `loginToken` OIDC frais. Rien ne persiste `access_token` / `user_id` /
`device_id`, `localStorage` est interdit (interdit n°2), et il n'existe aucun `restoreSession()`.

Trois modules livrés reposent sur une persistance locale qu'aucun chemin ne sait rouvrir :

| Promesse | Où | Pourquoi elle ne tient pas |
|---|---|---|
| « historique consultable hors ligne » | REQ-COR-03 | rouvrir la session exige un aller-retour OIDC |
| « la file survit au rechargement » | REQ-OBX-01 | la file survit, mais rien ne peut la vider sans session |
| « l'index survit au rechargement » | REQ-SRC-02 | l'index survit, mais l'app ne s'ouvre pas hors ligne |

Aucune spec ne possède ce raccordement : la 04 dit « cycle de vie du `MatrixClient` » sans le
détailler, la 11 n'est pas écrite.

### Décision PM requise avant tout code

**Où vit le jeton d'accès, et sous quelle protection ?**

Le fait à poser sur la table : `initRustCrypto({ useIndexedDB: true })` est appelé **sans clé de
pickle** (`session.ts:110`). L'état crypto — dont les clés Megolm — est donc **déjà** en clair dans
IndexedDB. Y ajouter le jeton d'accès ne baisse pas le niveau de protection réel ; chiffrer le seul
jeton en laissant les clés à côté serait de la mise en scène, ce que l'interdit n°13 proscrit.

Trois options, à trancher par le PM et à consigner en `DECISIONS.md` (D-06) :

1. **Jeton en clair en IndexedDB, aligné sur l'état crypto existant.** Cohérent, honnête, à
   documenter dans `LIMITES.md` : quiconque a accès au profil du navigateur a accès au compte.
2. **Clé de pickle sur la crypto *et* chiffrement du jeton**, dérivée d'un secret utilisateur
   (déverrouillage à chaque ouverture). Protège réellement, mais ajoute un écran de saisie à chaque
   démarrage — décision produit, pas technique.
3. **Pas de reprise du tout**, et on assume que l'app exige du réseau à chaque ouverture. Alors il
   faut **retirer** les promesses hors ligne de REQ-COR-03, REQ-OBX-01 et REQ-SRC-02, qui ne sont
   pas tenables sans elle.

Le reste de cette section suppose l'option 1 ou 2 ; la mécanique est la même, seule la couche de
chiffrement diffère.

### Le correctif

**Pas de nouveau fichier.** Un object store, une clé fixe, trois opérations : ~25 lignes en bas de
`session.ts`, sur le patron de `outbox/src/store.ts` (et avec le helper `write` de C3). Un fichier
séparé pour trois fonctions privées coûte plus qu'il ne range.

```ts
interface StoredCredentials { accessToken: string; userId: string; deviceId: string }
```

Trois champs, pas quatre : `homeserverUrl` vient déjà de la config de l'appelant, le stocker
supposerait un jour plusieurs homeservers — un seul `SERVER_NAME` est déployé.

**Refactor de `session.ts`** — extraire la queue commune des deux chemins d'entrée :

```ts
async function buildSession(credentials: StoredCredentials, config): Promise<Session>
// = tout ce qui suit le login aujourd'hui : IndexedDBStore, createClient,
//   initRustCrypto, lockUnverifiedDeviceBlacklist, startClient, objet Session

export async function initSession(config: SessionConfig): Promise<Session>
// loginRequest → persist → buildSession

export async function restoreSession(config: Omit<SessionConfig, "loginToken">): Promise<Session | null>
// read() → null si absent → buildSession
```

`Omit<SessionConfig, "loginToken">` plutôt qu'un type `RestoreConfig` : rien à maintenir en double.

`null` est le signal « va faire l'OIDC » pour la spec 11. Pas d'exception : l'absence de session
n'est pas une erreur, c'est le premier lancement.

**`logout()`** efface les credentials **en premier**, avant `client.logout(true)`. Le commentaire
existant (`session.ts:160-162`) pose déjà la règle : « l'effacement local ne dépend d'aucune
réussite réseau ». Si on efface après, un échec du wipe laisse un jeton stocké déjà révoqué côté
serveur — le pire des deux mondes.

### Impacts

- **`packages/client-core/`** : un fichier neuf, `session.ts` réorganisé, deux exports de plus dans
  `index.ts` (`restoreSession`, `StoredCredentials`).
- **`packages/client-core/package.json`** : `fake-indexeddb` en devDependency (comme `outbox` et
  `search`).
- **`packages/client-core/tests/mocks.ts`** : `resetSdk()` doit fournir un `IDBFactory` de test. Le
  mock actuel remplace tout matrix-js-sdk ; le store de credentials, lui, doit tourner sur un vrai
  fake-indexeddb, sinon on teste un mock contre un mock.
- **Aucun consommateur cassé** : `initSession` garde sa signature. `messaging`, `outbox` et `search`
  ne voient rien.
- **Spec 04 à amender** : REQ-COR-11 (reprise de session sans réseau) + REQ-COR-10 étendue
  (le wipe couvre les credentials).

### Effets secondaires

- **Un jeton restauré peut être invalide** (révoqué, expiré, soft logout). Le valider par un
  `whoami()` exigerait du réseau — ce qui détruit l'objectif hors ligne. **Choix à faire
  explicitement : restaurer optimistement, et laisser la spec 11 router vers l'OIDC quand le SDK
  remonte `M_UNKNOWN_TOKEN`.** Ne pas laisser ce choix implicite dans le code.
- **Ce scénario est exactement N2.** Un jeton restauré invalide produit des 401 sur les envois ;
  `isPermanent()` (`outbox.ts:63`) classe tout 4xx comme définitif, donc **toute la file passe
  `failed` en une passe** et exige un renvoi manuel entrée par entrée. C4 rend N2 systématique au
  lieu d'occasionnel. Corriger N2 dans la même PR ou juste après — pas plus tard.
- **`device_id` réutilisé entre sessions.** C'est voulu (l'identité crypto de l'appareil est
  attachée au `device_id`, en changer force une nouvelle vérification), mais ça veut dire qu'un
  store de credentials corrompu ou partiellement effacé laisse un client avec un `device_id` dont
  les clés ne correspondent plus. `restoreSession` doit traiter « credentials présents mais
  `initRustCrypto` échoue » comme un échec de restauration : effacer et rendre `null`, pas propager.
- **Deux bases IndexedDB de plus dans le budget de stockage** (`tacita`, `tacita-outbox`,
  `tacita-search`, + credentials). Sous pression disque, le navigateur peut évincer l'origine entière :
  la reprise de session échoue alors proprement (`read()` rend `undefined` → `null` → OIDC). Vérifier
  que c'est bien le comportement obtenu, et non une exception.

### Validation

- REQ-COR-11 : `initSession` → fermer → `restoreSession` sur le même `IDBFactory` → session
  utilisable, **sans que `loginRequest` ait été rappelé** (c'est l'assertion qui compte).
- `restoreSession` sur un store vide → `null`, aucun appel réseau.
- REQ-COR-10 étendue : après `logout()`, `restoreSession` rend `null`.
- Échec d'`initRustCrypto` à la restauration → `null` et store effacé.

---

## C1 — L'outbox envoie sans la garde de chiffrement

`packages/outbox/src/outbox.ts:147` · `packages/messaging/src/rooms.ts:17-22`

### Le défaut

`messaging` fait passer **tout** envoi par une fonction unique qui appelle `assertEncrypted()`
(`messages.ts:36-45`) — c'est REQ-MSG-02, et sa justification est explicite en `rooms.ts:11-16` :
« un envoi en clair est une fuite irréversible : on vérifie côté client avant chaque écriture plutôt
que de faire confiance à une config distante ».

L'outbox appelle `session.client.sendEvent()` en direct. Aucune vérification, ni à l'`enqueue`, ni à
l'`attempt`.

L'exposition est faible aujourd'hui (le serveur force
`encryption_enabled_by_default_for_room_type: all`) — mais c'est précisément la confiance que
REQ-MSG-02 refuse d'accorder. Et quand la spec 11 branchera l'UI sur l'outbox, ce sera **le** chemin
d'envoi principal, celui sans garde.

### Le correctif

**Remonter la garde dans `client-core`, pas la dupliquer.** Trois options examinées :

| Option | Verdict |
|---|---|
| `outbox` importe `assertEncrypted` de `@tacita/messaging` | ✗ crée une arête `outbox → messaging` que la spec 00 interdit sans déclaration, et la spec 07 ne déclare que la 04 |
| Dupliquer les quatre lignes dans `outbox` | ✗ deux copies d'un contrôle de sécurité dérivent |
| **Ajouter `isEncrypted(roomId)` à l'interface `Session`** | ✓ un seul endroit, aucune arête nouvelle, les deux packages dépendent déjà de la 04 |

`messaging/rooms.ts` garde son export : `assertEncrypted` devient une ligne au-dessus du prédicat.
Aucun appelant de `messaging` ne bouge.

**Où appeler la garde dans l'outbox : dans `attempt()`, pas dans `enqueue()`.** La file est différée
par nature — l'état de chiffrement au moment de la mise en file n'est pas celui au moment de
l'envoi. Un appel dans `enqueue()` en plus, pour un échec rapide côté UI, est optionnel ; celui de
`attempt()` est obligatoire.

### Le piège à ne pas manquer

Le réflexe est de mettre `await session.assertEncrypted(...)` en tête du `try` de `attempt()`.
**Ne pas faire ça.** L'échec tombe alors dans le `catch` (`outbox.ts:155-170`) et y est traité comme
une erreur d'envoi : `errcodeOf()` d'une `Error` nue rend `"network"`, `isPermanent()` rend `false`
faute de `httpStatus`, donc

> l'entrée réessaie indéfiniment, avec backoff, sur une condition qui ne changera jamais.

Le contrôle va **avant** le `try`, avec son propre échec — quatre lignes, aucun type d'erreur à
créer, aucun changement à `isPermanent()` :

```ts
if (!(await session.isEncrypted(entry.roomId))) {
  await save({ ...entry, status: "failed", errcode: "TACITA_NOT_ENCRYPTED" });
  return false;
}
```

D'où la forme à exposer sur `Session` : un prédicat `isEncrypted(roomId)`, pas un `assertEncrypted`
qui lève. `messaging/rooms.ts` garde son `assertEncrypted` (il lève, c'est ce que ses appelants
attendent) et devient une ligne au-dessus du prédicat.

### Pourquoi N3 est un prérequis dur

`isEncrypted` appelle `crypto.isEncryptionEnabledInRoom(roomId)`, qui lit l'état du salon.
**Avant la fin du premier `/sync`, cet état peut être inconnu — la fonction rend `false`.**

Or `schedule()` déclenche aujourd'hui un flush immédiat au montage (N3). Enchaînement au
rechargement de page :

```
outbox réhydraté → flush immédiat → état du salon pas encore synchronisé
  → assertEncrypted rend false → toutes les entrées marquées failed
    → l'utilisateur doit renvoyer chaque message à la main
```

**Poser C1 sans N3 transforme un risque théorique en panne certaine à chaque rechargement.**
C'est la seule dépendance non négociable de ce plan.

### Impacts

- **`packages/client-core/src/session.ts`** : une méthode de plus sur `Session`. Toute implémentation
  ou tout mock de `Session` doit la fournir — `outbox/tests/session-mock.ts`,
  `messaging/tests/session-mock.ts`, `search/tests/session-mock.ts` : **les trois** doivent renvoyer
  « chiffré » par défaut, sinon toute la suite passe au rouge d'un coup.
- **`packages/messaging/src/rooms.ts`** : `assertEncrypted` devient une délégation. REQ-MSG-02 reste
  couverte par les tests existants, sans les modifier.
- **`packages/outbox/src/outbox.ts`** : appel dans `attempt()` + branche de classification.
- **Specs à amender** : 04 (REQ-COR-12, la Session expose la garde) et 07 (REQ-OBX-09, aucun envoi
  de la file sans vérification côté client).

### Effets secondaires

- **Un appel crypto de plus par tentative d'envoi.** `isEncryptionEnabledInRoom` lit un état déjà en
  mémoire, le coût est négligeable — mais il est désormais sur le chemin chaud d'un flush de 50
  entrées. Si ça se voit, mémoriser par `roomId` **avec invalidation sur `m.room.encryption`**,
  jamais un cache permanent : la garde qui ment est pire que pas de garde.
- **Nouveau mode d'échec visible pour l'utilisateur.** Un salon non chiffré produit maintenant un
  `failed` définitif au lieu d'un envoi silencieux. C'est l'objectif, mais la spec 11 doit prévoir
  le libellé — sinon l'UI affichera « échec » sans dire pourquoi, et l'utilisateur retentera en boucle.
- **`retry()` sur une entrée bloquée par la garde reboucle** sur le même échec tant que le salon
  n'est pas chiffré. Acceptable (c'est une action manuelle), mais le message d'erreur doit être
  explicite, pas un code générique.

### Validation

- REQ-OBX-09 : session mockée rendant « non chiffré » → `flush()` → `sendEvent` **jamais appelé**, et
  l'entrée est `failed` avec l'errcode dédié.
- Non-régression N3 : état de sync non sain → `flush()` ne tente rien et ne marque **rien** `failed`.
- REQ-MSG-02 : la suite `messaging` existante doit rester verte sans modification. Si elle bouge,
  c'est que la délégation a changé le comportement — à investiguer, pas à ajuster.

---

## Ce que ce plan ne traite pas

Volontairement hors périmètre, à planifier après :

- **N2** (401 classé définitif) — sauf s'il part avec C4, où il devient systématique. Le faire là.
- **N1** (`ts` porte deux sémantiques dans l'index de recherche) — bug de données réel, mais aucune
  perte ni fuite ; attend son tour.
- **A1** (passerelle push déployée nulle part) — bloquant pour le ship, pas pour la correction des
  critiques. Demande un arbitrage : spec 01 la provisionne, ou spec 03 se dote d'un Dockerfile.
- **A5** (suite entièrement à base de mocks) — le vrai angle mort. Les quatre correctifs ci-dessus
  seront validés par des tests qui ne touchent ni le vrai SDK, ni un vrai Worker, ni Synapse.
  C4 en particulier — la reprise de session — ne sera réellement prouvée qu'à l'intégration de la
  spec 11. À garder en tête au moment de déclarer ces bugs « corrigés ».
