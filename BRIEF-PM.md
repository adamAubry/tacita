# Brief PM — arbitrages ouverts sur Tacita

**Destinataire :** PM du projet Tacita
**Émetteur :** agent de développement (Claude Code), session du 03/08/2026
**Objet :** neuf points d'arbitrage bloquant ou orientant la suite du développement
**Dépôt :** `git@github.com:adamAubry/tacita.git`

---

## 1. Qui vous écrit, et dans quelles limites

Je suis un agent de développement intervenant sur ce dépôt. Cette session a consisté en un audit
complet du code livré, puis en la correction des défauts critiques trouvés.

**Ce que je me suis autorisé :** lire tout le dépôt, écrire du code dans `packages/` et `apps/`,
ajouter des tests, écrire de la documentation technique, créer des branches, pousser sur `origin`.

**Ce que je me suis interdit, et c'est le cœur de ce brief :**

- **Je n'ai amendé aucune spec.** `CLAUDE.md` pose que « les specs sont exécutables, le code les
  implémente, jamais l'inverse ». Deux de mes correctifs dévient du texte d'une REQ existante ou en
  créent une nouvelle. Amender le contrat est votre décision, pas la mienne. `specs/` est intact.
- **Je n'ai pas écrit dans `DECISIONS.md`.** Ce fichier est marqué « Décisions PM fermes. Toute
  remise en cause passe par le PM, pas par un contournement dans le code ». Une décision a été prise
  en séance qui mérite d'y figurer (D-06) ; je l'ai documentée dans le README du package concerné et
  je vous la soumets, sans l'inscrire moi-même.
- **Je n'ai rien mergé.** `main` est exactement là où je l'ai trouvée. Tout attend votre arbitrage et
  celui des seniors.

Cette retenue n'est pas de la timidité procédurale : sur un produit dont le principe directeur est
« le serveur ne voit jamais de contenu en clair », un contrat de sécurité modifié en douce par le
code est plus dangereux qu'un bug connu.

---

## 2. Le produit

**Tacita** est une messagerie chiffrée de bout en bout, auto-hébergée, livrée en PWA. Elle vise à
remplacer les DM et groupes Instagram pour un cercle fermé d'utilisateurs.

**Principe directeur, répété dans tous les documents du projet : le serveur ne voit jamais de
contenu en clair.** Tout le reste en découle — y compris les limites assumées, qui sont documentées
plutôt que masquées (c'est une exigence explicite du projet, l'interdit n°13).

**Stack imposée :**

| Brique | Choix | Raison |
|---|---|---|
| Homeserver | Synapse + PostgreSQL | fédération désactivée, application fermée |
| Chiffrement | matrix-js-sdk avec crypto Rust (vodozemac) | libolm est déprécié et interdit |
| Authentification | Keycloak en OIDC | pas de mot de passe natif Synapse |
| Médias | MinIO (S3), chiffrement côté client | le serveur ne stocke que des blobs opaques |
| Appels | LiveKit + Element Call en widget | aucun client RTC maison |
| Notifications | passerelle Web Push maison (VAPID) | Sygnal ne gère qu'APNs et FCM, pas le Web Push standard |
| Recherche | Orama, index local en Web Worker | `/search` de Synapse est inopérant sur salon chiffré |
| UI | Next.js 15 App Router + Astryx UI | shard unique, spec 11 |

**Conséquences structurantes du chiffrement de bout en bout**, que le produit assume et documente :
les réactions circulent en clair (le serveur agrège les annotations), `m.room.pinned_events` est un
événement d'état donc non chiffré, l'accusé « délivré » est une extension maison et non du Matrix
natif, la recherche ne couvre que l'historique téléchargé sur l'appareil, et les métadonnées restent
visibles du serveur.

---

## 3. La méthode du projet

C'est du **spec-driven development**, appliqué strictement, et il faut le comprendre pour arbitrer
correctement.

- `specs/00-conventions.md` définit les règles transversales. `specs/01` à `specs/11` sont **un
  contrat autonome par module** : un développeur doit pouvoir réaliser une spec sans lire les
  autres, hors dépendances déclarées en tête.
- Chaque exigence porte un identifiant `REQ-<PRÉFIXE>-<NN>` — par exemple `REQ-MSG-04`.
- **Chaque test Vitest nomme l'exigence qu'il couvre** dans son `describe`. Un test sans ID est
  rejeté en revue ; une exigence sans test nommé n'est pas couverte.
