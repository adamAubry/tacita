# Reprise — état du dépôt, ce qu'on a appris, ce qui reste à faire

Écrit le 05/08/2026. **Ce fichier remplace les six documents de processus qui vivaient ici**
(brief PM, arbitrages, deux escalades, remédiation des critiques, dossier de reprise). Ils
racontaient chacun une session ; aucun ne disait où on en est. Leur contenu utile est ici,
leur contenu périmé est dans `git log`.

> **Cette page ne fait foi sur rien.** Elle oriente. Ce qui fait foi : `CLAUDE.md` (les
> 13 interdits), `DECISIONS.md` (D-01 à D-09), `specs/` (les exigences), et le `README.md`
> de chaque package (les limites assumées). En cas de contradiction, c'est le fichier
> désigné qui gagne et cette page qui est à corriger. Une copie diverge — ce dépôt en a
> fait la démonstration en douze heures avec le dossier `correctif/`.

---

## 1. Où on en est, en cinq lignes

Dix modules sur onze sont livrés, mergés et verts. **La spec 11 — le shard UI — revient à un
humain senior** (directive PM du 04/08/2026) ; `apps/web/` n'existe pas encore. Le découpage
frontend est fait : neuf modules `M-A` à `M-I` dans `specs/ui/`. Le socle a été audité deux
fois, sur son code puis sur ses jonctions, et la dernière passe a fermé les trous connus.

Les huit escalades du Tech Lead Frontend ont été **tranchées le 05/08/2026** — deux d'entre
elles créent du contrat neuf : la spec 09 gagne la recherche filtrée, et une spec 12 apparaît
pour le service de liens d'invitation. Il reste **cinq actions techniques** et **une action de
méthode**. Elles sont en § 6.

---

## 2. La chronologie, et ce que chaque étape a appris

C'est court, et c'est ce qui explique la forme du dépôt aujourd'hui.

### 02/08 — Dix modules écrits en parallèle, chacun contre sa spec

Traçabilité exemplaire : 100 % des exigences avec un test nommé, vert. Zéro secret en dur,
images épinglées par digest, limites documentées plutôt que masquées.

### 03/08 — L'audit du code trouve quatre défauts critiques

Et un motif : **aucun n'était une bavure locale.** Quatre jonctions entre modules que
personne ne possédait. Chaque spec était respectée ; l'espace entre les specs ne l'était pas.

Le cas d'école : la garde de chiffrement existait dans `messaging` et pas dans `outbox`,
parce que la spec 05 met la file hors scope et que la spec 07 ne parle pas de chiffrement.
Les deux specs respectées, le trou entre elles.

### 03/08 — L'arbitrage PM tranche neuf points

Trois bloquaient un merge, six orientaient la suite. Tous les textes ont été écrits dans
`specs/` et `DECISIONS.md` par le PM, jamais par le code. Ce qui en sort de durable est en
§ 3.

### 03/08 — La cible de fumée est financée, et paie avant d'exister

En la montant, on découvre que **le login OIDC n'avait jamais été exécuté et ne fonctionnait
pas**. Quatre causes, dont un certificat de développement sans `subjectAltName` — inutilisable
non seulement par Synapse mais par tout navigateur depuis 2017, alors que REQ-INF-10 exige un
contexte sécurisé pour `getUserMedia`.

Pourquoi personne ne l'avait vu : les tests de REQ-INF-09 vérifiaient que le YAML déclare le
provider. Pas qu'une connexion aboutit.

### 04/08 — Deux personnes ne pouvaient pas se parler

REQ-COR-07 exigeait des appareils vérifiés et **aucune spec ne décrivait comment un appareil
devient vérifié**. Le code faisait exactement ce que la spec disait ; la spec était
inapplicable. Toute la fumée validait jusque-là *un utilisateur qui se parle à lui-même*.

Tranché par **D-08** : la confiance se porte sur l'identité cross-signing, pas sur l'appareil.
Le trou de spec disparaît au lieu d'être comblé par un module de plus — REQ-COR-06 imposait
déjà le bootstrap cross-signing à l'inscription, donc le matériel de confiance existait et
personne ne s'en servait.

### 04/08 — L'audit des jonctions, puis le passage de main

