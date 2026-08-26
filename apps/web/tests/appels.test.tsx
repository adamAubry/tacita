import type { Session } from "@tacita/client-core";
import { asSession } from "@tacita/client-core/testing";
import type { CallState } from "@tacita/calls";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BandeauAppel } from "../components/appels/BandeauAppel";
import { EcranAppel, DELAI_CHARGEMENT_MS } from "../components/appels/EcranAppel";
import { SessionProvider } from "../components/onboarding/SessionProvider";
import { routeAppel } from "../lib/routes";
import { sansCommentaires, sourcesLivrees } from "./sources";

const SALON = "!salon:tacita.test";

const pousser = vi.fn();
const revenir = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/c/!salon:tacita.test",
  useRouter: () => ({ push: pousser, back: revenir }),
  useSearchParams: () => new URLSearchParams(),
}));

const restoreSession = vi.fn<() => Promise<Session | null>>();
vi.mock("@tacita/client-core", async (original) => ({
  ...(await original<typeof import("@tacita/client-core")>()),
  initSession: vi.fn(),
  restoreSession: () => restoreSession(),
}));

/**
 * Le paquet 10 est mocké à son interface (objectif mesurable de M-I) : l'appel réel est
 * prouvé par sa propre suite, celle-ci ne prouve que le shell.
 */
const decouvrir = vi.fn<() => Promise<unknown>>();
const debrancher = vi.fn();
/** Le signal « Element Call nous a parlé », que le test déclenche quand il le décide. */
let widgetPret: (() => void) | undefined;
const brancher = vi.fn((..._args: unknown[]) => {
  widgetPret = _args[4] as (() => void) | undefined;
  return debrancher;
});
const raccrocher = vi.fn(async () => {});
let etatAppel: CallState = { status: "idle", participants: [] };
let notifier: ((etat: CallState) => void) | undefined;

vi.mock("@tacita/calls", () => ({
  RtcFociMissingError: class extends Error {
    constructor(readonly reason: string) {
      super(reason);
    }
  },
  discoverFocus: () => decouvrir(),
  buildCallWidget: (_s: unknown, roomId: string, options: { video?: boolean; widgetId: string }) => ({
    params: {},
    url: `https://call.test/room#?roomId=${roomId}&video=${String(options.video ?? false)}&widgetId=${options.widgetId}`,
  }),
  attachCallWidget: (...args: unknown[]) => brancher(...(args as [])),
  hangupLocal: () => raccrocher(),
  activeCall: () => ({
    current: () => etatAppel,
    subscribe: (listener: (etat: CallState) => void) => {
      notifier = listener;
      return () => {
        notifier = undefined;
      };
    },
    stop: vi.fn(),
  }),
}));

const rendreAvecSession = (noeud: React.ReactNode) =>
  render(
    <SessionProvider homeserverUrl="https://chat.tacita.test">
      {noeud}
    </SessionProvider>,
  );

