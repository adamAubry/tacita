# @tacita/search — recherche locale (spec 09)

Index Orama construit et interrogé dans un Web Worker, persisté en IndexedDB.
Alimenté au fil du déchiffrement des événements.

```ts
const worker = new Worker(new URL("@tacita/search/worker", import.meta.url), { type: "module" });
const search = createSearch(session, worker);

await search.search("parc"); // tous salons
await search.search("parc", { roomId }); // un seul
await search.stats(); // { size, max, oldestTs, newestTs }
search.dispose(); // détache le hook et termine le worker
```

## Recherche filtrée (REQ-SRC-11)

Les critères sont **combinables** et se composent en ET ; un critère absent ne
restreint rien. Tous sont servis par l'index local — aucun n'ajoute d'appel réseau.

```ts
search.search("réunion", {
  roomId,                        // une conversation
  sender: "@mira:tacita.test",   // un expéditeur
  msgtype: "m.image",            // texte, image, fichier, vocal…
  mentions: [moi, ROOM_MENTION], // « me mentionne » — voir ci-dessous
  since: 1_700_000_000_000,      // bornes **inclusives** sur origin_server_ts,
  until: 1_800_000_000_000,      // en filtre, jamais en tri (interdit n°6)
});
```

**L'onglet « Mentions » passe un terme vide et le seul critère `mentions`** : il
filtre, il ne cherche pas. Le champ est alimenté depuis `m.mentions` de
l'événement — jamais par un plein-texte sur un nom d'affichage, qui raterait les
mentions en pièce jointe et prendrait un homonyme pour une mention. Une mention
de salon (`m.mentions.room`) est indexée sous le littéral `ROOM_MENTION`
(`"@room"`), exporté par le package : côté Matrix elle mentionne chacun, donc
l'UI passe `[moi, ROOM_MENTION]`.

`msgtype` et `mentions` sont du **contenu déchiffré**, au même titre que le corps :
l'interdit n°8 leur applique tout ce qu'il applique au texte — pas de logs, pas de
télémétrie, pas de cache de service worker, pas de payload push, y compris en
développement.

Rien à câbler : le module écoute le déchiffrement des événements **et les
suppressions** sur le client, et tient l'index à jour tout seul. `index()` reste
là pour un rattrapage manuel.

## Cycle de vie des messages (REQ-SRC-10)

Un message supprimé sort de l'index — « supprimer » qui laisse le texte
trouvable ne serait pas une suppression. Une édition remplace le document de sa
cible : l'ancienne version cesse d'être trouvable, et il n'y a jamais deux
documents pour un même message. Réindexer un événement déjà connu le remplace
plutôt que d'en ajouter un second, ce qui rend un re-déchiffrement inoffensif.

## `/search` de Synapse n'est jamais appelé

L'endpoint serveur est inopérant sur salon chiffré — il indexe du chiffré. Il
n'y a pas de repli dessus et il n'y en aura pas : une recherche qui ne rend rien
hors ligne est un bug, pas une dégradation.

## Limites assumées

- **La recherche couvre l'historique téléchargé, pas celui du serveur.** Un
  message jamais synchronisé sur cet appareil est introuvable. `stats()` rend
  `oldestTs`/`newestTs` précisément pour que l'UI (spec 11) l'affiche au lieu de
  laisser croire à une recherche exhaustive.
- **Plafond de 200 000 événements ; les premiers indexés sortent** (DECISIONS
  D-01). L'éviction suit l'ordre d'indexation locale, jamais la date d'origine
  des messages : sinon un rattrapage d'historique — qui insère par définition
  des messages anciens — s'auto-évincerait. `stats().size` contre `max` dit si
  la purge a mordu, et `oldestTs`/`newestTs` restent des dates d'origine, les
  seules qui parlent à l'utilisateur.
- **Mot-clé simple, pas de fuzzy.** Orama fait de l'OR sur les tokens : chercher
  `réunion demain` rend aussi ce qui ne contient que `réunion`.
- **`roomId`, `sender` et `msgtype` sont indexés en `enum`, pas en texte.** Ils
  filtrent à l'égalité exacte et ne sont pas cherchables au mot-clé — chercher un
  mot ne doit pas matcher un identifiant, ni `m.text` répondre à « text ».
- **Un changement de schéma d'index jette le snapshot précédent.** Les documents
  déjà indexés ne sont pas migrés : ils sont effacés, et l'index se reconstruit au
  fil des déchiffrements suivants. La recherche ne couvre alors plus l'historique
  antérieur tant qu'il n'est pas reparcouru — `stats()` le dit, comme toujours.
- **Une rotation de session Megolm ne déclenche rien** (DECISIONS D-05). Ce qui
  a été déchiffré et indexé le reste ; en dehors du cycle de vie des messages
  ci-dessus, seules la purge D-01 et `wipe()` retirent des entrées.
- **Un retrait qui échoue n'est pas retenté.** Si le worker rejette la
  suppression, le document reste trouvable jusqu'au prochain `wipe()`. Ce
  package n'a aucun canal d'erreur ; la reprise se branchera quand le shard UI
  (spec 11) en exposera un.
- **Le snapshot est réécrit en entier à chaque appel d'`index()`.** Suffisant
  pour des vagues de sync ; à débattre par un timer si le coût devient visible
  sur un gros index.
