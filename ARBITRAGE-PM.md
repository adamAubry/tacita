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

---

# Addendum du 03/08/2026 — réponse à `ESCALADE-PM-OIDC.md`

La cible de fumée a payé avant d'exister : le login OIDC n'avait jamais été exécuté et ne
fonctionne pas. C'est exactement le mode de panne pour lequel elle a été financée. Trois
questions m'étaient posées ; les trois sont tranchées.

## 1. Option retenue : B — la cible s'écrit sans le tronçon OIDC, maintenant

Jeton obtenu par l'API d'administration Synapse ; la cible couvre vraie crypto, vrai IndexedDB,
vrai Synapse, salon chiffré, envoi/réception, `restoreSession` sans réseau — l'intégralité de ce
qu'elle a été financée pour valider. Le tronçon OIDC est un **ticket dédié, bloquant pour la
spec 11** (le shard consomme un `m.login.token` que rien ne sait produire : la 11 ne démarre pas
tant que la connexion n'aboutit pas).

**Motif, qui fait jurisprudence : un tronçon bloqué ne prend pas en otage la validation de sept
modules.** On découpe par valeur, pas par complétude. L'option A est refusée **dans sa forme**
(instruction de dev dans l'image de production — voir D-07), mais son effet reste atteignable :
la confiance du certificat de dev s'installe **dans l'overlay de fumée** (montage du CA +
`update-ca-certificates` au démarrage), pas dans le Dockerfile. C'est le contenu du ticket OIDC,
à faire après B, sans rien jeter.

## 2. Réponse au §3 : `SERVER_NAME` résout publiquement — c'est D-07

Consigné dans `DECISIONS.md` : résolution publique, certificat réel (déjà exigé par REQ-INF-10),
magasin de confiance de l'image jamais modifié. Les trois causes du 503 sont donc **locales au
dev** ; un déploiement sans hairpin NAT utilise l'alias réseau et `SYNAPSE_IP_RANGE_WHITELIST` —
les leviers exacts que l'escalade a livrés, requalifiés de contournements de dev en configuration
de déploiement documentée. Le README d'infra gagne une vérification de pré-vol : depuis le
conteneur Synapse, la découverte OIDC répond 200 avant toute création de compte.

**Jurisprudence : aucun besoin de développement ne modifie un artefact de production.** Les
écarts dev/prod vivent dans des overlays explicites, chargés volontairement.

## 3. REQ-INF-09 : amendée, oui

Critère de comportement ajouté (`specs/01-infra-synapse.md`) : une connexion aboutit, prouvée
dans la suite de fumée sous un describe `REQ-INF-09`. La règle générale qui en découle : les
tests de config attestent le contenu des fichiers, la fumée atteste le comportement — « module
terminé » et « produit qui marche » sont deux portes distinctes, et les modules 06, 08, 10
hériteront de la seconde quand leur fonction touchera l'infra.

Au passage : l'escalade documente une deuxième occurrence de l'erreur de méthode N3 (valider une
hypothèse contre un substitut qui la confirme par construction — ici `SSL_CERT_FILE` vérifié en
Python quand Synapse parle Twisted). Deux occurrences en une session : c'est la confirmation
empirique du point 9, pas un incident isolé.

## Suite du 03/08/2026 — deux points signalés avant exécution

**La régression du statut de la spec 01 est un état voulu, annoncé ici : l'ordre ne s'inverse
pas.** Entre l'option B et le ticket OIDC, la spec 01 passe « non terminée » — c'est la vérité :
le produit n'est pas connectable. Un tableau rouge qui dit vrai vaut mieux qu'un tableau vert qui
ment ; séquencer les tâches pour éviter l'affichage serait masquer une limite, ce que l'interdit
n°13 proscrit pour le produit et qui vaut aussi pour le pilotage. L'amendement n'a pas cassé la
spec 01, il a révélé qu'elle l'était. La fenêtre reste courte : le ticket OIDC suit immédiatement
la cible.

**Le commentaire SSRF dans le template est approuvé** — « ne pas activer `url_preview_enabled`
avec `SYNAPSE_IP_RANGE_WHITELIST` rempli sans restreindre la plage » — à poser en écrivant la
cible, comme proposé. C'est une ligne de garde-fou, pas une décision : le jour où l'aperçu d'URL
deviendra une demande produit, il arrivera avec sa propre entrée DECISIONS et cette ligne
l'attendra.

## Ordre de marche mis à jour

1. Le point 5 de l'ordre initial (correctif rétention) reste la tâche la plus prioritaire —
   inchangé.
2. **La cible de fumée passe devant le reste du backlog dev** (option B) : elle vient de prouver
   son rendement avant même d'exister.
3. **Ticket OIDC** ensuite : confiance du CA en overlay, tronçon login ajouté à la fumée,
   critère REQ-INF-09 vert. **Bloquant pour la spec 11.**
4. Le reste de l'ordre initial est inchangé (C1 après `fix-n3-n2`, spec 09, REQ-INF-14,
   puis 06 → 08 → 10 → 11).

---

# Addendum du 04/08/2026 — jonctions ou spec 11, et le sort du média

L'ordre de marche dev est épuisé, onze branches attendent, les modules 06/08/10 ont été livrés
en parallèle sur `main`. Trois questions posées, trois réponses.

## 1. Ni l'un ni l'autre en premier : merges → audit des jonctions → spec 11

**L'ordre est : (a) résorber le stock de relecture, (b) auditer les jonctions sur la `main`
réellement intégrée, (c) spec 11.** Auditer avant de merger ferait auditer un état qui n'existera
plus onze merges plus tard ; démarrer la 11 par-dessus des jonctions jamais vérifiées, c'est
bâtir l'étage sans visiter les fondations — et chaque correction de jonction coûtera plus cher
une fois qu'elle devra traverser du code d'interface.

**Motif, qui fait jurisprudence : dans ce dépôt, 100 % des défauts critiques trouvés à ce jour
étaient des jonctions entre modules, zéro était une bavure locale. On audite donc là où le dépôt
a prouvé qu'il casse.** Et l'audit se limite aux jonctions et aux motifs récurrents — la logique
métier des modules livrés a déjà été auditée par son auteur ; la refaire serait la redondance
que deux fils parallèles ont déjà produite.

Le périmètre proposé est approuvé tel quel : points de contact déclarés par les specs, récurrence
des motifs connus (garde de chiffrement, wipe, commit IndexedDB, hypothèses d'ordre du SDK),
compatibilité des branches. **La vérification immédiate de ce que les branches cassent au merge :
oui, lancée sans attendre** — c'est l'entrée du (a).

## 2. Le média est hors périmètre de REQ-OBX-09 **par construction** — pas de défaut, un invariant à verrouiller

Lecture faite du code livré : `media-pipeline` n'émet **aucun événement de salon**. Son seul
appel réseau est `uploadContent` d'un blob passé **inconditionnellement** par `encryptAttachment`
(AES-CTR avant upload, quel que soit l'état du salon) ; l'événement qui porte les clés est rendu
« prêt à `enqueue` » (hors-scope explicite de la spec 08) et passe donc par l'outbox — c'est-à-dire
par la garde REQ-OBX-09. Le motif C1 était « deux chemins d'envoi d'événements, un gardé, l'autre
non » ; l'upload d'un blob opaque n'est pas un envoi d'événement, et un blob orphelin dans un
salon refusé par la garde reste illisible. La jonction est saine **parce que** la spec 08 a mis la
file hors scope — l'inverse exact du trou C1.

**Ce qui est demandé à l'audit en échange :** transformer cette construction en invariant testé —
un test nommé REQ-MED-02 assertant qu'aucun `sendEvent`/`sendMessage` n'existe dans
`media-pipeline` (le pipeline téléverse, il n'envoie jamais). Une construction saine sans garde
est exactement ce que C1 était avant qu'on le nomme. Au passage, l'audit qualifiera le seul
`sendEvent` direct restant hors outbox : `calls/driver.ts` (signalisation du widget Element
Call) — vérifier quels types d'événements il peut émettre et documenter pourquoi il est hors
file, ou le garder.

## 3. Le stock de relecture est déclaré risque n°1 : fenêtre de merge immédiate

La relecture seniors passe devant tout travail nouveau, audit compris. Ordre d'entrée dans
`main`, qui respecte les dépendances déjà arbitrées : `pm/arbitrage-2026-08-03` (les contrats
d'abord) → `fix-c3-c2` → `fix-n3-n2` → `fix-c4` → `fix-retention` → `fix-c1` →
`fix-src-lifecycle` → `fix-inf14` → `smoke-target` → `fix-oidc`. À chaque entrée, les mocks des
modules 06/08/10 qui ne compilent plus se réparent **dans le même merge** (ajouter `isEncrypted`
à un mock n'est pas un contournement de spec, c'est la spec 04 amendée qui s'applique).
`review/remediation` ne se merge toujours pas ; elle se supprime une fois les `fix-*` entrées.

## Directive nouvelle : la spec 11 est réalisée par un humain senior, jusqu'à nouvel ordre

Décision produit transmise le 04/08/2026. Conséquence pour les agents dev : **votre livrable
final n'est plus « commencer la 11 », c'est un socle où tout fonctionne jusqu'à elle.**
Concrètement : les dix modules mergés et verts, les jonctions auditées, la cible de fumée et le
tronçon OIDC verts (un humain qui démarre la 11 doit pouvoir se connecter), et les contrats
d'interface consommés par la 11 (exports, `restoreSession`/`null` → OIDC, libellés d'erreur type
`TACITA_NOT_ENCRYPTED`, `stats()`, `deliveryUnknowable`) propres et documentés dans les README —
c'est désormais la porte de sortie du travail agent, pas un à-côté. L'ordre de marche ne change
pas ; seule sa destination change.

## La réserve : assumée par le PM

C'est moi qui cadre l'audit auprès d'adam, pas l'auditeur : le périmètre est **les jonctions et
les motifs récurrents, pas la qualité de ses modules** — ses quatre correctifs d'audit propre en
sont la preuve. Toute trouvaille arrive comme un filet posé sur l'espace entre les specs, le même
qui a manqué aux quatre défauts critiques de la veille. Personne n'audite personne : on audite
l'espace que les contrats ne possèdent pas encore.
