import type { CallState } from "@tacita/calls";
import { RtcFociMissingError } from "@tacita/calls";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BandeauAppel } from "../components/appel/BandeauAppel";
import { BoutonAppelAmi, BoutonsAppel, cheminAppel } from "../components/appel/BoutonsAppel";
import { DELAI_CHARGEMENT_MS, EcranAppel } from "../components/appel/EcranAppel";
import { SessionProvider } from "../components/onboarding/SessionProvider";
import { sansCommentaires, sourcesLivrees } from "./sources";

const pousser = vi.fn();
const revenir = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/c/!dm:t",
  useRouter: () => ({ push: pousser, back: revenir }),
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * Le paquet 10 est mocké à son interface (spec 11) : le shard ne compose aucun appel,
 * il monte un conteneur et transmet des paramètres. `RtcFociMissingError` est définie
 * ici parce que le composant fait un `instanceof` dessus — un faux type ne prouverait
 * pas le chemin d'erreur que REQ-UI-19 exige.
 */
const decouvrir = vi.fn<() => Promise<unknown>>();
const construire = vi.fn();
const accrocher = vi.fn(() => detacher);
const detacher = vi.fn();
const raccrocher = vi.fn(async () => {});
const etatAppel = vi.fn<() => CallState>(() => ({ status: "idle", participants: [] }));
let publier: ((etat: CallState) => void) | undefined;

vi.mock("@tacita/calls", () => {
  class ErreurFocus extends Error {
    constructor(readonly reason: string) {
      super(`aucun focus MatrixRTC utilisable : ${reason}`);
      this.name = "RtcFociMissingError";
    }
  }
  return {
    RtcFociMissingError: ErreurFocus,
    discoverFocus: () => decouvrir(),
    buildCallWidget: (...args: unknown[]) => construire(...(args as [])),
    attachCallWidget: (...args: unknown[]) => accrocher(...(args as [])),
    hangupLocal: () => raccrocher(),
    activeCall: () => ({
      current: () => etatAppel(),
      subscribe: (ecouteur: (etat: CallState) => void) => {
        publier = ecouteur;
        return () => {
          publier = undefined;
        };
      },
      stop: vi.fn(),
    }),
  };
});

const ouvrirDm = vi.fn(async () => "!dm:t");
vi.mock("@tacita/messaging", () => ({
  openDirectMessage: (...args: unknown[]) => ouvrirDm(...(args as [])),
}));

const restoreSession = vi.fn();
vi.mock("@tacita/client-core", async (original) => ({
  ...(await original<typeof import("@tacita/client-core")>()),
  initSession: vi.fn(),
  restoreSession: () => restoreSession(),
}));

const session = () =>
  ({
    client: {
      baseUrl: "https://chat.tacita.test",
      getUserId: () => "@luca:t",
      getDeviceId: () => "DEVICE1",
    },
    recoveryRequired: async () => false,
  }) as never;

const rendre = (noeud: React.ReactNode) =>
  render(
    <SessionProvider homeserverUrl="https://chat.tacita.test" rediriger={vi.fn()}>
      {noeud}
    </SessionProvider>,
  );

const WIDGET = { url: "https://call.tacita.test/room#?roomId=!dm:t", params: { widgetId: "w1" } };

