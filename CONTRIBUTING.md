# Contributing to Tacita

Thanks for looking. This document is the whole contract: what the project refuses to
do, how it tests, and what it takes to get a change merged.

## Getting a stack running

```sh
./install.sh --dev        # development machine, self-signed certificate
```

That script goes from a bare Ubuntu to a reachable stack. It is resumable — stop it,
fix whatever it complained about, run it again and it picks up where it was.
`infra/README.md` covers the server side in detail, and `apps/web/README.md` the UI
shard. Every package has a `README.md` carrying its interface contract and its
documented limits.

```sh
pnpm install
npm test                  # mocks only, no external dependency
npm run smoke             # real Synapse, real crypto, real IndexedDB (needs Docker)
pnpm admin doctor         # diagnoses a running stack
```

## Non-negotiables

These are constraints, not preferences. A change that breaks one of them will be sent
back, so it is cheaper to know them first.

1. **Astryx UI only** — no Tailwind, shadcn, Bootstrap or third-party CSS-in-JS.
   `@stylexjs/stylex` is allowed because it *is* Astryx's style engine, shipped
   pre-compiled as a peer dependency. Astryx also ships a `tailwind-theme.css`: never
   import it.
2. **No `localStorage` or `sessionStorage`** for user data. IndexedDB only.
3. **Never call Synapse's `/search`**, and never build a fallback on it — it does not
   work on encrypted rooms. Search is entirely local.
4. **No libolm.** Rust crypto (vodozemac) through the SDK.
5. **Never call `/_matrix/media/*/thumbnail`** on encrypted media. Thumbnails are
   generated client-side.
6. **Never sort by `origin_server_ts`.** The canonical order is the `/sync` stream.
7. **No homemade RTC client.** Element Call, as a widget.
8. **No decrypted content** in the service worker cache, push payloads, logs,
   telemetry or error traces — including in development.
9. **No native "delivered" receipt.** Matrix defines only `m.read`; ours is an
   extension and is never presented as standard Matrix.
10. **`/sync` is HTTP long-polling, not WebSocket.** Don't describe it as one.
11. **One media upload pipeline** for every file type. No parallel path.
12. **No Playwright, and no driven browser in the test suite.** Requirements are
    proven in Vitest, or they are documented as unproven.
13. **Never ship a guarantee the software doesn't provide.** Known limits get
    documented, never hidden. This is the one that produced
    [THREAT_MODEL.md](THREAT_MODEL.md).

Visual changes go through `DESIGN.md` tokens, never a hardcoded value in a component.

## Tests: what proves what

- **Vitest only.** Components run in jsdom/happy-dom, gestures are simulated with
  pointer events. The `infra/` configuration is tested too: those tests parse the
  rendered YAML and assert the values that matter.
- **Every test names the behaviour it proves**, in plain language, in its `describe`.
  A name that doesn't say what would break is not good enough.
- **Mock `Session` through `asSession()`** (`@tacita/client-core/testing`), never
  `as unknown as Session`. Otherwise a member added to the contract shows up nowhere —
  not at compile time, not at startup, only as `undefined is not a function`.
- **A handover between two packages needs a compile site.** No package depends on two
  others, so an interface promise between modules is checked by nothing. The pattern
  to copy is `packages/media-pipeline/tests/jonction-outbox.ts`: a file with no test
  in it that *is* the test — if it stops compiling, the handover is broken.
- **Passing under Vitest does not prove the code starts.** Vitest transpiles;
  `node --experimental-strip-types`, which runs the services in `apps/`, *strips*
  types without transforming them and rejects any TypeScript construct that emits code
  (parameter properties, `enum`, `namespace`). Where a service is launched by that
  engine, a test loads its modules **with that engine**
  (`infra/tests/invite-tokens.test.ts`).
- **jsdom renders nothing** — no geometry, no cascade, no computed style. What only a
  browser can see is measured by hand and then held by a *structural* test that reads
  the stylesheet or the source. That guard doesn't prove the rendering; it stops the
  line that holds it from disappearing unnoticed.

