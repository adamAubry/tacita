# M-F — Recherche (Default layout, variations search et mentions)

**Dépendances : M-A, package search (spec 09) — dont la recherche filtrée REQ-SRC-11, livrée le 05/08/2026 (action A5). Escalade E-01 tranchée le 05/08/2026 : les filtres sont au périmètre V1, implémentés par le schéma d'index, jamais par un contournement plein-texte.**

## Livrable

Les trois états de la variation search + l'onglet Mentions. 100 % local (spec 09) : aucun appel réseau, fonctionne hors ligne.

## Exigences

- **REQ-UI-16** — Barre de recherche globale (PowerSearch, tokens configurés ici) ; périmètre explicite affiché : « Recherche dans l'historique téléchargé » avec les bornes de `stats()` (REQ-SRC-06).
- **REQ-UIX-19** — État initial (rien saisi) : Recent searches (composant 17) — titre + scroller horizontal de profils récemment recherchés avec « content peek » (dernier élément partiellement visible s'il déborde), stocké en IndexedDB, purgeable ; puis raccourcis/options de recherche. Placeholder si aucun historique.
- **REQ-UIX-20** — État résultats : deux sections titrées — « Conversations » (liste de previews filtrées par nom, sans badge ni épingle) et « Messages » (composant 19 : « message preview » = nom de conversation en haut à gauche, date en haut à droite, extrait tronqué en bas). Occurrences surlignées via Highlighted text (composant 18, token `highlight` de DESIGN.md). Tap sur un résultat → conversation positionnée sur le message.
- **REQ-UIX-21** — Onglet Mentions : recherche pré-armée du token `@me` (surligné dans la barre), résultats sous titre « Mentions » avec mentions surlignées ; filtre « exclure les groupes » (bouton dédié) + dropdown de filtres avancés (personne, conversation, type, dates). **Tous ces filtres sont au périmètre V1** (E-01 tranchée) : `sender`, `roomId`, dates, `msgtype` et `mentions` sont servis par REQ-SRC-11. L'onglet Mentions interroge le champ `mentions`, jamais une recherche plein-texte sur un nom d'affichage. L'API est `search(query, { roomId, sender, msgtype, mentions, since, until })` ; l'onglet Mentions passe un terme vide et `mentions: [moi, ROOM_MENTION]` — voir `packages/search/README.md`.
- **REQ-UIX-22** — Recherche débouncée (300 ms) **sur les changements de critères**, exécutée dans le worker du package ; skeletons pendant la requête ; Placeholder « aucun résultat » avec rappel du périmètre. *(Amendée le 07/08/2026 — escalade E-11, voie A. La rédaction précédente parlait de frappes, ce qu'Astryx `0.2.0` ne permet pas d'observer : `PowerSearch` ne notifie la saisie qu'à la validation d'un token. Le contrat est aligné sur ce que la primitive permet — on ne recode pas une primitive parce qu'il lui manque une prop, jurisprudence E-10. Si `onQueryChange` arrive en amont, la recherche incrémentale reviendra comme **nouvelle exigence**, pas comme dette.)*

## Contraintes

- Aucun appel réseau déclenché par la recherche (REQ-SRC-03) — testé par spy.
- **L'index n'appartient pas à cet écran.** `createSearch` est monté au-dessus des routes, avec la session (REQ-UI-16, même place que la file d'envoi) ; l'écran le consomme et ne le crée pas. Le créer ici le branchait sur les seuls déchiffrements survenus pendant que l'onglet était affiché — un index vide par construction. *(Ajoutée le 21/08/2026.)*
- La navigation vers un message hors historique chargé charge la timeline locale, jamais le serveur.

## Hors scope

Indexation (package spec 09) ; recherche intra-conversation du layout info (M-H, réutilise PowerSearch avec token conversation).

## Objectif mesurable

Vitest + Testing Library, package search mocké : REQ-UI-16 (bornes stats rendues) ; REQ-UIX-19 (débordement simulé → dernier item partiellement visible via attribut/style testable) ; REQ-UIX-20 (résultats mixtes → deux sections, texte surligné présent) ; REQ-UIX-21 (chaque filtre appelle `search` avec le critère correspondant ; deux filtres combinés rendent l'intersection ; l'onglet Mentions n'émet aucune requête plein-texte sur un nom d'affichage) ; REQ-UIX-22 (20 **changements de critères** → 1 appel search, fake timers ; spy fetch : zéro appel réseau).