- Un module est « terminé » quand 100 % de ses REQ ont un test nommé qui passe.
- `DECISIONS.md` porte les arbitrages produit fermes (D-01 à D-05). Les specs y renvoient par leur
  ID. Le code ne les rediscute pas.
- `CLAUDE.md` porte 13 interdits absolus (pas de Tailwind, pas de localStorage pour des données
  utilisateur, jamais `/search` de Synapse, pas de libolm, jamais de tri par `origin_server_ts`,
  aucun contenu déchiffré dans les logs ou les payloads push, etc.).
- Hooks de pré-commit bloquants dès le premier commit : lint, typecheck, tests. `--no-verify` est
  proscrit par convention d'équipe.
- **Vitest uniquement. Playwright interdit.** CI/CD après le ship seulement.
- Waterfall : les specs 01 à 10 se développent en parallèle, la 11 (le shard UI) intègre en dernier.

**Ce point de méthode est central pour vos arbitrages :** quand mon code et le texte d'une spec
divergent, le projet impose que ce soit la spec qui tranche. D'où trois de mes neuf questions.

---

## 4. L'architecture du dépôt

Monorepo pnpm workspaces. Le client est découpé en **packages headless** — logique métier, zéro DOM,
zéro composant — et **un unique shard UI** qui les consomme.

```
tacita/
├── CLAUDE.md                    principe directeur, stack imposée, 13 interdits absolus
├── DECISIONS.md                 arbitrages produit fermes (D-01 à D-05)
├── specs/
│   ├── 00-conventions.md        règles transversales — à lire en premier
│   ├── 01-infra-synapse.md      REQ-INF-01..13
│   ├── 02-rtc-backend.md        REQ-RTC-01..07
│   ├── 03-push-gateway.md       REQ-PSH-01..05
│   ├── 04-client-core.md        REQ-COR-01..10
│   ├── 05-messaging.md          REQ-MSG-01..12
│   ├── 06-receipts.md           accusés 3 niveaux
│   ├── 07-outbox.md             REQ-OBX-01..08
│   ├── 08-media-pipeline.md     chiffrement/compression média
│   ├── 09-search.md             REQ-SRC-01..09
│   ├── 10-calls.md              intégration Element Call
│   └── 11-ui-shard.md           LE shard UI
├── packages/
│   ├── client-core/    spec 04 — session, crypto, store, sync    ✅ livré
│   ├── messaging/      spec 05 — domaine conversations           ✅ livré
│   ├── outbox/         spec 07 — file d'envoi persistante        ✅ livré
│   ├── search/         spec 09 — index local Orama               ✅ livré
│   ├── receipts/       spec 06                                   ⬜ non commencé
│   ├── media-pipeline/ spec 08                                   ⬜ non commencé
│   └── calls/          spec 10                                   ⬜ non commencé
├── apps/
│   ├── push-gateway/   spec 03 — passerelle Web Push             ✅ livré, ⚠️ non déployé
│   └── web/            spec 11 — le shard UI                     ⬜ non commencé
└── infra/              specs 01 et 02 — config-as-code           ✅ livré
```

**Règle de dépendance :** `apps/web` dépend des packages ; les packages ne dépendent jamais de
`apps/web` ni entre eux, sauf déclaration explicite dans leur spec. `client-core` est la fondation —
**aucun autre package n'importe matrix-js-sdk pour la session.** Cette règle contraint plusieurs de
mes correctifs et explique certains choix qui pourraient sembler détournés.

**État d'avancement :** 7 modules livrés sur 11. Les 4 restants sont 06 (accusés), 08 (média), 10
(appels) et 11 (UI). La 11 intègre tout le reste et n'a pas commencé.

---

## 5. Ce que j'ai fait

### 5.1 L'audit

J'ai relu l'intégralité du code livré, les specs, la config d'infra et les tests.

**Le constat positif d'abord, parce qu'il est réel :** la traçabilité spec↔test est exemplaire.
**100 % des exigences existantes ont au moins un test nommé qui passe** — 185 tests, 22 fichiers,
tous verts. La convention `describe("REQ-XXX-NN — …")` est tenue partout sans exception. Les images
Docker sont épinglées par digest, aucun secret n'est en dur, les limites produit sont documentées
plutôt que masquées.

