# correctif/ — instantané C3 et C2 du 03/08/2026 · ⚠️ NE PAS LIRE COMME COURANT

> ## ⚠️ Ce dossier est un instantané daté, partiellement périmé par construction
>
> Il fige les fichiers de C3 et C2 **tels que déposés le 03/08/2026, avant application**.
> Il n'a jamais vocation à suivre le code. Deux de ses cinq fichiers ont déjà divergé,
> parce que `fix-src-lifecycle` (REQ-SRC-10) les a retouchés après coup :
>
> | Fichier | État au 04/08/2026 |
> |---|---|
> | `packages/outbox/src/store.ts` | identique à `packages/` |
> | `packages/search/src/snapshot.ts` | identique à `packages/` |
> | `packages/search/src/worker.ts` | identique à `packages/` |
> | `packages/search/src/index.ts` | **PÉRIMÉ** — la version vivante est dans `packages/` |
> | `packages/search/tests/proxy.test.ts` | **PÉRIMÉ** — idem |
>
> **La source de vérité est toujours `packages/`.** Ce dossier ne sert qu'à répondre à la
> question « qu'est-ce qui avait été proposé, et pourquoi », sans dérouler l'historique git.
>
> **Il est conservé délibérément.** La version précédente de cet avertissement disait
> « identique à ce qui est en place » — vrai à l'écriture, faux douze heures plus tard.
> C'est exactement le mode de panne d'une copie, et la raison pour laquelle le README
> racine pointe au lieu de recopier.
>
> Pour comparer vous-même :
> `git diff --no-index correctif/packages/search/src/index.ts packages/search/src/index.ts`

Les correctifs eux-mêmes sont commités en `05f22aa` (C3) et `98e0065` (C2) : leurs
messages portent le raisonnement et les conséquences. Le document qui les détaillait
(`docs/REMEDIATION-CRITIQUES.md`) a été remplacé par `docs/REPRISE.md`, qui en garde les
enseignements sans en garder l'état daté.

**Ce dossier est en instance de suppression** — décidée à l'ordre de marche du 03/08/2026,
planifiée en `docs/REPRISE.md` § 6.1, action A2.

## Contenu

Les chemins sous `correctif/` sont ceux de destination — déjà appliqués tels quels.

## Specs concernées

| Fichier | Spec | REQ |
|---|---|---|
| `outbox/src/store.ts` | **07 — file d'envoi persistante** | REQ-OBX-01 (persistance avant tentative réseau), REQ-OBX-06 (contenu hors localStorage/logs, inchangé) |
| `search/src/snapshot.ts` | **09 — recherche locale** | REQ-SRC-02 (index persisté), REQ-SRC-08 (wipe) |
| `search/src/index.ts` | **09** | REQ-SRC-08 (wipe = déconnexion détruit l'index) |
| `search/src/worker.ts` | **09** | REQ-SRC-08, REQ-SRC-09 (indexation par lots) |
| `search/tests/proxy.test.ts` | **09**, **00** | REQ-SRC-08 ; spec 00 pour la convention `describe("REQ-…")` |

Transversal : **CLAUDE.md interdit n°8** (aucun contenu déchiffré dans le cache, les payloads push,
les logs ou la télémétrie) — c'est ce que C2 rétablit sur le chemin de la déconnexion.

**Aucun amendement de spec n'est nécessaire pour ces deux correctifs.** Le texte des REQ existantes
dit déjà ce que le code aurait dû faire ; on le met en conformité, on ne change pas le contrat.
C'est la différence avec C1 et C4, qui modifient des interfaces exportées et exigent, eux, un
passage par le PM avant le code.

## Ce que fait chaque correctif

**C3 — commit IndexedDB** (`store.ts`, `snapshot.ts`). `promisify()` résolvait sur
`request.onsuccess`, qui précède le commit de la transaction. Un helper `commit` — même nom dans les
deux fichiers — prend la mutation en callback et attend `oncomplete`. Les lectures gardent
`promisify` : elles ont besoin du résultat, et une lecture réussie a lu un état committé.

Le rejet retombe sur `transaction.error ?? new Error(...)`. Le repli n'est pas décoratif :
`transaction.error` n'est pas encore posé au moment où `onerror` se déclenche (il l'est pendant
l'abort, qui suit), donc sans lui on rejette avec `null` — et `errcodeOf()` côté outbox
(`outbox.ts:43`) lit `.errcode` sur ce qu'il reçoit, ce qui lève un `TypeError` sur `null`.

Les fichiers sont **plus longs** qu'avant (~15 lignes chacun), commentaire du « pourquoi » compris.
Une première version plus courte inlinait le helper de lecture et sautait le repli sur `null` : plus
courte, moins juste, et le site de lecture devenait illisible.

**C2 — wipe vs tampon** (`index.ts`, `worker.ts`). Deux courses, deux corrections :

- `resetBuffer()` extrait de `dispose()` et appelé aussi par `wipe()`, **avant** de poster le wipe au
  worker. Sinon le timer de 250 ms se déclenche après coup, réindexe ce qu'il retenait, et le
  `persist()` du moteur réécrit du clair sur disque une fois l'utilisateur déconnecté.
- Les messages du worker se sérialisent (`queue = queue.then(...)`), pour qu'un `wipe` ne s'exécute
  plus entre deux lots d'un `index` en cours. Un `ponytail:` marque le plafond : un `index` de
  rattrapage fait attendre une recherche derrière lui ; découper en un message par lot si ça devient
  visible.

## Vérification

Exécuté avant de déposer les fichiers ici, avec les correctifs appliqués :

- `npx vitest run` → **186 tests, 22 fichiers, tous verts** (185 avant + 1 nouveau)
- `npm run typecheck` → propre
- `npx eslint packages/search packages/outbox` → propre
- Le nouveau test **échoue bien sans le correctif** : avec l'ancien `wipe`, `expected 1 to be +0` —
  l'événement resté en tampon atterrissait dans l'index après la déconnexion.

## Limite assumée

**C3 n'a pas de test dédié.** Le correctif ferme une fenêtre de course entre l'acceptation d'une
requête et le commit de sa transaction ; la reproduire de façon déterministe sous fake-indexeddb
demanderait de simuler un avortement de transaction, soit plus de mécanique de test que de code
corrigé. Le filet reste les tests existants — `outbox/tests/persistence.test.ts` (REQ-OBX-01/06/08)
et REQ-SRC-02 — qui couvrent le chemin nominal et passent toujours. À dire tel quel en revue plutôt
qu'à masquer derrière un test qui ne prouverait rien.
