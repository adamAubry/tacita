import {
  createFile,
  DataStream,
  Endianness,
  MP4BoxBuffer,
  type ISOFile,
  type Matrix,
  type Sample,
} from "mp4box";

import type { Bytes } from "./attachments";
import type { EchantillonVideo, PisteAudio, Rotation } from "./mp4";

/**
 * REQ-MED-04 / E-17 — **le démuxage d'un fichier entrant, par bibliothèque.**
 *
 * `mp4box@2.4.1`, digest dans le lockfile
 * (`sha512-0HGX7nXoDIX6FKLVl4a3wtYjBlwqsN3xuQC3GXzNtKp98FXUOhDSq623azsz8DG5ptd9ZXcXodDkgbdMZOjWvw==`).
 * Version épinglée sans accent circonflexe, CHANGELOG relu avant tout bump — le régime de
 * `CLAUDE.md` § Prudence outillage, règle 5, celui d'Astryx.
 *
 * **Pourquoi une dépendance ici et nulle part ailleurs.** Ce que nous écrivons — un
 * conteneur, avec nos propres échantillons — est borné et connu. Ce que nous *lisons*
 * vient de toutes les caméras du marché : listes d'édition, pistes multiples, `moov`
 * fragmenté, rotation dans le `tkhd`, `.mov` HEVC d'iPhone. Un démuxeur maison sur cette
 * surface est un puits à défauts d'interop, et aucun test de ce dépôt ne les verrait.
 *
 * **Elle ne touche pas WebCodecs**, et c'est la condition qui la rendait admissible :
 * octets → structures, exécutable dans Node, donc testable sans navigateur. E-10 reste
 * intacte — l'encodage vit toujours dans le shard. *(Mesuré le 20/08/2026 : `mp4-muxer`,
 * l'autre candidat, commence `addVideoChunk` par `sample instanceof EncodedVideoChunk` et
 * lève un `ReferenceError` dans Node. Le faire passer aurait demandé de définir nous-mêmes
 * la classe que le test vérifie — la règle 3, à la lettre.)*
 */

/** Ce qu'on lit d'une source, et rien de plus : de quoi remuxer, réencoder ou refuser. */
export interface SourceVideo {
  /** Chaîne `avc1.xxxxxx` ou autre, telle que la piste la déclare. */
  codec: string;
  /** Dimensions **codées**, avant application de la matrice. */
  largeur: number;
  hauteur: number;
  /** REQ-MED-14 — la rotation lue dans la matrice du `tkhd`, jamais devinée. */
  rotation: Rotation;
  dureeMs: number;
  /** Débit moyen réel, calculé sur les échantillons — pas celui que le conteneur annonce. */
  debitBps: number;
  /** `avcC`, tel quel : le muxeur le recopie sans le lire. */
  description: Bytes;
  /** Dans l'ordre de décodage, horodatés en microsecondes de présentation. */
  echantillons: EchantillonVideo[];
  /** Nombre total de pistes de la source, vidéo comprise. */
  pistes: number;
  /**
   * REQ-MED-13 — la piste audio **transportable**, quand il y en a une.
   *
   * Absente quand la source n'a pas de son, ou quand son codec n'est pas de l'AAC : ce
   * muxeur recopie une piste, il n'en convertit aucune. Le second cas est signalé par
   * `audioAbandonne`, parce que « pas de son » et « du son qu'on n'a pas su emporter » ne
   * demandent pas la même phrase à l'écran.
   */
  audio?: PisteAudio;
  /** La source avait du son, et il ne part pas : l'UI doit le dire (REQ-MED-13). */
  audioAbandonne: boolean;
}

const signe = (valeur: number): number => (valeur > 0x7fffffff ? valeur - 0x100000000 : valeur);

/**
 * REQ-MED-14 — l'angle que dit la matrice, ou `0` si elle ne dit rien de reconnaissable.
 *
 * Seuls `a` et `b` sont lus : les quatre orientations qu'une caméra écrit s'y distinguent
 * déjà, et une matrice arbitraire — mise à l'échelle, cisaillement — n'est pas une
 * rotation. Rendre `0` sur ce qu'on ne reconnaît pas est le bon défaut : l'image sort
 * comme elle est codée, jamais tournée au hasard.
 */
export function rotationDeMatrice(matrice: Matrix | undefined): Rotation {
  if (!matrice || matrice.length < 5) return 0;
  const a = signe(matrice[0] ?? 0);
  const b = signe(matrice[1] ?? 0);
  const unite = 0x10000;
  if (a === unite && b === 0) return 0;
  if (a === 0 && b === unite) return 90;
  if (a === -unite && b === 0) return 180;
  if (a === 0 && b === -unite) return 270;
  return 0;
}