Trois pièges trouvés (voir § 5), le dossier de reprise écrit, et la directive : **la spec 11
est réalisée par un humain senior.** Le livrable des agents n'est plus « commencer la 11 »,
c'est un socle où tout fonctionne jusqu'à elle.

### 05/08 — Cadrage frontend et travail préalable

Découpage `M-A` à `M-I`, `PRODUCT.md`, `DESIGN.md`. Puis fermeture des quatre trous que le
shard aurait payés (§ 5).

---

## 3. Les six règles que cette histoire a produites

Elles ont valeur de jurisprudence : elles ont été posées avec un motif, sur un cas réel.

**1. Chaque jonction entre modules doit avoir un propriétaire nommé dans une spec.**
Cent pour cent des défauts critiques de ce dépôt étaient des jonctions. Une passation que
deux specs mentionnent sans que ni l'une ni l'autre ne la possède n'est vérifiée par rien.

**2. Une erreur se classe par sa résolubilité, pas par sa classe HTTP.**
Un 401 de jeton expiré se résout par un renouvellement, pas par un renvoi manuel message par
message. `failed` doit vouloir dire « l'utilisateur doit agir sur *ce* message ».

**3. Ne jamais valider une hypothèse contre un substitut qui la confirme par construction.**
Deux occurrences en une session. Un mock qui fixe lui-même l'ordre d'émission du SDK ne peut
pas infirmer une hypothèse sur cet ordre. `SSL_CERT_FILE` vérifié en Python quand le client
HTTP de Synapse est Twisted valide un chemin de code que Synapse n'emprunte jamais.

**4. « Module terminé » et « produit qui marche » sont deux portes distinctes.**
Les tests de configuration attestent le contenu des fichiers ; la fumée atteste un
comportement contre un vrai serveur. La spec 01 a été « 100 % conforme » pendant que personne
ne pouvait se connecter.

**5. Tenir la promesse ou la retirer — jamais la laisser affichée sans la tenir.**
Interdit n°13. Quatre arbitrages en sont des applications directes : la reprise de session, le
jeton en clair, la recherche qui retrouvait les messages supprimés, la rétention.

**6. Aucun besoin de développement ne modifie un artefact de production.**
Les écarts dev/prod vivent dans des overlays explicites, chargés volontairement. C'est D-07.

---

## 4. Ce qui est prouvé, ce qui ne l'est pas

```sh
npm test        # imitations, aucune dépendance externe
npm run smoke   # vrai Synapse, vraie crypto, vrai IndexedDB (Docker requis)
```

Aucun compte de tests n'est écrit ici : les deux documents qui en portaient un en donnaient
deux valeurs différentes, toutes deux fausses. **Un nombre qu'aucun test ne garde dérive.**
La commande fait foi.

**Prouvé à l'exécution :** la crypto Rust réellement chargée, un salon effectivement chiffré
côté serveur, l'aller-retour chiffrement → serveur → déchiffrement, la reprise de session sans
réseau, le login OIDC jusqu'à la redirection, la passerelle push à travers le proxy TLS.

**Non prouvé :** le flux SSO complet (il faudrait un navigateur, Playwright est interdit), le
média contre un vrai serveur, LiveKit, et tout ce qui touche l'UI. La cible de fumée est une
**cible**, pas une couverture.

---

## 5. Ce dont hérite le shard UI

Cette section est le dossier de reprise. À lire avant de coder, dans l'ordre : `CLAUDE.md`,
`specs/00-conventions.md`, `specs/11-ui-shard.md`, `specs/ui/00-plan-frontend.md`, puis le
module `M-X` assigné.

### 5.1 Démarrer

```sh
cd infra
cp .env.example .env                       # remplir les secrets
./proxy/generate-dev-certs.sh              # lit .env tout seul, ne rien exporter
docker compose -f docker-compose.yml -f smoke/docker-compose.yml up -d
cd .. && npm run smoke
```

Si la fumée échoue au démarrage, la cause est presque toujours dans `infra/README.md`,
section « Login OIDC » : quatre causes documentées, toutes corrigées, mais elles décrivent les
symptômes que vous reverrez si un réglage saute.