**Le constat négatif :** j'ai trouvé 4 défauts critiques, 14 non critiques et 8 pistes
d'amélioration. Et surtout un motif — **aucun de ces défauts n'est une bavure locale.** Ce sont des
jonctions entre modules que personne ne possède. Chaque spec est respectée individuellement ; c'est
l'espace entre les specs qui ne l'est pas.

Exemple parlant : la garde de chiffrement existe dans `messaging` et pas dans `outbox`, parce que la
spec 05 met la file d'attente hors scope et que la spec 07 ne parle pas de chiffrement. Les deux
specs sont respectées. Le trou est entre elles.

### 5.2 Les correctifs

Trois des quatre défauts critiques sont corrigés, plus deux non critiques promus parce qu'ils
bloquaient un correctif critique.

| # | Défaut | Ce que c'était |
|---|---|---|
| **C3** | Écritures IndexedDB résolues avant le commit | `REQ-OBX-01` promet « persisté avant toute tentative réseau ». La promesse résolvait sur l'acceptation de la requête, pas sur le commit de la transaction : une fermeture d'onglet dans cette fenêtre perdait un message que l'UI affichait déjà comme mis en file. C'est la garantie que la spec 07 existe pour fournir. |
| **C2** | Texte en clair réécrit sur disque après déconnexion | Le tampon de la recherche n'était pas vidé par le wipe : son timer se déclenchait après la déconnexion, réindexait ce qu'il retenait, et repersistait le snapshot. **Violation de l'interdit absolu n°8.** |
| **N3** | L'outbox envoyait avant que `/sync` soit sain | Un flush était armé dès la construction, avant la première synchronisation. |
| **N2** | Un jeton expiré condamnait toute la file | Tout 4xx hors rate-limit était classé définitif. Un jeton expiré est un 401 : toute la file passait `failed` d'un coup et exigeait un renvoi manuel, message par message. |
| **C4** | Aucune reprise de session | `initSession` exigeait un jeton OIDC frais à chaque appel et rien ne persistait les credentials. **Trois promesses du produit étaient donc vraies sur le papier et inatteignables en pratique** : historique hors ligne (REQ-COR-03), file d'envoi qui survit au rechargement (REQ-OBX-01), index de recherche persisté (REQ-SRC-02). L'application ne savait pas se rouvrir sans réseau. |

**Il reste C1**, décrit en détail dans le document de remédiation : l'outbox envoie sans la garde de
chiffrement que `messaging` applique à chaque écriture.

### 5.3 Ma méthode de vérification, et ce qu'elle ne prouve pas

Chaque correctif a été validé par : lint, typecheck, suite complète, **et une vérification que le
nouveau test échoue quand on retire le correctif.** Un test qui passe avant et après ne prouve rien ;
je les ai cassés un par un pour m'en assurer. C2, N3, N2 et C4 mordent.

**Ce que ça ne prouve pas, et c'est important pour votre arbitrage n°9 :** la suite est
intégralement à base de mocks. Aucun test n'exécute le vrai matrix-js-sdk, un vrai Web Worker, un
vrai IndexedDB, ni Synapse. Les tests d'infra parsent les fichiers YAML — ils attestent de leur
contenu, pas de l'interprétation qu'en fait le serveur.

J'en ai fait l'expérience en direct : en écrivant N3, j'avais posé une hypothèse sur l'ordre dans
lequel le SDK publie son état de synchronisation. Le mock confirmait cette hypothèse — puisque c'est
le mock qui fixe l'ordre. Si l'hypothèse était fausse, la file d'envoi ne serait jamais repartie
après une reconnexion, et **aucun test n'aurait pu le voir.** J'ai réécrit le correctif pour ne plus
dépendre de cet ordre. Mais le problème de fond demeure pour tout le reste du code.

---

## 6. Où lire — emplacements exacts

Tout est poussé sur `origin`. **`main` est intacte, à `f015e56`, et aucune de ces branches n'y a été
mergée.**

### Branche à ouvrir en priorité

```
origin/review/remediation
```

Elle réunit les trois branches de correctifs pour qu'on lise l'ensemble d'un bloc. **192 tests
verts** (les 185 de `main` + 7 nouveaux), lint et typecheck propres.

