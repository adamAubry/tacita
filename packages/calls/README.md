# @tacita/calls — appels voix/vidéo

Orchestration côté client des appels MatrixRTC : découverte du focus, URL du widget
Element Call, état d'appel d'un salon, driver de l'API widget. **Aucun code RTC maison** —
la négociation, les clés de média et l'appartenance à l'appel vivent entièrement dans
Element Call. Zéro DOM : le shard UI monte l'iframe, ce package lui donne
l'URL et le driver.

```ts
const focus = await discoverFocus(homeserverUrl); // lève RtcFociMissingError
const { url } = buildCallWidget(session, roomId, { elementCallUrl, parentUrl, widgetId, video });
const driver = new CallWidgetDriver(session, roomId); // à passer à ClientWidgetApi
const detacher = attachCallWidget(session, roomId, iframe, options); // le pont postMessage
const call = activeCall(session, roomId); // idle → active → ended
await hangupLocal(session, roomId);
```

## ⚠️ Les littéraux MatrixRTC ne sont pas stables

`src/matrixrtc.ts` est le **seul** fichier du package qui porte un littéral de protocole,
et un test structurel échoue si l'un d'eux réapparaît ailleurs. Chaque valeur y est datée
et sourcée (`matrix-js-sdk@42.0.0`, `infra/rtc/README.md`).

**Divergence connue** : le brouillon courant de MSC4143 remplace l'événement d'état
`org.matrix.msc3401.call.member` par des événements *sticky* `m.rtc.member` (MSC4354).
Element Call et le SDK déployé sont encore sur l'ancien préfixe — c'est donc lui qui est
implémenté. Le jour où le SDK bascule, `activeCall` cessera de voir les participants sans
erreur bruyante : le salon affichera simplement « aucun appel ».

**Depuis E-14, cette bascule a un interrupteur nommé** : le `matrix_rtc_mode` servi dans
`infra/rtc/element-call.json`. Ses trois valeurs (v0.23.0) sont `legacy`, `compatibility`
et `matrix_2_0` ; seule la dernière active les événements *sticky*. Nous épinglons
`compatibility`, et a un test qui refuse `matrix_2_0` — le jour où on voudra y
passer, c'est ce fichier-ci qu'il faudra changer d'abord.

## Limites assumées

- **`attachCallWidget` prend une iframe, il n'en rend aucune.** `@tacita/calls` dit « zéro DOM,
  le shard rend l'iframe » — c'est toujours vrai : le shard la rend, ce paquet branche le
  pont postMessage dessus. Le pont est ici et non dans le shard parce que tient
  une liste close de dépendances qui n'inclut pas `matrix-widget-api`, et n'a pas à
  l'inclure : c'est du protocole, pas de l'interface.
- **Les paramètres d'URL sont relus dans la version épinglée, jamais de mémoire.** E-14
  close : `infra/rtc/` épingle Element Call `v0.23.0` par digest, et
  `option.video` se traduit en `intent=start_call` / `start_call_voice` d'après
  `src/UrlParams.ts` de cette version. Le passage a corrigé deux paramètres qui ne
  faisaient rien — `video`, qui n'existe dans aucune version, et `hideHeader`, remplacé
  par `header`. **À relire au prochain bump d'image** : la marche à suivre est dans
  `infra/rtc/README.md`, et elle inclut `matrix_rtc_mode`, dont la valeur `matrix_2_0`
  rendrait `activeCall()` aveugle sans erreur.
- **`skipLobby` n'est jamais envoyé.** Le lobby est le rattrapage : une intention partie
  de travers y est corrigeable avant d'entrer, caméra comprise.
- **Le driver envoie directement, sans passer par la file d'envoi**. Seul
  endroit du dépôt, hors `messaging` et `outbox` lui-même, à appeler `client.sendEvent`.
  C'est voulu et : `WidgetDriver.sendEvent` de `matrix-widget-api`
  doit rendre l'`eventId` **à l'appelant, de façon synchrone**, et Element Call s'en sert
  pour suivre son propre état d'appartenance. Une file différée par nature ne peut pas
  tenir ce contrat — l'événement partirait plus tard, ou jamais.
  Conséquence assumée : les événements d'appartenance RTC ne survivent pas à une coupure
  réseau, contrairement aux messages. C'est le bon compromis — une appartenance périmée
  n'a aucune valeur (elle expire en 4 h, voir plus bas), alors qu'un message, si.
  Relevé pendant l'audit des jonctions : le contournement était juste, mais écrit nulle
  part. Un relecteur pouvait le prendre pour un oubli et « corriger » vers l'outbox.
- **Un focus périmé ne casse pas, il rend muet.** Sans `rtc_foci` exploitable,
  `discoverFocus` lève `RtcFociMissingError` avec une `reason` (`well-known-unreachable`,
  `well-known-absent`, `no-livekit-focus`) : l'UI doit afficher la cause, pas désactiver
  un bouton en silence.
- **Le widget reçoit toutes les capacités qu'il demande.** Element Call est notre propre
  déploiement, dont ce module construit lui-même l'URL : il n'y a pas d'origine tierce à
  arbitrer, donc pas d'invite utilisateur. Le confinement vient d'ailleurs — `getKnownRooms`
  et le contrôle de `roomId` du driver limitent le widget au seul salon de l'appel, quelles
  que soient les capacités accordées.
- **Une appartenance est ignorée passé 4 h** (`expires` du contenu, sinon le défaut du
  SDK). Sans ce filtre, un client parti sans nettoyer laisse un salon en « appel en cours »
  pour toujours. En contrepartie, un appel réellement plus long que sa fenêtre d'expiration
  disparaît de l'affichage si le participant ne rafraîchit pas son état.
- **`ended` est un état déduit, pas un événement.** Il n'existe que par contraste avec un
  `active` observé dans la même session : au rechargement de la page, un appel terminé est
  indistinguable d'un salon qui n'a jamais eu d'appel — les deux sont `idle`.
- **Métadonnées d'appel visibles côté serveur** : qui appelle qui, quand, combien de temps.
  Le média est chiffré par participant (`perParticipantE2EE`), le SFU relaie sans
  déchiffrer. Voir `infra/rtc/README.md`.
- **Pas de sonnerie, de refus ni d'appel manqué en V1** (YAGNI) : l'état
  d'appartenance dit déjà qui est là et depuis quand.
