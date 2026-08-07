# PLAN FRONTEND — Découpage du shard UI (apps/web)

Rédigé par le Tech Lead Frontend. **Hiérarchie des sources** : la SPEC 11 fait autorité (REQ-UI-XX, contraintes, critères) ; `ui-specs.md` (wireframe du concepteur) est un point de départ non exhaustif et faillible — toute divergence est tranchée en faveur de la SPEC 11 ou remontée (ESCALATIONS.md). Les exigences issues du wireframe portent le préfixe **REQ-UIX** ; elles ont été **ratifiées telles quelles le 05/08/2026** (E-06) et valent contrat au même titre que les REQ-UI.

## Documents

- `M-A.md` … `M-I.md` — les 9 modules frontend, assignables indépendamment
- `ESCALATIONS.md` — les quatorze points remontés au PM, tous tranchés
- `PLAN-DE-ROUTE.md` — audit PM des décisions E-01..E-10 et arbitrages E-11..E-14 (07/08/2026)
- Racine du repo : `PRODUCT.md` et `DESIGN.md` (impeccable) — à lire avant tout code UI

## Modules et ordre

| Module | Périmètre | Dépend de |
|---|---|---|
| M-A | Fondations : shell, thème, navbar, header, états vides/skeletons, PWA | — |
| M-B | Onboarding : OIDC, clé de récupération, éducation notifications iOS | M-A |
| M-C | Accueil : liste de conversations, tri, épingle, badges, bannière demandes, modal « + » | M-A |
| M-D | Conversation : timeline, message object, composer, gestes, reçus, typing, mentions | M-A, M-E (lecteurs) |
| M-E | Média : pickers, viewers, vocal + forme d'onde, capture, galeries partagées | M-A |
| M-F | Recherche : variations search/mentions, recherches récentes, résultats, highlight | M-A |
| M-G | Social : profils, amis, demandes, note, bloquer | M-A |
| M-H | Réglages & infos : settings, info conversation 1:1/groupe, options, notifications | M-A, M-E (galeries) |
| M-I | Appels & push : Element Call, bandeau, abonnement Web Push, notifications | M-A |

M-A d'abord (spike Astryx/ponytail/impeccable d'une journée inclus, cf. SPEC 11). Ensuite B–I parallélisables, M-E avant la fin de M-D et M-H. Intégration finale : navigation croisée + passe de cohérence design.

## Mapping des 26 composants du wireframe

| # | Composant | Module | # | Composant | Module |
|---|---|---|---|---|---|
| 1 | Component selector | M-A | 14 | Info buttons | M-H |
| 2 | Dropdown menu | M-A | 15 | Options | M-H |
| 3 | Conversations list | M-C | 16 | Friends list | M-G |
| 4 | Navbar | M-A | 17 | Recent searches | M-F |
| 5 | Invitation request | M-C | 18 | Highlighted text | M-F |
| 6 | Layout header | M-A | 19 | Searched messages | M-F |
| 7 | Buttons list | M-A | 20 | Placeholder | M-A |
| 8 | Search bar | M-A (base) / M-F (tokens) | 21 | Profile card | M-G |
| 9 | Conversation input | M-D | 22 | Form edit | M-G |
| 10 | Conversation starter | M-D | 23 | Note | M-G |
| 11 | Message object | M-D | 24 | Settings profile card | M-H |
| 12 | Hold menu modal | M-D | 25 | Friends interaction buttons | M-G |
| 13 | Date separator | M-D (+ réutilisé M-H) | 26 | Send invite | M-G |

Les 7 layouts : Default (home/search) → M-C/M-F ; Settings → M-H ; Profile → M-G ; Add-friends → M-G ; Friend request → M-G ; Conversation → M-D ; Conversation info → M-H.

## Organisation du code (lean)

```
apps/web/
  app/                  # routes App Router (une par layout)
  components/
    foundation/         # M-A : primitives composées (Navbar, Header, Placeholder, Skeleton…)
    conversation/       # M-D
    media/              # M-E (partagé par D, G, H)
    search/             # M-F
    social/             # M-G
    settings/           # M-H
  lib/                  # adaptateurs vers les packages 04–10, interfaces Contacts/ProfileNotes/InviteLinks
```

Règles : un composant du wireframe = un composant React nommé, réutilisé partout (jamais dupliqué entre layouts) ; les variations sont des props, pas des copies ; toute logique métier découverte remonte dans le package concerné (SPEC 11). Sweet spot assumé : pas de dossier par atome, regroupement par domaine.

## Divergences wireframe déjà arbitrées

Voir ESCALATIONS.md : les **quatorze** points sont tranchés — filtres de recherche (E-01), note locale à l'appareil (E-02), éphémères abandonnés (E-03), modèle amis natif (E-04), service de liens (E-05), REQ-UIX ratifiées (E-06), call layout (E-07), focus RTC conditionnel (E-08), ordre de la liste (E-09), transcodage (E-10), puis les quatre du plan de route PM du 07/08/2026 : recherche débouncée sur les critères (E-11), photo de profil par le chemin public nommé (E-12), lien de groupe en `knock` (E-13), Element Call épinglé (E-14). Plus les décisions design (avatar, navbar, formats de date). Le wireframe n'inclut pas : onboarding clé de récupération, bandeau hors ligne, reçus 3 niveaux, capture in-app, mode masqué — **ils sont dans la SPEC 11 et donc au périmètre**, répartis dans les modules.
