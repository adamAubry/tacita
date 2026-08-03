# SPEC 07 — File d'envoi persistante (outbox hors ligne)

**Package : `packages/outbox/`. Dépendances : spec 04 (Session). Zéro DOM.**

## Livrable

File d'envoi persistée en IndexedDB : les messages composés hors ligne partent à la reconnexion, **y compris après rechargement de page** — le local echo de matrix-js-sdk ne survit pas à un reload, c'est précisément le manque que ce module comble. Statuts d'envoi et renvoi manuel en cas d'échec.

API : `enqueue(roomId, content, txnId)`, `retry(txnId)`, `remove(txnId)`, observable `pending(roomId)`.

## Exigences et critères d'acceptation

- **REQ-OBX-01** — Un message composé hors ligne est persisté en IndexedDB avant toute tentative réseau ; il survit à un rechargement de page (critère : réhydratation de la file au démarrage).
- **REQ-OBX-02** — À la reconnexion, la file part automatiquement, en ordre FIFO par salon.
- **REQ-OBX-03** — Chaque entrée porte le `txnId` généré à l'enqueue et le réutilise à chaque tentative : les retries s'appuient sur la déduplication native (même txnId → même event_id), jamais de double envoi.
- **REQ-OBX-04** — Statuts exposés par entrée : `queued | sending | failed` ; le passage à « envoyé » = sortie de la file (le statut devient celui de la spec 06). Échec définitif (4xx qui ne se résout ni par l'attente ni par un renouvellement de jeton — `M_LIMIT_EXCEEDED` et `M_UNKNOWN_TOKEN` restent réessayables) → `failed`, renvoi manuel via `retry`, abandon via `remove`. *(Amendé le 03/08/2026 : `failed` signifie « l'utilisateur doit agir sur ce message », jamais « la session a expiré ».)*
- **REQ-OBX-05** — UI optimiste : les entrées de la file sont fusionnables avec la timeline par le shard UI (local echo natif du SDK quand la page vit, entrées outbox après reload) — l'API expose ce qu'il faut pour un affichage unifié.
- **REQ-OBX-06** — Le contenu en file est stocké tel qu'il sera chiffré à l'envoi par la Session ; le module ne fait jamais transiter le contenu par localStorage/sessionStorage ni par aucun log.
- **REQ-OBX-07** — Backoff exponentiel sur `M_LIMIT_EXCEEDED` et erreurs réseau (pas de flood à la reconnexion).
- **REQ-OBX-08** — Le store de la file est enregistré au registre de wipe (spec 04, REQ-COR-10).
- **REQ-OBX-09** — Aucune entrée ne part vers un salon non chiffré : avant chaque tentative, la file consulte le prédicat `Session.isEncrypted(roomId)` (spec 04, REQ-COR-12) ; s'il rend `false`, l'entrée passe `failed` avec le code `TACITA_NOT_ENCRYPTED` **sans aucune tentative réseau**, et sans passer par le chemin de retry (la condition ne changera pas en réessayant). Critère : aucun appel d'envoi émis pour un salon non chiffré. *(Créée le 03/08/2026 — clôt le défaut C1.)*

## Méthode et contraintes

- Détection de connectivité déléguée à l'état de sync de la Session, pas à `navigator.onLine` seul.
- YAGNI : pas de priorités, pas de file média séparée (les envois média passent par le même mécanisme, le pipeline spec 08 fournissant le contenu prêt à envoyer).
- Hors scope : rendu des statuts, bouton renvoyer (spec 11).

## Objectif mesurable

Suite Vitest avec Session mockée et IndexedDB simulée (fake-indexeddb), une describe par REQ : REQ-OBX-01 (enqueue → destroy/recréation du module → entrée toujours là) ; REQ-OBX-02/03 (reconnexion simulée → envois FIFO, txnId stable entre tentatives) ; REQ-OBX-07 (429 → fake timers, backoff croissant).
