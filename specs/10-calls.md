# SPEC 10 — Intégration appels (Element Call en widget)

**Package : `packages/calls/`. Dépendances : spec 04 (Session), spec 02 (backend RTC déployé). Zéro DOM — fournit les données, le shard UI rend l'iframe.**

## Livrable

Orchestration côté client des appels voix/vidéo MatrixRTC : construction de l'URL du widget Element Call, cycle de vie de l'appel, détection d'appel en cours dans un salon. **Aucun client RTC maison** — les MSC visés ne sont pas stabilisés et une couche RTC propre représente plusieurs mois ; Element Call embarqué en widget est la seule voie autorisée.

API : `buildCallWidget(roomId): { url, params }`, `activeCall(roomId): Observable<CallState>`, `hangupLocal(roomId)`.

## Exigences et critères d'acceptation

- **REQ-CAL-01** — `buildCallWidget` produit une URL Element Call complète et paramétrée (salon, identité, homeserver) pour intégration en iframe par le shard UI ; l'auth SFU passe par le chemin lk-jwt du déploiement (spec 02), le module ne manipule jamais de credentials LiveKit en dur.
- **REQ-CAL-02** — Découverte des `rtc_foci` via `.well-known/matrix/client` (spec 02) ; si le well-known est absent ou sans foci, l'API retourne une erreur **explicite et typée** (pas de bouton inerte silencieux — l'UI doit pouvoir afficher la cause).
- **REQ-CAL-03** — `activeCall` détecte les appels en cours d'un salon à partir des événements d'état MatrixRTC (participants, début/fin) pour l'affichage « appel en cours — rejoindre ».
- **REQ-CAL-04** — Tout préfixe d'événement et toute structure de state key MatrixRTC utilisés sont centralisés dans **un seul fichier de constantes** commenté avec la référence de doc Element Call vérifiée : les MSC ne sont pas stabilisés, ces valeurs doivent être relues dans la doc courante avant usage et modifiables en un seul point.
- **REQ-CAL-05** — Communication widget ↔ client via l'API widget standard (postMessage / matrix-widget-api) : le module fournit le driver, sans réimplémenter de logique RTC.
- **REQ-CAL-06** — Aucune donnée d'appel (tokens, identifiants de salle SFU) dans les logs.

## Méthode et contraintes

- YAGNI : pas de sonnerie/refus/signalement d'appel manqué en V1 au-delà de ce que les événements d'état donnent déjà.
- Hors scope : infra LiveKit/TURN (spec 02), rendu de l'iframe, permissions caméra/micro, UI d'appel (spec 11).

## Objectif mesurable

Suite Vitest avec Session et fetch mockés, une describe par REQ : REQ-CAL-01 (URL générée conforme au pattern attendu, paramètres requis présents) ; REQ-CAL-02 (well-known sans foci → erreur typée `RtcFociMissing`) ; REQ-CAL-03 (événements d'état simulés → transitions `idle → active → ended`) ; REQ-CAL-04 (test structurel : les littéraux MatrixRTC n'existent que dans le fichier de constantes — scan des sources).
