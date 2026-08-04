# Escalade PM — REQ-COR-07 : deux personnes ne pouvaient pas se parler

**Statut : TRANCHÉE le 04/08/2026 par D-08.** Conservée comme trace : l'escalade ne vivait
que dans le message du commit `e533e9c`, mauvais endroit pour une question qui a amendé une
exigence.

| | |
|---|---|
| Ouverte | 03/08/2026, en répondant à « deux utilisateurs distincts peuvent-ils échanger un message lisible ? » |
| Tranchée | 04/08/2026 — `DECISIONS.md` **D-08**, addendum `ARBITRAGE-PM.md` « REQ-COR-07 : la troisième voie » |
| Effet | `specs/04-client-core.md` REQ-COR-07 **amendée**, pas abrogée |
| Reste à faire | implémentation + fumée par le chemin produit — voir §4 |

---

## 1. Le constat

Deux utilisateurs réels ne pouvaient pas se lire. Message envoyé, message reçu illisible, dans
les deux sens, DM comme groupe : *« The sender has disabled encrypting to unverified devices »*.

Ce n'était **pas un bug**. REQ-COR-07 disait que les clés Megolm ne sont *jamais* partagées avec
un appareil non vérifié, réglage activé et verrouillé. Le code faisait exactement ça.

Le trou était dans les specs : REQ-COR-07 posait la vérification d'appareil en prérequis absolu,
et **aucune spec ne décrivait comment un appareil devient vérifié**. Recherche dans
`specs/11-ui-shard.md`, dernier module du waterfall : zéro occurrence de vérification, d'appareil
ou de cross-signing. À la fin de la cascade, personne n'aurait construit ce parcours.

## 2. Pourquoi personne ne l'avait vu

Toute la fumée validait **un utilisateur qui se parle à lui-même** : même appareil, mêmes clés.
Le partage de clés entre appareils distincts n'avait jamais été exercé.

`infra/smoke/deux-personnes.smoke.test.ts` a fermé cet angle mort. Les trois tests où Alice et
Bob se parlent n'étaient verts **que parce qu'ils appelaient `setDeviceVerified()` eux-mêmes** —
un geste qu'aucun code produit n'exécute. Ils simulaient une UI qui n'existait pas.

Même famille que les deux bugs de `e533e9c` (`cryptoCallbacks` manquant, magasin de clés au nom
fixe) : des contrats que les imitations n'exercent pas. C'est la règle des deux portes du PM — les
tests de configuration attestent des fichiers, la fumée atteste d'un comportement.

## 3. L'arbitrage

**Ni parcours SAS en V1, ni TOFU par appareil : la confiance se porte sur l'identité
cross-signing.** Le détail et le raisonnement sont en `DECISIONS.md` § D-08 et dans l'addendum
d'`ARBITRAGE-PM.md` — non recopiés ici, une copie diverge.

Le point qui a écarté les deux options que l'escalade proposait : REQ-COR-06 rend le bootstrap
cross-signing obligatoire à l'inscription, donc **le matériel de confiance existe déjà** et
personne ne s'en servait. Le trou de spec disparaît au lieu d'être comblé par un module de plus.

Et le TOFU brut aurait cédé la protection que REQ-INF-11 existe pour fournir : un appareil injecté
côté serveur ne porte pas la signature de son propriétaire et ne reçoit rien.

## 4. Conditions d'acceptation — état au 04/08/2026

### ✅ (a) Le mécanisme SDK existe sur la version épinglée — **vérifié**

Condition posée : « mode d'isolation *appareils signés uniquement* de la crypto Rust ; s'il ne
l'exprime pas, escalade avant d'implémenter ». Il l'exprime, et dans les termes exacts de D-08.

`matrix-js-sdk@42.0.0`, `lib/crypto-api/index.d.ts` :

```ts
setDeviceIsolationMode(isolationMode: DeviceIsolationMode): void;

/**
 * Message encryption keys are only shared with devices that have been cross-signed by their owner.
 * Encryption will throw an error if a verified user replaces their identity.
 *
 * Events are decrypted only if they come from a cross-signed device. […]
 */
export declare class OnlySignedDevicesIsolationMode { … }
```

