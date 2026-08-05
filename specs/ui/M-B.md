# M-B — Onboarding et authentification

**Dépendances : M-A, package client-core (spec 04).**

## Livrable

Parcours d'entrée : login OIDC, étape bloquante de clé de récupération, écrans d'éducation (notifications iOS). Le premier contact avec l'app : sobre, rassurant, zéro jargon crypto inutile (PRODUCT.md, voix).

## Exigences

- **REQ-UI-04** — Login par redirection OIDC (le fournisseur gère email/pseudo/OAuth/passkeys — aucune UI de mot de passe chez nous), puis **étape bloquante** : clé de récupération affichée une fois, confirmation de sauvegarde obligatoire, route conversations inaccessible tant que `recoveryRequired` (REQ-COR-06). Formulation honnête : sans cette clé, l'historique est perdu sur un nouvel appareil.
- **REQ-UI-18 (partie éducation)** — Écran « ajoutez l'app à l'écran d'accueil pour recevoir des notifications » présenté sur iOS hors standalone, au bon moment (pas au premier lancement — au premier point de friction pertinent, ex. activation des notifications). Jamais re-présenté après refus explicite (préférence en IndexedDB).
- **REQ-UIX-06** — Reprise de session : session valide → arrivée directe sur Accueil ; session expirée → retour OIDC sans écran intermédiaire inutile ; déconnexion → wipe (REQ-COR-10) avec confirmation explicite listant ce qui sera effacé localement.

## Contraintes

- L'étape clé de récupération ne peut être ni sautée, ni différée, ni contournée par URL directe (guard de route).
- Aucun secret (clé de récupération) dans les logs, l'historique de navigation ou le presse-papiers sans action utilisateur explicite (bouton copier dédié, avec avertissement).

## Hors scope

Configuration du fournisseur OIDC (spec 01) ; abonnement push effectif (M-I).

## Objectif mesurable

Vitest + Testing Library, Session mockée : REQ-UI-04 (état `recoveryRequired` → navigation vers conversations redirigée vers l'étape clé ; confirmation → accès libéré) ; REQ-UIX-06 (wipe appelé à la déconfirmation… uniquement après confirmation) ; REQ-UI-18 (user-agent iOS + display-mode browser simulés → écran rendu ; préférence refus → non re-rendu).