⚠️ **Cette branche ne doit pas être mergée dans `main`.** Elle sert à lire, pas à intégrer. Merger
ferait rentrer les trois correctifs d'un coup, dont ceux dont la spec n'est pas encore amendée.

### Documents

| Fichier | Contenu |
|---|---|
| `REMEDIATION-CRITIQUES.md` | **Le document principal.** État, un chapitre par défaut corrigé (le bug, pourquoi ce correctif-là, les conséquences), le plan pour C1, les limites de la vérification, la section « À statuer par le CM », et l'inventaire des fichiers touchés. |
| `BRIEF-PM.md` | Ce document. |
| `correctif/` | Archive de la revue : les fichiers tels que déposés avant application. Doublonne `packages/`, supprimable sans perte au merge. |
| `packages/client-core/README.md` | Les limites assumées de la reprise de session, dont celle qui motive D-06. |

### Branches de correctif — ce sont elles qui partent, une par une

| Branche | Commits | Contenu | Tests |
|---|---|---|---|
| `origin/fix-c3-c2` | 5 | C3, C2, et toute la documentation | 186 |
| `origin/fix-n3-n2` | 2 | N3 et N2 | 187 |
| `origin/fix-c4` | 2 | C4 | 189 |

Les trois partent de `main` et **ne se touchent pas** : chacune se relit, se valide et se merge
seule, dans n'importe quel ordre. Les compteurs ne s'additionnent pas — chacun est mesuré depuis les
185 tests de `main`.

Note : `origin/spec-05-messaging` et `origin/spec-09-search` sont des branches antérieures dont le
contenu est déjà dans `main`. Elles peuvent être supprimées.

---

## 7. Votre mission

Neuf points attendent votre arbitrage. Ils sont détaillés en section 5 de
`REMEDIATION-CRITIQUES.md` ; ce qui suit en donne la substance et l'enjeu.

### Trois décisions bloquent un merge

