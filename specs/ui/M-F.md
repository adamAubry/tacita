# M-F — Recherche (Default layout, variations search et mentions)

**Dépendances : M-A, package search (spec 09). Escalation E-01 ouverte (tokens avancés).**

## Livrable

Les trois états de la variation search + l'onglet Mentions. 100 % local (spec 09) : aucun appel réseau, fonctionne hors ligne.

## Exigences

- **REQ-UI-16** — Barre de recherche globale (PowerSearch, tokens configurés ici) ; périmètre explicite affiché : « Recherche dans l'historique téléchargé » avec les bornes de `stats()` (REQ-SRC-06).
- **REQ-UIX-19** — État initial (rien saisi) : Recent searches (composant 17) — titre + scroller horizontal de profils récemment recherchés avec « content peek » (dernier élément partiellement visible s'il déborde), stocké en IndexedDB, purgeable ; puis raccourcis/options de recherche. Placeholder si aucun historique.
- **REQ-UIX-20** — État résultats : deux sections titrées — « Conversations » (liste de previews filtrées par nom, sans badge ni épingle) et « Messages » (composant 19 : « message preview » = nom de conversation en haut à gauche, date en haut à droite, extrait tronqué en bas). Occurrences surlignées via Highlighted text (composant 18, token `highlight` de DESIGN.md). Tap sur un résultat → conversation positionnée sur le message.
- **REQ-UIX-21** — Onglet Mentions : recherche pré-armée du token `@me` (surligné dans la barre), résultats sous titre « Mentions » avec mentions surlignées ; filtre « exclure les groupes » (bouton dédié) + dropdown de filtres avancés (personne, conversation, type, dates). **Les filtres non couverts par l'index actuel (type, mentions structurées) restent derrière flag tant que E-01 n'est pas tranché** — le bouton n'apparaît pas, aucun filtre grisé.
- **REQ-UIX-22** — Recherche débouncée (300 ms), exécutée dans le worker du package ; skeletons pendant la requête ; Placeholder « aucun résultat » avec rappel du périmètre.

## Contraintes

- Aucun appel réseau déclenché par la recherche (REQ-SRC-03) — testé par spy.
- La navigation vers un message hors historique chargé charge la timeline locale, jamais le serveur.

## Hors scope

Indexation (package spec 09) ; recherche intra-conversation du layout info (M-H, réutilise PowerSearch avec token conversation).

## Objectif mesurable

Vitest + Testing Library, package search mocké : REQ-UI-16 (bornes stats rendues) ; REQ-UIX-19 (débordement simulé → dernier item partiellement visible via attribut/style testable) ; REQ-UIX-20 (résultats mixtes → deux sections, texte surligné présent) ; REQ-UIX-21 (flag off → filtres avancés absents du DOM) ; REQ-UIX-22 (20 frappes → 1 appel search, fake timers ; spy fetch : zéro appel réseau).
