import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeEvent, fakeRoom, resetSdk, type ClientMock } from "./mocks";
import { initSession, type SessionConfig } from "../src";

vi.mock("matrix-js-sdk", async () => (await import("./mocks")).sdkModule());

const config: SessionConfig = {
  homeserverUrl: "https://tacita.test",
  loginToken: "loginToken",
  indexedDB: {} as IDBFactory,
};

let client: ClientMock;

beforeEach(() => {
  ({ client } = resetSdk());
});

describe("REQ-COR-04 — OrderedTimeline restitue l'ordre du flux /sync", () => {
  it("conserve l'ordre d'accumulation même quand les timestamps sont dans le désordre", async () => {
    // Horodatages décroissants : un tri par `origin_server_ts` inverserait la liste.
    const sync = [fakeEvent("$a", 3000), fakeEvent("$b", 1000), fakeEvent("$c", 2000)];
    client.getRoom.mockReturnValue(fakeRoom(sync));

    const session = await initSession(config);
    const events = session.timeline("!salon:tacita.test").events();

    expect(events.map((e) => e.getId())).toEqual(["$a", "$b", "$c"]);
    expect(events).toEqual(sync);
  });

  it("relit la timeline vivante à chaque appel plutôt que de figer une copie", async () => {
    const session = await initSession(config);
    const timeline = session.timeline("!salon:tacita.test");

    client.getRoom.mockReturnValue(fakeRoom([fakeEvent("$a", 1000)]));
    expect(timeline.events()).toHaveLength(1);

    client.getRoom.mockReturnValue(fakeRoom([fakeEvent("$a", 1000), fakeEvent("$b", 500)]));
    expect(timeline.events().map((e) => e.getId())).toEqual(["$a", "$b"]);
  });

  it("rend une liste vide pour un salon inconnu du store", async () => {
    const session = await initSession(config);
    client.getRoom.mockReturnValue(null);
    expect(session.timeline("!inconnu:tacita.test").events()).toEqual([]);
  });
});
