import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Session } from "@tacita/client-core";
import { asSession } from "@tacita/client-core/testing";

import {
  activeCall,
  buildCallWidget,
  CALL_MEMBER_EVENT_TYPE,
  callMemberStateKey,
  CallWidgetDriver,
  discoverFocus,
  hangupLocal,
  RtcFociMissingError,
  RTC_FOCI_WELL_KNOWN_KEY,
} from "../src/index";

const HOMESERVER = "https://tacita.chat";
const SALON = "!salon:tacita.chat";
const MOI = "@luca:tacita.chat";
const APPAREIL = "DEVICE1";
const FOCUS = { type: "livekit", livekit_service_url: "https://tacita.chat/livekit/jwt" };

const WIDGET = {
  elementCallUrl: "https://call.tacita.chat",
  parentUrl: "https://app.tacita.chat",
  widgetId: "widget-1",
};

/** Un événement d'état réduit à ce que le module en lit. */
function membership(stateKey: string, content: Record<string, unknown>, ts = Date.now()) {
  return {
    getType: () => CALL_MEMBER_EVENT_TYPE,
    getRoomId: () => SALON,
    getStateKey: () => stateKey,
    getContent: () => content,
    getTs: () => ts,
    getEffectiveEvent: () => ({
      type: CALL_MEMBER_EVENT_TYPE,
      sender: MOI,
      event_id: `$${stateKey}`,
      room_id: SALON,
      state_key: stateKey,
      content,
      origin_server_ts: ts,
      unsigned: {},
    }),
  };
}

type Membership = ReturnType<typeof membership>;

function fakeSession(state: Membership[] = []) {
  const handlers = new Set<(event: Membership) => void>();
  const events = [...state];
  return {
    events,
    emit(event: Membership) {
      for (const handler of handlers) handler(event);
    },
    client: {
      baseUrl: HOMESERVER,
      getUserId: () => MOI,
      getDeviceId: () => APPAREIL,
      getRoom: () => ({
        getLiveTimeline: () => ({
          getState: () => ({
            getStateEvents: (_type: string, stateKey?: string) =>
              stateKey === undefined
                ? events
                : (events.find((event) => event.getStateKey() === stateKey) ?? null),
          }),
        }),
      }),
      sendEvent: vi.fn(async () => ({ event_id: "$evt" })),
      sendStateEvent: vi.fn(async () => ({ event_id: "$state" })),
      sendToDevice: vi.fn(async () => ({})),
      encryptAndSendToDevice: vi.fn(async () => {}),
      getOpenIdToken: vi.fn(async () => ({ access_token: "openid_secret", matrix_server_name: "tacita.chat" })),
      getTurnServers: () => [
        { urls: ["turns:tacita.chat:443"], username: "u", credential: "turn_secret" },
      ],
      on: (_event: string, handler: (event: Membership) => void) => void handlers.add(handler),
      off: (_event: string, handler: (event: Membership) => void) => void handlers.delete(handler),
    },
  };
}

let fake: ReturnType<typeof fakeSession>;
let session: Session;

beforeEach(() => {
  vi.unstubAllGlobals();
  fake = fakeSession();
  // Ce paquet ne lit que `client`. `asSession` fournit le reste du contrat en
  // levées nommées : un membre ajouté à `Session` ne manque plus en silence.
  session = asSession({ client: fake.client });
});

const wellKnown = (body: unknown, ok = true) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: ok ? 200 : 404 }));