**Cette pile ne monte pas le RTC.** L'overlay `infra/rtc/docker-compose.yml` est séparé et
demande deux IP publiques — voir le piège en 5.4.

### 5.2 Les sept paquets

Tous verts, tous en dépendance unique sur `client-core`. **Aucun n'importe un autre en
production** : c'est le shard qui les compose. Une seule exception, en `devDependencies` :
`media-pipeline` tire `outbox` pour le site de compilation `tests/jonction-outbox.ts`.

| Paquet | Ce qu'il donne | REQ-UI servies |
|---|---|---|
| `@tacita/client-core` | `initSession`, `restoreSession`, `Session` (client, timeline, isEncrypted, recoveryRequired, setupRecoveryKey, identityResetOf, confirmIdentityOf, registerWipe, logout) | 01, 04, 17 |
| `@tacita/messaging` | `sendText`, `reply`, `edit`, `redact`, `react`, `messages`, `subscribe`, `canEdit`, `canRedact`, `createDirectMessage`, `createGroupChat`, `memberCount`, `getPinnedEvents`, `setPinnedEvents`, `parseMentions`, `mentionCandidates`, `createTypingIndicator` | 05–12 |
| `@tacita/outbox` | `createOutbox`, `Outbox` (enqueue/retry/remove/pending/subscribe), `OutboxEntry`, `NOT_ENCRYPTED` | 06, 17 |
| `@tacita/receipts` | `createReceipts`, `ReceiptStatus`, `DELIVERED`, `deliveryUnknowable` | 13 |
| `@tacita/media-pipeline` | `uploadAttachment`, `downloadAttachment`, `saveOriginal`, `waveform`, `AttachmentContent` | 14, 15 |
| `@tacita/search` | `createSearch`, `Search`, `SearchHit`, `SearchStats` | recherche locale |
| `@tacita/calls` | `discoverFocus`, `buildCallWidget`, `CallWidgetDriver`, `activeCall`, `hangupLocal` | appels |

Chaque paquet a un `README.md` avec une section **« Limites assumées »**, écrite pour vous :
ce sont les cas où le module ne peut pas tenir ce que l'UI voudrait afficher. Lisez-les avant
de dessiner un écran qui promet plus.

### 5.3 Le point qui décide de l'onboarding — D-08

**Sans identité cross-signing, un compte ne peut pas chiffrer du tout.** La crypto Rust refuse
l'envoi : *« Encryption failed because cross-signing is not set up on your account »*.

Conséquence sur **REQ-UI-04** : l'étape bloquante de clé de récupération n'est pas un confort.
`setupRecoveryKey()` est ce qui amorce le cross-signing ; **la sauter rend le client muet** —
l'utilisateur pourra lire, jamais écrire.

Le reste de D-08 : les clés Megolm ne vont qu'aux appareils signés par leur propriétaire.
Aucun parcours de vérification (SAS/QR) n'est requis en V1, il est renvoyé post-V1 dans une
spec dédiée. Deux utilisateurs qui ont terminé leur inscription se parlent sans geste
supplémentaire. Détail : `DECISIONS.md` § D-08 et `specs/04-client-core.md` REQ-COR-07.

**Il n'y a pas de `verifyDevice()` — ne le cherchez pas.** L'API a été retirée du contrat le
04/08 : un exporté sans appelant sur un chemin de clés est un piège, et l'interdit n°13 veut
qu'on n'annonce aucune capacité qu'on ne rend pas.

**Le dialogue de réinitialisation d'identité vous revient** — c'est la condition (e) de D-08,
la seule non levée. Quand un correspondant réinitialise son identité, ses anciennes signatures
ne valent plus rien, et l'envoi vers lui doit être bloqué **jusqu'à confirmation explicite dans
l'UI** — pas un avertissement ignorable. Les deux membres existent :

```ts
await session.identityResetOf(userId);   // true → bloquer l'envoi, expliquer pourquoi
await session.confirmIdentityOf(userId); // la confirmation ; lève si elle échoue
```

Le second **lève**, contrairement au premier, et c'est délibéré : le SDK refuse sur votre
propre identifiant et sur un utilisateur sans identité connue. Ne l'avalez pas — une
confirmation ratée qui rouvre l'UI promet un envoi que le chiffrement refusera de toute façon.

