import type { Bytes } from "./attachments";

/**
 * Muxeur MP4 (ISO BMFF) — **octets → octets, aucun DOM** (§ Méthode, E-10).
 *
 * Il n'encode rien : il reçoit des échantillons déjà encodés — par `WebCodecs` pour la
 * vidéo, tels quels depuis la source pour l'audio — et les range dans les boîtes qu'un
 * lecteur attend. C'est le pendant vidéo du muxeur Ogg.
 *
 * **Deux pistes depuis le 20/08/2026.** Le commentaire qui vivait ici disait
 * « une piste, pas de son : l'audio d'une vidéo de téléphone n'est pas dans le périmètre
 * de D-04, et aucune exigence ne la demande ». C'était vrai de la lettre de specs et faux
 * du produit : sur une messagerie, une vidéo muette est perçue comme un bug. La REQ existe
 * maintenant, et la piste avec elle.
 */

/** Microsecondes : c'est l'unité de `WebCodecs`, et l'adopter supprime tout arrondi. */
export const TIMESCALE_US = 1_000_000;

export interface EchantillonVideo {
  /** Échantillon encodé, au format AVCC (NAL préfixées de leur longueur). */
  donnees: Bytes;
  /** Horodatage de présentation, en microsecondes, tel que `WebCodecs` le rend. */
  timestampUs: number;
  /** Image clé : elle seule permet de démarrer le décodage. */
  cle: boolean;
}

/**
 * Un échantillon audio, **recopié tel quel** depuis la source.
 *
 * Sa durée est celle que la source déclare, dans l'échelle de temps de la source : la
 * recopier plutôt que la recalculer supprime toute dérive — une trame AAC dure 1024
 * échantillons, ce qui ne tombe juste dans aucune échelle en microsecondes.
 */
export interface EchantillonAudio {
  donnees: Bytes;
  /** Durée dans le `timescale` de la piste audio. */
  duree: number;
}

/** la piste audio, telle que le muxeur la reçoit : déjà encodée, jamais convertie. */
export interface PisteAudio {
  /**
   * La boîte `esds` de la source, **recopiée octet pour octet**, en-tête compris.
   *
   * Elle porte l'`AudioSpecificConfig` — profil, fréquence, canaux —, et la réécrire
   * demanderait de la parser puis de la reconstruire, deux occasions de se tromper sur
   * une structure qu'on ne fait que transporter.
   */
  esds: Bytes;
  /** Échelle de temps de la piste, celle de la source : conservée, jamais convertie. */
  timescale: number;
  frequence: number;
  canaux: number;
  echantillons: EchantillonAudio[];
}

export interface Mp4Options {
  largeur: number;
  hauteur: number;
  /**
   * `AVCDecoderConfigurationRecord`, rendu par `VideoEncoder` dans
   * `metadata.decoderConfig.description`. Le muxeur le recopie sans le lire : ce sont les
   * paramètres du codec, et les deviner produirait une vidéo qui ne décode pas.
   */
  description: Bytes;
  echantillons: EchantillonVideo[];
  /**
   * la rotation **à l'affichage**, propagée dans la matrice du `tkhd`.
   *
   * Gratuite et sans perte : les pixels ne bougent pas, seul le lecteur tourne l'image.
   * `largeur`/`hauteur` restent celles des pixels codés — c'est la matrice qui dit au
   * lecteur d'échanger les deux à l'écran, et `info.w`/`info.h` de l'événement doivent
   * décrire ce que l'utilisateur verra, pas ce que le codec a encodé.
   */
  rotation?: Rotation;
  /**
   * la piste audio, quand la source en a une **et** qu'elle est transportable.
   *
   * Absente ⇒ fichier **mono-piste**, jamais une piste vide : un `trak` sans échantillon
   * fait échouer certains lecteurs et n'apporte rien aux autres.
   */
  audio?: PisteAudio;
}

/** Les quatre orientations qu'une caméra écrit. Rien d'autre n'existe dans un `tkhd`. */
export type Rotation = 0 | 90 | 180 | 270;

const encodeur = new TextEncoder();

