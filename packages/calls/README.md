# @tacita/calls — appels voix/vidéo (spec 10)

Orchestration côté client des appels MatrixRTC : découverte du focus, URL du widget
Element Call, état d'appel d'un salon, driver de l'API widget. **Aucun code RTC maison** —
la négociation, les clés de média et l'appartenance à l'appel vivent entièrement dans
Element Call. Zéro DOM : le shard UI (spec 11) monte l'iframe, ce package lui donne
l'URL et le driver.

```ts
const focus = await discoverFocus(homeserverUrl); // lève RtcFociMissingError
const widget = buildCallWidget(session, roomId, {
  elementCallUrl,
  parentUrl,
  widgetId,
  media: "audio", // sinon vidéo — le seul paramètre de lancement que l'UI choisit
  join: false, // `true` pour rejoindre un appel en cours (bandeau REQ-CAL-03)
});
const detach = attachCallWidget(iframe, session, roomId, widget); // API widget + driver
const call = activeCall(session, roomId); // idle → active → ended
await hangupLocal(session, roomId);
```

`attachCallWidget` est le seul membre qui touche un élément du DOM, et il ne l'a pas
construit : le shard monte l'iframe, ce package lui parle. Sans lui, Element Call en mode
widget reçoit l'identité par l'URL et attend un client qui ne répond jamais — l'état du
salon, le jeton OpenID et les clés de média passent tous par l'API widget.

`intent` porte le point d'entrée (`start_call`, `start_call_voice`, `join_existing`,
`join_existing_voice`, relus dans `UrlParams.ts` d'Element Call le 06/08/2026) ; `skipLobby`
est déprécié en sa faveur. **`preload` n'est pas envoyé** : il ferait attendre le widget
jusqu'à l'action `io.element.join`, que personne ne lui envoie — le shard monte l'iframe au
moment de l'appel, pas en avance.

## ⚠️ Les littéraux MatrixRTC ne sont pas stables

`src/matrixrtc.ts` est le **seul** fichier du package qui porte un littéral de protocole,
et un test structurel échoue si l'un d'eux réapparaît ailleurs. Chaque valeur y est datée
et sourcée (`matrix-js-sdk@42.0.0`, `infra/rtc/README.md`).

**Divergence connue** : le brouillon courant de MSC4143 remplace l'événement d'état
`org.matrix.msc3401.call.member` par des événements *sticky* `m.rtc.member` (MSC4354).
Element Call et le SDK déployé sont encore sur l'ancien préfixe — c'est donc lui qui est
implémenté. Le jour où le SDK bascule, `activeCall` cessera de voir les participants sans
erreur bruyante : le salon affichera simplement « aucun appel ». À revérifier à chaque
montée de version du SDK ou d'Element Call.

## Limites assumées

- **Le driver envoie directement, sans passer par la file d'envoi** (spec 07). Seul
  endroit du dépôt, hors `messaging` et `outbox` lui-même, à appeler `client.sendEvent`.
  C'est voulu et imposé par REQ-CAL-05 : `WidgetDriver.sendEvent` de `matrix-widget-api`
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
- **Pas de sonnerie, de refus ni d'appel manqué en V1** (YAGNI, spec 10) : l'état
  d'appartenance dit déjà qui est là et depuis quand.
