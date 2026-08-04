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
| **Relecteur** | `REMEDIATION-CRITIQUES.md` §1 (état) et §4 (ce qui n'est pas prouvé), puis le diff |
| **PM / décideur** | `DECISIONS.md`, puis `ARBITRAGE-PM.md` — les deux seuls documents contraignants côté produit |
| **Quelqu'un que ça réveille la nuit** | la section « Ce qui est prouvé, ce qui ne l'est pas » ci-dessous |

---

## Les contrats, par ordre d'autorité

1. **`CLAUDE.md`** — principe directeur, stack imposée, **13 interdits absolus**. Ne se
   négocie pas dans une PR.
2. **`DECISIONS.md`** — arbitrages produit fermes (D-01 à D-07). Le code ne les rediscute
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
npm test        # 273 tests — imitations, aucune dépendance externe
npm run smoke   # 6 tests — vrai Synapse, vraie crypto, vrai IndexedDB (Docker requis)
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

## Les documents de processus, et leur péremption

Ils racontent comment on en est arrivé là. **Aucun n'est contraignant** — ce qui l'est a
migré dans `DECISIONS.md`, les specs et les README de packages.

| Fichier | Ce que c'est | Encore utile ? |
|---|---|---|
| `REMEDIATION-CRITIQUES.md` | L'audit et ses suites : chaque défaut, pourquoi ce correctif-là, ce qu'il coûte | Oui — journal de bord vivant |
| `ARBITRAGE-PM.md` | Les décisions du PM et leurs motifs | Oui — les motifs font jurisprudence |
| `BRIEF-PM.md` | La mise en contexte qui a précédé l'arbitrage | Historique — les réponses sont dans `ARBITRAGE-PM.md` |
| `ESCALADE-PM-OIDC.md` | La question posée quand le login s'est révélé cassé | Historique — tranché, correctif livré |
| `correctif/` | Instantané des fichiers C3/C2 tels que déposés avant application | **Historique et partiellement périmé — lire son README avant de s'en servir** |

Conserver ces traces est un choix délibéré : une décision dont on a perdu le motif se
rediscute tous les six mois. Mais **une trace n'est utile que si sa péremption est
lisible** — d'où cette colonne, et d'où l'avertissement en tête de `correctif/README.md`.

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

Détail du socle serveur, y compris la vérification de pré-vol à faire avant toute création
de compte : `infra/README.md`.

Hooks de pré-commit bloquants dès le premier commit — lint, typecheck, tests.
`--no-verify` est proscrit par convention d'équipe.
