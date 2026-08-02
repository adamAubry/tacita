# SPEC 06 — Accusés de réception à 3 niveaux

**Package : `packages/receipts/`. Dépendances : spec 04 (Session). Zéro DOM.**

## Livrable

Machine à états d'accusés par message : **envoyé → délivré → lu**, dont le niveau « délivré » est une extension maison (Matrix ne définit que `m.read`, aucun niveau intermédiaire — ne jamais supposer qu'un accusé « délivré » existe dans le protocole).

API : `status(eventId): 'sending' | 'sent' | 'delivered' | 'read'` (observable) + `setHiddenMode(bool)`.

## Exigences et critères d'acceptation

- **REQ-RCP-01** — « Envoyé » : dérivé de l'`event_id` retourné par le serveur (natif). Avant retour : `sending` (local echo).
- **REQ-RCP-02** — « Lu » : dérivé des reçus `m.read` natifs.
- **REQ-RCP-03** — « Délivré » : événement personnalisé (type préfixé, ex. `org.<domaine>.delivered`) émis **automatiquement à l'entrée de l'événement dans le store local** du client destinataire — pas à l'affichage.
- **REQ-RCP-04** — Multi-device : le crochet « délivré » s'affiche au **premier appareil atteint**, pas à tous (un compte a N appareils, « délivré » n'a pas de sens unique). Les reçus délivrés surnuméraires sont idempotents.
- **REQ-RCP-05** — Le reçu « délivré » est **volontairement non chiffré** (une session Megolm serait disproportionnée pour un accusé). Doc du package : fuite de métadonnées assumée ; le contenu du message reste chiffré.
- **REQ-RCP-06** — Doc du package : extension **non standard**, jamais présentée comme du Matrix natif (l'UI reprend cette formulation, spec 11).
- **REQ-RCP-07** — Mode masqué : bascule vers `m.read.private` (pas de désactivation pure — le reçu public sert aussi à synchroniser les compteurs de non-lus entre appareils d'un même utilisateur, qui doivent continuer à fonctionner).
- **REQ-RCP-08** — En mode masqué, l'émission du « délivré » est suspendue. Côté expéditeur, un message vers un utilisateur masqué reste indéfiniment à `sent` ; l'API expose ce cas pour que l'UI le rende explicite.
- **REQ-RCP-09** — Anti-tempête : émission « délivré » par lot (debounce, un événement pour plusieurs messages reçus d'un coup lors d'un sync de rattrapage).

## Méthode et contraintes

- Écoute de l'insertion en store via les hooks de la Session (spec 04) ; pas d'accès direct à IndexedDB.
- Hors scope : rendu des crochets, réglage utilisateur (spec 11).

## Objectif mesurable

Suite Vitest, Session mockée, une describe par REQ : REQ-RCP-03 (événement inséré en store → reçu délivré émis, fake timers pour le debounce REQ-RCP-09) ; REQ-RCP-04 (2 reçus délivrés de 2 devices du même compte → statut inchangé après le premier) ; REQ-RCP-07/08 (mode masqué → émissions `m.read.private` et zéro délivré) ; transitions interdites testées (jamais read → delivered).
