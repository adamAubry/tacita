import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Session } from "@tacita/client-core";

import {
  decryptAttachment,
  detectProfile,
  downloadAttachment,
  encryptAttachment,
  MediaIntegrityError,
  saveOriginal,
  uploadAttachment,
  waveform,
  type AttachmentContent,
  type EncryptedFile,
  type MediaEnvironment,
} from "../src/index";

const MXC = "mxc://tacita.test/blob";
const bytes = (text: string) => new TextEncoder().encode(text);

function fakeEnv(overrides: Partial<MediaEnvironment> = {}) {
  return {
    subtle: globalThis.crypto.subtle,
    getRandomValues: (target: Uint8Array) => void globalThis.crypto.getRandomValues(target),
    resizeImage: vi.fn(async (_blob: Blob, targets: { maxEdge: number; quality: number }) => ({
      blob: new Blob([`image ${targets.maxEdge}@${targets.quality}`]),
      width: targets.maxEdge,
      height: Math.round(targets.maxEdge / 2),
    })),
    transcodeVideo: vi.fn(async (_blob: Blob, targets: { height: number; bitrate: number }) => ({
      blob: new Blob([`video ${targets.height}@${targets.bitrate}`]),
      width: targets.height * 2,
      height: targets.height,
      durationMs: 4200,
    })),
    extractPoster: vi.fn(async () => new Blob(["poster"])),
    transcodeAudio: vi.fn(async () => new Blob(["ogg opus"], { type: "audio/ogg" })),
    decodeAudio: vi.fn(async () => ({
      samples: Float32Array.from({ length: 600 }, (_u, i) => Math.sin(i) / 2),
      durationMs: 3000,
    })),
    saveViaDownload: vi.fn(async () => {}),
    ...overrides,
  } satisfies MediaEnvironment;
}

function fakeSession() {
  return {
    client: {
      uploadContent: vi.fn(async (_blob: Blob, _opts: unknown) => ({ content_uri: MXC })),
      mxcUrlToHttp: vi.fn(
        (
          _mxc: string,
          _w?: number,
          _h?: number,
          _method?: string,
          _direct?: boolean,
          _redirects?: boolean,
          _authenticated?: boolean,
        ): string | null => "https://tacita.test/_matrix/client/v1/media/download/tacita.test/blob",
      ),
      getAccessToken: () => "syt_token",
    },
  };
}

let env: ReturnType<typeof fakeEnv>;
let fake: ReturnType<typeof fakeSession>;
let session: Session;

beforeEach(() => {
  vi.unstubAllGlobals();
  env = fakeEnv();
  fake = fakeSession();
  session = fake as unknown as Session;
});

/** L'erreur d'une promesse qui doit échouer. */
const rejection = (promise: Promise<unknown>): Promise<Error> =>
  promise.then(
    () => {
      throw new Error("la promesse aurait dû échouer");
    },
    (caught: unknown) => caught as Error,
  );

/** Les octets réellement remis au serveur lors du n-ième upload. */
async function uploadedBytes(index: number): Promise<Uint8Array> {
  const [blob] = fake.client.uploadContent.mock.calls[index]!;
  return new Uint8Array(await blob.arrayBuffer());
}

describe("REQ-MED-01 — chiffrement client AES-CTR, schéma EncryptedFile", () => {
  it("produit un blob opaque et des clés au format v2", async () => {
    const clear = bytes("photo de vacances");
    const { ciphertext, keys } = await encryptAttachment(clear, env);

    expect(ciphertext).not.toEqual(clear);
    expect(keys.v).toBe("v2");
    expect(keys.key.alg).toBe("A256CTR");
    expect(keys.key.kty).toBe("oct");
    expect(keys.hashes.sha256).toBeTruthy();

    // Le compteur AES-CTR occupe les 8 octets de poids faible : ils démarrent à zéro.
    const iv = Uint8Array.from(atob(keys.iv), (char) => char.charCodeAt(0));
    expect(iv).toHaveLength(16);
    expect([...iv.subarray(8)]).toEqual(Array<number>(8).fill(0));
  });

  it("ne remet au serveur que du chiffré, jamais le clair", async () => {
    const file = new File([bytes("contrat.pdf en clair")], "contrat.pdf", {
      type: "application/pdf",
    });
    await uploadAttachment(session, env, file);

    const sent = await uploadedBytes(0);
    expect(new TextDecoder().decode(sent)).not.toContain("en clair");
    const [, opts] = fake.client.uploadContent.mock.calls[0]!;
    // Le nom du fichier fuiterait le contenu : il reste dans l'événement chiffré.
    expect(opts).toMatchObject({ includeFilename: false, type: "application/octet-stream" });
  });
});

