# M-B — Onboarding et authentification

**Dépendances : M-A, package client-core (spec 04). Depuis le 24/08/2026, le module traverse aussi M-G (profil) et M-H (notifications) — il n'en copie aucun écran, il les rend.**

## Livrable

Parcours d'entrée : login OIDC, **puis un parcours d'accueil en étapes** qui va de la clé de récupération au premier message écrit. Le premier contact avec l'app : sobre, rassurant, zéro jargon crypto inutile (PRODUCT.md, voix).

## Exigences

- **REQ-UI-04** — Login par redirection OIDC (le fournisseur gère email/pseudo/OAuth/passkeys — aucune UI de mot de passe chez nous), puis **étape bloquante** : clé de récupération affichée une fois, confirmation de sauvegarde obligatoire, route conversations inaccessible tant que `recoveryRequired` (REQ-COR-06). Formulation honnête : sans cette clé, l'historique est perdu sur un nouvel appareil.
- **REQ-UI-18 (partie éducation)** — Écran « ajoutez l'app à l'écran d'accueil pour recevoir des notifications » présenté sur iOS hors standalone, au bon moment (pas au premier lancement — au premier point de friction pertinent, ex. activation des notifications). Jamais re-présenté après refus explicite (préférence en IndexedDB).
- **REQ-UIX-06** — Reprise de session : session valide → arrivée directe sur Accueil ; session expirée → retour OIDC sans écran intermédiaire inutile ; déconnexion → wipe (REQ-COR-10) avec confirmation explicite listant ce qui sera effacé localement.
- **REQ-UI-22** — **Le parcours d'accueil**, sur un compte qui vient d'être créé et sur lui seul. Quatre étapes aujourd'hui, dans cet ordre : clé de récupération (bloquante, REQ-UI-04) → identité (les images par défaut de REQ-MSG-22 sont dessinées **ici, et à aucun autre moment du produit**, puis le formulaire de M-G permet d'en changer) → notifications (l'écran de réglages de M-H, rendu tel quel) → première conversation (REQ-UI-23). La liste vit dans `components/onboarding/etapes.tsx` et nulle part ailleurs. Progression, sortie des étapes facultatives, attente localisée d'une étape qui prépare : voir SPEC 11.
- **REQ-UI-24** — **Porte de secours par clé de récupération** sur l'écran de connexion (D-14, SPEC 11). Troisième mode du même écran, atteint par « Mot de passe oublié ? » ; identifiant + clé ; pas de champ mot de passe ; la contrepartie dite sur place ; refus indifférencié. Tests : le lien n'apparaît qu'en mode connexion ; le champ mot de passe est absent (et non grisé) ; l'appel part avec identifiant et clé ; un `M_FORBIDDEN` rend « Identifiant ou clé de récupération incorrect. » et jamais le message de panne réseau.
- **REQ-UI-23** — **La conversation personnelle**, ouverte par la dernière étape, et le bouton qui y emmène. C'est le « moment de bascule » du parcours : ce qui suit n'est plus un écran d'accueil.

## Contraintes

- L'étape clé de récupération ne peut être ni sautée, ni différée, ni contournée par URL directe (guard de route).
- Aucun secret (clé de récupération) dans les logs, l'historique de navigation ou le presse-papiers sans action utilisateur explicite (bouton copier dédié, avec avertissement).
- Le parcours **ne copie aucun écran d'un autre module** : identité et notifications sont les composants de M-G et M-H, rendus à un autre moment. Deux copies auraient divergé au premier champ ajouté, et une seule des deux aurait porté l'avertissement d'honnêteté le jour où on l'aurait déplacé.
- Le parcours entier **remplace le contenu**, comme l'étape de la clé : ce n'est pas une route, donc aucune URL ne le contourne. Ses étapes peuvent être facultatives ; en sortir par le milieu ne l'est pas — un parcours abandonné en cours de route laisse quelqu'un sur une application vide.

## Hors scope

Configuration du fournisseur OIDC (spec 01) ; abonnement push effectif (M-I) ; le formulaire d'identité lui-même et la carte de profil (M-G) ; l'écran d'état des notifications (M-H) — le parcours les rend, il ne les écrit pas.

## Objectif mesurable

Vitest + Testing Library, Session mockée : REQ-UI-04 (état `recoveryRequired` → navigation vers conversations redirigée vers l'étape clé ; confirmation → accès libéré) ; REQ-UIX-06 (wipe appelé à la déconfirmation… uniquement après confirmation) ; REQ-UI-18 (user-agent iOS + display-mode browser simulés → écran rendu ; préférence refus → non re-rendu) ; REQ-UI-22 (les quatre étapes s'enchaînent et l'app reste fermée jusqu'à la dernière ; le compteur suit la liste **injectée**, pas la vraie ; « passer » n'écrit rien ; une préparation qui ne rend pas la main affiche son attente ; marque IndexedDB → parcours repris après rechargement ; `deverrouillage` → aucun parcours) ; REQ-UI-23 (salon créé une fois, inscrit dans `m.direct` sous son propre identifiant, navigation vers lui ; échec de création → entrée quand même, et dite ; propre identifiant absent de la liste d'amis).
