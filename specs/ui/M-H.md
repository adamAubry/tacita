# M-H — Réglages et infos de conversation

**Dépendances : M-A, M-E (galeries), packages messaging (05), receipts (06), média (08), spec 12 pour les liens d'invitation de groupe. Escalades E-03 et E-05 tranchées le 05/08/2026 (`DECISIONS.md` D-09) : pas de messages éphémères, et les liens passent par le service de tokens, **livré** (`apps/invite-tokens/`).**

## Livrable

Layout Settings, layout Conversation info (1:1 et groupe), et toutes les options par conversation.

## Exigences

### Settings
- **REQ-UIX-31** — Settings layout : header ; Settings profile card (composant 24 : carte non fondue, avatar + nom, chevron → profil propre) ; liste d'Options ouvrant chacune une modal : thème sombre/clair (mécanisme M-A, REQ-UI-03), confidentialité, notifications, stockage local (taille index/caches, bouton purge), à propos/limites connues.
- **REQ-UI-13 (réglage)** — Dans confidentialité : « mode masqué » (bascule `m.read.private`, REQ-RCP-07) avec explication de l'effet symétrique : vos reçus deviennent privés ET vos correspondants ne verront plus « délivré/lu » de votre part.
- **REQ-UIX-32** — Écran « limites connues » (honnêteté produit, spec 00) : réactions et épinglés en clair, « délivré » non standard, métadonnées visibles serveur, périmètre de recherche. Rédaction sobre, pas anxiogène.

### Conversation info
- **REQ-UIX-33** — Layout info : header ; avatar + nom centrés ; Info buttons (composant 14, taille navbar + libellé sous l'icône, 4 boutons équirépartis) — 1:1 : profil, rechercher dans la conversation (PowerSearch pré-armée token conversation, M-F), muter, options ; groupe : ajouter un membre, rechercher, muter, options.
- **REQ-UIX-34** — Options (composant 15, ClickableCards) — 1:1 : thème de la conversation, notifications, créer un groupe avec cette personne (+ autres) ; groupe : thème, lien d'invitation (émis par le service de la spec 12, E-05 tranchée — l'écran gère aussi l'expiration et la révocation), membres (liste + kick si power level suffisant, REQ-MSG-11), notifications. **« Messages éphémères » n'existe pas** — abandonné, pas reporté (E-03, D-09) : absent du DOM, jamais grisé.
- **REQ-UIX-35** — Thème de conversation : fond d'écran depuis la galerie du user (REQ-UI-20) — stocké en IndexedDB, non synchronisé, libellé « sur cet appareil » ; aperçu avant application ; réinitialisation possible. Lisibilité garantie par le voile (M-D).
- **REQ-UIX-36** — Muter / notifications par salon : push rules Matrix natives (silencieux, mentions uniquement, tout), état actuel visible dans la liste.
- **REQ-UIX-37** — Galeries : dernière section du layout info = `ConversationCollections` (M-E), 4 onglets, deux variantes 1:1/groupe identiques hors actions.

## Contraintes

- Compteur de membres visible dans l'info groupe (REQ-UI-05/REQ-MSG-11).
- Kick réservé aux power levels suffisants — les boutons non autorisés n'apparaissent pas (pas d'items grisés sans explication).
- Toute option affichée doit fonctionner en V1 : rien de « coming soon ».

## Hors scope

Contenu des galeries (M-E) ; onboarding (M-B) ; abonnement push global (M-I — M-H règle le par-salon).

## Objectif mesurable

Vitest + Testing Library : REQ-UI-13 (bascule → appel receipts.setHiddenMode ; explication rendue) ; REQ-UIX-33 (variante 1:1 vs groupe → jeux de boutons corrects) ; REQ-UIX-34 (option éphémères absente du DOM ; kick absent si power level insuffisant) ; REQ-UIX-35 (choix → persistance IndexedDB ; reset) ; REQ-UIX-36 (choix « mentions uniquement » → push rule correspondante appelée).
