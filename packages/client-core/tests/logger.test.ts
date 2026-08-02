import { describe, expect, it, vi } from "vitest";

// Import direct : ce test ne charge pas la session, donc pas matrix-js-sdk.
import { createLogger, eventRef, sanitize, type LogSink } from "../src/logger";
import { fakeEvent } from "./mocks";

const spy = () => {
  const calls: { message: string; fields: Record<string, unknown> }[] = [];
  const sink: LogSink = (_level, message, fields) => calls.push({ message, fields });
  return { calls, logger: createLogger(sink) };
};

describe("REQ-COR-09 — aucun contenu déchiffré dans les logs, y compris en dev", () => {
  it("un corps d'événement passé par erreur n'atteint jamais le sink", () => {
    const { calls, logger } = spy();

    logger.info("événement reçu", {
      eventId: "$abc",
      body: "rendez-vous à 18h",
      formatted_body: "<b>rendez-vous à 18h</b>",
    } as never);

    expect(calls[0]!.fields).toEqual({ eventId: "$abc" });
    expect(JSON.stringify(calls)).not.toContain("18h");
  });

  it("un objet — MatrixEvent, content, erreur — est retiré, seules les primitives passent", () => {
    const { calls, logger } = spy();

    logger.error("échec de déchiffrement", {
      event: fakeEvent("$abc", 1000),
      cause: new Error("secret: 42"),
      roomId: "!salon:tacita.test",
      retries: 3,
      recovered: false,
      previous: null,
    } as never);

    expect(calls[0]!.fields).toEqual({
      roomId: "!salon:tacita.test",
      retries: 3,
      recovered: false,
      previous: null,
    });
    expect(JSON.stringify(calls)).not.toContain("42");
  });

  it("sanitize est le filtre, pas une convention d'appel", () => {
    expect(sanitize({ body: "x", content: { body: "x" }, ok: "1" })).toEqual({ ok: "1" });
  });

  it("eventRef ne rend que des métadonnées d'événement", () => {
    expect(eventRef(fakeEvent("$abc", 1000))).toEqual({
      eventId: "$abc",
      roomId: "!salon:tacita.test",
      eventType: "m.room.message",
    });
  });

  it("le sink par défaut reste branché quand aucun n'est fourni", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    createLogger().info("prêt", { body: "secret" } as never);
    expect(info).toHaveBeenCalledWith("[client-core] prêt", {});
    info.mockRestore();
  });
});
