# SPEC 00 — Conventions transversales

S'applique à tous les modules. Chaque spec de module (01 à 11) est un contrat autonome : un développeur doit pouvoir la réaliser sans lire les autres, hors dépendances déclarées en tête de spec.

## Architecture générale

Monorepo pnpm workspaces. Le client est découpé en **packages headless** (logique métier, zéro DOM, zéro composant) et **un unique shard UI** (spec 11) qui les consomme. Les services serveur sont des packages indépendants.

```
packages/
  client-core/        # spec 04 — session, crypto, store, sync
  messaging/          # spec 05 — domaine messages
  receipts/           # spec 06 — accusés 3 niveaux
  outbox/             # spec 07 — file d'envoi persistante
  media-pipeline/     # spec 08 — chiffrement/compression média
  search/             # spec 09 — index local Orama
  calls/              # spec 10 — intégration Element Call
apps/
  web/                # spec 11 — LE shard UI (Next.js 15 + Astryx)
  push-gateway/       # spec 03 — passerelle Web Push
infra/                # specs 01 et 02 — config-as-code Synapse, LiveKit, proxy
```

Règle de dépendance : `apps/web` dépend des packages ; les packages ne dépendent jamais de `apps/web` ni entre eux sauf déclaration explicite dans leur spec. Tout échange passe par les interfaces TypeScript exportées, décrites dans chaque spec.

## Identifiants d'exigence

Chaque exigence porte un ID `REQ-<PREFIXE>-<NN>` défini dans sa spec (ex. `REQ-MSG-04`). **Chaque test Vitest nomme l'exigence qu'il couvre** dans son `describe` ou `it` :

```ts
describe("REQ-MSG-04 — réponse via m.in_reply_to", () => { ... })
```

Une exigence sans test nommé n'est pas couverte ; un test sans ID d'exigence est rejeté en revue.

## Tests

- Framework unique : **Vitest**. **Playwright interdit.** Composants UI testés via Vitest + Testing Library (environnement jsdom/happy-dom), gestes simulés par événements pointer.
- Un module est « terminé » quand : 100 % de ses REQ ont au moins un test nommé qui passe, et `pnpm test` est vert sur le package.
- La config infra (specs 01–02) est testée aussi : les tests parsent les fichiers YAML rendus et assertent les valeurs critiques.
- **Mocker `Session` passe par `asSession()`** (`@tacita/client-core/testing`), jamais par un `as unknown as Session`. Six paquets faisaient le second : un membre **ajouté** au contrat n'apparaissait alors nulle part — ni à la compilation, ni au démarrage, seulement en `undefined is not a function`. Aujourd'hui, ajouter un membre à `Session` casse la compilation d'un seul fichier, `packages/client-core/src/testing.ts`, qui est le site de compilation du contrat.
- **Toute passation entre deux paquets a un site de compilation.** Aucun paquet ne dépendant de deux autres, une promesse d'interface entre modules n'est vérifiée par *rien* — ni compilateur, ni test. La spec 08 promettait « un contenu prêt à `enqueue` » (spec 07) et c'était faux : `AttachmentContent` était une `interface`, non assignable au `Record<string, unknown>` d'`enqueue`. Le motif à reproduire : `packages/media-pipeline/tests/jonction-outbox.ts`, un fichier sans test, qui **est** le test — s'il cesse de compiler, la passation est cassée.
- **Un test qui s'exécute sous Vitest ne prouve pas que le code démarre en production.** Vitest transpile ; `node --experimental-strip-types`, qui fait tourner les services de `apps/`, *retire* les types sans les transformer et refuse toute construction TypeScript qui génère du code (propriété de paramètre, `enum`, `namespace`). Un service peut avoir 100 % de ses REQ vertes et ne pas booter. Là où un service est lancé par ce moteur, un test charge ses modules **avec ce moteur** (`infra/tests/invite-tokens.test.ts`).

## Workflow