Deux correspondances littérales avec D-08 : le partage limité aux appareils signés par leur
propriétaire, et l'erreur au changement d'identité — qui est précisément le point d'accroche du
blocage d'envoi jusqu'à confirmation UI. Réservé à la crypto Rust (« Only supported by rust
Crypto »), ce que REQ-COR-01 impose déjà. Équivalent du mode « Exclude insecure devices »
d'Element Web, recommandé par MSC4153.

**Pas d'escalade requise : la voie est ouverte.**

### ⚠️ (b) Piège d'implémentation — le verrou actuel s'oppose à D-08

Trouvé en vérifiant (a). `packages/client-core/src/session.ts`, `lockUnverifiedDeviceBlacklist()` :

```ts
crypto.globalBlacklistUnverifiedDevices = true;
Object.defineProperty(crypto, "globalBlacklistUnverifiedDevices", {
  get: () => true,
  set: () => { throw new Error("REQ-COR-07 : la politique d'appareils non vérifiés est verrouillée"); },
  configurable: false,
});
```

Deux obstacles, à traiter **avant** d'ajouter quoi que ce soit :

1. `globalBlacklistUnverifiedDevices` est le mécanisme **hérité**, par appareil — celui de
   l'ancienne rédaction. Il exige des appareils *vérifiés*, pas *signés*. Le laisser à `true`
   risque de continuer à tout bloquer et d'annuler D-08 en silence.
2. `configurable: false` rend la propriété **non redéfinissable**. On ne peut pas neutraliser le
   verrou après coup : il faut modifier `lockUnverifiedDeviceBlacklist` à la source.

Donc : **remplacer le verrou, pas en empiler un second.** Le nouveau doit verrouiller
`setDeviceIsolationMode` sur `OnlySignedDevicesIsolationMode` avec le même principe — toute
tentative de désarmement lève plutôt que d'échouer en silence.

Le test `REQ-COR-07 — le réglage est verrouillé : toute tentative de désarmement lève`
(`packages/client-core/tests/session.test.ts`) devra suivre : il épingle aujourd'hui le mécanisme
hérité.

**Question ouverte, tranchée par la fumée et non par la lecture :** l'interaction exacte entre les
deux réglages quand ils sont posés ensemble. Elle se règle empiriquement contre le vrai Synapse —
règle des deux portes.

### ⬜ (c) Fumée verte par le chemin produit — à faire

`infra/smoke/deux-personnes.smoke.test.ts` doit passer **sans un seul `setDeviceVerified()`**.
Et le test « sans vérification préalable, rien n'est lisible » se retourne : ce n'est plus
l'absence de vérification manuelle qui bloque, c'est l'absence de **signature**. Un appareil non
signé ne reçoit toujours rien — c'est ce qui prouve que REQ-INF-11 tient encore.

Attention à la construction du cas négatif : `ouvrir()` appelle `setupRecoveryKey()`, qui amorce
le cross-signing. Un appareil fabriqué par ce chemin est *signé*. Produire un appareil non signé
demande un autre montage — sans quoi le test se retournerait au vert pour la mauvaise raison.

### ⬜ (d) Limite documentée côté utilisateur — à faire

Ce que D-08 cède : la compromission complète du compte d'un correspondant rend ses signatures
menteuses. Interdit n°13 — la limite se documente, elle ne se masque pas. Parade et chemin de
relèvement : SAS/QR, spec dédiée post-V1.

### ⬜ (e) Le dialogue de réinitialisation d'identité — spec 11

Un dialogue, pas un parcours : une réinitialisation bloque l'envoi vers cet utilisateur jusqu'à
confirmation explicite. Le module expose l'état bloquant par utilisateur ; l'UI confirme.
`Encryption will throw an error if a verified user replaces their identity` est le signal SDK
correspondant.

## 5. Ce que cette escalade laisse comme leçon

L'ancienne REQ-COR-07 était **plus forte sur le papier et inapplicable en pratique**. Elle a passé
tous les tests unitaires, toute la revue de specs, et n'a été prise en défaut que par un test qui
faisait parler deux personnes contre un vrai serveur.

Une exigence qui pose un prérequis doit nommer qui l'outille. Aucune ne le faisait, et rien dans le
processus ne l'a signalé : chaque spec était cohérente seule, l'incohérence vivait dans la
jonction. C'est le motif que l'audit des jonctions doit chercher.
