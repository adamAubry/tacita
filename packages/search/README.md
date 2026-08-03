# @tacita/search — recherche locale (spec 09)

Index Orama construit et interrogé dans un Web Worker, persisté en IndexedDB.
Alimenté au fil du déchiffrement des événements.

```ts
const worker = new Worker(new URL("@tacita/search/worker", import.meta.url), { type: "module" });
const search = createSearch(session, worker);

await search.search("parc"); // tous salons
await search.search("parc", roomId); // un seul
await search.stats(); // { size, max, oldestTs, newestTs }
search.dispose(); // détache le hook et termine le worker
```

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
- **Mot-clé simple, pas de fuzzy ni de facettes.** Orama fait de l'OR sur les
  tokens : chercher `réunion demain` rend aussi ce qui ne contient que
  `réunion`.
- **`roomId` et `sender` sont indexés en `enum`, pas en texte.** Ils filtrent à
  l'égalité exacte et ne sont pas cherchables au mot-clé — chercher un mot ne
  doit pas matcher un identifiant.
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