Le premier ne lève jamais et replie sur `false`. **La protection ne dépend pas de lui** : c'est
`OnlySignedDevicesIsolationMode` qui fait lever le chiffrement à l'envoi. Ces membres servent à
*expliquer* le blocage, pas à le produire.

Vous n'avez donc **rien à dériver du crypto vous-même**, et c'est le point : la spec 11 interdit
toute logique métier dans le shard. Si vous vous surprenez à appeler `session.client.getCrypto()`,
c'est le signal qu'un membre manque à la spec 04 — demandez-le plutôt que de le contourner.
C'est exactement ce qui s'est passé pour ces deux-là.

### 5.4 Les quatre pièges que les audits ont trouvés

**La passation média → outbox ne compilait pas.** La spec 08 promet « un contenu prêt à
`enqueue` » ; `AttachmentContent` était une `interface`, non assignable au
`Record<string, unknown>` d'`enqueue`. Corrigé, et le site de compilation qui manquait existe :
`packages/media-pipeline/tests/jonction-outbox.ts`. **Si vous créez une autre passation entre
deux paquets, créez son site de compilation** — sinon rien ne la vérifie, aucun paquet ne
dépendant de deux autres.

**`NOT_ENCRYPTED` doit s'importer, jamais se recopier.** C'est l'`errcode` que porte une entrée
bloquée par REQ-OBX-09 (salon non chiffré), et l'UI doit le distinguer d'un échec réseau : le
premier ne se réessaie pas. Importable depuis `@tacita/outbox`. Une chaîne recopiée n'est plus
un contrat.

**Le driver d'appel court-circuite la file d'envoi**, seul endroit du dépôt à le faire hors
`messaging` et `outbox`. C'est imposé par REQ-CAL-05 et documenté en limite assumée dans
`packages/calls/README.md`. Ne le « corrigez » pas vers l'outbox.

