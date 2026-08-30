***English** · [Français](README.fr.md)*

# Tacita

**Self-hosted, end-to-end encrypted messaging for a closed circle.** One command
deploys the whole stack on your own server; your family or friends install it from the
browser as an app. It replaces Instagram DMs and group chats, without the surveillance
and without the ads.

[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)
![Status: pre-1.0](https://img.shields.io/badge/status-pre--1.0-orange.svg)
![Matrix](https://img.shields.io/badge/protocol-Matrix-000.svg)

<!-- HERO: replace with a screenshot of a conversation, mobile, dark theme.
     Then add a 3-shot grid: conversation · call · settings.
     ![Tacita](assets/hero.png) -->

**Read [THREAT_MODEL.md](THREAT_MODEL.md) before you trust it with anything.** It is
the honest version of the sentence above: what the encryption covers, what it does not,
and where the sharp edges are.

---

## Not a Matrix client — the whole box

Tacita is not an app you point at someone else's server. It is the **entire stack**,
deployed as one unit on a machine you control:

| | |
|---|---|
| **Synapse** | Matrix homeserver, encrypted rooms |
| **PostgreSQL** | its database |
| **MinIO** | S3-compatible storage for encrypted media blobs |
| **LiveKit + Element Call** | voice and video calls |
| **nginx** | TLS termination, Let's Encrypt certificates |
| **The PWA** | a mobile-first web app installed from the home screen |

If you want a client for an existing Matrix account, use Element — it is excellent and
this is not that. If you want a private messenger for a dozen people that lives entirely
on your box, that is what this is.

## Install

On a fresh Ubuntu server with a domain pointed at it:

```sh
git clone https://github.com/adamAubry/tacita.git
cd tacita
./install.sh --domaine=chat.example.org --email=you@example.org
```

Six steps: prerequisites, configuration, DNS check, TLS certificate, stack, diagnosis.
It is **resumable** — if it stops, fix what it names and run it again; it picks up where
it was. When it finishes, open your domain and create the first account from the app.

```sh
./install.sh --dev     # local machine, self-signed certificate
pnpm admin doctor      # diagnose a running stack without touching it
```

### Requirements

- **Ubuntu 22.04 or 24.04**, root or sudo (other distributions: install Node 22+, pnpm,
  Docker with the compose v2 plugin and certbot yourself, then run the script)
- **4 GB RAM recommended, 2 GB minimum with swap.** The web app is compiled on your
  machine during install, because the build inlines your domain into the bundle. This is
  the heaviest moment of the install by a wide margin.
- **A domain** with an `A` record for it and for `call.<your-domain>`
- **Open ports**: `80/tcp` (certbot only, during the certificate challenge), `443/tcp`,
  `3478/udp` and `5349/tcp` (TURN), `7881/tcp` and `50000-50100/udp` (call media).
  `./install.sh` opens the RTC ones itself when `ufw` is present — miss them and a call
  connects, shows the participants, then dies at 15-20 seconds with nothing said.

## Features

- **End-to-end encrypted** conversations, direct and group, with Rust crypto (vodozemac)
- **Voice and video calls** through Element Call, encrypted
- **Photos, video, voice notes and files** — encrypted client-side before upload, one
  pipeline for every file type
- **Offline**: read, search and compose with no connection; what you write leaves on
  reconnect and survives a page reload
- **Local search** over your own history — the server is never asked, because it could
  not answer anyway
- **Installable** on iOS and Android from the browser, with push notifications
- **Replies, reactions, edits, pins, mentions, typing indicators, read receipts**

## What the server can see

The server never sees message content. It does see metadata, and the difference matters:

- who talks to whom, and when
- the exact size of every attachment — which, at a near-constant bitrate, gives away the
  **duration of every video and voice note**
- reactions, which are not encrypted

And there is one sharp edge worth knowing before you start: **your recovery key reaches
the server when you change your password**, and it opens a session on its own. This is
tolerable because you are the operator. It stops being tolerable if you host for
strangers.

All of it, in full: **[THREAT_MODEL.md](THREAT_MODEL.md)**.

## Status

Pre-1.0, and honest about it. The project distinguishes two gates, and so should you:

```sh
npm test        # unit and configuration tests, mocks, no external dependency
npm run smoke   # real Synapse, real crypto, real IndexedDB (needs Docker)
```

**Proven at runtime:** Rust crypto actually loading, a room genuinely encrypted
server-side, the encrypt → server → decrypt round trip, and session resume with no
network.

**Not proven:** everything else. The push gateway end-to-end (verified by hand once, no
test replays it), media against a real server, LiveKit under load. Nothing has been
rendered in a real browser by an automated test — see `apps/web/README.md`, which lists
what that leaves unverified.

Each package's `README.md` carries its own interface contract and its accepted limits.
Those limits are not marketing copy: several of them are enforced by tests that fail if
the README stops saying them.

## Documentation

| | |
|---|---|
| [THREAT_MODEL.md](THREAT_MODEL.md) | what is protected, what is not, and why |
| [CONTRIBUTING.md](CONTRIBUTING.md) | constraints, test discipline, commit gate |
| [SECURITY.md](SECURITY.md) | reporting a vulnerability |
| `infra/README.md` | the server stack, in detail |
| `apps/web/README.md` | the PWA, and what it does not prove |
| `packages/*/README.md` | one contract and one limits list per module |

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) is the whole
contract — it is short, and it will save you a rejected PR. The constraints in it are
not preferences; most were written after a specific bug.

## License

MIT — see [LICENSE](LICENSE).
