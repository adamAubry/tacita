# Tacita

Messagerie chiffrée de bout en bout, auto-hébergée, livrée en PWA. Elle remplace les DM
et groupes Instagram pour un cercle fermé.

**La règle qui gouverne tout : le serveur ne voit jamais de contenu en clair.** Tout le
reste en découle, y compris les limites — qui sont documentées, jamais masquées.

> **Ce fichier est une carte, pas une copie.** Il dit où chaque chose vit ; il ne
> reproduit rien. Une copie vieillit sans prévenir — `correctif/` l'a démontré en douze
> heures. Si un point ci-dessous contredit le fichier qu'il désigne, **c'est le fichier
> désigné qui fait foi**, et cette carte est à corriger.

---

## Par où commencer, selon qui vous êtes

| Vous êtes | Lisez, dans cet ordre |
|---|---|
| **Développeur qui arrive** | `specs/00-conventions.md`, puis la spec de votre module, puis le `README.md` du package |
| **Relecteur** | `docs/REPRISE.md` § 4 (ce qui est prouvé, ce qui ne l'est pas), puis le diff |
| **PM / décideur** | `DECISIONS.md`, puis `specs/ui/ESCALATIONS.md` — ce qui est tranché, puis ce qui attend |
| **Développeur du shard UI** | `docs/REPRISE.md` § 5 en entier — c'est le dossier de reprise |
| **Quelqu'un que ça réveille la nuit** | la section « Ce qui est prouvé, ce qui ne l'est pas » ci-dessous |

---

## Les contrats, par ordre d'autorité

1. **`CLAUDE.md`** — principe directeur, stack imposée, **13 interdits absolus**. Ne se
   négocie pas dans une PR.
2. **`DECISIONS.md`** — arbitrages produit fermes (D-01 à D-08). Le code ne les rediscute
   pas ; on escalade au PM.
3. **`specs/00-conventions.md`** puis `specs/01` à `specs/11` — un contrat par module.
   Chaque exigence porte un identifiant `REQ-XXX-NN`, et **chaque test nomme l'exigence
   qu'il couvre**.

Le code implémente les specs, jamais l'inverse. Une divergence se règle en amendant la
spec, pas en corrigeant discrètement.

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
| Métadonnées visibles du serveur, SSE-S3 en défense en profondeur seulement | `infra/LIMITES.md` |
| Login OIDC : quatre causes de panne et leur état | `infra/README.md` § « Login OIDC » |
| Média authentifié : les anciens endpoints sont morts | `infra/README.md` § REQ-INF-12 |
| Web Push impossible sur iOS hors PWA installée | `apps/push-gateway/LIMITES.md` |
| Ce que la cible de fumée prouve — et ne prouve pas | `infra/smoke/README.md` |

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
chiffré côté serveur, l'aller-retour chiffrement → serveur → déchiffrement, la reprise de
session sans réseau, et le login OIDC jusqu'à la redirection.

**Non prouvé :** tout le reste. Le flux SSO complet (il faudrait un navigateur, Playwright
est interdit), la passerelle push de bout en bout (vérifiée une fois à la main, aucun test
ne la rejoue), le média contre un vrai serveur, LiveKit. La cible de fumée est une
**cible**, pas une couverture.

---

## État

Dix modules sur onze. **La spec 11 — le shard UI — est réalisée par un humain senior.**

Le socle qui lui est remis doit être : modules mergés et verts, jonctions auditées, fumée
et login OIDC verts, et les contrats d'interface propres dans les README —
`restoreSession`/`null` → OIDC, `TACITA_NOT_ENCRYPTED`, `stats()`, `deliveryUnknowable`.

---

## Le document de processus, et ce qu'il a remplacé

**`docs/REPRISE.md`** — un seul fichier : la chronologie et ce que chaque étape a appris, les
six règles qui en sortent, l'état de ce qui est prouvé, le dossier de reprise du shard UI, et
le plan des actions restantes. **Il n'est contraignant sur rien** ; ce qui l'est a migré dans
`DECISIONS.md`, les specs et les README de packages.

Il remplace six documents de session — brief PM, arbitrages, deux escalades, remédiation des
défauts critiques, dossier de reprise. Chacun racontait bien sa session ; aucun ne disait où
on en était, et leurs états se contredisaient d'un fichier à l'autre. Ils vivent dans
`git log`, où un document daté est à sa place.

Reste `correctif/` : instantané des fichiers C3/C2 tels que déposés avant application,
**partiellement périmé**. Son propre README l'avertit. Sa suppression est décidée et
planifiée — `docs/REPRISE.md` § 6.1, action A2.

**Une trace n'est utile que si sa péremption est lisible.** Une décision dont on a perdu le
motif se rediscute tous les six mois ; un compte-rendu dont on a perdu la date se prend pour
l'état courant. Le premier risque justifie qu'on garde les motifs, le second qu'on ne garde
qu'un fichier.

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
demande deux IP publiques. Le `.well-known` annonce pourtant un focus LiveKit sans
condition, donc un appel échoue en 502 plutôt qu'en `RtcFociMissing` — c'est une
contradiction entre REQ-RTC-05 et REQ-CAL-02, remontée en `specs/ui/ESCALATIONS.md` § E-08.

Détail du socle serveur, y compris la vérification de pré-vol à faire avant toute création
de compte : `infra/README.md`.

Hooks de pré-commit bloquants dès le premier commit — lint, typecheck, tests.
`--no-verify` est proscrit par convention d'équipe.
