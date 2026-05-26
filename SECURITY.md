# Security

## Local-first trust model

Rotom Table is currently a local-first, trust-based tabletop tool. The GM/Player session model is a role picker backed by a cookie; it is not hardened public authentication.

Track 2 GM-hosted sessions add a guarded session-local join flow for trusted tables, but they do not turn Rotom Table into a hardened public service. See [docs/track-2-security-review.md](docs/track-2-security-review.md) for the current Track 2 trust boundaries, join-code limits, tunnel exposure risks, and non-goals. See [docs/track-2-dependency-runtime-review.md](docs/track-2-dependency-runtime-review.md) for the reviewed dependency inventory, runtime flags, Node/Nitro compatibility, and Cloudflare tunnel assumptions.

Do not expose this application publicly without replacing the current auth and persistence assumptions. A public deployment should include, at minimum:

- real authentication and authorization
- a persistence layer designed for hosted use instead of repository-tree JSON writes
- review of all mutating API routes
- content/asset rights review
- separation of private campaign data from public/static reference data

## Sensitive data

Do not submit real campaign/private data, credentials, secrets, private player information, unreleased story notes, or production environment files in issues, pull requests, screenshots, or logs.

The repository ignores common local environment files such as `.env` and `.env.*`; keep secrets out of Git.

## Reporting issues

If you find a security issue, report it privately to the repository owner/maintainer rather than posting exploit details publicly. Include:

- a short description of the issue
- reproduction steps
- affected routes or files, if known
- whether private data, filesystem writes, or role boundaries are involved

Because this is a hobby/local-first project, response times may vary, but reports that affect data safety or public exposure assumptions should be treated seriously.
