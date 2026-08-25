import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
/*
 * Passe par le barrel `matrix-js-sdk` et non par `lib/secret-storage` : le sous-chemin
 * tire `lib/oauth/index.js`, qui fait un import de répertoire que Node refuse en ESM.
 * Le barrel est déjà transformé par Vitest et le ré-exporte sous `SecretStorage`.
 */
import { SecretStorage } from "matrix-js-sdk";

/**
 * D-12 — **la vérification de clé de récupération existe en deux exemplaires, dans deux
 * langages, et ce fichier est le seul endroit où ils se rencontrent.**
 *
 * Le shard vérifie la clé localement pour rendre la faute de frappe immédiate ; le module
 * Synapse (`infra/synapse/modules/tacita_password.py`) la vérifie à nouveau, et c'est
 * celle-là qui autorise le changement de mot de passe — un contrôle client se contourne en
 * n'utilisant pas notre client.
 *
 * Les deux implémentent le même algorithme de la spec Matrix (§ Secret storage, key check) :
 * HKDF-SHA256 sel nul et `info` vide, AES-CTR sur 32 octets nuls, HMAC-SHA256 du chiffré.
 * Rien ne les relie — pas de compilateur commun, pas d'appel de l'un vers l'autre. C'est la
 * jonction que la règle 7 décrit : une divergence ne casserait rien à l'exécution, elle
 * refuserait simplement toutes les clés valides, et le symptôme serait « le changement de
 * mot de passe ne marche pas » sans que rien ne dise pourquoi.
 *
 * **Le vecteur est produit par Python et validé ici par le SDK** — l'inverse aurait été un
 * substitut qui se confirme lui-même (règle 3). Si l'un des deux dérive, ce test rougit.
 */
const vecteur = JSON.parse(
  readFileSync(
    new URL("../../../infra/synapse/modules/vecteur-key-check.json", import.meta.url),
    "utf-8",
  ),
) as { cle: string; iv: string; mac: string };

const octets = (b64: string) => Uint8Array.from(Buffer.from(b64, "base64"));

describe("D-12 — le module Synapse et le SDK vérifient la même clé de la même façon", () => {
  it("le MAC calculé par Python est celui que le SDK calcule", async () => {
    // `iv` fourni : sans lui `calculateKeyCheck` en tire un au hasard et le MAC change à
    // chaque appel. C'est ce paramètre qui rend la comparaison possible.
    const { mac } = await SecretStorage.calculateKeyCheck(octets(vecteur.cle), vecteur.iv);
    expect(mac).toBe(vecteur.mac);
  });

  it("une clé voisine ne produit pas le même MAC", async () => {
    /*
     * Le test précédent passerait encore si les deux implémentations avaient dérivé
     * ensemble vers quelque chose de constant. Celui-ci dit que le MAC dépend bien de la
     * clé — c'est-à-dire que le vecteur prouve quelque chose.
     */
    const voisine = octets(vecteur.cle);
    voisine[0] = (voisine[0]! + 1) % 256;
    const { mac } = await SecretStorage.calculateKeyCheck(voisine, vecteur.iv);
    expect(mac).not.toBe(vecteur.mac);
  });
});