describe("REQ-MED-02 — un seul pipeline pour tous les types de fichiers", () => {
  it("fait passer un PDF et une image par la même fonction d'upload", async () => {
    const pdf = new File([bytes("%PDF-1.7")], "notice.pdf", { type: "application/pdf" });
    const image = new File([bytes("\xFF\xD8\xFF")], "chat.jpg", { type: "image/jpeg" });

    const pdfContent = await uploadAttachment(session, env, pdf);
    const uploadsAfterPdf = fake.client.uploadContent.mock.calls.length;
    const imageContent = await uploadAttachment(session, env, image);

    expect(pdfContent.msgtype).toBe("m.file");
    expect(imageContent.msgtype).toBe("m.image");
    // Aucun canal parallèle : les deux ont emprunté le même `uploadContent`.
    expect(uploadsAfterPdf).toBe(1);
    expect(fake.client.uploadContent.mock.calls.length).toBeGreaterThan(uploadsAfterPdf);
    for (const [, opts] of fake.client.uploadContent.mock.calls) {
      expect(opts).toMatchObject({ includeFilename: false, type: "application/octet-stream" });
    }
    // Le PDF n'est pas compressé, mais il est chiffré comme le reste.
    expect(env.resizeImage).toHaveBeenCalledTimes(2); // image + sa vignette
    expect(pdfContent.file.hashes.sha256).toBeTruthy();
  });
});

describe("REQ-MED-03 — vignettes générées côté client, chiffrées séparément", () => {
  it("téléverse deux blobs aux clés distinctes et n'interroge jamais le serveur", async () => {
    const image = new File([bytes("jpeg")], "chat.jpg", { type: "image/jpeg" });
    const content = await uploadAttachment(session, env, image);

    expect(fake.client.uploadContent).toHaveBeenCalledTimes(2);
    const thumbnail = content.info.thumbnail_file as EncryptedFile;
    expect(thumbnail.key.k).not.toBe(content.file.key.k);
    expect(thumbnail.iv).not.toBe(content.file.iv);
    // `/thumbnail` côté serveur est exclu : il ne sait pas déchiffrer le blob.
    expect(fake.client.mxcUrlToHttp).not.toHaveBeenCalled();
  });

  it("dérive la vignette d'une image extraite de la vidéo", async () => {
    const video = new File([bytes("mp4")], "clip.mp4", { type: "video/mp4" });
    await uploadAttachment(session, env, video);

    expect(env.extractPoster).toHaveBeenCalledTimes(1);
    expect(env.resizeImage).toHaveBeenCalledTimes(1);
  });
});

describe("REQ-MED-04 — compression adaptative, seuils D-04", () => {
  it("applique les cibles du profil contraint quand le réseau l'est", async () => {
    env = fakeEnv({ connection: { effectiveType: "3g" } });
    await uploadAttachment(session, env, new File([bytes("x")], "a.jpg", { type: "image/jpeg" }));
    expect(env.resizeImage).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ maxEdge: 1280, quality: 0.7 }),
    );

    env = fakeEnv({ connection: { effectiveType: "3g" } });
    await uploadAttachment(session, env, new File([bytes("x")], "a.mp4", { type: "video/mp4" }));
    expect(env.transcodeVideo).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ height: 480, bitrate: 1_000_000, mimeType: "video/mp4" }),
    );
  });

  it("applique les cibles « bon réseau » sinon", async () => {
    await uploadAttachment(session, env, new File([bytes("x")], "a.jpg", { type: "image/jpeg" }));
    expect(env.resizeImage).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ maxEdge: 2048, quality: 0.8 }),
    );

    env = fakeEnv();
    await uploadAttachment(session, env, new File([bytes("x")], "a.mp4", { type: "video/mp4" }));
    expect(env.transcodeVideo).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ height: 720, bitrate: 2_500_000 }),
    );
  });

  it("retombe sur « bon réseau » quand l'API est absente, et suit saveData", () => {
    expect(detectProfile(undefined)).toBe("good");
    expect(detectProfile({ effectiveType: "4g" })).toBe("good");
    expect(detectProfile({ effectiveType: "2g" })).toBe("constrained");
    expect(detectProfile({ effectiveType: "4g", saveData: true })).toBe("constrained");
  });
});

