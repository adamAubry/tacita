# SPEC 09 — Recherche locale

**Package : `packages/search/`. Dépendances : spec 04 (flux d'événements déchiffrés), DECISIONS D-01/D-05. Zéro DOM.**

## Livrable

Recherche par mot-clé intégralement côté client : index **Orama** persisté en IndexedDB, alimenté au fil du déchiffrement des événements, construit et interrogé dans un **Web Worker** (l'indexation JS d'un long historique est coûteuse en mémoire et batterie sur mobile). Rappel structurel : l'endpoint `/search` de Synapse est inopérant sur salon chiffré — ne pas l'appeler, ne pas construire de repli dessus.

API (proxy du worker) : `index(event)`, `search(query, roomId?)`, `stats()`, `wipe()`.

## Exigences et critères d'acceptation

- **REQ-SRC-01** — Index Orama, alimenté au déchiffrement des événements (hook spec 04) ; indexation et requêtes exécutées en Web Worker, thread principal jamais bloqué.
- **REQ-SRC-02** — Persistance de l'index en IndexedDB uniquement ; l'index survit au rechargement sans réindexation complète.
- **REQ-SRC-03** — **Aucune recherche n'émet d'appel réseau** ; la recherche fonctionne hors ligne. Aucun code du package n'appelle `/search` Synapse.
- **REQ-SRC-04** — Recherche globale (tous salons) et par salon, par mot-clé.
- **REQ-SRC-05** — Purge par plafond : 200 000 événements max, éviction des plus anciens **par ordre d'indexation locale** (DECISIONS D-01) — jamais par `origin_server_ts` : un rattrapage d'historique (pagination arrière) insère des documents anciens qui ne doivent pas être évincés en premier. `stats()` expose taille courante et bornes temporelles couvertes (en `origin_server_ts`, REQ-SRC-06). *(Précisée le 03/08/2026 : deux horodatages, deux usages — voir schéma.)*
- **REQ-SRC-06** — Périmètre exposé pour l'UI : la recherche couvre **l'historique téléchargé**, pas l'intégralité de l'historique serveur ; `stats()` fournit de quoi l'afficher explicitement (spec 11).
- **REQ-SRC-07** — Rotation Megolm = non-événement : aucun mécanisme de réindexation liée aux sessions (DECISIONS D-05). Seule invalidation : purge D-01 ou `wipe()`.
- **REQ-SRC-08** — `wipe()` enregistré au registre de wipe (spec 04, REQ-COR-10) : la déconnexion détruit l'index (contenu déchiffré).
- **REQ-SRC-09** — Indexation par lots avec yield (pas de rafale bloquante lors d'un sync de rattrapage) ; aucun texte indexé ne transite par les logs.
- **REQ-SRC-10** — L'index suit le cycle de vie des messages : une **redaction** retire le document de l'index ; une **édition** (`m.replace`) remplace le document existant, l'ancienne version cessant d'être trouvable. Critères : après redaction, `search` ne rend plus l'événement ; après édition, seule la dernière version est rendue. *(Créée le 03/08/2026 — « supprimer un message » qui laisse le texte trouvable est une promesse produit non tenue, interdit n°13.)*

## Méthode et contraintes

- Schéma d'index minimal : eventId, roomId, sender, **deux horodatages** — `tsIndexed` (horodatage local d'indexation, **seul** critère d'éviction D-01) et `tsOrigin` (`origin_server_ts`, uniquement pour les bornes de `stats()`, jamais un critère de tri ni d'éviction — interdit n°6) —, corps texte. Pas de facettes, pas de fuzzy avancé en V1 (YAGNI).
- Hors scope : barre de recherche, rendu des résultats, surlignage (spec 11).

## Objectif mesurable

Suite Vitest (worker testé en direct via son module, fake-indexeddb), une describe par REQ : REQ-SRC-03 (spy global fetch/XHR : zéro appel réseau pendant `search`) ; REQ-SRC-05 (insérer 200 001 événements factices → le plus ancien évincé, stats exactes) ; REQ-SRC-02 (persist → reload du module → même résultat de recherche) ; REQ-SRC-08 (wipe → zéro résultat, store vide).
