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
const call = activeCall(session, roomId); // idle → active → ended, dans **un** salon
const entrants = incomingCalls(session); // les appels qui nous attendent, **tous salons**
const journal = callHistory(session, roomId); // les appels passés, manqués compris
await hangupLocal(session, roomId);
```

## Trois lectures, trois questions différentes

Elles se ressemblent et ne répondent pas à la même chose. Les confondre est ce qui avait
laissé le chemin d'appel avec un trou béant : `activeCall` était la seule, et il fallait
avoir le bon salon ouvert pour l'interroger.

| | Question | Périmètre | Ce qui la rend nécessaire |
|---|---|---|---|
| `activeCall` | « y a-t-il un appel **ici** ? » | un salon | le bandeau « appel en cours — rejoindre » |
| `incomingCalls` | « quelqu'un m'appelle-t-il, **où que je sois** ? » | tous les salons | la sonnerie ; un appel qui n'arrive pas est le seul défaut irrattrapable |
| `callHistory` | « que s'est-il passé **avant** ? » | un salon, sa fenêtre chargée | l'appel manqué, et le geste pour rappeler |

`incomingCalls` distingue **sonner** de **être joignable** (`ringing`, fenêtre de
`RINGING_WINDOW_MS`). Un appel commencé il y a quarante minutes reste rejoignable et ne
sonne plus : la sonnerie dit « décroche maintenant », et ouvrir l'application au milieu
d'un appel de groupe ne dit pas ça.

`callHistory` **n'écrit rien** : pas d'événement inventé pour marquer un appel. Le journal
se dérive des appartenances déjà présentes dans la timeline — une appartenance non vide
ouvre, une vide referme. Chaque entrée porte `apres`, l'identifiant du message qu'elle
suit dans `/sync` : c'est ce qui permet au shard de la placer parmi les messages **sans
trier par horodatage** (interdit n°6).

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
- **Le pont est à double sens, et le second sens est à la charge de l'hôte.** Le driver
  répond à ce que le widget *demande* ; `ClientWidgetApi` n'observe rien de lui-même.
  `attachCallWidget` branche donc `RoomEvent.Timeline`, `MatrixEventEvent.Decrypted` et
  `ClientEvent.ReceivedToDeviceMessage` sur `feedEvent`/`feedToDevice`, filtrés sur le
  salon de l'appel.

  Ajouté le 29/08/2026, après un appel qui se connectait sans qu'on entende rien :
  Element Call chiffre le média **par participant** et distribue les clés par événements
  Matrix. Chacun envoyait la sienne — `sendEvent` passe par le driver — et ne recevait
  jamais celle d'en face : deux flux GCM que personne ne pouvait ouvrir. L'appartenance,
  elle, marchait, parce qu'elle se **tire** de l'état du salon. Tout ce qui se tirait
  marchait, tout ce qui se pousse manquait.

- **Le widget reçoit les capacités qu'il demande, sauf celles que le driver ne tient pas.**
  Element Call est notre propre déploiement, dont ce module construit lui-même l'URL : il
  n'y a pas d'origine tierce à arbitrer, donc pas d'invite utilisateur. Le confinement vient
  d'ailleurs — `getKnownRooms` et le contrôle de `roomId` du driver limitent le widget au
  seul salon de l'appel, quelles que soient les capacités accordées.

  La réserve a été ajoutée le 29/08/2026, après un appel figé sans erreur : accorder tout
  incluait des capacités dont la méthode reste celle de `WidgetDriver`, et trois d'entre
  elles **lèvent de façon synchrone**. `ClientWidgetApi.handleMessage` n'ayant aucun `try`,
  la requête du widget n'obtient jamais de réponse. Refuser est sûr par construction : la
  capacité est vérifiée **avant** l'appel au driver, et son absence rend une erreur propre.
  Aujourd'hui refusées, faute d'implémentation : les événements *sticky* (MSC4407), les
  événements différés (MSC4157), la navigation, la recherche d'annuaire, le transfert de
  fichiers et les transports RTC. Les implémenter est ce qui les rouvrira — la table de
  `driver.ts` compare les prototypes, elle ne se déclare pas.
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
- **Il n'y a pas de refus, et l'interface ne prétend pas le contraire.** MatrixRTC ne
  définit aucun événement de rejet : ne pas décrocher n'envoie rien à l'appelant, qui voit
  seulement que personne n'a rejoint. Le shard nomme donc son bouton « Ignorer » et non
  « Refuser » — il fait taire la sonnerie ici, rien de plus (interdit n°13). L'appel reste
  rejoignable depuis le salon tant qu'il dure.
- **Un appel manqué ne remonte pas dans l'aperçu de la liste des conversations.** Il est
  dans le salon (`callHistory`) et il sonne à l'instant où il arrive (`incomingCalls`),
  mais l'aperçu vient du dernier **message** — et le porter jusque-là demanderait à
  `@tacita/messaging` de connaître les littéraux MatrixRTC, dont `src/matrixrtc.ts` est
  le seul dépositaire. Limite assumée plutôt qu'un deuxième foyer pour la même valeur.
- **Le journal ne voit que la fenêtre de timeline chargée.** Remonter l'historique en
  révèle davantage, exactement comme pour les messages ; un appel plus ancien que ce qui
  est chargé n'apparaît pas encore.
- **Une fin d'appel inconnue reste inconnue.** Quand le dernier participant part sans
  refermer, son appartenance expire en silence : `fin` est absent et aucune durée n'est
  rendue. Déduire la fin de l'expiration afficherait « appel de 4 h » pour un appel de
  trois minutes.
