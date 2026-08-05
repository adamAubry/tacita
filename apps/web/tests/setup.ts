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