/**
 * Une boîte ISO BMFF : taille (4), type (4), charge utile.
 *
 * **Rien n'est étalé.** La version précédente faisait `morceaux.flatMap((m) => [...m])` :
 * pour le `mdat` d'une vidéo de 20 Mo, c'était vingt millions d'octets convertis en autant
 * d'éléments de tableau JavaScript — plusieurs centaines de mégaoctets d'allocation et
 * plusieurs secondes, dans le worker. Invisible sur les échantillons de quelques
 * kilo-octets des tests, décisif sur un fichier réel : c'est ce qui rendait l'envoi d'une
 * vidéo « très long » (mesuré le 20/08/2026, sur un fichier de 89 Mo).
 *
 * `Uint8Array.set` accepte aussi bien une vue qu'un tableau ordinaire : une seule
 * allocation, une copie par morceau, et les entiers restent des octets.
 */
function boite(type: string, ...morceaux: (Bytes | number[])[]): Bytes {
  const longueur = morceaux.reduce((somme, morceau) => somme + morceau.length, 0);
  const sortie = new Uint8Array(8 + longueur);
  new DataView(sortie.buffer).setUint32(0, sortie.length);
  sortie.set(encodeur.encode(type), 4);

  let position = 8;
  for (const morceau of morceaux) {
    sortie.set(morceau, position);
    position += morceau.length;
  }
  return sortie;
}

const u32 = (valeur: number): number[] => [
  (valeur >>> 24) & 0xff,
  (valeur >>> 16) & 0xff,
  (valeur >>> 8) & 0xff,
  valeur & 0xff,
];

const u16 = (valeur: number): number[] => [
  (valeur >>> 8) & 0xff,
  valeur & 0xff,
];

/** Version 0 + trois octets de drapeaux, en tête de toute « full box ». */
const pleine = (drapeaux = 0): number[] => [
  0,
  (drapeaux >>> 16) & 0xff,
  (drapeaux >>> 8) & 0xff,
  drapeaux & 0xff,
];

/** 16.16 signé. `u32` fait déjà le complément à deux : `-1 >>> 24` rend bien `0xff`. */
const f1616 = (valeur: number): number[] => u32(valeur * 0x10000);

/**
 * la matrice de transformation du `tkhd`, disposée `{a, b, u, c, d, v, x, y, w}`.
 *
 * Seuls les quatre termes de rotation sont posés ; les translations restent nulles, comme
 * le fait la matrice d'affichage de ffmpeg. Un lecteur qui honore la matrice fait tourner
 * l'image autour de son centre — c'est ce que produisent les caméras de téléphone.
 */
const matrice = (a: number, b: number, c: number, d: number): number[] => [
  ...f1616(a),
  ...f1616(b),
  ...u32(0),
  ...f1616(c),
  ...f1616(d),
  ...u32(0),
  ...u32(0),
  ...u32(0),
  ...u32(0x40000000),
];

const MATRICES: Record<Rotation, number[]> = {
  0: matrice(1, 0, 0, 1),
  90: matrice(0, 1, -1, 0),
  180: matrice(-1, 0, 0, -1),
  270: matrice(0, -1, 1, 0),
};

/** La matrice du film : jamais de rotation ici, elle appartient à la piste. */
const MATRICE_UNITE = MATRICES[0];

/**
 * Durées par échantillon, dérivées des horodatages **de décodage**.
 *
 * Le dernier échantillon n'a pas de suivant qui donnerait sa durée : il reprend celle du
 * précédent. Lui mettre zéro tronquerait la dernière image à la lecture — le défaut se
 * voit sur une vidéo courte, où c'est une part visible du plan.
 */
function durees(dts: number[]): number[] {
  const suite = dts.map((horodatage, rang) =>
    rang + 1 < dts.length ? Math.max(0, dts[rang + 1]! - horodatage) : 0,
  );
  const dernier = suite.length - 1;
  if (dernier >= 0) suite[dernier] = suite[dernier - 1] ?? TIMESCALE_US / 30;
  return suite;
}