- Waterfall jusqu'au ship : les specs 01–10 se développent en parallèle, la 11 s'intègre en dernier. CI/CD après le ship uniquement.
- Dev par blocs : un bloc = une ou plusieurs REQ ; un commit n'est autorisé que si les tests du bloc passent.
- **Hooks de pré-commit bloquants dès le premier commit** (husky + lint-staged) : lint, typecheck, tests du package modifié. Non désactivables (`--no-verify` proscrit par convention d'équipe).

## Interdits globaux (rappel, détaillés dans CLAUDE.md)

Tailwind/shadcn/Bootstrap/CSS-in-JS tiers ; localStorage/sessionStorage pour données utilisateur ; endpoint `/search` de Synapse ; libolm ; endpoint thumbnail serveur sur média chiffré ; tri par `origin_server_ts` ; client RTC maison ; contenu déchiffré dans cache SW, payloads push, logs, télémétrie, traces d'erreur — y compris en dev.

## Six règles nées de défauts réels

Elles ont valeur de jurisprudence : chacune a été posée sur un cas vécu dans ce dépôt, avec son motif. Les ignorer, c'est recommettre le défaut qui les a produites.

**1. Chaque jonction entre modules a un propriétaire nommé dans une spec.** Cent pour cent des défauts critiques de ce dépôt étaient des jonctions. Le cas d'école : la garde de chiffrement existait dans `messaging` et pas dans `outbox`, parce que la spec 05 met la file hors scope et que la spec 07 ne parlait pas de chiffrement. Les deux specs respectées, le trou entre elles. Une passation que deux specs mentionnent sans que ni l'une ni l'autre ne la possède n'est vérifiée par rien.

**2. Une erreur se classe par sa résolubilité, pas par sa classe HTTP.** Un 401 de jeton expiré se résout par un renouvellement, pas par un renvoi manuel message par message. `failed` doit vouloir dire « l'utilisateur doit agir sur *ce* message ».

**3. Ne jamais valider une hypothèse contre un substitut qui la confirme par construction.** Un mock qui fixe lui-même l'ordre d'émission du SDK ne peut pas infirmer une hypothèse sur cet ordre. Une imitation de base monothread ne peut pas éprouver l'atomicité d'une transaction. `SSL_CERT_FILE` vérifié en Python quand le client HTTP de Synapse est Twisted valide un chemin que Synapse n'emprunte jamais.

**4. « Module terminé » et « produit qui marche » sont deux portes distinctes.** Les tests de configuration attestent le contenu des fichiers ; la cible de fumée atteste un comportement contre un vrai serveur. La spec 01 a été « 100 % conforme » pendant que personne ne pouvait se connecter, et le service de la spec 12 a eu ses vingt REQ vertes avant de pouvoir démarrer.

**5. Tenir la promesse ou la retirer — jamais la laisser affichée sans la tenir.** C'est l'interdit n°13, et la section « Honnêteté produit » ci-dessous en est l'application.

**6. Aucun besoin de développement ne modifie un artefact de production.** Les écarts dev/prod vivent dans des overlays explicites, chargés volontairement (D-07).

## Ce qui ne se décide pas dans le code

Trois choses s'escaladent au PM plutôt que de se trancher dans une PR :

- toute **incompatibilité d'outillage** constatée (Astryx en `0.2.0` ; voir « Prudence outillage » de `CLAUDE.md`) — ne pas contourner en silence ;
- tout affaiblissement d'une décision de `DECISIONS.md`, en particulier D-08 et REQ-COR-07 ;
- toute **contradiction entre deux specs** découverte en les composant. C'est le mode de panne dominant de ce dépôt : chaque spec est respectée, et l'espace entre elles ne l'est pas.

## Honnêteté produit

Aucune fonctionnalité n'est présentée (UI ou doc) avec une garantie qu'elle n'offre pas. Chaque spec liste ses limites assumées ; elles sont documentées, jamais masquées. Exemples imposés : réactions en clair, reçu « délivré » non chiffré et non standard, `m.room.pinned_events` non chiffré, métadonnées visibles serveur.

## Précaution versions

Les défauts Synapse varient selon les versions : lire la config de la version déployée, ne pas supposer. Les MSC MatrixRTC ne sont pas stabilisés : toute valeur littérale (préfixes d'événements, state keys) doit être relue dans la doc courante d'Element Call avant usage. Le comportement de l'authenticated media a changé récemment : à vérifier dans la version déployée (spec 01).