/** La boîte de configuration d'une piste, écrite telle quelle par mp4box. */
function boiteDe(fichier: ISOFile, pisteId: number, noms: string[], entete: boolean): Bytes {
  const piste = fichier.getTrackById(pisteId);
  /*
   * La boîte de configuration porte un nom par codec — `avcC`, `hvcC`, `vpcC`, `av1C` —
   * et les types de mp4box décrivent l'entrée de description par sa forme commune, sans
   * ces champs. Le cast est **local et nommé**, pas un `any` sur toute la fonction : on
   * cherche exactement une boîte sachant s'écrire dans un flux, et rien d'autre.
   */
  type Configuration = { write(flux: DataStream): void };
  const entrees = (piste?.mdia?.minf?.stbl?.stsd?.entries ?? []) as unknown as Record<
    string,
    Configuration | undefined
  >[];

  for (const entree of entrees) {
    const config = noms.map((nom) => entree[nom]).find(Boolean);
    if (!config) continue;
    const flux = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
    config.write(flux);
    // La vidéo veut le **contenu** de `avcC` (le muxeur réécrit la boîte) ; l'audio veut
    // la boîte `esds` **entière**, en-tête compris, parce qu'elle est recopiée telle quelle.
    return new Uint8Array(entete ? flux.buffer : flux.buffer.slice(8)) as Bytes;
  }
  throw new Error(`piste sans description de codec (${noms.join(", ")}) : source illisible`);
}

/**
 * REQ-MED-04 — lit la **première piste vidéo** d'un MP4/MOV et rend ce qu'il faut pour
 * décider : remuxer, réencoder, ou refuser.
 *
 * Une seule piste vidéo est lue, et c'est assumé : le pipeline en produit une (D-04), et
 * une source multi-angles n'a pas de sens dans une messagerie. `pistes` et `audio`
 * remontent quand même, parce que ce sont eux qui disent au prédicat du chemin rapide que
 * la source n'est pas ordinaire.
 */
export async function lireMp4(octets: Bytes): Promise<SourceVideo> {
  const fichier = createFile();

  const source = await new Promise<SourceVideo>((resolve, reject) => {
    fichier.onError = (erreur: string) => reject(new Error(`démuxage impossible : ${erreur}`));

    fichier.onReady = (info) => {
      const piste = info.videoTracks?.[0];
      if (!piste) {
        reject(new Error("aucune piste vidéo : source illisible"));
        return;
      }

      // REQ-MED-13 — la piste audio n'est reprise que si elle est **de l'AAC** : le
      // muxeur recopie une piste, il n'en convertit aucune (voir `SourceVideo.audio`).
      const pisteAudio = info.audioTracks?.[0];
      const audioReprise = pisteAudio?.codec.startsWith("mp4a") === true;

      const echantillons: EchantillonVideo[] = [];
      const echantillonsAudio: PisteAudio["echantillons"] = [];
      fichier.onSamples = (id, _user, lot: Sample[]) => {
        for (const brut of lot) {
          if (!brut.data) continue;
          if (id === piste.id) {
            echantillons.push({
              donnees: new Uint8Array(brut.data) as Bytes,
              // `cts` est la date de **présentation** : c'est ce que le muxeur attend, et
              // ce dont il redérive l'ordre de décodage.
              timestampUs: Math.round((brut.cts / brut.timescale) * 1_000_000),
              cle: brut.is_sync,
            });
          } else {
            // La durée **déclarée**, dans l'échelle de la source : la recalculer
            // introduirait la dérive que conserver l'échelle supprime.
            echantillonsAudio.push({ donnees: new Uint8Array(brut.data) as Bytes, duree: brut.duration });
          }
        }
      };

      fichier.setExtractionOptions(piste.id, null, { nbSamples: Number.MAX_SAFE_INTEGER });
      if (pisteAudio && audioReprise) {
        fichier.setExtractionOptions(pisteAudio.id, null, { nbSamples: Number.MAX_SAFE_INTEGER });
      }
      fichier.start();
      fichier.flush();

      const dureeMs = Math.round((info.duration / info.timescale) * 1000);
      const octetsUtiles = echantillons.reduce((somme, e) => somme + e.donnees.length, 0);

      resolve({
        codec: piste.codec,
        largeur: piste.track_width || piste.video?.width || 0,
        hauteur: piste.track_height || piste.video?.height || 0,
        rotation: rotationDeMatrice(piste.matrix),
        dureeMs,
        // Le débit **mesuré**, pas celui que le conteneur annonce : un champ d'en-tête se
        // recopie d'un transcodage à l'autre et ne décrit plus rien.
        debitBps: dureeMs > 0 ? Math.round((octetsUtiles * 8) / (dureeMs / 1000)) : 0,
        description: boiteDe(fichier, piste.id, ["avcC", "hvcC", "vpcC", "av1C"], false),
        echantillons,
        pistes: info.tracks?.length ?? 1,
        audio:
          pisteAudio && audioReprise && echantillonsAudio.length > 0
            ? {
                esds: boiteDe(fichier, pisteAudio.id, ["esds"], true),
                timescale: pisteAudio.timescale,
                frequence: pisteAudio.audio?.sample_rate ?? pisteAudio.timescale,
                canaux: pisteAudio.audio?.channel_count ?? 2,
                echantillons: echantillonsAudio,
              }
            : undefined,
        audioAbandonne: pisteAudio !== undefined && !audioReprise,
      });
    };

    // `fileStart` situe le tampon dans le fichier : ici tout tient en mémoire, donc un
    // seul tampon à l'offset zéro.
    fichier.appendBuffer(
      MP4BoxBuffer.fromArrayBuffer(
        octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength),
        0,
      ),
    );
    fichier.flush();
  });

  if (source.echantillons.length === 0) throw new Error("piste vidéo sans échantillon : source illisible");
  return source;
}
