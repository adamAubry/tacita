# SPEC 12 — Service de liens d'invitation

**App : `apps/invite-tokens/`. Dépendances : spec 01 (PostgreSQL, proxy, OIDC/Keycloak). Déploiement raccordé par la spec 01 (REQ-INF-15).**

*(Créée le 05/08/2026 — escalade E-05 tranchée, `DECISIONS.md` D-09. Elle reprend l'esquisse V2-04 du backlog `specs/ui/V2-BACKEND.md`, supprimé : ses quatre items sont tranchés.)*

## Livrable

Un service Node autonome qui **traduit un token en identifiant**, et rien d'autre. Il émet des liens à durée de vie bornée et les résout pour un appelant authentifié.

**Le cadre de la fonctionnalité, décidé par le PM : un utilisateur existant ajoute un autre utilisateur existant.** Tout ce qui en sort a un comportement défini par cette spec — jamais une erreur technique brute, jamais une inscription en libre-service que `enable_registration: false` interdit.

**Le service n'exécute aucune action Matrix.** Il ne détient ni jeton d'administration, ni droit d'inviter, ni droit de créer un salon. Il rend un identifiant au porteur authentifié ; c'est **le client** qui invite ensuite, par le chemin natif de D-09 (invitation de salon DM pour un ami, invitation de salon pour un groupe). Un service compromis peut donc mentir sur un identifiant — il ne peut envoyer, joindre ni lire quoi que ce soit.

## Exigences et critères d'acceptation

### Émission

- **REQ-INV-01** — `POST /links` crée un lien. Authentification **obligatoire** par le jeton d'accès Matrix de l'émetteur, validé auprès de Synapse (`/_matrix/client/v3/account/whoami`) : le service ne croit jamais un identifiant que l'appelant lui donne. Corps : `kind` (`friend` | `group`), `roomId` si `group`, `maxUses` (défaut **1**), `ttlSeconds` (défaut **86 400**, plafond **604 800**). Réponse : le token opaque et sa date d'expiration.
- **REQ-INV-02** — Le token est **opaque et aléatoire**, ≥ 256 bits d'entropie tirés d'un CSPRNG, stocké **haché** (jamais en clair en base). Pas de token auto-porteur signé : un JWT ne se révoque pas, et REQ-INV-05 exige la révocation.
- **REQ-INV-03** — Un lien ne révèle **rien avant résolution authentifiée**. L'URL ne contient ni identifiant d'émetteur, ni `roomId`, ni nom lisible : un lien qui fuite ne dit pas qui invite qui.
- **REQ-INV-04** — `GET /links` liste les liens actifs de l'émetteur authentifié (kind, expiration, usages restants), jamais ceux d'un autre.
- **REQ-INV-05** — `DELETE /links/:id` révoque immédiatement. Un lien révoqué est indistinguable d'un lien inexistant (REQ-INV-08).

### Résolution

- **REQ-INV-06** — `POST /links/:token/resolve` exige un jeton d'accès Matrix valide et rend `{ kind, issuer }` — plus `roomId` si `kind: group`. **Le service s'arrête là** : aucune invitation n'est émise par lui.
- **REQ-INV-07** — La consommation est **atomique** : décrément de `maxUses` et lecture dans la même transaction. Deux résolutions concurrentes du dernier usage : une seule réussit.
- **REQ-INV-08** — **Un seul message d'échec pour trois causes.** Token inconnu, expiré ou révoqué rendent la même réponse (`404`, corps identique). Distinguer les trois permettrait de sonder l'existence d'un token ; l'UI dit « ce lien n'est plus valide » et propose d'en redemander un. *La perte de confort est assumée : elle est le prix de la non-énumérabilité.*
- **REQ-INV-09** — Limitation de débit sur la résolution, par compte appelant **et** par IP. Un token de 256 bits n'est pas énumérable de front, mais un service qui ne compte pas ses échecs n'a aucun moyen de voir qu'on l'essaie.

### Les scénarios hors cadre — chacun a un comportement, aucun n'a une erreur brute

- **REQ-INV-10** — **Porteur sans compte.** `enable_registration: false` : aucune inscription en libre-service. Le lien affiche un écran d'explication — Tacita est sur invitation, voici comment demander un compte — et **jamais** un formulaire d'inscription ni une erreur technique. Le token n'est **pas** consommé.
- **REQ-INV-11** — **Porteur déconnecté.** Le lien déclenche le login OIDC et **survit à la redirection** : après authentification, la résolution reprend sans que l'utilisateur ait à rouvrir le lien. Le token n'est consommé qu'après authentification réussie.
- **REQ-INV-12** — **Le porteur est l'émetteur.** Résolution refusée, message explicite (« ce lien est le vôtre »). Aucun DM avec soi-même, aucun usage consommé.
- **REQ-INV-13** — **Lien déjà résolu par ce porteur, ou relation déjà établie** (DM existant, déjà membre du salon). Succès **idempotent** : le client ouvre la conversation existante. Ce n'est pas une erreur, et aucun usage supplémentaire n'est consommé.
- **REQ-INV-14** — **L'un des deux a bloqué l'autre** (`m.ignored_user_list`). La résolution rend le même échec neutre que REQ-INV-08. Un blocage ne s'annonce pas : le dire confirmerait au bloqué qu'il l'est.
- **REQ-INV-15** — **Émetteur disparu** (compte désactivé, ou salon quitté pour un lien `group`). Le lien est invalide, même réponse neutre. Vérifié à la résolution, jamais mis en cache.
- **REQ-INV-16** — **Le service est indisponible.** L'ajout par identifiant Matrix direct reste disponible dans l'UI et **ne passe pas par le service** — il est natif (D-09). Un lien cassé ne doit jamais rendre le produit inutilisable pour se lier à quelqu'un. Critère : le parcours d'ajout par identifiant n'émet aucun appel vers ce service.
- **REQ-INV-17** — **Expiration vérifiée côté serveur** contre son horloge, jamais contre une date portée par le client ou par le token.

### Ce que le service sait, et qu'il faut dire

- **REQ-INV-18** — Le stockage est **minimal** : hachage du token, identifiant de l'émetteur, `kind`, `roomId` si `group`, expiration, usages restants, état de révocation. **Aucun nom d'affichage, aucun contenu, aucun libellé de salon.** Les lignes expirées sont purgées par un job ; une trace de lien n'a aucune raison de survivre à sa validité.
- **REQ-INV-19** — **Limite assumée, documentée dans `apps/invite-tokens/LIMITES.md` et côté utilisateur** : ce service apprend **qui invite qui**. C'est de la métadonnée, jamais du contenu — il n'a accès à aucun message et ne peut en émettre aucun — et elle rejoint la limite déjà assumée par REQ-INF-13. Interdit n°13 : elle se documente, elle ne se masque pas.
- **REQ-INV-20** — Aucun identifiant d'utilisateur, aucun `roomId` et aucun token dans les logs. Les journaux portent l'issue (`resolved`, `rejected`) et le motif technique, jamais qui.

## Méthode et contraintes

- Service Node autonome, PostgreSQL de la spec 01 (base dédiée, pas de table dans celle de Synapse). Le déploiement — Dockerfile, service compose, route proxy, variables — appartient à la spec 01 : **REQ-INF-15**, par la même jurisprudence que REQ-INF-14 pour la passerelle push. Chaque jonction a un propriétaire nommé.
- Aucun jeton d'administration Synapse, aucun droit Matrix, dans aucune variable d'environnement de ce service. C'est vérifiable et c'est vérifié (objectif mesurable).
- Hors scope : l'UI d'émission et de réception des liens (spec 11, modules `M-G` et `M-H`), l'onboarding de comptes nouveaux (il n'y en a pas — `enable_registration: false`), le graphe social (D-09 le refuse).

