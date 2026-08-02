import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const compose = parse(
  readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf-8"),
);

describe("REQ-INF-01 — PostgreSQL en locale C", () => {
  it("passe --lc-collate=C et --lc-ctype=C à l'initdb", () => {
    const args = compose.services.postgres.environment.POSTGRES_INITDB_ARGS as string;
    expect(args).toContain("--lc-collate=C");
    expect(args).toContain("--lc-ctype=C");
  });
});
