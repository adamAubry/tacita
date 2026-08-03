# Escalade PM — le login OIDC ne fonctionne pas, et la cible de fumée est bloquée dessus

**Émetteur :** agent de développement · **Date :** 03/08/2026
**Objet :** un arbitrage bloquant, une question de déploiement, trois options
**Branche :** `origin/smoke-target` (`9d73936`) — `main` intacte, rien de mergé

---

## En une phrase

En montant la cible de fumée que vous avez financée (point 9 de l'arbitrage), j'ai découvert
que **le flux de login OIDC n'a jamais été exécuté et ne fonctionne pas**. J'ai levé deux des
trois causes ; la troisième demande une modification de l'image Synapse, donc votre arbitrage.

---

## 1. Ce que la cible de fumée a trouvé avant même d'exister

Le périmètre que vous avez fixé commence par « `docker compose up` → login OIDC ». Je n'ai jamais
dépassé le deuxième mot.

`GET /_matrix/client/v3/login/sso/redirect/oidc-keycloak` répond **503 « Authentication failed »**.
Les logs Synapse ne montrent qu'un `OidcDiscoveryError` sans cause lisible.

**Pourquoi personne ne l'avait vu.** Les tests de REQ-INF-09 vérifient que le YAML déclare le
provider `keycloak` et que `password_config.enabled` vaut `false`. Ils n'ont jamais vérifié qu'une
connexion aboutit. C'est exactement le motif que vous aviez identifié en finançant la cible : la
config est conforme, le comportement n'est pas testé.

**Conséquence à froid :** en l'état, personne ne peut se connecter à Tacita. Le module 04
(client-core) consomme un `m.login.token` que rien ne sait produire aujourd'hui.

---

## 2. Le mécanisme, et les trois causes

Synapse lit la découverte OIDC sur `https://${SERVER_NAME}/auth/realms/tacita/.well-known/…`.
Il doit donc joindre **le proxy par son nom public**, depuis l'intérieur du réseau Docker. Trois
choses l'en empêchent, et les trois produisent le même 503 indifférencié.

| # | Cause | Vérification | État |
|---|---|---|---|
| 1 | `chat.example.org` ne résout nulle part depuis le réseau Docker | `socket.gethostbyname` échouait dans le conteneur | ✅ levée — alias réseau sur le proxy |
| 2 | Synapse refuse ses propres requêtes sortantes vers les plages privées | `172.16.0.0/12` est dans son blocklist SSRF par défaut ; le proxy est en `172.18.0.6` | ✅ levée — réglage vide par défaut |
| 3 | Le certificat auto-signé du proxy n'est pas approuvé | voir ci-dessous | ❌ **bloquante** |

**Le point 2 mérite une note.** Le blocage SSRF ne dit pas son nom : il se manifeste par un
timeout, et rien dans les logs ne mentionne le blocage. C'est une protection légitime que je n'ai
pas désarmée — j'ai ajouté `SYNAPSE_IP_RANGE_WHITELIST`, **vide par défaut**, à ne remplir que par
un déploiement qui en a besoin.

**Le point 3 est celui où j'ai eu tort une première fois.** J'avais posé `SSL_CERT_FILE` sur le
conteneur et vérifié depuis l'intérieur, en Python : la découverte passait, HTTP 200. Sauf que
`SSL_CERT_FILE` est une convention du module `ssl` de Python, et **le client HTTP de Synapse est
Twisted**, qui charge sa racine de confiance depuis le magasin OpenSSL du système. J'avais validé
un chemin de code que Synapse n'emprunte pas.

C'est la même erreur de méthode que l'épisode N3 signalé dans la remédiation — vérifier une
hypothèse contre un substitut qui la confirme par construction. Elle mérite d'être notée deux fois.

---

## 3. La question qui vous revient, et qui dépasse le dev

Le correctif du point 3 serait d'installer le certificat de développement dans le magasin de
confiance de l'image Synapse (`/usr/local/share/ca-certificates/` + `update-ca-certificates`).
Quatre lignes de Dockerfile. **Mais c'est modifier l'image d'un composant de production pour un
besoin de développement**, et je ne prends pas cette décision seul.

Surtout, elle en cache une plus grande :

> **Comment `SERVER_NAME` est-il censé résoudre depuis l'intérieur du déploiement ?**

- **S'il résout publiquement** (DNS public, hairpin NAT disponible, certificat réel) : aucune des
  trois causes ne se pose en production. Elles sont purement locales, et tout ce que j'ai écrit
  appartient à un overlay de dev.
- **S'il résout en interne** (DNS split-horizon, pas de hairpin) : **les causes 1 et 2 s'appliquent
  telles quelles en production**, et la configuration actuelle ne permet pas de se connecter, sur
  un vrai serveur, avec un vrai certificat.

Personne n'a tranché ce point. Il conditionne la réponse, et il conditionne aussi si `REQ-INF-09`
doit gagner un critère de comportement (« une connexion aboutit ») en plus de ses critères de
configuration.

---

## 4. Trois options

**Option A — installer le CA de dev dans l'image Synapse.**
~4 lignes de Dockerfile, conditionnées à l'overlay de fumée. La cible complète devient écrivable,
tronçon OIDC compris. Coût : l'image de production porte une instruction qui ne sert qu'en dev.

**Option B — écrire la cible sans le tronçon OIDC.** *(ma recommandation)*
Le jeton est obtenu par l'API d'administration Synapse plutôt que par le flux SSO. La cible couvre
alors : vraie crypto vodozemac, vrai IndexedDB, vrai Synapse, création de salon chiffré,
envoi/réception avec déchiffrement réel, rechargement et `restoreSession` sans réseau. **C'est
l'intégralité de ce que la cible a été financée pour valider** — l'écart entre nos sept modules
testés sur mocks et la réalité. Le tronçon OIDC reste documenté comme non couvert, et fait l'objet
d'un ticket à part.

**Option C — ne rien écrire avant votre réponse au §3.**
Défendable si vous jugez que la cible doit couvrir le login ou rien, mais elle laisse les sept
modules sans validation réelle pendant ce temps, et la spec 11 approche.

**Pourquoi B :** la valeur de la cible est dans la crypto, le store et la session — pas dans le
login, qui est de la configuration d'infra. Le tronçon OIDC mérite son propre correctif et son
propre test, pas d'être le goulot d'une validation qui couvre sept modules. Et A reste faisable
après B, sans rien jeter.

---

## 5. Ce qui est déjà livré

Sur `origin/smoke-target` (`9d73936`), 189 tests verts, `main` intacte :

```
infra/smoke/docker-compose.yml       overlay de fumée (patron rtc/) : alias réseau + réglages
infra/synapse/homeserver.yaml.tmpl   ip_range_whitelist, piloté par variable, vide par défaut
infra/docker-compose.yml             la variable, vide par défaut
infra/.env.example                   la variable, documentée
infra/README.md                      section « Login OIDC » : les trois causes et leurs preuves
```

Rien n'y désarme une protection par défaut. L'overlay n'est chargé qu'explicitement, comme celui
de la spec 02.

---

## 6. Ce que j'attends de vous

1. **A, B ou C** — et le motif, qui fera jurisprudence pour les autres écarts dev/prod.
2. **La réponse au §3** : mode de résolution de `SERVER_NAME` visé en production.
3. **Faut-il amender REQ-INF-09** pour lui ajouter un critère de comportement ? Aujourd'hui un
   module peut être « terminé, 100 % de REQ couvertes » alors que sa fonction ne marche pas. C'est
   le cas de la spec 01 en ce moment, et ça peut se reproduire ailleurs.
