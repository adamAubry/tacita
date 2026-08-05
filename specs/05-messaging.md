# SPEC 05 — Domaine messagerie (headless)

**Package : `packages/messaging/`. Dépendances : spec 04 (Session). Zéro DOM.**

## Livrable

API métier des conversations texte : DM et groupes, envoi/réception chiffrés, réponses, réactions, édition/suppression, épinglage, copie, typing, mentions. Expose des fonctions pures + observables consommés par le shard UI (spec 11).

## Exigences et critères d'acceptation

- **REQ-MSG-01** — Envoi et réception de messages texte chiffrés (`m.room.message` en salon chiffré) via la Session (spec 04).
- **REQ-MSG-02** — Création de DM (salon à 2, `is_direct`) et de group chats. Tous chiffrés dès la création (garanti serveur par spec 01, vérifié client : refus d'envoyer dans un salon non chiffré).
- **REQ-MSG-03** — Déduplication d'envoi par `txnId` généré côté client, mécanisme **natif** du SDK — ne rien construire par-dessus. Critère : rejouer la même requête produit le même `event_id`.
- **REQ-MSG-04** — Réponse à un message via relation `m.in_reply_to`.
- **REQ-MSG-05** — Réactions emoji (`m.annotation`), visibles de tous. Le module expose la métadonnée `cleartext: true` et la doc précise : les réactions circulent en clair en salon chiffré — les chiffrer casserait l'agrégation serveur ; le serveur voit qui réagit à quoi.
- **REQ-MSG-06** — Modification (`m.replace`) et suppression (redaction) d'un message ; l'API expose « modifiable/supprimable » par message (droits + auteur).
- **REQ-MSG-07** — Extraction du texte d'un message pour copie (fonction pure ; l'accès presse-papiers est dans l'UI).
- **REQ-MSG-08** — Épinglage via `m.room.pinned_events`, avec métadonnée exposée et documentée : événement d'état **non chiffré**.
- **REQ-MSG-09** — « Est en train d'écrire » via l'EDU éphémère `m.typing` : aucun événement de frappe en base, **throttling côté client** (une émission max toutes les N secondes, pas d'émission par frappe), timeout d'arrêt automatique.
- **REQ-MSG-10** — Mentions type Discord : syntaxe `@everyone` mappée sur `@room` (push rule native `.m.rule.roomnotif`) ; le module fournit le parsing de la syntaxe et les données d'autocomplétion (membres du salon + `@everyone`). Le rendu est dans l'UI.
- **REQ-MSG-11** — Rôles : échelle numérique de power levels Matrix telle quelle — pas de rôles nommés, pas d'héritage par catégorie. Le module expose lecture/écriture des power levels et le compteur de membres du salon.
- **REQ-MSG-12** — L'ordre des messages exposé est celui de `OrderedTimeline` (spec 04) ; ce package n'introduit aucun tri propre.
- **REQ-MSG-13** — Liste des conversations : salons rejoints (DM et groupes) avec nom, dernier message, horodatage, compteurs **natifs** de non-lus et de mentions, marque d'épingle ; invitations en attente exposées à part (D-09 : une demande d'ami *est* une invitation de DM) ; observable branché sur l'émetteur du SDK. **L'ordre rendu est la récence du dernier message** — voir la réserve ci-dessous.
- **REQ-MSG-14** — Épinglage d'une conversation par le tag natif `m.favourite` (lecture et écriture). Synchronisé par le serveur comme toute account data de salon, donc **visible de lui** : métadonnée, jamais du contenu.
- **REQ-MSG-15** — Ouverture d'un DM avec un utilisateur : le DM existant est réutilisé, un second n'est **jamais** créé. Un DM quitté ne compte pas comme existant.

> **Réserve portée par REQ-MSG-13, ajoutée le 05/08/2026 avec l'exigence.** L'interdit global « ne jamais trier par `origin_server_ts` » vise l'ordre des messages *dans* une timeline, où /sync fait autorité (REQ-COR-04, REQ-MSG-12) — et il reste entier. Mais une **liste de salons** n'a aucun ordre dans /sync : `getRooms()` rend l'ordre d'insertion du store. La récence du dernier message est le seul signal disponible côté client, et REQ-UIX-07 (tri récentes/anciennes) l'exige. Il est donc utilisé **ici seulement**, jamais à l'intérieur d'un salon. **Tranché en périmètre technique le 05/08/2026, PM informé** — le motif complet et les alternatives écartées sont dans `specs/ui/ESCALATIONS.md` § E-09.

## Méthode et contraintes

- Utiliser les APIs du SDK partout où elles existent ; ce package est une façade métier, pas une réimplémentation.
- Hors scope : accusés de réception (spec 06), file hors ligne (07), média (08), recherche (09), tout rendu.

## Objectif mesurable

Suite Vitest avec Session mockée : une describe par REQ, nommée par son ID. Points de contrôle notables : REQ-MSG-03 (double appel même txnId → un seul event) ; REQ-MSG-09 (20 frappes en 1 s → ≤ 1 émission m.typing, fake timers) ; REQ-MSG-10 (`"salut @everyone"` → contenu avec mention room conforme) ; REQ-MSG-05/08 (métadonnées `cleartext` présentes) ; REQ-MSG-13 (salon invité absent de la liste et présent dans les invitations ; compteurs natifs relayés tels quels) ; REQ-MSG-15 (DM existant → aucun `createRoom` ; DM quitté → création).
