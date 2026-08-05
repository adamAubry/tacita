# Limites assumées — service de liens d'invitation (spec 12)

Interdit n°13 : une limite se documente, elle ne se masque pas. Celles-ci sont à dire
aussi **côté utilisateur**, pas seulement ici.

## Ce service apprend qui invite qui (REQ-INV-19)

C'est la limite principale, et elle est structurelle. Pour résoudre un lien, le service
sait : quel compte l'a émis, quel compte l'a résolu, et — pour un lien de groupe — de
quel salon il s'agit. **C'est de la métadonnée, jamais du contenu.** Le service n'a accès
à aucun message, ne peut en émettre aucun, et ne détient aucun droit Matrix : ni jeton
d'administration, ni droit d'inviter, ni droit de créer un salon. Un service compromis
peut mentir sur un identifiant ; il ne peut rien envoyer, joindre ni lire.

Cette métadonnée rejoint celle que REQ-INF-13 assume déjà côté Synapse. Elle ne survit
pas à la validité du lien : les lignes expirées sont purgées (REQ-INV-18), et le stockage
ne porte ni nom d'affichage, ni libellé de salon, ni contenu.

**L'ajout par identifiant Matrix direct ne passe pas par ce service** (REQ-INV-16). Qui
veut éviter cette métadonnée peut se lier à quelqu'un sans jamais l'utiliser — c'est
aussi ce qui fait qu'une panne du service ne rend pas le produit inutilisable.

## Un blocage n'est vérifiable que dans un sens (REQ-INV-14)

Le service refuse la résolution — du même échec neutre que tout le reste — quand **le
porteur** a mis l'émetteur dans son `m.ignored_user_list`. Il le lit avec le jeton du
porteur, c'est-à-dire au nom de qui appelle.

**L'autre sens ne lui est pas accessible** : la liste d'ignorés de l'émetteur est de la
donnée de compte que le service ne peut pas lire sans les pouvoirs Matrix que la spec 12
lui refuse. Ce sens-là est déjà tenu par Matrix lui-même : si l'émetteur ignore le
porteur, son client écarte l'invitation qui arrivera, sans rien afficher. Le résultat
produit est le même — rien ne se passe, et personne n'apprend qu'il est bloqué — mais il
est obtenu côté client, pas ici.

## « Salon quitté » n'est pas vérifié (REQ-INV-15)

Un compte désactivé est détecté : son profil n'est plus lisible. En revanche, pour un
lien `group`, le service **ne peut pas voir** que l'émetteur a quitté le salon — il
faudrait lire l'état d'un salon dont ni lui ni le porteur ne sont membres. Le lien reste
donc résolvable, et c'est le parcours d'invitation côté client qui échouera.

## L'atomicité ne se prouve que contre un vrai PostgreSQL (REQ-INV-07)

La consommation d'un usage est **une seule instruction SQL**, garde `uses_left > 0`
compris ; c'est PostgreSQL qui réévalue ce garde après avoir pris le verrou de ligne, et
c'est ce qui fait qu'une seule de deux résolutions concurrentes réussit.

Les deux portes, séparément :

- `tests/store.test.ts` asserte la **forme** de l'instruction, et `tests/links.test.ts`
  que le domaine ne décide pas lui-même du dernier usage entre sa lecture et sa
  consommation. Ni l'un ni l'autre ne prouve le comportement concurrent : l'imitation de
  la base y est monothread, donc atomique par construction — elle confirmerait
  l'hypothèse au lieu de l'éprouver ;
- `infra/smoke/invite-tokens.smoke.test.ts` le prouve, contre la base de la pile Docker.
  C'est là, et seulement là, que PostgreSQL arbitre.

Une modification du SQL de consommation qui passe `npm test` n'est pas validée : elle
demande `npm run smoke`.

## La limitation de débit est locale au processus (REQ-INV-09)

Compteur en mémoire, par IP et par compte. Deux répliques du service doubleraient le
budget réel. C'est sans conséquence pour un cercle fermé de quelques dizaines de comptes
servi par une instance ; le jour où il y en a deux, le compteur doit passer en base.

## « Pas de compte » et « déconnecté » ne se distinguent pas ici (REQ-INV-10 / 11)

Le service répond `401` à tout appelant sans jeton d'accès valide, **avant** de regarder
le token — donc aucun usage n'est consommé, et le lien survit au détour par OIDC. Choisir
entre lancer le login et afficher « Tacita est sur invitation, voici comment demander un
compte » revient à l'UI (spec 11) : c'est elle qui sait si le login vient d'échouer.
Aucun formulaire d'inscription n'existe nulle part — `enable_registration` est à `false`.
