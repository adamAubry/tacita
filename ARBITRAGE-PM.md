# Arbitrage PM — réponse au brief du 03/08/2026

**Émetteur :** PM (session d'arbitrage du 03/08/2026)
**Répond à :** `BRIEF-PM.md` et section 5 de `REMEDIATION-CRITIQUES.md` (branche `review/remediation`)
**Textes appliqués :** les amendements décidés ici sont écrits dans `specs/` et `DECISIONS.md`
sur cette branche (`pm/arbitrage-2026-08-03`) — conformément à la règle : c'est le PM qui écrit
dans les contrats, pas le code.

---

## Les trois bloquants

### 1. REQ-OBX-04 — AMENDÉE (pas de revert de N2)

**Décision :** le texte proposé est retenu, précisé par la liste fermée des codes réessayables.
Nouveau texte dans `specs/07-outbox.md`.

**Motif :** `failed` doit signifier « l'utilisateur doit agir sur *ce* message », jamais « la
session a expiré ». Un 401 de jeton se résout par un renouvellement, pas par un renvoi manuel
entrée par entrée. **Jurisprudence pour les modules restants : une erreur se classe par sa
résolubilité, pas par sa classe HTTP.**

### 2. REQ-COR-11 — CRÉÉE (la reprise de session est une exigence)

**Décision :** REQ-COR-11 créée, REQ-COR-10 étendue (le wipe couvre les credentials, effacés en
premier), `restoreSession` ajoutée au contrat d'interface. Textes dans `specs/04-client-core.md`.

**Motif :** l'alternative — retirer les promesses hors ligne de REQ-COR-03, REQ-OBX-01 et
REQ-SRC-02 — amputerait la PWA de sa raison d'être : une messagerie qui remplace Instagram et ne
se rouvre pas sans réseau n'est pas un remplacement. Le trou était dans les specs, pas dans le
correctif. **Jurisprudence : quand trois specs promettent ce qu'aucune ne fournit, on crée
l'exigence manquante chez celui qui possède la fondation (spec 04), on ne rabote pas les trois.**

### 3. D-06 — RATIFIÉE (jeton en clair)

**Décision :** consignée dans `DECISIONS.md`. Le jeton d'accès est stocké en clair en IndexedDB.
Le relèvement (clé de pickle + écran de déverrouillage) est une décision produit post-V1 qui
mérite sa propre spec ; elle n'est pas prise ici.

**Motif :** interdit n°13. Chiffrer le seul jeton pendant que les clés Megolm voisines restent en
clair serait une garantie de façade — exactement ce que le projet proscrit. La conséquence (accès
au profil navigateur = accès au compte et à l'historique déchiffrable) est assumée et documentée,
pas masquée. Pour un cercle fermé d'utilisateurs sur appareils personnels, c'est un compromis V1
acceptable à condition d'être écrit noir sur blanc — il l'est.

---

## Les six arbitrages de priorité

### 4. Exploitabilité de C1 — on ne finance pas la preuve, on finance le correctif

**Décision :** C1 se corrige **maintenant**, selon le plan de `REMEDIATION-CRITIQUES.md` §3
(prédicat `isEncrypted` sur `Session`). Les contrats sont posés : REQ-COR-12 (spec 04) et
REQ-OBX-09 (spec 07). Prérequis : `fix-n3-n2` mergée d'abord.

**Motif :** l'évaluation « exposition faible » est plausible mais repose sur la config serveur —
précisément la confiance que REQ-MSG-02 refuse d'accorder, et sa vérification exhaustive
(chemins de création de salon de tout client Matrix standard pointé sur le homeserver, upgrades,
migrations) coûterait plus cher que les quelques lignes du correctif. Quand la spec 11 branchera
l'UI, l'outbox sera **le** chemin d'envoi principal : il sera gardé avant.

### 5. La recherche retrouve les messages supprimés — REQ-SRC-10 créée, à corriger avant la spec 11

**Décision :** REQ-SRC-10 créée dans `specs/09-search.md` : redaction → document retiré, édition
→ document remplacé. Correction requise avant le démarrage de la spec 11.

**Motif :** interdit n°13, cas d'école. « Supprimer un message » qui laisse le texte trouvable
dans la recherche est une promesse produit non tenue, dans une messagerie dont la confidentialité
est l'argument unique. C'était un trou de spec ; il est comblé côté spec, le code suit.

### 6. `ts` à double sémantique — spec 09 amendée, deux champs

**Décision :** schéma amendé dans `specs/09-search.md` : `tsIndexed` (local, seul critère
d'éviction D-01) et `tsOrigin` (`origin_server_ts`, uniquement pour les bornes de `stats()`).
REQ-SRC-05 précisée. À corriger dans la même passe que le point 5 (même package).

**Motif :** le rattrapage d'historique qui s'auto-évince est une perte de couverture silencieuse —
l'utilisateur croit son historique indexé, il ne l'est plus. Accessoirement, évincer par
`origin_server_ts` frôle l'interdit n°6 ; deux champs aux usages exclusifs rendent la frontière
testable.

### 7. Raccordement de la passerelle push — la spec 01 le prend (REQ-INF-14)

**Décision :** REQ-INF-14 créée dans `specs/01-infra-synapse.md` : Dockerfile, service compose
joignable par Synapse, route proxy pour la clé publique VAPID, variables `VAPID_*` dans
`.env.example`. La spec 03 reste ce qu'elle est : elle livre le service, pas son déploiement.

**Motif :** tout le provisioning vit déjà dans `infra/` (Synapse y est déjà construit et
raccordé) ; c'est le module qui possède compose, proxy et `.env.example`. **Jurisprudence, la
même que pour C1 et C2 : chaque jonction entre modules doit avoir un propriétaire nommé dans une
spec.** Échéance : avant la spec 11 — les notifications ne se testent que raccordées.

### 8. Rétention — hypothèse vérifiée, elle était fausse : `enabled: false`

**Décision :** D-02 est **révisée explicitement** (décision inchangée : ne jamais purger ; le
moyen change) ; REQ-INF-07 amendée : bloc `retention` présent, commenté, `enabled: false`.
Correctif YAML + test = tâche dev immédiate, **priorité la plus haute de la liste** : c'est le
seul point où la config actuelle peut détruire des données.

**Motif :** vérification faite sur la doc Synapse de la v1.155 déployée, comme `CLAUDE.md`
l'impose : « If no configuration is provided for this option, a single job will be set up to
delete expired events in every room daily ». `purge_jobs: []` ne désactive donc rien — un job de
purge quotidien tourne, et `enabled: true` fait honorer les politiques par salon
`m.room.retention` : n'importe quel client standard posant cet événement d'état déclencherait de
vraies purges. Aujourd'hui rien n'expire (`max_lifetime: null`), mais D-02 dit « jamais », pas
« tant que personne ne pose de politique de salon ».

### 9. Cible de fumée — FINANCÉE, avant la spec 11

**Décision :** oui. Une cible unique, en Vitest (Playwright reste interdit, ceci n'en est pas) :
`docker compose up` → login OIDC → envoi/réception dans un salon chiffré → rechargement →
`restoreSession` rouvre sans réseau. Ce dernier pas est ajouté au périmètre proposé : C4 est le
correctif le plus structurant et le seul dont la remédiation dit elle-même qu'il « ne sera
réellement prouvé qu'à l'intégration ».

**Motif :** sept modules validés exclusivement sur mocks seront intégrés d'un coup par la
spec 11. L'épisode N3 (le mock qui confirme l'hypothèse qu'on lui a donnée) est la démonstration
faite en direct du mode de panne. Le coût d'une cible est borné et connu ; le coût d'une
hypothèse fausse découverte pendant l'intégration de la 11 ne l'est pas.

---

## Ordre de marche

1. **Cette branche** (`pm/arbitrage-2026-08-03` : specs + DECISIONS + ce document) se merge en
   premier, après lecture des seniors — les contrats précèdent le code.
2. **`fix-c3-c2`** part dès validation seniors : aucun amendement requis.
3. **`fix-n3-n2`** part ensuite : débloquée par l'amendement REQ-OBX-04.
4. **`fix-c4`** part en dernier des trois : débloquée par REQ-COR-11 et D-06. L'ordre 3→4 est
   volontaire : C4 sans N2 condamne la file au premier démarrage avec un jeton périmé.
5. **Dev, immédiat et indépendant :** correctif rétention (`homeserver.yaml.tmpl` +
   `infra/tests/homeserver.test.ts` alignés sur REQ-INF-07 amendée).
6. **Dev, après merge de 3 :** C1 (REQ-COR-12 + REQ-OBX-09, les trois `session-mock.ts` mis à
   jour). Puis spec 09 : REQ-SRC-10 + double horodatage, une seule passe.
7. **Dev :** REQ-INF-14 (raccordement passerelle push).
8. **Cible de fumée** (point 9) — avant tout démarrage de la spec 11.
9. **Modules restants, dans l'ordre : 06 (accusés) → 08 (média) → 10 (appels) → 11 (UI).**
   06 et 08 sont le cœur d'usage quotidien ; 10 s'appuie sur Element Call en widget, son risque
   est surtout un risque d'intégration que la 11 portera de toute façon.
10. **Nettoyage :** suppression de `origin/spec-05-messaging` et `origin/spec-09-search`
    (contenu déjà dans `main`) — approuvée. `review/remediation` ne se merge jamais ; elle se
    supprime une fois les trois `fix-*` sur `main`. Le dossier `correctif/` se supprime au merge,
    comme prévu.

**Rappel de la contrainte qui a tout guidé :** les options étaient de tenir chaque promesse ou de
la retirer — jamais de la laisser affichée sans la tenir. Les points 2, 3, 5 et 8 sont quatre
applications de cette même règle.