describe("REQ-CAL-01 — URL Element Call complète et paramétrée", () => {
  it("porte salon, identité et homeserver, sans aucun credential LiveKit", () => {
    const { url, params } = buildCallWidget(session, SALON, WIDGET);

    expect(url.startsWith("https://call.tacita.chat/room#?")).toBe(true);
    const fragment = new URLSearchParams(url.slice(url.indexOf("#?") + 2));
    expect(fragment.get("roomId")).toBe(SALON);
    expect(fragment.get("userId")).toBe(MOI);
    expect(fragment.get("deviceId")).toBe(APPAREIL);
    expect(fragment.get("baseUrl")).toBe(HOMESERVER);
    expect(fragment.get("widgetId")).toBe("widget-1");
    expect(fragment.get("parentUrl")).toBe("https://app.tacita.chat");
    expect(params.perParticipantE2EE).toBe("true");

    // L'autorisation SFU passe par lk-jwt : rien de LiveKit ne peut être en dur ici.
    expect(url).not.toMatch(/secret|api[_-]?key|token/i);
  });

  it("met les paramètres dans le fragment, jamais dans la requête HTTP", () => {
    const { url } = buildCallWidget(session, SALON, WIDGET);
    expect(url.slice(0, url.indexOf("#"))).not.toContain("?");
  });
});

describe("REQ-CAL-02 — découverte des rtc_foci, erreur typée sinon", () => {
  it("rend le focus LiveKit publié par le .well-known", async () => {
    vi.stubGlobal("fetch", wellKnown({ [RTC_FOCI_WELL_KNOWN_KEY]: [FOCUS] }));
    await expect(discoverFocus(HOMESERVER)).resolves.toEqual(FOCUS);
  });

  it("lève RtcFociMissing quand le well-known n'a pas de foci", async () => {
    vi.stubGlobal("fetch", wellKnown({ "m.homeserver": { base_url: HOMESERVER } }));

    const error = await discoverFocus(HOMESERVER).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RtcFociMissingError);
    expect((error as RtcFociMissingError).reason).toBe("well-known-absent");
  });

  it("distingue un well-known injoignable d'un focus non LiveKit", async () => {
    vi.stubGlobal("fetch", wellKnown({}, false));
    await expect(discoverFocus(HOMESERVER)).rejects.toMatchObject({
      reason: "well-known-unreachable",
    });

    vi.stubGlobal("fetch", wellKnown({ [RTC_FOCI_WELL_KNOWN_KEY]: [{ type: "jitsi" }] }));
    await expect(discoverFocus(HOMESERVER)).rejects.toMatchObject({
      reason: "no-livekit-focus",
    });
  });
});

describe("REQ-CAL-03 — détection d'appel en cours par les événements d'état", () => {
  it("passe de idle à active puis ended", () => {
    const call = activeCall(session, SALON);
    const seen: string[] = [];
    call.subscribe((state) => seen.push(state.status));

    expect(call.current().status).toBe("idle");

    const key = callMemberStateKey("@ana:tacita.chat", "D2");
    const joined = membership(key, { application: "m.call", created_ts: Date.now() });
    fake.events.push(joined);
    fake.emit(joined);
    expect(call.current()).toEqual({ status: "active", participants: [key] });

    fake.events.length = 0;
    fake.events.push(membership(key, {}));
    fake.emit(membership(key, {}));
    expect(call.current()).toEqual({ status: "ended", participants: [] });

    expect(seen).toEqual(["active", "ended"]);
  });

  it("ignore une appartenance périmée : un salon ne reste pas en appel pour toujours", () => {
    const key = callMemberStateKey("@ana:tacita.chat", "D2");
    const stale = Date.now() - 5 * 60 * 60 * 1000;
    fake.events.push(membership(key, { created_ts: stale }, stale));

    expect(activeCall(session, SALON).current().status).toBe("idle");
  });

  it("cesse de notifier après stop()", () => {
    const call = activeCall(session, SALON);
    const listener = vi.fn();
    call.subscribe(listener);
    call.stop();

    const key = callMemberStateKey("@ana:tacita.chat", "D2");
    fake.events.push(membership(key, { created_ts: Date.now() }));
    fake.emit(membership(key, { created_ts: Date.now() }));

    expect(listener).not.toHaveBeenCalled();
  });

  it("hangupLocal vide notre propre appartenance", async () => {
    await hangupLocal(session, SALON);
    expect(fake.client.sendStateEvent).toHaveBeenCalledWith(
      SALON,
      CALL_MEMBER_EVENT_TYPE,
      {},
      callMemberStateKey(MOI, APPAREIL),
    );
  });
});

