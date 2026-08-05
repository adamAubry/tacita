# Dossier de reprise — spec 11, le shard UI

Pour le développeur qui prend la spec 11. Écrit le 04/08/2026, après le merge des correctifs
sur `main` (`e44f72b`) et l'audit des jonctions.

**Ce dossier pointe, il ne recopie pas.** Chaque affirmation renvoie au fichier qui fait
foi. Une copie diverge — c'est arrivé ici, c'est documenté dans `correctif/README.md`, et
c'est la raison de cette règle.

À lire avant de coder, dans cet ordre : `CLAUDE.md` (les 13 interdits), `specs/00-conventions.md`,
`specs/11-ui-shard.md`, puis ce dossier.

---

## 1. Démarrer — vérifié le 04/08/2026 sur une pile détruite et reconstruite

```sh
cd infra
cp .env.example .env                       # remplir les secrets
./proxy/generate-dev-certs.sh              # lit .env tout seul, ne rien exporter
docker compose -f docker-compose.yml -f smoke/docker-compose.yml up -d
cd .. && npm run smoke                     # 14/14 attendus
```

`npm run test` (279 unitaires), `npm run typecheck`, `npm run lint`. Les hooks pré-commit
lancent les trois : **`--no-verify` est proscrit** (`CLAUDE.md`).

Si `npm run smoke` échoue au démarrage, la cause est presque toujours dans
`infra/README.md`, section « Login OIDC » — quatre causes documentées, toutes déjà
corrigées, mais elles décrivent les symptômes que vous reverrez si un réglage saute.

---

## 2. Ce dont vous héritez

Sept paquets, tous verts, tous en dépendance unique sur `client-core`. **Aucun paquet n'en
importe un autre** : c'est votre shard qui les compose. C'est un choix d'architecture des
specs, pas un oubli.

| Paquet | Ce qu'il vous donne | REQ-UI servies |
|---|---|---|
| `@tacita/client-core` | `initSession`, `restoreSession`, `Session` (client, timeline, isEncrypted, recoveryRequired, setupRecoveryKey, identityResetOf, confirmIdentityOf, registerWipe, logout) | 01, 04, 17 |
| `@tacita/messaging` | `sendText`, `reply`, `edit`, `redact`, `react`, `messages`, `subscribe`, `canEdit`, `canRedact`, `createDirectMessage`, `createGroupChat`, `memberCount`, `getPinnedEvents`, `setPinnedEvents`, `parseMentions`, `mentionCandidates`, `createTypingIndicator` | 05–12 |
| `@tacita/outbox` | `createOutbox`, `Outbox` (enqueue/retry/remove/pending/subscribe), `OutboxEntry`, `NOT_ENCRYPTED` | 06, 17 |
| `@tacita/receipts` | `createReceipts`, `ReceiptStatus`, `DELIVERED` | 13 |
| `@tacita/media-pipeline` | `uploadAttachment`, `downloadAttachment`, `saveOriginal`, `waveform`, `AttachmentContent` | 14, 15 |
| `@tacita/search` | `createSearch`, `Search`, `SearchHit`, `SearchStats` | recherche locale |
| `@tacita/calls` | `discoverFocus`, `buildCallWidget`, `CallWidgetDriver`, `activeCall`, `hangupLocal` | appels |

Chaque paquet a un `README.md` avec une section **« Limites assumées »**. Elles sont écrites
pour vous : ce sont les cas où le module ne peut pas tenir ce que l'UI voudrait afficher.
Lisez-les avant de dessiner un écran qui promet plus.

---

## 3. Le point qui décide de votre onboarding — D-08

**Sans identité cross-signing, un compte ne peut pas chiffrer du tout.** La crypto Rust
refuse l'envoi : *« Encryption failed because cross-signing is not set up on your account »*.

Conséquence directe sur **REQ-UI-04** : l'étape bloquante de clé de récupération n'est pas
un confort ni une bonne pratique. `setupRecoveryKey()` est ce qui amorce le cross-signing.
**La sauter rend le client muet** — l'utilisateur pourra lire, jamais écrire.

Le reste de D-08 : les clés Megolm ne vont qu'aux appareils signés par leur propriétaire.
Aucun parcours de vérification (SAS/QR) n'est requis en V1 — il est renvoyé post-V1. Deux
utilisateurs qui ont terminé leur inscription se parlent, sans geste supplémentaire.

Détail complet : `DECISIONS.md` § D-08, `docs/ESCALADE-PM-VERIFICATION.md`, et
`specs/04-client-core.md` REQ-COR-07.

---

## 4. Ce qui vous attend et qui n'est pas fait

### 4.1 Le dialogue de réinitialisation d'identité — condition (e) de D-08

Quand un correspondant réinitialise son identité, ses anciennes signatures ne valent plus
rien. D-08 exige que **l'envoi vers lui soit bloqué jusqu'à confirmation explicite dans
l'UI** — pas un avertissement qu'on peut ignorer.

**Les deux membres dont vous avez besoin existent** — ils ont été ajoutés le 04/08/2026,
après que ce dossier a signalé le trou (arbitrage PM, branche `fix-identity-reset`) :

```ts
await session.identityResetOf(userId);  // true → bloquer l'envoi, expliquer pourquoi
await session.confirmIdentityOf(userId); // la confirmation ; lève si elle échoue
```

Le second **lève**, contrairement au premier, et c'est délibéré : le SDK refuse sur votre
propre identifiant et sur un utilisateur sans identité connue. Ne l'avalez pas — une
confirmation ratée qui rouvre l'UI promet un envoi que le chiffrement refusera de toute
façon.