describe("REQ-MED-05 — original non compressé conservé sur l'appareil de l'auteur", () => {
  it("préfère le sélecteur de fichiers, retombe sur le téléchargement", async () => {
    const original = new Blob([bytes("raw sensor data")]);

    await saveOriginal(env, original, "IMG_0001.heic");
    expect(env.saveViaDownload).toHaveBeenCalledWith(original, "IMG_0001.heic");

    const withPicker = fakeEnv({ saveViaFilePicker: vi.fn(async () => {}) });
    await saveOriginal(withPicker, original, "IMG_0001.heic");
    expect(withPicker.saveViaFilePicker).toHaveBeenCalledWith(original, "IMG_0001.heic");
    expect(withPicker.saveViaDownload).not.toHaveBeenCalled();

    // L'adaptateur a le droit de s'appuyer sur son `this` : la méthode ne doit pas être
    // détachée de `env` avant d'être appelée.
    const stateful = {
      ...fakeEnv(),
      saved: [] as string[],
      async saveViaFilePicker(_blob: Blob, filename: string) {
        this.saved.push(filename);
      },
    };
    await saveOriginal(stateful, original, "IMG_0002.heic");
    expect(stateful.saved).toEqual(["IMG_0002.heic"]);
  });

  it("reste hors du chemin d'envoi : le destinataire n'a que la version compressée", async () => {
    const image = new File([bytes("original 48 Mpx")], "chat.jpg", { type: "image/jpeg" });
    await uploadAttachment(session, env, image);

    expect(env.saveViaDownload).not.toHaveBeenCalled();
    expect(new TextDecoder().decode(await uploadedBytes(0))).not.toContain("original");
  });
});

describe("REQ-MED-06 — vocaux m.audio avec forme d'onde et durée", () => {
  it("porte la durée et une forme d'onde MSC1767 dans le contenu", async () => {
    const voice = new File([bytes("ogg")], "vocal.ogg", { type: "audio/ogg" });
    const content = await uploadAttachment(session, env, voice);

    expect(content.msgtype).toBe("m.audio");
    expect(content.info.mimetype).toBe("audio/ogg");
    expect(content.info.duration).toBe(3000);
    const audio = content["org.matrix.msc1767.audio"]!;
    expect(audio.duration).toBe(3000);
    expect(audio.waveform).toHaveLength(60);
    expect(Math.max(...audio.waveform)).toBeLessThanOrEqual(1024);
    expect(Math.min(...audio.waveform)).toBeGreaterThanOrEqual(0);
  });

  it("ramène chaque tranche à son pic sur l'échelle 0–1024", () => {
    expect(waveform(Float32Array.from([0, 0, 1, 0.5]), 2)).toEqual([0, 1024]);
  });
});

describe("REQ-MED-07 — transcodage vers Ogg/Opus quand l'entrée n'en est pas", () => {
  it("transcode une capture Safari iOS en MP4/AAC", async () => {
    const aac = new File([bytes("mp4 aac")], "vocal.m4a", { type: "audio/mp4" });
    const content = await uploadAttachment(session, env, aac);

    expect(env.transcodeAudio).toHaveBeenCalledTimes(1);
    // D-03 — format de sortie unique, sans quoi les vocaux iPhone sont illisibles ailleurs.
    expect(content.info.mimetype).toBe("audio/ogg");
  });

  it("laisse passer un Ogg/Opus sans le retranscoder", async () => {
    await uploadAttachment(
      session,
      env,
      new File([bytes("ogg")], "vocal.ogg", { type: "audio/ogg" }),
    );
    expect(env.transcodeAudio).not.toHaveBeenCalled();
  });
});

