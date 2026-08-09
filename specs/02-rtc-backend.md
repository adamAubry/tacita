# SPEC 02 — Backend RTC (LiveKit, lk-jwt-service, TURN, .well-known)

**Package : `infra/rtc/`. Dépendances : spec 01 (reverse proxy). Déployé dès la V1.**

## Livrable

Config-as-code du chemin voix/vidéo : SFU LiveKit auto-hébergé, service d'autorisation `lk-jwt-service` (traduit l'identité Matrix en jeton d'accès LiveKit), relais TURN, fichier `.well-known/matrix/client`. Les clients se connectent au SFU directement en UDP après autorisation.

## Exigences et critères d'acceptation

- **REQ-RTC-01** — LiveKit avec `room.auto_create: false` (sinon le SFU crée des salles pour n'importe qui, indépendamment du service d'autorisation).
- **REQ-RTC-02** — `use_external_ip: true` (découverte de l'IP publique par STUN).
- **REQ-RTC-03** — `LIVEKIT_FULL_ACCESS_HOMESERVERS` restreint au domaine du déploiement, jamais `*`.
- **REQ-RTC-04** — Plage UDP LiveKit ouverte **à la fois** sur le pare-feu hôte et sur le groupe de sécurité cloud ; les deux règles sont dans le code d'infra. (Symptôme d'oubli documenté dans le README : l'appel se connecte puis coupe à 15–20 s.)
- **REQ-RTC-05** — `.well-known/matrix/client` expose les `rtc_foci` **quand le RTC est déployé**, et est servi avec `Access-Control-Allow-Origin` (sans quoi le bouton d'appel reste inerte sans message d'erreur). **L'annonce est portée par l'overlay RTC, pas par la pile de base** : une pile sans SFU n'annonce aucun focus, `discoverFocus()` rend `RtcFociMissing`, et l'UI affiche le message que REQ-CAL-02 exige. Critère : le `.well-known` de la pile de base ne contient pas `rtc_foci` ; celui de la pile avec overlay le contient, avec le header CORS. *(Amendée le 05/08/2026 — escalade E-08. L'annonce inconditionnelle faisait trouver un focus dont le backend n'existait pas : l'appel échouait en 502 à la connexion au lieu de l'erreur lisible de REQ-CAL-02. Les deux specs étaient cohérentes seules ; l'incohérence vivait dans la jonction.)*
- **REQ-RTC-06** — TURN en TURN-TLS sur le port 443 pour les clients derrière NAT symétrique ou pare-feu strict.
- **REQ-RTC-07** — README `infra/rtc/README.md` rappelant que les MSC MatrixRTC ne sont pas stabilisés : préfixes d'événements et structure des state keys relus dans la doc courante d'Element Call avant tout usage littéral.
- **REQ-RTC-08** — **Element Call est auto-hébergé et épinglé, comme tout le reste du compose.** Son image est fixée par digest dans l'overlay RTC, la version correspondante et la date de résolution sont consignées dans `infra/rtc/README.md`, et son `matrix_rtc_mode` est **épinglé dans la config servie** — laissé au défaut, c'est le réglage développeur de chaque utilisateur qui déciderait de la forme des événements d'appartenance, donc une valeur différente par appareil. Servi sous son propre nom d'hôte (`call.<domaine>`), le SPA d'Element Call référençant ses assets en chemins absolus. **La pile de base n'en sert aucun** : même règle que REQ-RTC-05 — sans SFU derrière, un client d'appel qui se charge est un appel qui meurt à la connexion. Critère : aucune image de l'overlay n'est référencée par tag mutable ; le README porte version et digest ; le `matrix_rtc_mode` servi n'est pas `matrix_2_0` (événements *sticky* MSC4354, que `packages/calls` ne lit pas). *(Ajoutée le 07/08/2026 — escalade E-14. Un runtime externe que le client pointe sans version consignée est une jonction non relue : le paramètre de lancement audio/vidéo de REQ-UIX-38 avait été écrit sans pouvoir être vérifié contre quoi que ce soit.)*

## Méthode et contraintes

- Aucun client RTC maison, aucune couche RTC applicative : le client embarque Element Call en widget (spec 10). Ce module ne livre que l'infra.
- Hors scope : UI d'appel, logique client, config Synapse générale (spec 01).

## Objectif mesurable

Suite Vitest `infra/rtc/tests/` : parse la config LiveKit et asserte REQ-RTC-01/02/03 ; parse les règles pare-feu/SG et asserte REQ-RTC-04 (plage UDP présente dans les deux) ; parse les deux `.well-known` rendus et asserte REQ-RTC-05 (**absence** de `rtc_foci` dans la config proxy de base, **présence** avec header CORS dans celle de l'overlay) ; asserte REQ-RTC-06 (listener TLS :443) ; parse le compose de l'overlay et asserte REQ-RTC-08 (toute image épinglée par digest, version et digest d'Element Call présents dans le README, `matrix_rtc_mode` épinglé et différent de `matrix_2_0`, aucun Element Call servi par la pile de base). Une describe par REQ, nommée par son ID.