## Objectif mesurable

Suite Vitest, une describe par REQ. Points de contrôle notables : REQ-INV-07 (deux résolutions concurrentes du dernier usage → une seule réussit) ; REQ-INV-08 (les réponses pour un token inconnu, expiré et révoqué sont **strictement identiques**, corps et code) ; REQ-INV-10 à REQ-INV-15 (un test par scénario hors cadre, assertant le comportement **et** l'absence de consommation d'usage là où la spec l'exige) ; REQ-INV-16 (le parcours d'ajout par identifiant n'appelle pas le service) ; REQ-INV-20 (spy sur le logger : aucun identifiant ni token dans les lignes émises). Un test lisant la configuration asserte qu'aucune variable ne porte de jeton d'administration Synapse.

## Ratification

**Cette spec traduit la décision E-05 ; elle n'a pas encore été relue par le PM.** Trois choix ont dû être faits pour l'écrire, et méritent un oui ou un non explicite :

1. **Le service ne fait aucune action Matrix** (il résout, le client invite). C'est ce qui borne les dégâts d'une compromission, au prix d'un aller-retour de plus.
2. **Un seul message pour « expiré », « révoqué » et « inconnu »** (REQ-INV-08) — non-énumérabilité contre confort d'usage.
3. **Les liens de groupe sont couverts** par le même service (`kind: group`), alors que le cadre énoncé ne parlait que d'ajout d'ami. Si les liens de groupe doivent attendre, `kind` se réduit à `friend` et REQ-INV-06 perd son `roomId`.