beforeEach(() => {
  restoreSession.mockResolvedValue(session());
  decouvrir.mockResolvedValue({ type: "livekit" });
  construire.mockReturnValue(WIDGET);
  etatAppel.mockReturnValue({ status: "idle", participants: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("REQ-UI-19 — appel audio / vidéo, bandeau, et jamais de bouton inerte", () => {
  it("les deux boutons du header mènent à l'écran d'appel, chacun avec son point d'entrée", () => {
    render(<BoutonsAppel roomId="!dm:t" />);

    fireEvent.click(screen.getByRole("button", { name: "Appel audio" }));
    expect(pousser).toHaveBeenCalledWith("/c/!dm:t/appel?media=audio");

    fireEvent.click(screen.getByRole("button", { name: "Appel vidéo" }));
    expect(pousser).toHaveBeenCalledWith("/c/!dm:t/appel?media=video");
  });

  it("RtcFociMissing rend un message qui dit la cause, avec une issue", async () => {
    decouvrir.mockRejectedValue(new RtcFociMissingError("well-known-absent" as never));
    rendre(<EcranAppel roomId="!dm:t" media="video" />);

    // REQ-CAL-02 : la cause, pas « une erreur est survenue » — et surtout pas un écran
    // noir sur lequel l'utilisateur attendrait un appel qui ne viendra jamais.
    expect(await screen.findByText(/n'annonce aucun service d'appel/)).toBeTruthy();
    expect(screen.queryByTitle("Appel")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Revenir à la conversation" }));
    expect(revenir).toHaveBeenCalled();
  });

  it("chaque panne de focus a son propre message", async () => {
    for (const [raison, motif] of [
      ["well-known-unreachable", /serveur n'a pas répondu/],
      ["no-livekit-focus", /n'est pas pris en charge/],
    ] as const) {
      decouvrir.mockRejectedValue(new RtcFociMissingError(raison as never));
      rendre(<EcranAppel roomId="!dm:t" media="video" />);
      expect(await screen.findByText(motif)).toBeTruthy();
      cleanup();
    }
  });

  it("un appel en cours affiche le bandeau, et « rejoindre » reprend le même chemin", async () => {
    etatAppel.mockReturnValue({ status: "active", participants: ["_@ana:t_D2_m.call"] });
    render(<BandeauAppel session={session()} roomId="!dm:t" />);

    expect(await screen.findByText("Appel en cours")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Rejoindre" }));
    expect(pousser).toHaveBeenCalledWith(cheminAppel("!dm:t", "video", true));
  });

  it("le bandeau suit l'état du paquet, il ne le mémorise pas", async () => {
    etatAppel.mockReturnValue({ status: "active", participants: ["_@ana:t_D2_m.call"] });
    render(<BandeauAppel session={session()} roomId="!dm:t" />);
    await screen.findByText("Appel en cours");

    // REQ-CAL-03 : l'appel se termine, le bandeau disparaît. Un bandeau qui survit à
    // son appel envoie rejoindre une salle vide.
    publier?.({ status: "ended", participants: [] });
    await waitFor(() => expect(screen.queryByText("Appel en cours")).toBeNull());
  });
});

describe("REQ-UIX-38 — shell d'appel minimal : conteneur, paramètres, sortie de secours", () => {
  it("ne rend que l'iframe, avec les seules permissions d'un appel", async () => {
    rendre(<EcranAppel roomId="!dm:t" media="video" />);

    const iframe = await screen.findByTitle("Appel");
    expect(iframe.getAttribute("src")).toBe(WIDGET.url);
    expect(iframe.getAttribute("allow")).toBe("camera; microphone; fullscreen");
  });

  it("passe le point d'entrée audio ou vidéo au widget, et la reprise d'un appel", async () => {
    rendre(<EcranAppel roomId="!dm:t" media="audio" />);
    await waitFor(() => expect(construire).toHaveBeenCalled());
    expect(construire.mock.calls[0]![2]).toMatchObject({ media: "audio", join: false });

    cleanup();
    construire.mockClear();
    rendre(<EcranAppel roomId="!dm:t" media="video" rejoindre />);
    await waitFor(() => expect(construire).toHaveBeenCalled());
    expect(construire.mock.calls[0]![2]).toMatchObject({ media: "video", join: true });
  });

  it("le widget qui ne charge pas donne un message et une sortie, pas un écran noir", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    rendre(<EcranAppel roomId="!dm:t" media="video" />);
    await screen.findByTitle("Appel");

    expect(screen.queryByRole("button", { name: "Revenir à la conversation" })).toBeNull();
    await vi.advanceTimersByTimeAsync(DELAI_CHARGEMENT_MS + 1);

    expect(await screen.findByText(/ne s'ouvre pas/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Revenir à la conversation" }));
    expect(revenir).toHaveBeenCalled();
  });

  it("l'iframe chargée à temps ne déclenche aucun message d'échec", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    rendre(<EcranAppel roomId="!dm:t" media="video" />);

    fireEvent.load(await screen.findByTitle("Appel"));
    await vi.advanceTimersByTimeAsync(DELAI_CHARGEMENT_MS + 1);

    expect(screen.queryByText(/ne s'ouvre pas/)).toBeNull();
  });

  it("la sortie de secours existe dès le premier instant", async () => {
    rendre(<EcranAppel roomId="!dm:t" media="video" />);

    // Un widget qui s'affiche mais ne répond plus enferme autant qu'un widget absent.
    fireEvent.click(await screen.findByRole("button", { name: "Quitter l'appel" }));
    expect(revenir).toHaveBeenCalled();
  });

  it("quitter l'écran décroche le widget et vide notre appartenance", async () => {
    const { unmount } = rendre(<EcranAppel roomId="!dm:t" media="video" />);
    await waitFor(() => expect(accrocher).toHaveBeenCalled());

    unmount();
    // Sans les deux, le salon reste « en appel » pour les autres et l'API widget parle
    // encore à une iframe démontée.
    expect(detacher).toHaveBeenCalled();
    await waitFor(() => expect(raccrocher).toHaveBeenCalled());
  });

  it("le shard ne rend aucune commande d'appel : elles sont à Element Call (E-07)", () => {
    const source = sansCommentaires(
      sourcesLivrees().find((fichier) => fichier.chemin.endsWith("/appel/EcranAppel.tsx"))!.code,
    );

    // Interdit n°7 : ni bascule voix↔vidéo, ni couper le micro, ni layout de vignettes.
    // Ce sont des comportements internes au widget ; les imiter serait un client maison.
    for (const commande of [/couper le micro/i, /caméra/i, /partager l'écran/i, /getUserMedia/]) {
      expect(source).not.toMatch(commande);
    }
  });
});

describe("REQ-UIX-39 — « Appel audio » d'un profil : le même chemin que le header 1:1", () => {
  it("résout le DM puis part sur le chemin d'appel commun", async () => {
    rendre(<BoutonAppelAmi userId="@ana:t" />);

    fireEvent.click(await screen.findByRole("button", { name: "Appel audio" }));

    await waitFor(() => expect(ouvrirDm).toHaveBeenCalledWith(expect.anything(), "@ana:t"));
    // Le même chemin, au sens strict : la valeur vient de `cheminAppel`, pas d'une URL
    // recopiée qui divergerait au premier paramètre ajouté.
    await waitFor(() => expect(pousser).toHaveBeenCalledWith(cheminAppel("!dm:t", "audio")));
  });
});