Le premier ne lève jamais et replie sur `false`. **La protection ne dépend pas de lui** :
c'est `OnlySignedDevicesIsolationMode` qui fait lever le chiffrement à l'envoi. Ces membres
servent à *expliquer* le blocage, pas à le produire — n'en faites pas votre garde.

Vous n'avez donc **rien à dériver du crypto vous-même**, et c'est le point :
`specs/11-ui-shard.md` interdit toute logique métier dans le shard. Si vous vous surprenez à
appeler `session.client.getCrypto()`, c'est le signal qu'un membre manque à la spec 04 —
demandez-le plutôt que de le contourner. C'est exactement ce qui s'est passé ici.

### 4.2 Il n'y a pas de `verifyDevice()` — ne le cherchez pas

D-08 renvoie la vérification interactive (SAS/QR) au post-V1, dans une spec dédiée qui
définira sa propre interface. L'API a été **retirée** du contrat le 04/08/2026 : un exporté
sans appelant sur un chemin de clés est un piège, et l'interdit n°13 veut qu'on n'annonce
aucune capacité qu'on ne rend pas. Détail : `docs/ARBITRAGE-PM.md`, addendum du 04/08.

---

## 5. Les pièges que l'audit des jonctions a trouvés

Trois d'entre eux vous auraient coûté une demi-journée chacun.

**La passation média → outbox ne compilait pas.** `specs/08` promet « un contenu prêt à
`enqueue` » ; `AttachmentContent` était une `interface`, non assignable au
`Record<string, unknown>` d'`enqueue`. Corrigé, et le site de compilation qui manquait
existe désormais : `packages/media-pipeline/tests/jonction-outbox.ts`. **Si vous créez une
autre passation entre deux paquets, créez son site de compilation** — sinon rien ne la
vérifie, aucun paquet ne dépendant de deux autres.

**`NOT_ENCRYPTED` n'était pas réexporté.** C'est l'`errcode` que porte une entrée bloquée
par REQ-OBX-09 (salon non chiffré), et l'UI doit le distinguer d'un échec réseau : le
premier ne se réessaie pas. Il est maintenant importable depuis `@tacita/outbox`. **Ne le
recopiez jamais en dur** — une chaîne recopiée n'est plus un contrat.

**Le driver d'appel court-circuite la file d'envoi**, seul endroit du dépôt à le faire hors
`messaging` et `outbox`. C'est imposé par REQ-CAL-05 et documenté en limite assumée dans
`packages/calls/README.md`. Ne le « corrigez » pas vers l'outbox.

**Les mocks de `Session`.** Trois sont ancrés au contrat par `satisfies` ; trois ne le sont
pas (`calls`, `media-pipeline`, `receipts` — ils n'exposent que `client`). Si vous ajoutez
un membre à `Session`, le compilateur ne vous dira rien de ces trois-là : la panne sera un
`undefined is not a function` à l'exécution. C'est un risque **connu et non couvert**.

---

## 6. Les règles qui vous concernent le plus

Les 13 interdits sont dans `CLAUDE.md`. Ceux qui mordent l'UI :

- **Astryx exclusivement.** Pas de Tailwind, shadcn, Bootstrap, ni CSS-in-JS tiers.
- **Pas de Playwright.** Vitest uniquement, y compris pour les gestes tactiles.
- **IndexedDB, jamais localStorage/sessionStorage**, y compris pour le choix de thème.
- **Aucun contenu déchiffré** dans le cache du service worker, les payloads push, les logs
  ou la télémétrie — **y compris en développement**.
- **Ne jamais trier par `origin_server_ts`.** L'ordre canonique est celui du flux `/sync`,
  déjà rendu par `timeline()`. L'horodatage est indicatif (il sert à REQ-UI-09, l'affichage
  des heures, pas à l'ordre).
- **Aucune fonctionnalité présentée avec une garantie qu'elle n'offre pas.** Concrètement :
  « délivré » n'est pas du Matrix natif (REQ-RCP-06), les réactions et les épinglés sont en
  clair (REQ-MSG-05/08), les métadonnées d'appel sont visibles du serveur.
- **Chaque test Vitest nomme son exigence** : `describe("REQ-UI-NN — …")`. Sans ID, rejeté
  en revue.

---

## 7. Ce que vous ne décidez pas seul

Escaladez au PM plutôt que de trancher dans le code — `DECISIONS.md` l'impose :

- Toute incompatibilité d'Astryx, ponytail ou impeccable avec les contraintes PWA. Ces
  outils **n'ont pas été évalués** (gestes tactiles, rendu hors ligne) : `CLAUDE.md`,
  « Prudence outillage ». Ne contournez pas en silence.
- Tout affaiblissement de D-08 ou de REQ-COR-07.
- Toute contradiction entre deux specs découverte en les composant. C'est le mode de panne
  dominant de ce dépôt : **chaque spec était cohérente seule, l'incohérence vivait dans la
  jonction.**

---

## 8. Où est le reste

| Question | Fichier |
|---|---|
| Pourquoi telle décision produit | `DECISIONS.md` (D-01 à D-08) |
| Arbitrages PM et leurs motifs | `docs/ARBITRAGE-PM.md` |
| Ce qui a été cassé et réparé, et pourquoi | `docs/REMEDIATION-CRITIQUES.md` |
| L'affaire REQ-COR-07 de bout en bout | `docs/ESCALADE-PM-VERIFICATION.md` |
| Le login OIDC et ses quatre causes | `infra/README.md` |
| Ce que la fumée prouve et ne prouve pas | `infra/smoke/README.md` |
| Instantané daté, **partiellement périmé** | `correctif/README.md` |
