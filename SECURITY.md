# Security policy

Tacita is an end-to-end encrypted messenger. Reports about its cryptography, its
server configuration, or anything that could expose message content are taken
seriously and answered.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Use GitHub's private reporting — *Security* › *Report a vulnerability* on this
repository — or email **adam@protectionjuridique.org**.

Please include what you need to make the problem reproducible: affected version or
commit, the deployment shape (self-hosted, which overlays), and the steps. A proof of
concept is welcome but never required.

You can expect an acknowledgement within **72 hours** and an assessment within
**14 days**. If a fix is warranted we will agree a disclosure date with you; if we
decide not to fix, you will get the reasoning rather than silence.

## Scope

In scope:

- Anything that lets a server operator, a network observer, or another user read
  message content they should not.
- Authentication and session handling, including the recovery-key login path.
- The media pipeline: client-side encryption, upload, and retrieval.
- Server configuration shipped in `infra/` that weakens the deployment.
- Dependency vulnerabilities that are actually reachable from this code.

Out of scope, because they are documented properties rather than defects — see
[THREAT_MODEL.md](THREAT_MODEL.md):

- Metadata visible to the server: the social graph, activity timing, and attachment
  sizes (from which media duration can be inferred).
- The recovery key reaching the server during a password change.
- The recovery key being sufficient, on its own, to open a session.
- Open registration and an enumerable user directory.
- Reactions and pinned-message lists being unencrypted.

If you think one of these is worse than the threat model claims, that is a legitimate
report — send it. The list marks what we already know, not what we refuse to hear.

## Supported versions

Tacita is pre-1.0. Only the latest tagged release receives fixes.