## Rules that came from real bugs

Each of these was written after a defect in this codebase. They read like pedantry
until you meet the failure they describe.

1. **Every seam between modules has a named owner.** Every critical defect this
   project has had lived in a seam. The textbook case: the encryption guard existed in
   `messaging` and not in `outbox`, because `messaging`'s contract put the queue out of
   scope and `outbox`'s contract said nothing about encryption. Both contracts honoured,
   the hole between them.
2. **Classify an error by whether it can be resolved, not by its HTTP class.** A 401
   from an expired token is fixed by renewing it, not by asking the user to resend
   message by message. `failed` must mean "the user has to act on *this* message".
3. **Never validate a hypothesis against a substitute that confirms it by
   construction.** A mock that itself fixes the SDK's emission order cannot disprove a
   hypothesis about that order. A single-threaded fake database cannot test transaction
   atomicity.
4. **"Module finished" and "product works" are two different gates.** Configuration
   tests attest to file contents; the smoke target attests to behaviour against a real
   server. `infra` was once "100% conforming" while nobody could log in.
5. **Keep the promise or withdraw it — never leave it displayed and unmet.** Every
   package lists its accepted limits in its own `README.md`.
6. **No development need modifies a production artifact.** Dev/prod differences live in
   explicit overlays, loaded deliberately.
7. **A value written where nothing reads it is undetectable.** Two cases in four days:
   URL parameters dropped from Element Call's schema two versions earlier — accepted,
   ignored, silent; and `opacity: "var(--token)"` in a React inline style, which the
   CSSOM parses as a *number* and reduces to `NaN` — the code said 50%, the screen said
   100%, and both were right. Any value placed at a seam nobody re-reads needs a
   structural test tying it to where it is read. If that test is impossible to write,
   the test isn't what's missing — the value is in the wrong place.

## Comments

Comment density is not the goal; orientation is. Four kinds, each with one home:

| Kind | What it says | Where | Rule |
|---|---|---|---|
| **Map** | What this file does, in N steps | Top of file, ≤10 lines | Required over 150 lines |
| **Contract** | What a function promises, requires, throws | JSDoc on exports | Present tense, ≤5 lines |
| **Trap** | A non-obvious failure and its literal error string | Inline, at the line that breaks | Must contain the symptom you'd search for |
| **Why** | The decision and what it rejected | Commit message or issue | Never inline prose |

**Inline comments are written in the present tense, about code that exists.** History
belongs in `git log`. A date inside a comment is a sign it belongs somewhere else, and
the pre-commit hook rejects new ones.

## Commit gate

Hooks are blocking from the first commit — lint, typecheck, tests. `--no-verify` is
not used here.

`typecheck` always runs over the whole workspace: it holds the type-level seams and it
is the cheaper of the two. Tests default to the whole workspace, and you may narrow
them to the project you touched **when the change is contained**, which leaves a trace
in the command:

```sh
TACITA_TESTS="--project @tacita/outbox" git commit -m "…"
```

Project names come from `package.json`: packages are prefixed (`@tacita/outbox`), apps
are not (`web`, `infra`, `push-gateway`, `invite-tokens`).

- **Wide, so run everything:** an interface exported by a package, a file shared by
  several modules, a contract between two packages, a reused component, a design token,
  build or test configuration.
- **Contained, so narrowing is fine:** a change inside a single package, or a single
  screen that exports nothing.

When in doubt, run everything.

## Things to raise rather than decide in a pull request

Open an issue instead of working around any of these:

- A tooling incompatibility you hit (Astryx is pinned at `0.2.0` and is young).
- Anything that weakens a documented guarantee in [THREAT_MODEL.md](THREAT_MODEL.md).
- A contradiction between two modules found while composing them. This is the dominant
  failure mode here: each module is correct, and the space between them is not.
