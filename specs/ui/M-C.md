# M-C — Accueil (Default layout, variation home)

**Dépendances : M-A, packages messaging (spec 05) et client-core (spec 04).**

## Livrable

L'écran d'atterrissage : liste des conversations et points d'entrée (nouvelle conversation, ajout d'amis, recherche, demandes).

## Exigences

- **REQ-UI-05** — Liste des conversations (composant 3) : « conversation preview » = avatar (règle ConversationAvatar, cf. ESCALATIONS décisions design) + nom + aperçu tronqué du dernier message + date localisée (heure:minute si aujourd'hui, sinon date courte). Skeleton pendant le chargement.
- **REQ-UIX-07** — En tête de home : Component selector « Conversations | Ajouter des amis » (bascule vers le layout add-friends, M-G) ; rangée de boutons : Dropdown de tri récentes/anciennes, bouton recherche (→ variation search), bouton « + » ouvrant le choix « nouvelle conversation | nouveau groupe » (NavIcon sauf le dropdown).
- **REQ-UIX-08** — Badges par conversation : non-lus « 1 »…« 9+ », remplacé par « @ » si mention non lue (données natives des compteurs de notification ; la mention prime sur le nombre).
- **REQ-UIX-09** — Épingler : glissement vers la droite sur une preview → épinglée en tête de liste (tag natif `m.favourite`, synchronisé). Geste avec seuil et équivalent non gestuel dans le hold menu de la carte.
- **REQ-UIX-10** — Bannière demandes (composant 5) : ClickableCard « Nouvelles demandes » + compteur, rendue **uniquement** s'il existe des demandes actives (invitations en attente, interface Contacts de M-G) ; tap → layout friend request ; glissement droit → dismiss (réapparaît à la prochaine nouvelle demande).
- **REQ-UIX-11** — Création : « nouvelle conversation » → sélection d'un contact → DM (existant réutilisé, jamais de doublon) ; « nouveau groupe » → sélection multiple + nom → salon groupe. Via package messaging (REQ-MSG-02).

## Contraintes

- Liste virtualisée si Astryx le permet (perf sur longues listes) — sinon pagination simple, à trancher au spike M-A.
- État vide : Placeholder « Démarre ta première conversation » avec action.
- Tri et épingles cohabitent : épinglées toujours en tête, tri appliqué au reste.

## Hors scope

Rendu de la conversation (M-D) ; recherche (M-F) ; add-friends et demandes (M-G — M-C ne fait que router).

## Objectif mesurable

Vitest + Testing Library, packages mockés : REQ-UI-05 (données → preview complète ; aujourd'hui vs hier → formats de date distincts) ; REQ-UIX-08 (12 non-lus → « 9+ » ; mention + non-lus → « @ ») ; REQ-UIX-09 (séquence pointer swipe droit → appel tag favourite ; épinglée rendue en tête malgré tri) ; REQ-UIX-10 (0 demande → bannière absente).
