# invite-tokens — service de liens d'invitation (spec 12)

Il **traduit un token en identifiant**, et rien d'autre. Il émet des liens à durée de vie
bornée et les résout pour un appelant authentifié.

**Le cadre, décidé par le PM : un utilisateur existant ajoute un autre utilisateur
existant.** Tout ce qui en sort a un comportement défini — jamais une erreur technique
brute. *(La phrase disait « jamais une inscription en libre-service (`enable_registration: false`) » :
D-13 a ouvert l'inscription le 25/08/2026. Le service, lui, n'a pas changé — il ne crée
aucun compte, il résout un token pour un appelant déjà authentifié.)*

## Ce qu'il ne fait pas, et c'est le point

Le service **n'exécute aucune action Matrix**. Il ne détient ni jeton d'administration,
ni droit d'inviter, ni droit de créer un salon. Il rend un identifiant au porteur
authentifié ; **c'est le client qui invite ensuite**, par le chemin natif de D-09
(invitation de DM pour un ami, invitation de salon pour un groupe).

Ses trois seuls appels à Synapse sont des **lectures faites avec le jeton de l'appelant** :
`whoami` (REQ-INV-01/06), la liste d'ignorés de l'appelant (REQ-INV-14), le profil de
l'émetteur (REQ-INV-15). Aucun n'utilise un pouvoir qui lui appartiendrait.

## API

| Route | Ce qu'elle fait |
|---|---|
| `POST /links` | crée un lien — `kind` (`friend`\|`group`), `roomId` si `group`, `maxUses` (défaut 1), `ttlSeconds` (défaut 86 400, plafond 604 800). Rend `{ id, token, expiresAt }`. |
| `GET /links` | les liens actifs de l'appelant — `{ id, kind, expiresAt, usesLeft }`, jamais ceux d'un autre. |
| `DELETE /links/:id` | révoque immédiatement. `204`, ou l'échec neutre si le lien n'est pas à l'appelant. |
| `POST /links/:token/resolve` | rend `{ kind, issuer }`, plus `roomId` si `kind: group`. **Le service s'arrête là.** |

Toutes exigent `Authorization: Bearer <jeton d'accès Matrix>`.

## Un seul échec, pour toutes les causes

Token inconnu, expiré, révoqué, épuisé, émetteur disparu, blocage : **une réponse, un
corps, un code** (`404 TACITA_LINK_INVALID`). Distinguer les causes permettrait de sonder
l'existence d'un token, et pour le blocage, de confirmer au bloqué qu'il l'est. L'UI dit
« ce lien n'est plus valide » et propose d'en redemander un. *La perte de confort est
assumée : elle est le prix de la non-énumérabilité.*

Les deux exceptions ne trahissent rien :

- `401 TACITA_AUTH_REQUIRED` — répondu **avant** toute lecture du token, donc sans
  consommer d'usage (REQ-INV-10/11) ;
- `400 TACITA_OWN_LINK` — seul l'émetteur peut le déclencher, et il connaît déjà son
  propre lien (REQ-INV-12).

Une reprise n'est pas un échec : un porteur qui rouvre un lien qu'il a déjà résolu obtient
le **même succès**, sans consommer d'usage de plus (REQ-INV-13).

## Déploiement

Le raccordement appartient à la spec 01 — **REQ-INF-15** : image, service compose, base
PostgreSQL dédiée, route proxy, variables. Voir `infra/README.md`.

```
DATABASE_URL=postgres://…    # base dédiée, jamais celle de Synapse
HOMESERVER_URL=https://…     # pour whoami et les deux lectures de compte
PORT=8009
PURGE_INTERVAL_MS=3600000    # REQ-INV-18 — les lignes expirées ne survivent pas
```

**Aucune variable ne porte de secret d'administration Synapse**, et un test de
configuration l'asserte : la spec 12 interdit à ce service tout pouvoir Matrix, le
raccordement ne doit pas le lui rendre.

Le schéma est créé au démarrage (`CREATE TABLE IF NOT EXISTS`) : deux tables, aucune
migration à dérouler.

## Limites assumées

Dans `LIMITES.md` — dont la principale : **ce service apprend qui invite qui.**