**1. `REQ-OBX-04` — amender le texte, ou revert N2.**
La spec 07 dit aujourd'hui : « Échec définitif (4xx non-ratelimit) → `failed` ». Mon correctif
exclut aussi les erreurs de jeton, donc le code et le texte divergent. Formulation que je propose :
« Échec définitif (4xx qui ne se résout ni par l'attente ni par un renouvellement de jeton) →
`failed` ». **Sans cet amendement, `fix-n3-n2` ne doit pas partir.**

**2. `REQ-COR-11` — créer l'exigence, ou renoncer à la reprise de session.**
La reprise de session n'existe dans aucune spec. Proposition : « `restoreSession()` rouvre la
session persistée sans aucun appel réseau ; l'absence de session locale se signale par `null` et non
par une erreur », plus une extension de REQ-COR-10 pour que le wipe couvre les credentials.
**Si vous refusez cette exigence, il faut retirer les promesses hors ligne de REQ-COR-03, REQ-OBX-01
et REQ-SRC-02**, qui ne sont pas tenables sans elle. C'est l'un ou l'autre, pas ni l'un ni l'autre.
**Sans arbitrage, `fix-c4` ne doit pas partir.**

**3. `D-06` — ratifier le stockage du jeton d'accès en clair.**
Le fait qui motive la décision : `initRustCrypto` tourne **sans clé de pickle**, donc l'état crypto —
clés Megolm comprises — est déjà en clair dans IndexedDB. Chiffrer le seul jeton en laissant les clés
à côté présenterait une garantie que le module n'offre pas, ce que l'interdit n°13 proscrit.
**Conséquence à assumer explicitement : qui a accès au profil du navigateur a accès au compte et à
l'historique déchiffrable.** Relever le niveau suppose une clé de pickle sur le store crypto *et* un
écran de déverrouillage à chaque ouverture — décision produit qui touche la spec 11 et qui mérite sa
propre spec.

### Six arbitrages de priorité

**4. C1 est-il plus exploitable que je ne l'estime ?** Je l'ai classé « exposition faible » parce que
le serveur force le chiffrement sur tout nouveau salon. Si un chemin existe qui crée un salon non
chiffré (invitation externe, salon créé hors `createDirectMessage`, migration), C1 remonte en tête.
**C'est le seul point où mon évaluation de gravité peut être franchement fausse.**

**5. La recherche retrouve les messages supprimés.** L'index n'écoute que le déchiffrement : une
suppression ne retire pas le document, une édition en ajoute un second sans retirer l'ancien. La
recherche rend donc le texte de messages supprimés et l'ancienne version des messages édités. **Ni
la spec 09 ni le code ne traitent le cas.** « Supprimer un message » qui laisse le texte trouvable
est une promesse produit non tenue.

**6. Le rattrapage d'historique s'auto-évince.** Le moteur de recherche documente son horodatage
comme « local, sert à l'éviction » ; le code y met `origin_server_ts`. Une pagination arrière insère
donc des documents anciens, que l'éviction supprime en premier. Or les statistiques ont besoin, elles,
de `origin_server_ts` pour afficher la période couverte (REQ-SRC-06). Deux besoins, un champ — le
correctif demande deux champs, donc un amendement de la spec 09.

**7. La passerelle push n'est déployée nulle part.** Pas de Dockerfile, absente du
`docker-compose.yml`, aucune route nginx, aucune variable VAPID dans `.env.example`. La spec 03 la
déclare « service Node autonome », la spec 01 ne la provisionne pas : **personne ne possède le
raccordement.** Le module est terminé et inutilisable en l'état. Qui le prend, la 01 ou la 03 ?

**8. `retention.enabled: true` contre l'intention de D-02.** D-02 dit « ne jamais purger ». Activer
la rétention ouvre la porte aux politiques par salon, et il reste à vérifier sur la version Synapse
déployée que `purge_jobs: []` est bien respecté comme liste vide et non remplacé par un job par
défaut. `CLAUDE.md` impose de relire la doc de la version déployée plutôt que de supposer : c'est
exactement ce cas.

**9. Financer une cible de fumée avant la spec 11 ?** Voir 5.3. Sept modules seront intégrés d'un
coup, validés jusque-là par des mocks. Une seule cible — `docker compose up`, login OIDC,
envoi/réception dans un salon chiffré, en Vitest contre un Synapse éphémère — rendrait le risque
visible maintenant plutôt qu'à l'intégration. Playwright reste interdit ; ce n'en est pas.

---

## 8. Ce qu'on attend de votre décision

Une décision **étayée**, pas un verdict. Concrètement, pour chaque point :

1. **La décision elle-même**, sans ambiguïté : amender / revert / reporter / refuser.
2. **Le motif**, en une ou deux phrases. Sur les trois bloquants, le motif compte autant que la
   décision : il fera jurisprudence pour les modules 06, 08, 10 et 11 qui restent à écrire.
3. **Le texte exact** quand la décision est un amendement de spec ou une entrée `DECISIONS.md` —
   c'est vous qui écrivez dans `specs/` et `DECISIONS.md`, je ne l'ai volontairement pas fait.
4. **L'ordre de marche** : quelles branches partent, dans quel ordre, et ce qui attend.

Et pour la suite du projet, les directives qu'il nous faut :

- **C1 :** je le traite maintenant, ou il attend ? Sa gravité dépend de votre réponse au point 4.
- **Priorité des modules restants** : 06 (accusés), 08 (média), 10 (appels), 11 (UI). La 11 intègre
  tout et n'a pas commencé.
- **Le raccordement de la passerelle push** (point 7) : à qui, et quand.
- **La dette de test** (point 9) : on finance une cible réelle avant la 11, ou on assume le risque
  d'intégration.

### Contraintes à respecter dans votre arbitrage

- **D-01 à D-05 sont fermes.** Si l'un d'eux doit bouger, il faut le rouvrir explicitement, pas le
  contourner.
- **Les 13 interdits de `CLAUDE.md` ne se négocient pas dans une PR.** Deux des défauts corrigés en
  violaient un ; si un arbitrage devait en assouplir un, ça se fait dans `CLAUDE.md`, en toutes
  lettres, avec un motif.
- **L'honnêteté produit est une exigence, pas une préférence.** Aucune fonctionnalité ne peut être
  présentée avec une garantie qu'elle n'offre pas. Trois de mes questions (2, 3, 5) sont exactement
  ça : une promesse qui n'est pas tenue aujourd'hui. Les options sont de la tenir ou de retirer la
  promesse — jamais de la laisser affichée sans la tenir.
