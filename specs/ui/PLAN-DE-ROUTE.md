# Plan de route PM — audit E-01..E-10, arbitrages E-11..E-14 (07/08/2026)

## 1. Audit des décisions E-01 à E-10 : aucun problème critique

Relues contre les piliers (une app qui fonctionne, zéro clair serveur, zéro promesse non tenue, stack stable) : les dix tiennent. E-09 est **ratifiée formellement** — le motif est correct, l'interdit n°6 protège l'ordre _dans_ un salon, pas l'ordre _entre_ salons ; le point ne peut plus être rouvert qu'avec un ordre serveur disponible sur la version déployée.

Deux vigilances, pas des blocages :

- **E-10 : le spike n'est pas exécuté.** Le tableau des sondes est vide et c'est la seule chose entre nous et l'allumage du vocal et de la vidéo — deux features V1 visibles. Les deux branches étant décidées d'avance, il n'y a aucun arbitrage en attente : c'est de l'exécution pure, et ça devient l'action n°1 ci-dessous.
- **Classe « jonction entre specs »** : E-08, E-13 et E-14 sont le même mode de panne (deux specs justes, l'incohérence entre elles). Règle permanente, à ajouter en une ligne dans CLAUDE.md § Prudence outillage : _tout runtime externe que le client pointe (widget, service, URL de config) doit être épinglé dans `infra/` — une URL configurable sans version consignée est une jonction non relue._

## 2. Arbitrages E-11 à E-14

### E-11 — PowerSearch ne notifie pas la frappe → **Voie A maintenant, B en parallèle. C refusée.**

REQ-UIX-22 est amendée (geste PM, acté ici) : « recherche débouncée (300 ms) sur les **changements de critères** ; objectif mesurable : 20 changements de critères → 1 appel ». La recherche à la validation est le comportement contractuel tant qu'Astryx n'expose pas la saisie. Ouvrir l'issue amont (`onQueryChange`) dès maintenant ; si elle est livrée, la recherche incrémentale reviendra comme nouvelle exigence, pas comme dette. On ne recode pas une primitive parce qu'il lui manque une prop — jurisprudence E-10 confirmée.
_Devs : aucun code à reprendre. M-F reste vert tel quel._

### E-12 — Photo de profil → **Voie A : chemin public explicite dans le pipeline. B et C refusées.**

Même logique que les réactions en clair : un avatar chiffré ne s'affiche nulle part, donc le chiffrer est une non-feature ; le supprimer (B) sacrifie un attendu universel ; le rendre local (C) en fait un thème, pas un avatar. Conditions qui rendent A acceptable :

1. Spec 08 gagne **REQ-MED-11** : `uploadPublicProfileImage(...)` — même paquet, même compression, un seul point d'entrée, **non chiffré et nommé pour qu'on ne s'y trompe pas**. L'interdit n°11 tient : un seul pipeline.
2. **Un seul site d'appel autorisé** (le formulaire de profil) ; test structurel qui balaie les sources et échoue si un autre appelant apparaît — la promesse « tout ce qui sort du pipeline est chiffré » devient « …sauf l'unique chemin nommé public », et le test empêche la dérive.
3. Honnêteté en UI : une phrase sobre au moment du choix — « Votre photo de profil est visible de tous et n'est pas chiffrée » — et l'écran « limites connues » (REQ-UIX-32) l'ajoute à sa liste.

REQ-UI-20 amendée en conséquence. _Devs : spec 08 (REQ-MED-11 + test de site d'appel unique), puis M-G rebranche le champ photo._

### E-13 — Lien de groupe sans porte d'entrée → **Voie A : `knock`. B et C refusées.**

B réinvente un graphe qu'on a refusé en E-04 ; C rend au service le pouvoir Matrix que la ratification n°1 de la spec 12 lui refuse — on ne reprend pas d'un côté ce qu'on a refusé de l'autre. La promesse produit change et je l'assume : **un lien de groupe fait frapper à la porte, un membre confirme l'entrée**. Pour une app de cercles privés, ce sas est cohérent avec le positionnement, pas une régression.

Mécanique : la `join_rule` du salon passe à `knock` **à l'émission du premier lien actif** et revient à `invite` à la révocation/expiration du dernier (pas de knock permanent sur tous les groupes). Réception : résolution du token → knock → état d'attente honnête (« en attente de confirmation par un membre »). Un knock entrant s'affiche aux membres du groupe, accepter = invitation native.
_Devs : spec 12 (REQ-INV-06/13/15 amendées, REQ-INV-16 ouvert au client de réception), M-H (bascule join_rule liée au cycle de vie des liens + libellé d'émission mis à jour), M-G (écran de réception), spec 05 inchangée par défaut._

### E-14 — Element Call non épinglé → **on épingle, comme le reste du compose.**

Auto-hébergement intégral oblige : Element Call rejoint l'overlay `rtc/` avec image épinglée par digest, URL et version consignées dans `infra/rtc/README.md` (nouvelle **REQ-RTC-08**, testée comme les autres valeurs d'infra). Ensuite seulement, le nom du paramètre audio/vidéo se relit dans `src/UrlParams.ts` de cette version et la docstring de `CallWidgetOptions.video` perd son avertissement. Le lobby reste le filet : `skipLobby` toujours absent. REQ-UIX-38 inchangée, comme le proposait le Tech Lead.
_Devs : infra (épinglage + REQ-RTC-08), puis calls (relecture du nom, une ligne)._

## 3. Ordre d'exécution

| #   | Action                                                            | Qui                          | Quand                                   |
| --- | ----------------------------------------------------------------- | ---------------------------- | --------------------------------------- |
| 1   | Sonde E-10 sur 3 versions d'iOS, tableau rempli **par version**   | dev M-E + un iPhone réel     | cette semaine — débloque vocal et vidéo |
| 2   | Remux Chrome/Edge + muxeur MP4 (aucune inconnue, déjà autorisés)  | dev media-pipeline           | en parallèle de 1                       |
| 3   | Épinglage Element Call + REQ-RTC-08, puis relecture du paramètre  | infra, puis calls            | cette semaine                           |
| 4   | REQ-MED-11 + test de site d'appel unique, puis champ photo M-G    | dev media-pipeline, puis M-G | après 2                                 |
| 5   | Flux knock complet (spec 12, M-H, M-G réception)                  | dev M-G/M-H                  | après 4                                 |
| 6   | Issue Astryx `onQueryChange` + amendement REQ-UIX-22 dans la spec | Tech Lead                    | aujourd'hui, 30 min                     |

Portes de sortie inchangées : le vocal et la vidéo ne s'allument qu'avec les trois chemins couverts (E-10) ; la réception de lien de groupe ne se livre qu'avec le knock (E-13). Aucun changement de paradigme requis : les quatre arbitrages se règlent dans les lieux existants — pas de nouveau paquet, pas de nouvelle dépendance hors la branche d'échec déjà décidée d'E-10.
