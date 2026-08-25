# CLAUDE.md — Messagerie E2EE auto-hébergée (PWA Matrix)

PWA de messagerie chiffrée de bout en bout remplaçant les DM/groupes Instagram. Synapse + PostgreSQL, client matrix-js-sdk, appels via LiveKit + Element Call en widget. **Principe directeur : le serveur ne voit jamais de contenu en clair.** *(Précisé le 20/08/2026, D-11 : « contenu » est le mot exact, et il ne couvre pas les métadonnées. Le serveur voit qui parle à qui, quand, à quelle fréquence, et **le poids de chaque pièce jointe — donc, à débit quasi constant, la durée de chaque vidéo et de chaque vocal**. C'est assumé, borné et écrit dans `infra/LIMITES.md` ; ce n'est pas un défaut à corriger en silence, et surtout pas une promesse à laisser lire plus large qu'elle n'est.)* *(Amendé le 25/08/2026, **D-12 puis D-14** : le changement de mot de passe envoie la **clé de récupération** au serveur, qui peut alors déchiffrer tout l'historique du compte — et depuis D-14, cette même clé **ouvre une session** à elle seule, quand le mot de passe est perdu. Non stocké n'est pas non vu ; un facteur, plus deux ; et cette clé ne se remplace pas sans perdre l'historique. Motif et bornes : D-12, D-14 et `infra/LIMITES.md`. **D-15** ajoute la conséquence qui va avec : cette clé étant dérivée du **mot de passe**, c'est lui qui protège l'historique chiffré, et le descripteur qui permet de l'attaquer hors ligne est de l'account data.)*

## Source de vérité

Spec-driven development : les specs sont exécutables, le code les implémente, jamais l'inverse.

- `specs/00-conventions.md` — architecture du monorepo, IDs d'exigence, séquencement. **Les règles de comportement qui y vivaient sont désormais ici** (§ Boucle de développement, § Tests, § Sept règles) : ce fichier-ci est chargé à chaque session, pas lui, et une règle rangée là où personne ne la lit au bon moment n'a jamais rien empêché. Un fait, une maison — si les deux fichiers se contredisent, c'est un bug à corriger, pas une préséance à appliquer.
- `specs/01..12-*.md` — un contrat par module. Ne travailler que dans le module assigné.
- `DECISIONS.md` — arbitrages produit tranchés (**D-01 à D-15**). Ne pas les rediscuter dans le code ; escalader au PM. Une entrée peut aussi porter des **notes de conception** non normatives et des **points ouverts** — elle le dit alors en tête. *(Étendu le 20/08/2026 ; D-11 à D-15 tranchées les 20 et 25/08/2026.)*
- `specs/ui/` — découpage frontend du shard UI (modules M-A à M-I, plan, ESCALATIONS.md). Pour tout travail dans `apps/web`, le module M-X assigné est le contrat ; la SPEC 11 reste l'autorité fonctionnelle.
- `PRODUCT.md` et `DESIGN.md` (racine) — stratégie produit et système visuel (voir section impeccable).

## Stack imposée

- Next.js 15 App Router — uniquement `apps/web`. *(Ce point disait « plugin ponytail » : erreur de catégorie corrigée le 05/08/2026. **ponytail est un plugin d'agent**, un style de codage, sans rapport avec Next.js et sans aucune empreinte à l'exécution. Le paquet npm homonyme, publié en 2019, n'a rien à voir — ne pas l'installer.)*
- **Astryx UI** exclusivement, avec le plugin **impeccable** (voir section dédiée)
- matrix-js-sdk avec crypto Rust (vodozemac) ; monorepo pnpm ; tests **Vitest** uniquement

## Interdits absolus

1. **Pas de Tailwind, shadcn, Bootstrap, ni CSS-in-JS tiers** — Astryx seul. **Exception ratifiée le 05/08/2026 : `@stylexjs/stylex`.** C'est le moteur de style d'Astryx lui-même, pas une couche ajoutée par-dessus : peer dependency, distribution déjà compilée en classes atomiques, rien à brancher dans le build. Le refuser reviendrait à refuser Astryx. L'interdit vise les systèmes de style **concurrents** d'Astryx, et lui seul. Sans ambiguïté en revanche : Astryx livre un `tailwind-theme.css` — **ne jamais l'importer**, ce serait Tailwind par la porte de derrière.
2. **Pas de localStorage/sessionStorage** pour des données utilisateur — IndexedDB uniquement.
3. **Ne jamais appeler `/search` de Synapse** ni construire de repli dessus (inopérant sur salon chiffré). Recherche 100 % locale (spec 09).
4. **Pas de libolm** (déprécié) — vodozemac via le SDK.
5. **Ne jamais appeler `/_matrix/media/*/thumbnail`** sur média chiffré — vignettes côté client (spec 08).
6. **Ne jamais trier par `origin_server_ts`** — l'ordre canonique est celui du flux `/sync`.
7. **Pas de client RTC maison** — Element Call en widget, point final.
8. **Aucun contenu déchiffré** dans le cache du service worker, les payloads push, les logs, la télémétrie ou les traces d'erreur — y compris en développement.
9. **Ne pas supposer un accusé « délivré » natif** — Matrix ne définit que `m.read` ; le nôtre est une extension (spec 06), jamais présentée comme du Matrix natif.
10. **Ne pas décrire `/sync` comme du WebSocket** — c'est du long-polling HTTP.
11. **Pas de canal d'upload parallèle** — un seul pipeline média pour tous les fichiers (spec 08).
12. **Pas de Playwright.** Aucun navigateur piloté dans la suite de tests : les exigences se prouvent en Vitest, ou elles se documentent comme non prouvées. **Exception ratifiée le 05/08/2026 : le moteur d'URL d'`impeccable`**, qui utilise puppeteer. Il est un outil d'**audit de design**, jamais un harnais de test — il ne s'exécute ni dans `npm test`, ni dans un hook, et aucune exigence ne s'appuie sur lui. Les moteurs statiques d'impeccable (HTML, CSS, regex) n'ont besoin d'aucun navigateur et restent le chemin par défaut.
13. Aucune fonctionnalité présentée avec une garantie qu'elle n'offre pas — les limites connues se documentent, ne se masquent pas.

## Design et impeccable

Layout officiel du plugin — deux fichiers à la racine, rien dans `.claude/impeccable/` (les anciens `design-system.md`/`interactions.md`/`review-checklist.md` ont été migrés puis supprimés ; leur contenu vit dans DESIGN.md, la SPEC 11 et les modules `specs/ui/`) :

- **`PRODUCT.md`** — stratégie : plateforme, utilisateurs, positionnement, voix, anti-références. À lire avant tout écran nouveau ; les microcopies suivent sa section Voix.
- **`DESIGN.md`** — système visuel maintenu via `/impeccable document`, avec **exactement six sections aux en-têtes figés** (`Overview`, `Colors`, `Typography`, `Elevation`, `Components`, `Do's and Don'ts`) : ne jamais renommer, réordonner, ajouter ou supprimer une section — d'autres outils les parsent. Toute évolution visuelle passe par une modification de DESIGN.md (validée par le Tech Lead), jamais par une valeur en dur dans un composant.

Usage attendu : avant de coder un composant, vérifier son token/style dans DESIGN.md et sa primitive Astryx dans Components ; en revue, tout écart DESIGN.md est bloquant au même titre qu'un test rouge.

## Workflow

- Dev par blocs : un bloc = des REQ ; commit seulement si les tests du bloc passent. Waterfall jusqu'au ship : les specs 01–10 se développent en parallèle, la 11 s'intègre en dernier ; CI/CD après le ship uniquement.
- **Chaque test Vitest nomme son exigence** : `describe("REQ-XXX-NN — ...")`. Test sans ID = rejeté en revue.
- Un module est terminé quand 100 % de ses REQ ont un test nommé vert et que la suite du paquet passe. Ce n'est pas la même porte que « le produit marche » (règle 4).
- Valeurs sensibles aux versions (défauts Synapse, préfixes MatrixRTC, authenticated media) : vérifier dans la doc de la version déployée avant usage, ne jamais supposer.
- **Porte de commit — l'auteur choisit la portée des tests, et l'écrit dans le message.** Hooks bloquants, jamais de `--no-verify`. `typecheck` reste **toujours complet** : c'est lui qui tient les jonctions au niveau des types, et c'est le moins cher des deux. Les tests, eux, se scopent au projet touché **quand le commit est peu impactant**, et couvrent tout le workspace sinon — c'est le défaut, on ne l'obtient pas en le demandant, on le perd en le refusant, et ce refus laisse une trace dans la commande : `TACITA_TESTS="--project @tacita/outbox" git commit -m "…"`. Les noms sont ceux des `package.json`, pas ceux des répertoires : paquets préfixés (`@tacita/outbox`), apps non (`web`, `infra`, `push-gateway`, `invite-tokens`). Mesuré : `@tacita/outbox` 4,6 s contre 85 s pour tout.
  - **Impactant, donc complet** : interface exportée par un paquet, fichier partagé par plusieurs modules, contrat entre deux specs, composant réutilisé, token ou règle de `DESIGN.md`, configuration de build ou de test.
  - **Peu impactant, donc scopable** : changement confiné à l'intérieur d'un seul paquet, ou à un seul écran qui n'exporte rien.
  - En cas de doute, complet. Et le gain est faible quand le projet touché est `apps/web`, qui porte l'essentiel du poids : scoper vaut pour les paquets, presque pas pour le shard.

## Boucle de développement

**Le coût d'exécution fait partie du travail.** Ces règles viennent de comportements mesurés sur ce dépôt. Les gestes sont **tous ici** : c'est le seul fichier chargé, donc le seul qui gouverne. Les relevés qui les ont produits vivent dans `docs/WORKFLOW.md`, hors dépôt parce que machine-dépendant — s'y référer est utile, en dépendre ne l'est pas.

- **La suite complète appartient à la porte, pas à la boucle.** Pendant l'itération, ne lancer que les fichiers de test qui lisent ce qu'on vient de toucher : `grep -rl "<FichierTouché>" apps/web/tests/`. Mesuré ici — un fichier ≈ 9 s, le projet `web` entier 85 s de mur pour **185 s de CPU de collecte**. Filtrer par **chemin** : filtrer par `--project` ne sauve pas la collecte.
- **Capturer une fois, relire autant qu'on veut.** `2>&1 | tee` vers un fichier, puis `grep` dessus. Ne jamais relancer une suite pour changer un filtre : c'est cher, et la seconde mesure est *pire* que la première puisqu'on charge la machine en la mesurant.
- **Un échec non reproduit en isolation n'est pas une régression.** Une cible qui se déplace d'un run à l'autre est de la famine mémoire, pas un bug. Reproduire fichier par fichier avant d'accuser le diff.
- **Le plafond de workers ne se relève pas.** `--maxWorkers=4` dans `package.json` : les outils se dimensionnent sur les cœurs et jamais sur la RAM, et chaque worker retransforme pour lui seul les dépendances `deps.inline`. Avant un run large, couper les piles Docker étrangères au projet. Allonger `testTimeout` masquerait la famine sans la retirer.
- **Écrire le test permanent avant la sonde jetable.** Il échoue et apprend la même chose, à ceci près qu'il reste. Une sonde qui a trouvé quelque chose de vrai ne se jette pas : elle devient un test.
- **Ne pas inventer l'en-tête d'une sonde** — copier celui d'un test voisin qui touche le même composant : il porte déjà les mocks, les alias et le bon chemin.
- **`git status` immédiatement avant tout `stash`, `checkout` ou `reset`.** Un état de dépôt vaut à l'instant où on le lit ; l'instantané de début de session est périmé, et un éditeur ouvert écrit pendant qu'on réfléchit.

## Tests — ce qui prouve quoi

- **Vitest uniquement** ; composants en jsdom/happy-dom, gestes simulés par événements pointer. La config infra (specs 01–02) est testée aussi : les tests parsent les fichiers YAML rendus et assertent les valeurs critiques.
- **Mocker `Session` passe par `asSession()`** (`@tacita/client-core/testing`), jamais par un `as unknown as Session`. Sinon un membre **ajouté** au contrat n'apparaît nulle part — ni à la compilation, ni au démarrage, seulement en `undefined is not a function`. Aujourd'hui, ajouter un membre casse la compilation d'un seul fichier, `packages/client-core/src/testing.ts`, qui est le site de compilation du contrat.
- **Toute passation entre deux paquets a un site de compilation.** Aucun paquet ne dépendant de deux autres, une promesse d'interface entre modules n'est vérifiée par *rien* — ni compilateur, ni test. Motif à reproduire : `packages/media-pipeline/tests/jonction-outbox.ts`, un fichier sans test qui **est** le test — s'il cesse de compiler, la passation est cassée.
- **Un test qui passe sous Vitest ne prouve pas que le code démarre.** Vitest transpile ; `node --experimental-strip-types`, qui fait tourner les services d'`apps/`, *retire* les types sans les transformer et refuse toute construction TypeScript qui génère du code (propriété de paramètre, `enum`, `namespace`). Un service peut avoir 100 % de ses REQ vertes et ne pas booter. Là où un service est lancé par ce moteur, un test charge ses modules **avec ce moteur** (`infra/tests/invite-tokens.test.ts`).
- **jsdom ne rend rien** : ni géométrie, ni cascade, ni style calculé. Ce que seul un navigateur voit se mesure à la main, se consigne avec sa date, et se garde ensuite par un test **structurel** qui lit la feuille ou la source — jamais par un navigateur piloté (interdit n°12). Ce garde-fou ne prouve pas le rendu ; il empêche la ligne qui le tient de disparaître sans que personne ne le voie.

## Sept règles nées de défauts réels

Valeur de jurisprudence : chacune a été posée sur un cas vécu **dans ce dépôt**, avec son motif. Les ignorer, c'est recommettre le défaut qui les a produites.

1. **Chaque jonction entre modules a un propriétaire nommé dans une spec.** Cent pour cent des défauts critiques de ce dépôt étaient des jonctions. Cas d'école : la garde de chiffrement existait dans `messaging` et pas dans `outbox`, parce que la spec 05 met la file hors scope et que la spec 07 ne parlait pas de chiffrement. Les deux specs respectées, le trou entre elles.
2. **Une erreur se classe par sa résolubilité, pas par sa classe HTTP.** Un 401 de jeton expiré se résout par un renouvellement, pas par un renvoi manuel message par message. `failed` doit vouloir dire « l'utilisateur doit agir sur *ce* message ».
3. **Ne jamais valider une hypothèse contre un substitut qui la confirme par construction.** Un mock qui fixe lui-même l'ordre d'émission du SDK ne peut pas infirmer une hypothèse sur cet ordre. Une imitation de base monothread ne peut pas éprouver l'atomicité d'une transaction. `SSL_CERT_FILE` vérifié en Python quand le client HTTP de Synapse est Twisted valide un chemin que Synapse n'emprunte jamais.
4. **« Module terminé » et « produit qui marche » sont deux portes distinctes.** Les tests de configuration attestent le contenu des fichiers ; la cible de fumée atteste un comportement contre un vrai serveur. La spec 01 a été « 100 % conforme » pendant que personne ne pouvait se connecter, et le service de la spec 12 a eu ses vingt REQ vertes avant de pouvoir démarrer.
5. **Tenir la promesse ou la retirer — jamais la laisser affichée sans la tenir.** C'est l'interdit n°13. Chaque spec liste ses limites assumées ; elles se documentent, jamais ne se masquent.
6. **Aucun besoin de développement ne modifie un artefact de production.** Les écarts dev/prod vivent dans des overlays explicites, chargés volontairement (D-07).
7. **Une valeur écrite là où rien ne la lit est indétectable** *(ajoutée le 11/08/2026)*. Deux cas en quatre jours : deux paramètres d'URL retirés du schéma d'Element Call deux versions plus tôt — acceptés, ignorés, silencieux (E-14) ; et `opacity: "var(--token)"` dans un `style` inline React, que le CSSOM valide comme un **nombre** et réduit à `NaN` — le code disait 50 %, l'écran disait 100 %, et les deux avaient raison. Toute valeur posée à une jonction que personne ne relit exige un **test structurel qui la relie à son site de lecture** : lire la feuille et lire la source suffit, aucun rendu n'est nécessaire. Et si ce test est impossible à écrire, ce n'est pas le test qui manque — c'est la valeur qui est au mauvais endroit.

## Prudence outillage

**Les trois outils ont été évalués le 05/08/2026** — application Next.js 15 réellement construite, rendu éprouvé, registre npm interrogé. Ce qu'il faut en savoir tient en cinq points ; le reste est dans `specs/11-ui-shard.md` et `specs/ui/M-A.md`, qui sont les contrats.

1. **Seul Astryx s'exécute chez l'utilisateur.** ponytail et impeccable sont des plugins d'agent, sans empreinte à l'exécution — ils ne peuvent être incompatibles ni avec les gestes, ni avec la PWA, ni avec le hors-ligne. *(La phrase parle **de ces trois outils-là**, pas du dépôt entier : depuis E-17, 20/08/2026, `packages/media-pipeline` peut porter une dépendance runtime de démuxage/muxage de conteneur, qui s'exécute évidemment chez l'utilisateur. Elle relève du même régime d'épinglage que le point 5.)*
2. **Trois contraintes de construction, non négociables**, sans lesquelles `next build` échoue : jamais le barrel `@astryxdesign/core` (toujours le sous-chemin) ; le `Theme` d'Astryx enveloppé dans un composant `"use client"` du shard ; une palette fournie par le shard (`defineTheme`), le cœur n'en embarque aucune.
3. **Astryx est en `0.2.0` et a six semaines.** Version épinglée, CHANGELOG relu avant tout bump — même jurisprudence que les digests d'images du compose.
4. Toute incompatibilité **découverte depuis** : ne pas contourner silencieusement, escalader au PM.
5. **Tout runtime externe que le client pointe — widget, service, URL de configuration — est épinglé dans `infra/`, version et digest consignés.** Une URL configurable sans version consignée est une jonction non relue : on ne peut rien vérifier de ce qu'on lui envoie. Règle ajoutée le 07/08/2026 après E-08, E-13 et E-14 — trois pannes de même nature, où deux specs correctes séparément laissaient le défaut vivre entre elles. C'est le cas particulier de la règle 7, appliqué aux runtimes externes.

## Ce qui ne se décide pas dans le code

Trois choses s'escaladent au PM plutôt que de se trancher dans une PR :

- toute **incompatibilité d'outillage** constatée (Astryx en `0.2.0`, cf. § Prudence outillage) — ne pas contourner en silence ;
- tout affaiblissement d'une décision de `DECISIONS.md`, en particulier D-08 et REQ-COR-07 ;
- toute **contradiction entre deux specs** découverte en les composant. C'est le mode de panne dominant de ce dépôt : chaque spec est respectée, et l'espace entre elles ne l'est pas. Consigner dans `specs/ui/ESCALATIONS.md` pour le shard.