beforeEach(() => {
  etatAppel = { status: "idle", participants: [] };
  notifier = undefined;
  // Sans cette remise à zéro, un test attendrait le signal du test précédent — dont le
  // composant est démonté, donc dont le rappel ne fait plus rien.
  widgetPret = undefined;
  decouvrir.mockResolvedValue({ type: "livekit", livekit_service_url: "https://sfu.test" });
  restoreSession.mockResolvedValue(
    asSession({
      client: {
        getUserId: () => "@luca:t",
        getDeviceId: () => "D1",
        baseUrl: "https://chat.tacita.test",
        on: vi.fn(),
        off: vi.fn(),
      },
      recoveryState: async () => "prete" as const,
    } as never),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("appel voix/vidéo, bandeau d'appel en cours, erreur explicite", () => {
  it("monte le widget Element Call avec les seules permissions nécessaires", async () => {
    rendreAvecSession(<EcranAppel roomId={SALON} video={false} />);

    const cadre = (await screen.findByTitle("Appel")) as HTMLIFrameElement;
    // La contrainte de M-I, mot pour mot : caméra, micro, plein écran, rien d'autre.
    expect(cadre.getAttribute("allow")).toBe("camera; microphone; fullscreen");
    await waitFor(() => expect(brancher).toHaveBeenCalledOnce());
  });

  it("RtcFociMissing rend la cause, jamais un bouton inerte", async () => {
    const { RtcFociMissingError } = await import("@tacita/calls");
    decouvrir.mockRejectedValue(new RtcFociMissingError("no-livekit-focus" as never));

    rendreAvecSession(<EcranAppel roomId={SALON} video={false} />);

    // La cause est nommée : « pas de service d'appel » ≠ « réseau injoignable ».
    expect(await screen.findByText(/pas de service d'appel/)).toBeTruthy();
    expect(screen.queryByTitle("Appel")).toBeNull();
    expect(screen.getByRole("button", { name: "Retour" })).toBeTruthy();
  });

  it("distingue un serveur injoignable d'un serveur sans service d'appel", async () => {
    const { RtcFociMissingError } = await import("@tacita/calls");
    decouvrir.mockRejectedValue(new RtcFociMissingError("well-known-unreachable" as never));

    rendreAvecSession(<EcranAppel roomId={SALON} video={false} />);
    expect(await screen.findByText(/n'a pas répondu/)).toBeTruthy();
  });

  it("un appel actif dans le salon affiche le bandeau et mène à l'écran d'appel", async () => {
    etatAppel = { status: "active", participants: ["_@ana:t_D2_m.call"] };
    rendreAvecSession(<BandeauAppel roomId={SALON} />);

    expect(await screen.findByText("Appel en cours")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Rejoindre" }));
    expect(pousser).toHaveBeenCalledWith(routeAppel(SALON));
  });

  it("le bandeau n'existe pas sans appel, et disparaît quand il se termine", async () => {
    rendreAvecSession(<BandeauAppel roomId={SALON} />);
    await waitFor(() => expect(notifier).toBeDefined());
    expect(screen.queryByText("Appel en cours")).toBeNull();

    etatAppel = { status: "active", participants: ["_@ana:t_D2_m.call", "_@mira:t_D3_m.call"] };
    notifier!(etatAppel);
    expect(await screen.findByText("Appel en cours")).toBeTruthy();
    expect(screen.getByText("2 personnes y participent.")).toBeTruthy();

    etatAppel = { status: "ended", participants: [] };
    notifier!(etatAppel);
    await waitFor(() => expect(screen.queryByText("Appel en cours")).toBeNull());
  });
});

describe("shell minimal : conteneur, sortie de secours, paramètres de lancement", () => {
  it("passe le paramètre du point d'entrée, audio par défaut", async () => {
    const { rerender } = rendreAvecSession(<EcranAppel roomId={SALON} video={false} />);
    const audio = (await screen.findByTitle("Appel")) as HTMLIFrameElement;
    expect(audio.src).toContain("video=false");

    rerender(
      <SessionProvider homeserverUrl="https://chat.tacita.test">
        <EcranAppel roomId={SALON} video />
      </SessionProvider>,
    );
    await waitFor(() =>
      expect((screen.getByTitle("Appel") as HTMLIFrameElement).src).toContain("video=true"),
    );

    // Le pont postMessage reçoit la même option : l'URL de l'iframe et celle du widget
    // doivent coïncider, sinon l'origine attendue n'est pas celle de l'iframe.
    expect(brancher.mock.calls.at(-1)?.[3]).toMatchObject({ video: true });
  });

  it("le widget qui ne charge pas laisse un message et une sortie, jamais un écran mort", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    rendreAvecSession(<EcranAppel roomId={SALON} video={false} />);
    await screen.findByTitle("Appel");

    // Avant le délai : le widget a encore sa chance, et la sortie de secours est là.
    expect(screen.getByRole("button", { name: "Quitter" })).toBeTruthy();

    await vi.advanceTimersByTimeAsync(DELAI_CHARGEMENT_MS + 1);

    expect(await screen.findByText("Appel impossible")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retour" }));
    expect(revenir).toHaveBeenCalledOnce();
  });

  it("la sortie de secours s'efface dès qu'Element Call répond", async () => {
    rendreAvecSession(<EcranAppel roomId={SALON} video={false} />);
    await waitFor(() => expect(widgetPret).toBeDefined());
    expect(screen.getByRole("button", { name: "Quitter" })).toBeTruthy();

    // E-07 : le raccrochage appartient au widget. Deux sorties concurrentes, non.
    act(() => widgetPret!());
    await waitFor(() => expect(screen.queryByRole("button", { name: "Quitter" })).toBeNull());
  });

  it("un widget qui a répondu ne déclenche pas le message d'échec", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    rendreAvecSession(<EcranAppel roomId={SALON} video={false} />);
    await waitFor(() => expect(widgetPret).toBeDefined());
    act(() => widgetPret!());

    await vi.advanceTimersByTimeAsync(DELAI_CHARGEMENT_MS + 1);
    expect(screen.queryByText("Appel impossible")).toBeNull();
    expect(screen.getByTitle("Appel")).toBeTruthy();
  });

  it("quitter l'écran retire notre appartenance : le salon ne reste pas en appel", async () => {
    const { unmount } = rendreAvecSession(<EcranAppel roomId={SALON} video={false} />);
    await waitFor(() => expect(brancher).toHaveBeenCalled());

    unmount();
    expect(debrancher).toHaveBeenCalled();
    expect(raccrocher).toHaveBeenCalled();
  });
});

describe("l'appel des Friends interaction buttons prend le même chemin", () => {
  it("la route d'appel est construite à un seul endroit, jamais recopiée", () => {
    // « Même chemin que le header 1:1 » n'est tenable que si c'est le même code : trois
    // gabarits d'URL recopiés divergent au premier changement de route, et personne ne
    // le voit — les trois écrans continuent d'ouvrir *une* page d'appel, deux la bonne.
    const recopies = sourcesLivrees()
      .filter(({ chemin }) => !chemin.endsWith("/lib/routes.ts"))
      // Un gabarit de route d'appel : `/c/appel`. Les imports de `lib/routes` n'en
      // sont pas — ils ne portent pas le chemin en dur.
      .filter(({ code }) => /["'`]\/c\/appel/.test(sansCommentaires(code)))
      .map(({ chemin }) => chemin);

    expect(recopies).toEqual([]);
  });

  it("le point d'entrée audio ne demande pas la vidéo, le point d'entrée vidéo si", () => {
    expect(routeAppel(SALON)).toBe(`/c/appel?room=${encodeURIComponent(SALON)}`);
    expect(routeAppel(SALON, true)).toBe(`/c/appel?room=${encodeURIComponent(SALON)}&video=1`);
    // Un `!salon:serveur` non encodé couperait la route sur son `/`.
    expect(routeAppel(SALON)).not.toContain("!salon:tacita.test");
  });
});
