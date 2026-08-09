import type { Session } from "@tacita/client-core";
import { asSession } from "@tacita/client-core/testing";
import type { Conversation } from "@tacita/messaging";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PushNotifications } from "../components/notifications/PushNotifications";
import { SessionProvider } from "../components/onboarding/SessionProvider";
import { PUSH_CONFIG_URL, PUSH_NOTIFY_URL } from "../lib/config";
import { apercuLocal, TYPE_APERCU } from "../lib/push";
import { lire } from "./sources";
import { routeConversation } from "../lib/routes";

const SALON = "!salon:tacita.test";
const EVENEMENT = "$evt:tacita.test";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const restoreSession = vi.fn<() => Promise<Session | null>>();
vi.mock("@tacita/client-core", async (original) => ({
  ...(await original<typeof import("@tacita/client-core")>()),
  initSession: vi.fn(),
  restoreSession: () => restoreSession(),
}));

/** La timeline que le SDK a déjà déchiffrée pour cette fenêtre. */
let timeline: { id: string; sender: string; body?: string }[] = [];
let salons: Conversation[] = [];
/** L'abonnement de `messaging` : c'est lui qui dit qu'un message est arrivé. */
let notifierSalons: (() => void) | undefined;

vi.mock("@tacita/messaging", () => ({
  messages: () =>
    timeline.map((evenement) => ({
      getId: () => evenement.id,
      getSender: () => evenement.sender,
      getContent: () => (evenement.body === undefined ? {} : { body: evenement.body }),
    })),
  messageText: (evenement: { getContent: () => { body?: string } }) =>
    evenement.getContent().body ?? "",
  mentionCandidates: () => [{ id: "@mira:t", label: "mira" }],
  conversations: () => salons,
  subscribeConversations: (_session: unknown, listener: () => void) => {
    notifierSalons = listener;
    return () => {
      notifierSalons = undefined;
    };
  },
}));

const conversation = (unread: number): Conversation => ({
  roomId: SALON,
  name: "mira",
  direct: true,
  peerId: "@mira:t",
  preview: "",
  timestamp: 0,
  unread,
  mention: false,
  pinned: false,
});

const session = () =>
  asSession({
    client: { getUserId: () => "@luca:t", getDeviceId: () => "D1", on: vi.fn(), off: vi.fn() },
    recoveryRequired: async () => false,
  } as never);

/** Le service worker vu depuis la fenêtre : un simple bus de messages. */
function faireServiceWorker() {
  const ecouteurs = new Set<(evenement: MessageEvent) => void>();
  return {
    ecouteurs,
    addEventListener: (_type: string, ecouteur: (evenement: MessageEvent) => void) =>
      void ecouteurs.add(ecouteur),
    removeEventListener: (_type: string, ecouteur: (evenement: MessageEvent) => void) =>
      void ecouteurs.delete(ecouteur),
    ready: Promise.resolve({}),
  };
}

let serviceWorker: ReturnType<typeof faireServiceWorker>;