describe("REQ-MED-08 — vérification du hash puis déchiffrement local", () => {
  it("rend les octets d'origine sur un aller-retour complet", async () => {
    const clear = bytes("les octets exacts, au bit près");
    const { ciphertext, keys } = await encryptAttachment(clear, env);

    expect(await decryptAttachment(ciphertext, keys, env.subtle)).toEqual(clear);
  });

  it("accepte une empreinte paddée : la spec dit non paddé, les clients font ce qu'ils veulent", async () => {
    const clear = bytes("média venu d'un autre client");
    const { ciphertext, keys } = await encryptAttachment(clear, env);
    const padded = { ...keys, hashes: { sha256: `${keys.hashes.sha256}==` } };

    expect(await decryptAttachment(ciphertext, padded, env.subtle)).toEqual(clear);
  });

  it("rejette un blob altéré avant toute tentative de déchiffrement", async () => {
    const { ciphertext, keys } = await encryptAttachment(bytes("intact"), env);
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 0xff;

    await expect(decryptAttachment(ciphertext, keys, env.subtle)).rejects.toBeInstanceOf(
      MediaIntegrityError,
    );
  });
});

describe("REQ-MED-09 — média authentifié, aucune URL publique supposée", () => {
  it("passe par l'endpoint authentifié avec le jeton en en-tête", async () => {
    const clear = bytes("blob chiffré");
    const { ciphertext, keys } = await encryptAttachment(clear, env);
    const fetchStub = vi.fn(async () => new Response(ciphertext));
    vi.stubGlobal("fetch", fetchStub);

    const file: EncryptedFile = { ...keys, url: MXC };
    expect(await downloadAttachment(session, env, file)).toEqual(clear);

    // Dernier argument : `useAuthentication`. Les endpoints v3 répondent 404 (REQ-INF-12).
    expect(fake.client.mxcUrlToHttp).toHaveBeenCalledWith(
      MXC,
      undefined,
      undefined,
      undefined,
      false,
      true,
      true,
    );
    const [url, init] = fetchStub.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain("/_matrix/client/v1/media/download/");
    expect(init.headers).toEqual({ Authorization: "Bearer syt_token" });
  });

  it("échoue explicitement si le serveur refuse le média", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    const { keys } = await encryptAttachment(bytes("x"), env);

    await expect(downloadAttachment(session, env, { ...keys, url: MXC })).rejects.toThrow(
      "HTTP 404",
    );
  });
});

describe("REQ-MED-10 — aucun contenu média ni clé dans les erreurs", () => {
  it("ne laisse fuiter ni clé, ni IV, ni octets dans l'erreur d'intégrité", async () => {
    const { ciphertext, keys } = await encryptAttachment(bytes("secret"), env);
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 0xff;

    const error = await rejection(decryptAttachment(ciphertext, keys, env.subtle));
    const serialised = `${error.message} ${JSON.stringify(error)}`;
    expect(serialised).not.toContain(keys.key.k);
    expect(serialised).not.toContain(keys.iv);
    expect(serialised).not.toContain(keys.hashes.sha256);
  });

  it("n'expose pas l'URL du média dans l'erreur de téléchargement", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 403 })));
    const { keys } = await encryptAttachment(bytes("x"), env);

    const error = await rejection(downloadAttachment(session, env, { ...keys, url: MXC }));
    expect(error.message).not.toContain(MXC);
    expect(error.message).not.toContain("tacita.test");
  });
});

/** Le contenu rendu est directement `enqueue`-able (spec 07) : pas de post-traitement. */
describe("REQ-MED-02 — contenu prêt pour la file d'envoi", () => {
  it("porte msgtype, body et file sans étape supplémentaire", async () => {
    const content: AttachmentContent = await uploadAttachment(
      session,
      env,
      new File([bytes("zip")], "archive.zip", { type: "application/zip" }),
    );

    expect(content.body).toBe("archive.zip");
    expect(content.file.url).toBe(MXC);
    expect(content.info).toMatchObject({ mimetype: "application/zip" });
  });
});