/** `stts` — les durées, compressées en séries : une vidéo à cadence fixe tient en une. */
function stts(valeurs: number[]): Bytes {
  const series: [nombre: number, duree: number][] = [];
  for (const duree of valeurs) {
    const derniere = series.at(-1);
    if (derniere && derniere[1] === duree) derniere[0] += 1;
    else series.push([1, duree]);
  }
  return boite(
    "stts",
    pleine(),
    u32(series.length),
    series.flatMap(([nombre, duree]) => [...u32(nombre), ...u32(duree)]),
  );
}

/** `stss` — les images clés, en rangs 1-based. Omise si tout est clé. */
function stss(echantillons: EchantillonVideo[]): Bytes[] {
  const cles = echantillons.flatMap((echantillon, rang) =>
    echantillon.cle ? [rang + 1] : [],
  );
  if (cles.length === echantillons.length) return [];
  return [boite("stss", pleine(), u32(cles.length), cles.flatMap(u32))];
}

/**
 * `ctts` — l'écart entre présentation et décodage, échantillon par échantillon.
 *
 * **Prérequis des B-frames, et c'est pour ça que la boîte existe.** Un profil High les
 * autorise ; une image B se décode *après* une image qu'elle précède à l'écran, donc
 * l'ordre de décodage n'est plus l'ordre de présentation. Sans cette table, un lecteur
 * affiche les images dans l'ordre où elles sont rangées : la vidéo saute en arrière à
 * chaque groupe. Le défaut est spectaculaire et silencieux à l'encodage.
 *
 * **Version 1, offsets signés.** Un écart négatif est normal — c'est le cas de l'image
 * qui se décode avant celles qui l'entourent — et la version 0 ne sait pas les écrire.
 *
 * Omise quand tout est à zéro : un flux sans B-frames n'a rien à corriger, et une table
 * de zéros est un octet de plus par échantillon pour rien.
 */
function ctts(decalages: number[]): Bytes[] {
  if (decalages.every((decalage) => decalage === 0)) return [];

  const series: [nombre: number, decalage: number][] = [];
  for (const decalage of decalages) {
    const derniere = series.at(-1);
    if (derniere && derniere[1] === decalage) derniere[0] += 1;
    else series.push([1, decalage]);
  }

  return [
    boite(
      "ctts",
      [1, 0, 0, 0], // version 1 : les offsets sont signés
      u32(series.length),
      series.flatMap(([nombre, decalage]) => [
        ...u32(nombre),
        ...u32(decalage),
      ]),
    ),
  ];
}

/** Le même en-tête pour tous les fichiers : sa longueur entre dans le calcul des décalages. */
const ftyp = boite("ftyp", encodeur.encode("isom"), u32(512), encodeur.encode("isomiso2avc1mp41"));

/**
 * Écrit un MP4 **faststart** : `ftyp`, `moov`, `mdat`.
 *
 * *(Ordre inversé le 20/08/2026. La version précédente écrivait `moov` en dernier, avec ce
 * motif : « le déplacer en tête demanderait de recalculer tous les décalages de chunk une
 * fois sa taille connue, pour un gain qui n'existe qu'en lecture progressive ». Les deux
 * moitiés étaient fausses. Le recalcul tient en **une passe de plus** : la taille d'un
 * `stco` ne dépend pas de la valeur qu'il contient, donc construire `moov` avec des
 * décalages nuls donne exactement sa longueur définitive, et la seconde construction pose
 * les vrais. Quant au gain, il conditionne la lecture progressive de la phase 6 — sans
 * `moov` en tête, un lecteur doit lire la fin du fichier avant la première image — et il
 * vaut déjà pour un fichier exporté vers un autre outil.)*
 */