beforeEach(() => {
  timeline = [{ id: EVENEMENT, sender: "@mira:t", body: "on se voit demain ?" }];
  salons = [conversation(0)];
  notifierSalons = undefined;
  serviceWorker = faireServiceWorker();
  Object.defineProperty(globalThis.navigator, "serviceWorker", {
    value: serviceWorker,
    configurable: true,
  });
  restoreSession.mockResolvedValue(session());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("REQ-UI-18 — abonnement Web Push, réveil, déchiffrement local, notification", () => {
  it("rend l'aperçu déchiffré localement à partir du seul couple {event_id, room_id}", () => {
    // C'est tout ce que la passerelle a le droit d'envoyer (REQ-PSH-02) — le reste se
    // lit dans la timeline déjà déchiffrée par cette fenêtre.
    expect(apercuLocal(session(), SALON, EVENEMENT)).toEqual({
      expediteur: "mira",
      texte: "on se voit demain ?",
    });
  });

  it("répond au service worker qui demande l'aperçu d'un événement", async () => {
    render(
      <SessionProvider homeserverUrl="https://chat.tacita.test" rediriger={vi.fn()}>
        <PushNotifications />
      </SessionProvider>,
    );
    await waitFor(() => expect(serviceWorker.ecouteurs.size).toBe(1));

    const reponses: unknown[] = [];
    const evenement = {
      data: { type: TYPE_APERCU, roomId: SALON, eventId: EVENEMENT },
      ports: [{ postMessage: (valeur: unknown) => reponses.push(valeur) }],
    } as unknown as MessageEvent;

    for (const ecouteur of serviceWorker.ecouteurs) ecouteur(evenement);
    expect(reponses).toEqual([{ expediteur: "mira", texte: "on se voit demain ?" }]);
  });

  it("ne demande jamais la permission au premier lancement — seulement après un message", async () => {
    vi.stubGlobal("Notification", { permission: "default", requestPermission: vi.fn() });

    render(
      <SessionProvider homeserverUrl="https://chat.tacita.test" rediriger={vi.fn()}>
        <PushNotifications />
      </SessionProvider>,
    );

    // Session prête, aucun message reçu : rien n'est proposé.
    await waitFor(() => expect(notifierSalons).toBeDefined());
    expect(screen.queryByText(/Être prévenu/)).toBeNull();

    salons = [conversation(1)];
    act(() => notifierSalons!());
    expect(await screen.findByText(/Être prévenu/)).toBeTruthy();
    // Et la demande système passe par un geste, jamais par une invite surgie seule.
    expect(Notification.requestPermission).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Activer les notifications" })).toBeTruthy();
  });

  it("un refus laisse un chemin de rattrapage plutôt qu'un silence", async () => {
    const demander = vi.fn(async () => "denied");
    vi.stubGlobal("Notification", { permission: "default", requestPermission: demander });
    salons = [conversation(1)];

    render(
      <SessionProvider homeserverUrl="https://chat.tacita.test" rediriger={vi.fn()}>
        <PushNotifications />
      </SessionProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Activer les notifications" }));

    expect(await screen.findByText(/Réglages › Notifications/)).toBeTruthy();
    expect(demander).toHaveBeenCalledOnce();
  });
});

/**
 * Le service worker est du JavaScript sans module : il s'évalue avec son `self` et son
 * `caches` fournis. C'est bien **le fichier livré** qui est exercé — un double
 * réimplémenté ici ne prouverait rien de ce qui part en production.
 */
function chargerServiceWorker() {
  const code = lire("public/sw.js");
  const handlers = new Map<string, (evenement: unknown) => void>();
  const notifications: { titre: string; options: Record<string, unknown> }[] = [];
  let fenetres: unknown[] = [];

  const self = {
    addEventListener: (type: string, handler: (evenement: unknown) => void) =>
      void handlers.set(type, handler),
    location: { origin: "https://app.tacita.test" },
    registration: {
      showNotification: (titre: string, options: Record<string, unknown>) => {
        notifications.push({ titre, options });
        return Promise.resolve();
      },
    },
    clients: {
      matchAll: () => Promise.resolve(fenetres),
      openWindow: vi.fn(() => Promise.resolve(null)),
    },
  };

  const caches = { open: vi.fn(), match: vi.fn(), keys: vi.fn(() => Promise.resolve([])) };
  new Function("self", "caches", code)(self, caches);

  return {
    handlers,
    notifications,
    caches,
    fenetresOuvertes: (liste: unknown[]) => (fenetres = liste),
  };
}

/** Une fenêtre qui répond à la demande d'aperçu, ou qui n'y répond pas. */
const fenetreQuiRepond = (reponse: unknown) => ({
  postMessage: (_message: unknown, transfert: MessagePort[]) => {
    if (reponse !== undefined) transfert[0]!.postMessage(reponse);
  },
  focus: () => Promise.resolve({ navigate: vi.fn() }),
});

async function pousser(sw: ReturnType<typeof chargerServiceWorker>, charge: unknown) {
  let attente: Promise<unknown> = Promise.resolve();
  sw.handlers.get("push")!({
    data: { json: () => charge },
    waitUntil: (promesse: Promise<unknown>) => (attente = promesse),
  });
  await attente;
}

describe("REQ-UIX-40 — le service worker n'écrit rien, ne journalise rien, ne devine rien", () => {
  it("construit la notification à partir de l'aperçu rendu par la fenêtre", async () => {
    const sw = chargerServiceWorker();
    sw.fenetresOuvertes([fenetreQuiRepond({ expediteur: "mira", texte: "on se voit demain ?" })]);

    await pousser(sw, { event_id: EVENEMENT, room_id: SALON });

    expect(sw.notifications).toHaveLength(1);
    expect(sw.notifications[0]!.titre).toBe("mira");
    expect(sw.notifications[0]!.options.body).toBe("on se voit demain ?");
    // Groupées par conversation : un salon bavard remplace, il n'empile pas.
    expect(sw.notifications[0]!.options.tag).toBe(SALON);
  });

  it("sans déchiffrement possible, la notification est générique et silencieuse", async () => {
    const sw = chargerServiceWorker();
    // Aucune fenêtre ouverte : les clés Megolm sont hors de portée du service worker.
    sw.fenetresOuvertes([]);

    await pousser(sw, { event_id: EVENEMENT, room_id: SALON });

    expect(sw.notifications[0]!).toEqual({
      titre: "Nouveau message",
      options: { body: "", tag: SALON, data: { roomId: SALON } },
    });
  });

  it("une fenêtre qui ne sait pas déchiffrer donne le même résultat générique", async () => {
    const sw = chargerServiceWorker();
    sw.fenetresOuvertes([fenetreQuiRepond(null)]);

    await pousser(sw, { event_id: EVENEMENT, room_id: SALON });
    expect(sw.notifications[0]!.titre).toBe("Nouveau message");
    expect(sw.notifications[0]!.options.body).toBe("");
  });

  it("aucun contenu n'entre au cache, et aucun journal n'est écrit", async () => {
    const espions = (["log", "info", "warn", "error", "debug"] as const).map((niveau) =>
      vi.spyOn(console, niveau).mockImplementation(() => {}),
    );

    const sw = chargerServiceWorker();
    sw.fenetresOuvertes([fenetreQuiRepond({ expediteur: "mira", texte: "secret" })]);
    await pousser(sw, { event_id: EVENEMENT, room_id: SALON });

    // Interdit n°8 : le réveil push n'a aucun chemin vers le cache — pas une précaution,
    // aucune branche n'y mène.
    expect(sw.caches.open).not.toHaveBeenCalled();
    for (const espion of espions) expect(espion).not.toHaveBeenCalled();
    for (const espion of espions) espion.mockRestore();
  });

  it("le fichier livré ne contient aucun appel de journalisation", () => {
    // Le test ci-dessus prouve le chemin exercé ; celui-ci ferme les autres. Un
    // `console.warn` ajouté demain dans une branche d'erreur porterait un identifiant
    // d'événement dans un journal que personne ne relit avant l'incident.
    expect(lire("public/sw.js")).not.toMatch(/console\./);
  });

  it("un payload sans room_id ne réveille rien", async () => {
    const sw = chargerServiceWorker();
    sw.fenetresOuvertes([fenetreQuiRepond({ expediteur: "mira", texte: "secret" })]);

    // Synapse envoie aussi des notifications de badge seul (spec 03) : rien à afficher.
    await pousser(sw, { event_id: EVENEMENT });
    expect(sw.notifications).toHaveLength(0);
  });

  it("le tap sur la notification ouvre la conversation", async () => {
    const sw = chargerServiceWorker();
    const naviguer = vi.fn();
    sw.fenetresOuvertes([{ focus: () => Promise.resolve({ navigate: naviguer }) }]);

    let attente: Promise<unknown> = Promise.resolve();
    sw.handlers.get("notificationclick")!({
      notification: { close: vi.fn(), data: { roomId: SALON } },
      waitUntil: (promesse: Promise<unknown>) => (attente = promesse),
    });
    await attente;

    // Le service worker ne peut pas importer `lib/routes` : ce test est la seule
    // chose qui garde les deux gabarits alignés. Une notification qui ouvre une
    // route morte ne se voit nulle part ailleurs.
    expect(naviguer).toHaveBeenCalledWith(routeConversation(SALON));
  });
});

describe("REQ-INF-14 — le client vise les adresses que le déploiement expose vraiment", () => {
  // `join` et non `new URL` : sous jsdom, le `URL` global est celui de jsdom, que
  // `node:fs` refuse (« The URL must be of scheme file »). Même lacune que celle déjà
  // documentée dans `tests/sources.ts`.
  const contratInfra = readFileSync(
    join(import.meta.dirname, "../../../infra/README.md"),
    "utf-8",
  );

  /**
   * Trouvé le 07/08/2026 en montant la pile. Le shard visait une origine publique
   * `https://push.example.org`, qui n'existe dans aucun déploiement : la lecture de la
   * clé partait en 404, et le pusher enregistré pointait vers un hôte injoignable — donc
   * aucune notification n'aurait jamais été délivrée. Rien ne l'attrapait, parce que les
   * deux moitiés du contrat vivaient dans deux dépôts de vérité sans lien.
   */
  it("lit la clé VAPID là où le proxy la publie, derrière le homeserver", () => {
    expect(new URL(PUSH_CONFIG_URL).pathname).toBe("/push/config");
    // Et c'est bien ce que l'infra documente, pas une convention inventée ici.
    expect(contratInfra).toContain("/push/config");
  });

  it("enregistre le pusher sur l'adresse interne, jamais une URL publique", () => {
    // `/_matrix/push/v1/notify` n'a aucune authentification : la publier ferait de la
    // passerelle un relais de push ouvert. C'est Synapse qui appelle, depuis le réseau
    // du déploiement — l'adresse est donc interne par construction.
    expect(PUSH_NOTIFY_URL).toContain("/_matrix/push/v1/notify");
    expect(PUSH_NOTIFY_URL).not.toContain("push.example.org");
    expect(contratInfra).toContain(PUSH_NOTIFY_URL);
  });
});
