# SPEC 09 — Recherche locale

**Package : `packages/search/`. Dépendances : spec 04 (flux d'événements déchiffrés), DECISIONS D-01/D-05. Zéro DOM.**

## Livrable

Recherche par mot-clé intégralement côté client : index **Orama** persisté en IndexedDB, alimenté au fil du déchiffrement des événements, construit et interrogé dans un **Web Worker** (l'indexation JS d'un long historique est coûteuse en mémoire et batterie sur mobile). Rappel structurel : l'endpoint `/search` de Synapse est inopérant sur salon chiffré — ne pas l'appeler, ne pas construire de repli dessus.

API (proxy du worker) : `index(event)`, `search(query, roomId?)`, `stats()`, `wipe()`.

## Exigences et critères d'acceptation

- **REQ-SRC-01** — Index Orama, alimenté au déchiffrement des événements (hook spec 04) ; indexation et requêtes exécutées en Web Worker, thread principal jamais bloqué. **Le proxy s'amorce sur ce que le client tient déjà** au moment où il se branche (timelines vives des salons chargés) : l'écoute seule ne voit que les déchiffrements postérieurs, et sur une session rouverte l'historique est relu et déchiffré avant qu'on arrive. L'amorçage est idempotent — le moteur remplace un document connu par son identifiant (REQ-SRC-10) —, donc sûr à chaque ouverture. **Corollaire côté shard : le proxy est créé une fois par session, jamais par écran** ; créé à l'ouverture d'un onglet, il n'assiste à aucun déchiffrement (spec 11, REQ-UI-16). *(Précisée le 21/08/2026 — retour utilisateur : « la recherche des messages et des mentions ne fonctionne juste pas ». L'index était vide, et rien dans le paquet ne le disait : chaque test lui passait les événements à la main.)*
- **REQ-SRC-02** — Persistance de l'index en IndexedDB uniquement ; l'index survit au rechargement sans réindexation complète.
- **REQ-SRC-03** — **Aucune recherche n'émet d'appel réseau** ; la recherche fonctionne hors ligne. Aucun code du package n'appelle `/search` Synapse.
- **REQ-SRC-04** — Recherche globale (tous salons) et par salon, par mot-clé.
- **REQ-SRC-05** — Purge par plafond : 200 000 événements max, éviction des plus anciens **par ordre d'indexation locale** (DECISIONS D-01) — jamais par `origin_server_ts` : un rattrapage d'historique (pagination arrière) insère des documents anciens qui ne doivent pas être évincés en premier. `stats()` expose taille courante et bornes temporelles couvertes (en `origin_server_ts`, REQ-SRC-06). *(Précisée le 03/08/2026 : deux horodatages, deux usages — voir schéma.)*
- **REQ-SRC-06** — Périmètre exposé pour l'UI : la recherche couvre **l'historique téléchargé**, pas l'intégralité de l'historique serveur ; `stats()` fournit de quoi l'afficher explicitement (spec 11).
- **REQ-SRC-07** — Rotation Megolm = non-événement : aucun mécanisme de réindexation liée aux sessions (DECISIONS D-05). Seule invalidation : purge D-01 ou `wipe()`.
- **REQ-SRC-08** — `wipe()` enregistré au registre de wipe (spec 04, REQ-COR-10) : la déconnexion détruit l'index (contenu déchiffré).
- **REQ-SRC-09** — Indexation par lots avec yield (pas de rafale bloquante lors d'un sync de rattrapage) ; aucun texte indexé ne transite par les logs.
- **REQ-SRC-10** — L'index suit le cycle de vie des messages : une **redaction** retire le document de l'index ; une **édition** (`m.replace`) remplace le document existant, l'ancienne version cessant d'être trouvable. Critères : après redaction, `search` ne rend plus l'événement ; après édition, seule la dernière version est rendue. *(Créée le 03/08/2026 — « supprimer un message » qui laisse le texte trouvable est une promesse produit non tenue, interdit n°13.)*
- **REQ-SRC-11** — **Recherche filtrée.** `search` accepte des critères combinables, tous servis par l'index local : expéditeur (`sender`), conversation (`roomId`), bornes de date (sur `tsOrigin`, en **filtre** jamais en tri — interdit n°6), type de contenu (`msgtype`), et « mentionne cet utilisateur » (`mentions`). Les deux derniers champs sont ajoutés au schéma et alimentés au déchiffrement. Un critère absent ne restreint rien ; les critères présents se composent en ET. Critères d'acceptation : une recherche filtrée par `sender` ne rend que ses messages ; un filtre `msgtype` distingue texte et média ; `mentions` contenant l'identifiant de l'utilisateur courant sert l'onglet « Mentions » sans recherche plein-texte sur un nom d'affichage ; deux critères combinés rendent l'intersection. *(Créée le 05/08/2026 — escalade E-06 → E-01 tranchée : les filtres sont un besoin établi, le YAGNI de la V1 ne s'y applique pas. Ils s'implémentent par le schéma, jamais par un contournement plein-texte.)*

## Méthode et contraintes

- Schéma d'index : eventId, roomId, sender, **deux horodatages** — `tsIndexed` (horodatage local d'indexation, **seul** critère d'éviction D-01) et `tsOrigin` (`origin_server_ts`, uniquement pour les bornes de `stats()` et le filtre de dates de REQ-SRC-11, jamais un critère de tri ni d'éviction — interdit n°6) —, corps texte, `msgtype`, et `mentions: string[]`. Pas de fuzzy avancé en V1 (YAGNI — celui-là tient toujours, aucun besoin établi).
- **`mentions` et le corps sont du contenu déchiffré**, au même titre l'un que l'autre. Étendre le schéma étend la surface de l'interdit n°8 : ces champs ne transitent ni par les logs, ni par la télémétrie, ni par le cache du service worker, ni par un payload push — y compris en développement. Les facettes restent **strictement locales** : elles n'ajoutent aucun appel réseau, REQ-SRC-03 est inchangée.
- Hors scope : barre de recherche, rendu des résultats, surlignage (spec 11).

## Objectif mesurable

Suite Vitest (worker testé en direct via son module, fake-indexeddb), une describe par REQ : REQ-SRC-03 (spy global fetch/XHR : zéro appel réseau pendant `search`) ; REQ-SRC-05 (insérer 200 001 événements factices → le plus ancien évincé, stats exactes) ; REQ-SRC-02 (persist → reload du module → même résultat de recherche) ; REQ-SRC-08 (wipe → zéro résultat, store vide) ; REQ-SRC-01 (salons chargés avant `createSearch` → leurs messages trouvables sans qu'aucun déchiffrement n'ait été émis ; aucun salon → aucun message posté au worker ; réindexer un événement connu ne le duplique pas) ; REQ-SRC-11 (chaque critère seul restreint le résultat attendu ; deux critères combinés rendent l'intersection ; un filtre de dates ne modifie pas l'ordre des résultats).