**Le focus RTC est annoncé même quand le SFU est absent.** `proxy/nginx.conf` publie
`org.matrix.msc4143.rtc_foci` sans condition (REQ-RTC-05 l'exige), mais les backends
`/livekit/*` vivent dans un overlay que la procédure de démarrage ne monte pas. Sur la pile de
développement, `discoverFocus()` **trouve donc un focus** : vous n'aurez pas `RtcFociMissing`,
vous aurez un 502 au moment de rejoindre. Ne construisez pas l'état d'erreur de REQ-UI-19 en
vous fiant à ce que fait la pile locale. **Tranché le 05/08 (E-08) : l'annonce devient
conditionnelle** — mais tant que l'action A4 n'est pas faite, le comportement décrit ci-dessus
est celui que vous observerez.

### 5.5 Mocker `Session` dans le shard

Passez par `asSession()` de `@tacita/client-core/testing`. Ne refaites pas un
`as unknown as Session` : les six paquets le faisaient, et un membre ajouté au contrat
n'apparaissait alors nulle part — ni à la compilation, ni au démarrage, seulement en
`undefined is not a function`. `identityResetOf` et `confirmIdentityOf` sont passés exactement
par là. Aujourd'hui, ajouter un membre à `Session` casse la compilation d'un seul fichier,
`packages/client-core/src/testing.ts`, qui est le site de compilation du contrat.

### 5.6 Les règles qui mordent l'UI

Les 13 interdits sont dans `CLAUDE.md`. Ceux qui vous concernent :

- **Astryx exclusivement.** Pas de Tailwind, shadcn, Bootstrap, ni CSS-in-JS tiers.
- **Pas de Playwright.** Vitest uniquement, y compris pour les gestes tactiles.
- **IndexedDB, jamais localStorage/sessionStorage**, y compris pour le choix de thème.
- **Aucun contenu déchiffré** dans le cache du service worker, les payloads push, les logs ou
  la télémétrie — **y compris en développement**.
- **Ne jamais trier par `origin_server_ts`.** L'ordre canonique est celui du flux `/sync`, déjà
  rendu par `timeline()`. L'horodatage est indicatif : il sert à REQ-UI-09, pas à l'ordre.
- **Aucune fonctionnalité présentée avec une garantie qu'elle n'offre pas.** Concrètement :
  « délivré » n'est pas du Matrix natif (REQ-RCP-06), les réactions et les épinglés sont en
  clair (REQ-MSG-05/08), les métadonnées d'appel sont visibles du serveur.
- **Chaque test Vitest nomme son exigence** : `describe("REQ-UI-NN — …")`. Sans ID, rejeté.

### 5.7 Ce que vous ne décidez pas seul

- Toute incompatibilité d'Astryx, ponytail ou impeccable avec les contraintes PWA. Ces outils
  **n'ont pas été évalués** : `CLAUDE.md`, « Prudence outillage ». Ne contournez pas en silence.
- Tout affaiblissement de D-08 ou de REQ-COR-07.
- Toute contradiction entre deux specs découverte en les composant. **C'est le mode de panne
  dominant de ce dépôt.**

---

## 6. Le plan — ce qui reste à faire

### 6.1 Cinq actions techniques

| # | Action | Pourquoi | Qui |
|---|---|---|---|
| **A1** | Écrire l'invariant **REQ-MED-02** : un test assertant qu'aucun `sendEvent`/`sendMessage` n'existe dans `media-pipeline`. | Le PM l'a exigé le 04/08 **en contrepartie** de sa décision « le média est hors périmètre de REQ-OBX-09 par construction ». La construction est saine ; rien ne la garde. C'est exactement ce que C1 était avant qu'on le nomme. Jamais écrit. | dev |
| **A2** | Supprimer le dossier `correctif/`. | Décidé au point 10 de l'ordre de marche du 03/08 : « se supprime au merge, comme prévu ». Les merges sont faits depuis le 04/08. Il doublonne `packages/` avec des fichiers **partiellement périmés**, et son propre README avertit de ne pas s'en servir. Un instantané périmé à côté du code vivant est un piège pour le prochain lecteur. | dev |
| **A4** | Rendre l'annonce du focus RTC conditionnelle : la déplacer de la config proxy de base vers l'overlay RTC, et réaligner le test `REQ-RTC-05` sur les deux configs. | Escalade **E-08 tranchée**, `specs/02-rtc-backend.md` amendée. Aujourd'hui une pile sans SFU annonce un focus dont le backend n'existe pas, donc `discoverFocus()` réussit et l'appel meurt en 502 — au lieu du `RtcFociMissing` que REQ-CAL-02 traite en message visible. **À faire avant `M-I`**, sinon le module construit son état d'erreur contre un comportement local trompeur. | dev |
| **A5** | Implémenter la **recherche filtrée** : `mentions` et `msgtype` au schéma, alimentés au déchiffrement, et les critères combinables de `search`. | Escalade **E-01 tranchée**, `specs/09-search.md` REQ-SRC-11. **À faire avant `M-F`** : sans elle, l'onglet Mentions n'a que du plein-texte sur un nom d'affichage, c'est-à-dire le contournement que la décision refuse explicitement. Attention en écrivant : `mentions` dérive du corps déchiffré, l'interdit n°8 s'y applique entièrement. | dev |
| **A6** | Construire le **service de liens d'invitation** (`apps/invite-tokens/`, spec 12) et son raccordement (REQ-INF-15). | Escalade **E-05 tranchée** : le service se fait, sans repli deep link. Vingt exigences, dont huit ne décrivent que des scénarios hors cadre. **La spec 12 attend une ratification du PM sur trois choix de conception** — elle les liste dans sa dernière section. Bloque la partie « ajout par lien » de `M-G` et `M-H`, pas les modules entiers. | dev |

### 6.2 Une action de méthode, bloquante

| # | Action | Pourquoi | Qui |
|---|---|---|---|
| **A3** | Le **spike d'une journée** sur Astryx / ponytail / impeccable, avec compte-rendu d'une page au PM. | Exigé par `specs/11-ui-shard.md` « en tout début de module » et repris dans `M-A`. Aucun des trois outils n'est installé ni évalué pour les gestes tactiles, les contraintes PWA et le rendu hors ligne. **Tant qu'il n'est pas fait, on ne sait pas si REQ-UI-08/09 et REQ-UI-01 sont réalisables tels qu'écrits.** C'est la porte d'entrée de `M-A`, donc de tout le frontend. | senior spec 11 |

### 6.3 Les huit escalades sont tranchées

Décidées le 05/08/2026. Question, décision et motif : `specs/ui/ESCALATIONS.md`. Rien ne
bloque plus un module par manque d'arbitrage.

| Escalade | Décision | Où elle est contraignante |
|---|---|---|
| **E-01** — filtres de recherche | Retenus, schéma étendu proprement, aucun contournement | `specs/09-search.md` REQ-SRC-11 → action **A5** |
| **E-02** — note privée | Locale à l'appareil, non synchronisée, **définitif** | `DECISIONS.md` D-09 |
| **E-03** — messages éphémères | Abandonnés, ni V1 ni backlog, pas même une option grisée | `DECISIONS.md` D-09 |
| **E-04** — modèle « amis » | Mécanismes Matrix natifs, **définitif** ; pas de graphe social | `DECISIONS.md` D-09 |
| **E-05** — liens d'invitation | Service de tokens construit | `specs/12-invite-tokens.md` → action **A6** |
| **E-06** — les 40 `REQ-UIX` | Ratifiées telles quelles | les tests les nomment |
| **E-07** — layout d'appel | Confirmé : pas de client RTC maison | interdit n°7, inchangé |
| **E-08** — focus RTC sans SFU | Annonce conditionnelle | `specs/02-rtc-backend.md` REQ-RTC-05 → action **A4** |

**Ce qui a changé pour les modules :** `M-G` et `M-H` sont débloqués et leur périmètre est
fixé (natif + spec 12) ; `M-F` gagne les filtres en V1 ; `M-I` attend A4. Le backlog
`V2-BACKEND.md` est supprimé — ses quatre items sont tranchés, aucun n'attend plus une V2.

### 6.4 Trois dettes marquées, avec leur seuil de déclenchement

Elles portent un commentaire `ponytail:` dans le code. Aucune n'est à traiter maintenant ;
chacune nomme ce qui doit arriver pour qu'elle le devienne.

| Où | La dette | Le déclencheur |
|---|---|---|
| `packages/client-core/src/session.ts:106` | 3ᵉ copie du motif open/commit IndexedDB (avec `outbox` et `search`) | « à factoriser une fois C3 et C4 tous deux sur `main` » — **c'est le cas depuis le 04/08**, donc actionnable dès qu'on touche à l'un des trois |
| `packages/search/src/engine.ts:132` | snapshot complet de l'index à chaque appel d'`index()` | latence visible constatée par le shard |
| `packages/search/src/worker.ts:43` | file globale : un rattrapage fait attendre une recherche | idem — découper côté proxy, un message par lot |

### 6.5 Ce qui est renvoyé après la V1

Ni actions ni dettes : des décisions déjà prises de ne pas faire maintenant.

- **SAS/QR** — parcours de vérification interactive, spec dédiée. C'est le chemin de relèvement
  de la limite que D-08 assume (la compromission complète du compte d'un correspondant rend ses
  signatures menteuses).
- **Clé de pickle + écran de déverrouillage** — relèvement de D-06 (jeton d'accès et clés
  Megolm en clair dans IndexedDB). Décision produit qui touche la spec 11, mérite sa propre spec.

---

## 7. Où est le reste

| Question | Fichier |
|---|---|
| Les interdits, la stack, le workflow | `CLAUDE.md` |
| Pourquoi telle décision produit | `DECISIONS.md` (D-01 à D-09) |
| Les exigences, par module | `specs/00` à `specs/11` |
| Le découpage frontend et son plan | `specs/ui/00-plan-frontend.md`, `M-A` à `M-I` |
| Les huit escalades et leurs motifs | `specs/ui/ESCALATIONS.md` |
| Le service de liens d'invitation | `specs/12-invite-tokens.md` |
| Stratégie produit et voix | `PRODUCT.md` |
| Système visuel et tokens | `DESIGN.md` |
| Les limites assumées d'un module | le `README.md` du package concerné |
| Le login OIDC et ses quatre causes | `infra/README.md` |
| Ce que la fumée prouve et ne prouve pas | `infra/smoke/README.md` |
| Le détail de tout ce qui précède le 05/08/2026 | `git log` |
