/**
 * jsdom n'implémente pas `<dialog>` : `showModal()` et `close()` n'existent pas, et tout
 * composant qui s'appuie dessus lève au rendu. C'est une lacune de l'environnement de
 * test, pas du composant — le combler ici évite de tordre le composant pour le test.
 */
if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.show = function show(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
}

/**
 * jsdom ne fournit pas l'objet global `CSS` ; Astryx s'en sert (`CSS.escape`) pour
 * construire un sélecteur d'identifiant. Même nature que le manque ci-dessus : une
 * lacune de l'environnement, pas du composant.
 *
 * ponytail: échappement minimal — suffisant pour des identifiants générés (lettres,
 * chiffres, tirets). Prendre la vraie spécification le jour où un test construit un
 * sélecteur à partir d'une saisie utilisateur, ce qui n'arrive pas ici.
 */
globalThis.CSS ??= {
  escape: (valeur: string) => valeur.replace(/[^\w-]/g, (c) => `\\${c}`),
} as typeof globalThis.CSS;

/**
 * jsdom n'implémente pas `Blob.arrayBuffer()` — pourtant standard depuis 2019, et le
 * seul chemin pour poser une image dans IndexedDB (REQ-UIX-35). Quatrième lacune de
 * l'environnement, même traitement que les trois autres : on la comble ici plutôt que
 * de tordre le code produit pour l'éviter.
 */
if (typeof Blob !== "undefined" && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const lecteur = new FileReader();
      lecteur.onload = () => resolve(lecteur.result as ArrayBuffer);
      lecteur.onerror = () => reject(lecteur.error);
      lecteur.readAsArrayBuffer(this);
    });
  };
}

/**
 * jsdom ne fournit pas `matchMedia`. Astryx s'en sert pour les requêtes média (taille,
 * mouvement réduit, mode d'affichage) et lève sans elle. Troisième lacune de
 * l'environnement, même traitement que les deux précédentes.
 *
 * Le stub ne correspond à rien : `matches` est faux partout. Les tests qui dépendent
 * d'une requête média précise l'espionnent pour dire ce qu'elle vaut.
 */
globalThis.matchMedia ??= ((requete: string) =>
  ({
    media: requete,
    matches: false,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList) as typeof globalThis.matchMedia;

/**
 * jsdom n'implémente pas `HTMLCanvasElement.getContext` : il journalise une erreur « not
 * implemented » et rend `null`. Le `Spinner` d'Astryx dessine son anneau au canvas, donc
 * chaque attente du parcours d'accueil (REQ-UI-22) faisait une pile d'erreur dans la
 * sortie de test, sans qu'aucun test échoue — le pire des deux, parce qu'on finit par ne
 * plus lire une sortie qui crie sans raison.
 *
 * Cinquième lacune de l'environnement, même traitement que les quatre autres. `null` est
 * exactement ce que jsdom rendait : les composants qui savent s'en passer continuent de
 * s'en passer, et les tests qui ont besoin d'un vrai contexte 2D (`media.test.tsx`)
 * remplacent cette méthode par la leur, comme avant.
 */
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = () => null;
}
