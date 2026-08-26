# Tacita

Messagerie chiffrée de bout en bout, auto-hébergée, livrée en PWA. Elle remplace les DM
et groupes Instagram pour un cercle fermé.

**La règle qui gouverne tout : le serveur ne voit jamais de contenu en clair.** Tout le
reste en découle, y compris les limites — qui sont documentées, jamais masquées.

> **Ce fichier est une carte, pas une copie.** Il dit où chaque chose vit ; il ne
> reproduit rien. Une copie vieillit sans prévenir — le dossier `correctif/`, instantané
> de deux correctifs déjà appliqués, avait divergé en douze heures ; il a été supprimé.
> Si un point ci-dessous contredit le fichier qu'il désigne, **c'est le fichier
> désigné qui fait foi**, et cette carte est à corriger.

---

## Par où commencer, selon qui vous êtes

| Vous êtes | Lisez, dans cet ordre |
|---|---|
| **Développeur qui arrive** | `CLAUDE.md`, puis le `README.md` du package que vous touchez |
| **Relecteur** | la section « Ce qui est prouvé, ce qui ne l'est pas » ci-dessous, puis le diff |
| **PM / décideur** | `DECISIONS.md` — les arbitrages et leurs motifs |
| **Développeur du shard UI** | `DESIGN.md` et `PRODUCT.md`, puis `apps/web/README.md` |
| **Quelqu'un que ça réveille la nuit** | la section « Ce qui est prouvé, ce qui ne l'est pas » ci-dessous |

---

## Les contrats, par ordre d'autorité

1. **`CLAUDE.md`** — principe directeur, stack imposée, **13 interdits absolus**, la
   jurisprudence du dépôt. Ne se négocie pas dans une PR.
2. **`DECISIONS.md`** — arbitrages produit fermes (D-01 à D-15). Le code ne les rediscute
   pas ; on escalade au PM.
3. **`DESIGN.md`** et **`PRODUCT.md`** — système visuel et stratégie produit. Toute
   évolution visuelle passe par `DESIGN.md`, jamais par une valeur en dur.

Le `README.md` de chaque paquet porte son contrat d'interface et ses limites assumées.

---

## Où sont les limites assumées

Aucune n'est ici : elles vivent à côté du code qui les porte, c'est ce qui les empêche de
mentir.

| Sujet | Fichier |
|---|---|
| Jeton d'accès stocké en clair ; jeton restauré non validé | `packages/client-core/README.md` |
| Recherche limitée à l'historique téléchargé, plafond 200 000, retrait non retenté | `packages/search/README.md` |
| Refus d'envoi en salon non chiffré (`TACITA_NOT_ENCRYPTED`) | `packages/outbox/README.md` |
| Réactions en clair, épinglage non chiffré | `packages/messaging/README.md` |
| Média authentifié : les anciens endpoints sont morts | `infra/README.md` |
| Ce que la cible de fumée prouve — et ne prouve pas | `infra/smoke/README.md` |
| Ce que l'utilisateur en voit, en clair dans l'app | Profil › Réglages › Limites connues |

---

## Ce qui est prouvé, ce qui ne l'est pas

Le projet distingue **deux portes**, et c'est une règle, pas une nuance :

- **« module terminé »** = les tests de configuration et d'unité passent. Ils attestent le
  contenu des fichiers et le comportement du code contre des imitations.
- **« produit connectable »** = la cible de fumée passe. Elle atteste le comportement
  contre un vrai serveur.

Les deux sont nécessaires. La première seule a déjà menti : la configuration du login
était conforme à 100 % pendant que personne ne pouvait se connecter.

```sh
npm test        # imitations, aucune dépendance externe
npm run smoke   # vrai Synapse, vraie crypto, vrai IndexedDB (Docker requis)
```

**Prouvé à l'exécution :** la crypto Rust réellement chargée, un salon effectivement
chiffré côté serveur, l'aller-retour chiffrement → serveur → déchiffrement, et la reprise
de session sans réseau.

**Non prouvé :** tout le reste. La passerelle push de bout en bout (vérifiée une fois à la
main, aucun test ne la rejoue), le média contre un vrai serveur, LiveKit. La cible de
fumée est une **cible**, pas une couverture.

---

## Où vit la mémoire du projet

- `CLAUDE.md` porte les **sept règles nées de défauts réels** — la jurisprudence du
  dépôt — et ce qui ne se décide pas dans le code ;
- chaque `README.md` de paquet porte le contrat d'interface, les limites et le motif des
  amendements du module ;
- `DECISIONS.md` porte les arbitrages produit et leurs raisons.

Les comptes-rendus de session — brief PM, arbitrages, escalades, dossier de reprise, spike
d'outillage — ont tous été résorbés dans ces fichiers puis supprimés. **Un document daté qui
survit à sa date se prend pour l'état courant** : ce dépôt en a fait deux fois la
démonstration. Ce qu'ils racontaient vit dans `git log`, où un document daté est à sa place.

---

## Démarrer

```sh
corepack pnpm install
npm test

cd infra
cp .env.example .env                       # remplir les secrets
./proxy/generate-dev-certs.sh
docker compose -f docker-compose.yml -f smoke/docker-compose.yml up -d
cd .. && npm run smoke
```

Cette pile **ne monte pas le RTC** : l'overlay `infra/rtc/docker-compose.yml` est séparé et
demande deux IP publiques. Son `.well-known` n'annonce donc aucun focus (décision E-08) :
`discoverFocus()` rend `RtcFociMissing`, ce que l'UI sait afficher, au lieu d'un 502 en
pleine connexion d'appel.

Détail du socle serveur, y compris la vérification de pré-vol à faire avant toute création
de compte : `infra/README.md`.

Hooks de pré-commit bloquants dès le premier commit — lint, typecheck, tests.
`--no-verify` est proscrit par convention d'équipe.
