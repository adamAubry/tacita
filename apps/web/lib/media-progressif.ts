import {
  dechiffrerPlage,
  TAILLE_BLOC,
  type Bytes,
  type EncryptedFile,
  type SourceChiffree,
} from "@tacita/media-pipeline";

/**
 * REQ-MED-08 (b) — **la lecture progressive, côté page.**
 *
 * Le service worker répond aux plages que réclame le `<video>` ; il ne déchiffre rien et
 * ne détient aucune clé. Il **demande** les octets à une fenêtre vivante, qui les vérifie
 * bloc par bloc et les déchiffre ici.
 *
 * C'est une forme plus forte que les bornes prévues : la note de conception D-10 décrivait
 * une table de clés en portée module du worker, vide à froid, jamais lue par le handler
 * `push`. Le worker qui servirait les médias **est** celui du push — il n'y a qu'un worker
 * par portée, et il est réveillé hors de toute page. La meilleure façon de garantir que le
 * handler `push` ne lit jamais la table, c'est qu'il n'y ait pas de table : les clés ne
 * quittent pas la page, et un worker démarré à froid par une notification n'a personne à
 * qui demander quoi que ce soit.
 */

/** Le préfixe d'URL virtuelle que le service worker intercepte. */
export const PREFIXE_MEDIA = "/tacita-media/";

/** Le type de message échangé avec le worker, côté demande. */
export const TYPE_PLAGE = "tacita-media-plage";

interface Inscrit {
  chiffre: Bytes;
  cles: EncryptedFile;
  haches: readonly string[];
  type: string;
}

/**
 * Les médias que cette page accepte de servir, par identifiant **non devinable**.
 *
 * En portée module et en mémoire : rien n'est persisté, rien ne survit à la fermeture de
 * l'onglet, et une page qui n'a rien inscrit ne sert rien.
 */
const inscrits = new Map<string, Inscrit>();

let branche = false;

/** REQ-MED-08 — la vérification par bloc, puis le déchiffrement de la seule plage demandée. */
async function servir(inscrit: Inscrit, debut: number, fin: number): Promise<Bytes> {
  const source: SourceChiffree = {
    taille: inscrit.chiffre.length,
    tranche: async (a, b) => inscrit.chiffre.subarray(a, b) as Bytes,
  };
  return dechiffrerPlage(source, inscrit.cles, inscrit.haches, globalThis.crypto.subtle, debut, fin);
}

function brancher(): void {
  if (branche || !navigator.serviceWorker) return;
  branche = true;

  navigator.serviceWorker.addEventListener("message", (evenement) => {
    const message = evenement.data as { type?: string; id?: string; debut?: number; fin?: number | null };
    if (message?.type !== TYPE_PLAGE) return;

    const port = evenement.ports[0];
    if (!port) return;

    const inscrit = message.id === undefined ? undefined : inscrits.get(message.id);
    // Rien d'inscrit sous cet identifiant : on ne sert pas, et on ne dit pas pourquoi.
    if (!inscrit) {
      port.postMessage({ erreur: true });
      return;
    }

    const taille = inscrit.chiffre.length;
    const debut = Math.min(Math.max(0, message.debut ?? 0), taille);
    const fin =
      message.fin === null || message.fin === undefined
        ? Math.min(taille, debut + TAILLE_BLOC)
        : Math.min(message.fin + 1, taille);

    void servir(inscrit, debut, fin)
      .then((octets) => {
        const copie = octets.slice().buffer;
        // Le clair traverse le worker, il n'y séjourne pas : `transfer` le déplace, et la
        // page n'en garde pas de second exemplaire.
        port.postMessage({ octets: copie, debut, fin: fin - 1, taille, type: inscrit.type }, [copie]);
      })
      .catch(() => port.postMessage({ erreur: true }));
  });
}

/**
 * Inscrit un média chiffré et rend l'URL virtuelle qui le sert.
 *
 * L'identifiant vient de `crypto.randomUUID` : non devinable, et lié à la durée de vie de
 * la page — une autre origine, un autre onglet, ou la même page rechargée ne le connaît
 * pas.
 */
export function inscrireMedia(
  chiffre: Bytes,
  cles: EncryptedFile,
  haches: readonly string[],
  type: string,
): string {
  brancher();
  const id = globalThis.crypto.randomUUID();
  inscrits.set(id, { chiffre, cles, haches, type });
  return `${PREFIXE_MEDIA}${id}`;
}

/** Retire l'inscription : le média n'est plus servi, et ses octets sont relâchés. */
export function retirerMedia(url: string): void {
  inscrits.delete(url.slice(PREFIXE_MEDIA.length));
}

/** REQ-MED-08 (b) — la lecture progressive n'existe que si un worker contrôle la page. */
export function lectureProgressiveDisponible(): boolean {
  return typeof navigator !== "undefined" && navigator.serviceWorker?.controller != null;
}