export function ecrireMp4({
  largeur,
  hauteur,
  description,
  echantillons,
  rotation = 0,
  audio,
}: Mp4Options): Bytes {
  if (echantillons.length === 0) throw new Error("MP4 sans échantillon : rien à muxer");
  if (description.length === 0) throw new Error("MP4 sans description de codec : illisible");

  const taillesVideo = echantillons.map((echantillon) => echantillon.donnees.length);

  /*
   * Les échantillons arrivent dans l'ordre **de décodage** — c'est celui où l'encodeur les
   * rend —, et leur horodatage est celui de **présentation**. Les deux coïncident tant
   * qu'il n'y a pas d'image B ; dès qu'il y en a, il faut les deux suites.
   *
   * Les dates de décodage sont les mêmes valeurs, remises en ordre croissant : une image
   * décodée en n-ième position est décodée à la n-ième date, quelle que soit celle à
   * laquelle on l'affichera. C'est ce qui rend `ctts` calculable sans que l'encodeur ait
   * à rendre une seconde horloge — WebCodecs n'en expose pas.
   */
  const presentation = echantillons.map((echantillon) => echantillon.timestampUs);
  const decodage = [...presentation].sort((a, b) => a - b);
  const dureesVideo = durees(decodage);
  const dureeVideo = dureesVideo.reduce((somme, duree) => somme + duree, 0);

  const dureesAudio = audio?.echantillons.map((echantillon) => echantillon.duree) ?? [];
  const dureeAudio = dureesAudio.reduce((somme, duree) => somme + duree, 0);
  /** La durée du film est celle de la plus longue piste, exprimée en microsecondes. */
  const dureeFilm = Math.max(
    dureeVideo,
    audio ? Math.round((dureeAudio / audio.timescale) * TIMESCALE_US) : 0,
  );

  /*
   * **l'entrelacement**, et pourquoi il n'est pas cosmétique.
   *
   * Deux pistes rangées d'un bloc obligent un lecteur à sauter d'un bout à l'autre du
   * fichier pour tenir une seconde de son en face d'une seconde d'image. Sur un blob
   * local c'est invisible ; sur une lecture par plages — ce que prépare le hachage par
   * blocs —, chaque saut est une requête. Les groupes d'une seconde sont le compromis
   * habituel : assez gros pour que les tables restent courtes, assez fins pour qu'un
   * lecteur n'ait jamais plus d'une seconde d'avance à charger.
   */
  const GROUPE_US = TIMESCALE_US;
  const finVideo = (rang: number): number => decodage[rang] ?? dureeVideo;
  const morceaux: { piste: "v" | "a"; premier: number; nombre: number }[] = [];

  let rangVideo = 0;
  let rangAudio = 0;
  let tempsAudio = 0;
  for (let groupe = 0; rangVideo < echantillons.length || rangAudio < dureesAudio.length; groupe++) {
    const limite = (groupe + 1) * GROUPE_US;
    const avantVideo = rangVideo;
    const avantAudio = rangAudio;

    let finV = rangVideo;
    while (finV < echantillons.length && finVideo(finV) < limite) finV += 1;
    if (finV > rangVideo) morceaux.push({ piste: "v", premier: rangVideo, nombre: finV - rangVideo });
    rangVideo = finV;

    let finA = rangAudio;
    while (
      finA < dureesAudio.length &&
      (tempsAudio / (audio?.timescale ?? 1)) * TIMESCALE_US < limite
    ) {
      tempsAudio += dureesAudio[finA] ?? 0;
      finA += 1;
    }
    if (finA > rangAudio) morceaux.push({ piste: "a", premier: rangAudio, nombre: finA - rangAudio });
    rangAudio = finA;

    /*
     * Garde-fou contre une boucle infinie : des horodatages qui n'avancent pas — tous nuls,
     * ou tous au-delà de la fin — laisseraient les deux curseurs sur place indéfiniment.
     * La comparaison porte sur l'**avant**, pas sur les curseurs qu'on vient de déplacer :
     * écrite dans l'autre sens, la garde était vraie à tous les tours et coupait le fichier
     * à sa première seconde. C'est le genre de faute que seul un cas à plusieurs groupes
     * révèle, et le test à trois secondes est là pour ça.
     */
    if (rangVideo === avantVideo && rangAudio === avantAudio) {
      if (rangVideo < echantillons.length) {
        morceaux.push({ piste: "v", premier: rangVideo, nombre: echantillons.length - rangVideo });
        rangVideo = echantillons.length;
      }
      if (rangAudio < dureesAudio.length) {
        morceaux.push({ piste: "a", premier: rangAudio, nombre: dureesAudio.length - rangAudio });
        rangAudio = dureesAudio.length;
      }
      break;
    }
  }

  /** Les octets de `mdat`, dans l'ordre des morceaux, et les décalages relatifs de chacun. */
  const octetsAudio = audio?.echantillons.map((echantillon) => echantillon.donnees) ?? [];
  const taillesAudio = octetsAudio.map((donnees) => donnees.length);

  const decalages: { v: number[]; a: number[] } = { v: [], a: [] };
  const tailleParMorceau: { v: number[]; a: number[] } = { v: [], a: [] };
  const paquets: Bytes[] = [];
  let curseur = 0;

  for (const morceau of morceaux) {
    decalages[morceau.piste].push(curseur);
    tailleParMorceau[morceau.piste].push(morceau.nombre);
    const source = morceau.piste === "v" ? echantillons.map((e) => e.donnees) : octetsAudio;
    for (let rang = morceau.premier; rang < morceau.premier + morceau.nombre; rang++) {
      const donnees = source[rang]!;
      paquets.push(donnees);
      curseur += donnees.length;
    }
  }

  const donnees = new Uint8Array(curseur);
  let position = 0;
  for (const paquet of paquets) {
    donnees.set(paquet, position);
    position += paquet.length;
  }
  const mdat = boite("mdat", donnees);

  const avcC = boite("avcC", description);
  const avc1 = boite(
    "avc1",
    [0, 0, 0, 0, 0, 0], // réservé
    u16(1), // index de référence de données
    u16(0), u16(0), u32(0), u32(0), u32(0), // pré-défini / réservé
    u16(largeur),
    u16(hauteur),
    u32(0x00480000), // 72 dpi horizontaux
    u32(0x00480000),
    u32(0),
    u16(1), // une image par échantillon
    Array.from({ length: 32 }, () => 0), // nom du compresseur, laissé vide
    u16(0x0018), // profondeur
    [0xff, 0xff], // pré-défini = −1
    avcC,
  );

  /** `mp4a` — l'entrée de description de la piste audio, avec l'`esds` de la source. */
  const mp4a = audio
    ? boite(
        "mp4a",
        [0, 0, 0, 0, 0, 0],
        u16(1), // index de référence de données
        u32(0), u32(0), // version, révision, fournisseur
        u16(audio.canaux),
        u16(16), // taille d'échantillon, valeur conventionnelle pour un flux compressé
        u16(0), u16(0), // pré-défini, réservé
        u32(audio.frequence * 0x10000), // 16.16
        audio.esds,
      )
    : undefined;

  /** `stsc` — combien d'échantillons par morceau, compressé en séries. */
  const stsc = (nombres: number[]): Bytes => {
    const series: [premier: number, nombre: number][] = [];
    nombres.forEach((nombre, rang) => {
      const derniere = series.at(-1);
      if (derniere && derniere[1] === nombre) return;
      series.push([rang + 1, nombre]);
    });
    return boite(
      "stsc",
      pleine(),
      u32(series.length),
      series.flatMap(([premier, nombre]) => [...u32(premier), ...u32(nombre), ...u32(1)]),
    );
  };

  const stco = (offsets: number[], base: number): Bytes =>
    boite("stco", pleine(), u32(offsets.length), offsets.flatMap((offset) => u32(offset + base)));

  const construireMoov = (base: number): Bytes => {
    const stblVideo = boite(
      "stbl",
      boite("stsd", pleine(), u32(1), avc1),
      stts(dureesVideo),
      ...ctts(presentation.map((date, rang) => date - decodage[rang]!)),
      ...stss(echantillons),
      stsc(tailleParMorceau.v),
      boite("stsz", pleine(), u32(0), u32(taillesVideo.length), taillesVideo.flatMap(u32)),
      stco(decalages.v, base),
    );

    const trakVideo = boite(
      "trak",
      boite(
        "tkhd",
        pleine(3), // activée, et présente dans le film
        u32(0), u32(0),
        u32(1), // identifiant de piste
        u32(0),
        u32(dureeVideo),
        u32(0), u32(0),
        u16(0), u16(0),
        u16(0), // volume : nul pour une piste vidéo
        u16(0),
        MATRICES[rotation],
        u32(largeur * 0x10000),
        u32(hauteur * 0x10000),
      ),
      boite(
        "mdia",
        boite("mdhd", pleine(), u32(0), u32(0), u32(TIMESCALE_US), u32(dureeVideo), u16(0x55c4), u16(0)),
        boite("hdlr", pleine(), u32(0), encodeur.encode("vide"), u32(0), u32(0), u32(0), encodeur.encode("VideoHandler\0")),
        boite(
          "minf",
          boite("vmhd", pleine(1), u16(0), u16(0), u16(0), u16(0)),
          boite("dinf", boite("dref", pleine(), u32(1), boite("url ", pleine(1)))),
          stblVideo,
        ),
      ),
    );

    const trakAudio =
      audio && mp4a
        ? [
            boite(
              "trak",
              boite(
                "tkhd",
                pleine(3),
                u32(0), u32(0),
                u32(2), // seconde piste
                u32(0),
                u32(Math.round((dureeAudio / audio.timescale) * TIMESCALE_US)),
                u32(0), u32(0),
                u16(0), u16(0),
                u16(0x0100), // volume plein : c'est une piste sonore
                u16(0),
                MATRICES[0], // une piste audio ne tourne pas
                u32(0), // ni largeur, ni hauteur
                u32(0),
              ),
              boite(
                "mdia",
                // **L'échelle de temps de la source**, conservée telle quelle : une trame
                // AAC dure 1024 échantillons, ce qui ne tombe juste dans aucune échelle en
                // microsecondes. Convertir ici, c'est arrondir à chaque trame, et une
                // dérive de quelques millisecondes en fin de fichier.
                boite("mdhd", pleine(), u32(0), u32(0), u32(audio.timescale), u32(dureeAudio), u16(0x55c4), u16(0)),
                boite("hdlr", pleine(), u32(0), encodeur.encode("soun"), u32(0), u32(0), u32(0), encodeur.encode("SoundHandler\0")),
                boite(
                  "minf",
                  boite("smhd", pleine(), u16(0), u16(0)),
                  boite("dinf", boite("dref", pleine(), u32(1), boite("url ", pleine(1)))),
                  boite(
                    "stbl",
                    boite("stsd", pleine(), u32(1), mp4a),
                    stts(dureesAudio),
                    // Aucune `stss` : toute trame AAC est un point d'entrée.
                    stsc(tailleParMorceau.a),
                    boite("stsz", pleine(), u32(0), u32(taillesAudio.length), taillesAudio.flatMap(u32)),
                    stco(decalages.a, base),
                  ),
                ),
              ),
            ),
          ]
        : [];

    return boite(
      "moov",
      boite(
        "mvhd",
        pleine(),
        u32(0), u32(0),
        u32(TIMESCALE_US),
        u32(dureeFilm),
        u32(0x00010000), // vitesse normale
        u16(0x0100), // volume plein
        u16(0),
        u32(0), u32(0),
        MATRICE_UNITE,
        u32(0), u32(0), u32(0), u32(0), u32(0), u32(0),
        u32(trakAudio.length > 0 ? 3 : 2), // prochain identifiant de piste
      ),
      trakVideo,
      ...trakAudio,
    );
  };

  /*
   * Deux passes, et c'est tout ce que coûte le faststart : la première apprend la
   * **longueur** de `moov` — qui ne dépend pas des décalages qu'il contient, un `stco`
   * occupe quatre octets quelle que soit sa valeur —, la seconde y écrit les vrais
   * décalages, maintenant connus.
   */
  const moov = construireMoov(ftyp.length + construireMoov(0).length + 8);

  const fichier = new Uint8Array(ftyp.length + moov.length + mdat.length);
  fichier.set(ftyp, 0);
  fichier.set(moov, ftyp.length);
  fichier.set(mdat, ftyp.length + moov.length);
  return fichier;
}