describe("REQ-CAL-04 — littéraux MatrixRTC centralisés dans un seul fichier", () => {
  const srcDir = fileURLToPath(new URL("../src/", import.meta.url));

  it("n'écrit aucun littéral de protocole hors de matrixrtc.ts", () => {
    const literals = [/org\.matrix\.msc\d+/, /livekit_service_url/, /"m\.call"/];
    const offenders = readdirSync(srcDir)
      .filter((name) => name.endsWith(".ts") && name !== "matrixrtc.ts")
      .filter((name) => {
        const source = readFileSync(`${srcDir}${name}`, "utf8");
        return literals.some((literal) => literal.test(source));
      });

    expect(offenders).toEqual([]);
  });

  it("garde la référence de vérification datée dans le fichier de constantes", () => {
    const constants = readFileSync(`${srcDir}matrixrtc.ts`, "utf8");
    expect(constants).toContain("2026-08-03");
    expect(constants).toContain("matrix-js-sdk@42.0.0");
    // La divergence MSC connue est écrite, pas dissimulée.
    expect(constants).toContain("m.rtc.member");
  });

  it("construit la state key attendue par le SDK déployé", () => {
    expect(callMemberStateKey(MOI, APPAREIL)).toBe("_@luca:tacita.chat_DEVICE1_m.call");
  });
});

describe("REQ-CAL-05 — driver widget standard, sans logique RTC maison", () => {
  it("relaie les événements d'état vers la Session", async () => {
    const driver = new CallWidgetDriver(session, SALON);
    const sent = await driver.sendEvent(CALL_MEMBER_EVENT_TYPE, { foci_preferred: [] }, "_k", null);

    expect(sent).toEqual({ roomId: SALON, eventId: "$state" });
    expect(fake.client.sendStateEvent).toHaveBeenCalled();
  });

  it("confine le widget au salon de son appel", async () => {
    const driver = new CallWidgetDriver(session, SALON);

    expect(driver.getKnownRooms()).toEqual([SALON]);
    await expect(driver.sendEvent("m.room.message", {}, null, "!autre:tacita.chat")).rejects.toThrow(
      "autre salon",
    );
  });

  it("chiffre les clés de média appareil par appareil", async () => {
    const driver = new CallWidgetDriver(session, SALON);
    await driver.sendToDevice("io.element.call.encryption_keys", true, {
      "@ana:tacita.chat": { D2: { key: "k2" }, D3: { key: "k3" } },
    });

    expect(fake.client.encryptAndSendToDevice).toHaveBeenCalledTimes(2);
    expect(fake.client.sendToDevice).not.toHaveBeenCalled();
  });

  it("fournit le jeton OpenID qui autorise le SFU via lk-jwt", async () => {
    const driver = new CallWidgetDriver(session, SALON);
    const updates: unknown[] = [];
    driver.askOpenID({ update: (value: unknown) => updates.push(value) } as never);

    await vi.waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]).toMatchObject({ state: "allowed" });
  });
});

describe("REQ-CAL-06 — aucune donnée d'appel dans les logs", () => {
  it("ne journalise rien pendant la construction du widget ni le hangup", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );

    buildCallWidget(session, SALON, WIDGET);
    await hangupLocal(session, SALON);
    const driver = new CallWidgetDriver(session, SALON);
    await driver.sendToDevice("io.element.call.encryption_keys", true, {
      "@ana:tacita.chat": { D2: { key: "secret" } },
    });
    for await (const server of driver.getTurnServers()) expect(server.username).toBe("u");

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    for (const spy of spies) spy.mockRestore();
  });

  it("garde les jetons hors du message d'erreur de découverte", async () => {
    vi.stubGlobal("fetch", wellKnown({}, false));
    const error = await discoverFocus(HOMESERVER).then(
      () => new Error("la découverte aurait dû échouer"),
      (caught: unknown) => caught as Error,
    );

    expect(error.message).not.toContain(HOMESERVER);
    expect(error.message).toContain("well-known-unreachable");
  });
});
