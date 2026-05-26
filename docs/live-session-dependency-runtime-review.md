# Live session dependency and runtime review

This review records the dependency, Node/Nitro runtime, and Cloudflare Tunnel assumptions for the live session hosting-hardening slice. It should be read with the [session host runtime scripts](live-session-host-runtime.md), [LAN hosting runbook](live-session-lan-hosting.md), [named Cloudflare Tunnel runbook](live-session-cloudflare-tunnel-hosting.md), [deployment smoke checklist](live-session-deployment-smoke-checklist.md), [Quick Tunnel caveat](live-session-quick-tunnel-caveat.md), and [security review](live-session-security-review.md).

Live session remains a GM-hosted table session. This review does not add a package, a database, a cloud service, a public auth provider, or a new deployment target.

## Review outcome

- **No new direct runtime dependency is required for live session hosting.** The session host uses the existing Nuxt/Nitro app, TypeScript shared contracts, browser `WebSocket`, and Node built-ins.
- **The live session socket depends on Nitro's WebSocket support through Nuxt/Nitro**, not on a separately added `ws`, Socket.IO, Yjs, Hocuspocus, or collaborative-document server package.
- **No hosted persistence package is imported, configured, or required by Rotom Table.** Session state remains local JSON snapshots plus the optional local JSON-lines event log. `package.json` has no direct Postgres, Redis, Durable Objects, cloud object storage, or SaaS persistence dependency; Nuxt/Nitro may still bring optional transitive packages in the lockfile that Live session does not use.
- **`cloudflared` is an external operator tool, not an npm dependency.** The app does not start Cloudflare, store tunnel credentials, or require Cloudflare SDK packages.
- **Session hosting still requires the exact runtime gate `ROTOM_ENABLE_SESSION_HOST=1`.** Plain `npm run dev` keeps session endpoints and `/api/sessions/socket` fail-closed.

## Current dependency inventory

The current dependency shape is intentionally small:

| Area | Current packages or APIs | Live session note |
| --- | --- | --- |
| App/server framework | `nuxt` in `package.json` (lockfile currently resolves Nuxt 3.x) | Provides the Vue app and Nitro server used by the GM-hosted process. |
| Nitro WebSocket support | `nitro.experimental.websocket = true` in `nuxt.config.ts`; Nuxt/Nitro transitive packages include Nitro/H3/CrossWS implementations in the lockfile | Required for `defineWebSocketHandler` at `WebSocket /api/sessions/socket`; do not replace this with a separate realtime server without another review. |
| Optional transitive packages | Nuxt/Nitro/devtools may place packages such as `ws` or `ioredis` in `package-lock.json` | These are not direct Rotom Table dependencies, are not imported by Live session code, and do not change the local JSON persistence or Nitro WebSocket architecture. |
| Renderer | `three` plus `@types/three` | Existing map rendering dependency; Live session must not degrade render quality to simplify hosting. |
| UI assets | `@fontsource/*`, `@phosphor-icons/vue` | Existing presentation/UI dependencies, not session authority. |
| Type/test tooling | `typescript`, `vue-tsc`, `vitest`, `@types/node` | Used by `npm run typecheck`, `npm test`, and documentation/runtime regression coverage. |
| Node built-ins | `node:fs`, `node:path`, `node:crypto`, `node:child_process`, `node:process` | Used for local JSON persistence, ID generation, and helper scripts; no extra service is introduced. |
| Operator tools | `cloudflared` CLI, optional Python/`just` helpers | Installed and run by the GM/operator outside npm dependencies. Tunnel credentials stay outside the repository. |

If a future Live session change adds a package that changes live transport, persistence, hosting, authentication, encryption, proxying, or Cloudflare integration, update this review and add focused tests before merging that change.

## Dependency boundaries to preserve

Do **not** add these to satisfy live session hosting-hardening work without a new architecture decision:

- `ws`, Socket.IO, PeerJS, Yjs, Hocuspocus, ShareDB, or other generic collaborative-document/realtime servers for live session authority;
- Postgres, Redis, Durable Objects, cloud object storage, hosted database clients, or queue services for Live session persistence;
- Cloudflare SDKs, Workers/Wrangler, Miniflare, Access SDKs, or tunnel credential helpers as app dependencies;
- public auth providers, OAuth/OIDC clients, account systems, CAPTCHA, or multi-tenant SaaS packages as a silent replacement for the session-local model.

The current allowed model is still: GM-controlled Nuxt/Nitro process, WebSocket command envelopes, local JSON snapshots/event logs, session-local GM/player identity, and explicit LAN or named-tunnel exposure.

## Runtime flags and scripts

The runtime gate is exact:

```bash
ROTOM_ENABLE_SESSION_HOST=1
```

Values such as `true`, `yes`, `on`, an empty string, or a flag exported after Nuxt is already running are not the documented enabled state. The gate is checked by server endpoints and the session socket so disabled hosts fail closed.

Supported helper scripts:

| Script | Binding | Intended use |
| --- | --- | --- |
| `npm run dev` | Nuxt default local dev binding | Local-first development; live session hosting disabled. |
| `npm run dev:session:lan` | `ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host 0.0.0.0 --port 3000` | Trusted same-Wi-Fi/LAN sessions. |
| `npm run dev:session:tunnel` | `ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host 127.0.0.1 --port 3000` | Named Cloudflare Tunnel sessions through a stable hostname. |
| `npm run smoke:session:multi-tab` | Opens/prints local browser URLs and runs focused checks | Local tab smoke only; not a LAN/named-tunnel replacement. |

Both session-host helpers support `--port <port>` and `--print-only`. They set the flag for the Nuxt child process only and do not write `.env` files, mint credentials, start `cloudflared`, or commit runtime data.

## Node and Nitro compatibility assumptions

- Use a maintained Node.js LTS runtime for development and GM-hosted sessions. Node 20 or newer is the documented floor for live-session review because the project uses ESM, modern Node built-ins, `@types/node` 20.x, and Nuxt/Nitro WebSocket support; the standard validation currently runs on a newer Node runtime.
- Run live session hosting on the normal Node/Nuxt/Nitro server process. Static hosting, edge/serverless adapters, Cloudflare Workers, Durable Objects, or serverless functions are not reviewed Live session hosts.
- `nuxt.config.ts` intentionally enables `nitro.experimental.websocket = true`. Removing that flag, changing the server adapter, or moving the socket route away from H3/Nitro requires re-running WebSocket transport tests and updating this review.
- The GM host must have filesystem access for local JSON reads/writes under the expected repository data paths, including `data/sessions/` for snapshots/event logs. A read-only deployment is not a supported live-session host.
- Production-like hosting remains out of scope for Live session. If the app is ever packaged as a long-running production Node service, repeat this review for process management, TLS termination, backups, log redaction, file permissions, and route hardening.

## Cloudflare Tunnel assumptions

The supported remote path is a named Cloudflare Tunnel with a stable hostname forwarding to the GM-controlled local server:

```yaml
ingress:
  - hostname: table.example.com
    service: http://localhost:3000
  - service: http_status:404
```

Assumptions to preserve:

- `cloudflared tunnel run <name>` runs outside the app and forwards the normal Rotom Table origin; it is not an in-app dependency.
- Player pages use `https://table.example.com/...` and resolve the socket to `wss://table.example.com/api/sessions/socket` on the same origin.
- `/api/sessions/socket` must preserve WebSocket upgrade behaviour end to end.
- Cloudflare cache rules must not cache `/sessions`, `/maps/*`, `/api/sessions/*`, WebSocket responses, session patches, snapshots, or lobby state.
- Cloudflare Access, WAF rules, or IP restrictions may be used as optional outer protection only; Rotom Table authority still comes from the session-local GM key/join code, player/client identity, permissions, revisions, and command validation.
- Quick Tunnel and temporary `trycloudflare.com` hostnames remain development smoke-test only and are not campaign-session URLs.
- `cert.pem`, tunnel credentials JSON, tokens, Access/WAF config, private keys, real `.env` files, snapshots, and join codes stay outside git and outside documentation examples.

## Verification checklist

Before accepting dependency or runtime changes that affect live session hosting:

- [ ] `package.json` and `package-lock.json` were reviewed for new realtime, database, auth, Cloudflare, or hosted-service packages.
- [ ] `nuxt.config.ts` still enables Nitro WebSockets for the Node/Nuxt host.
- [ ] `npm run dev` remains the disabled-by-default local-first path.
- [ ] `npm run dev:session:lan -- --print-only` shows `ROTOM_ENABLE_SESSION_HOST=1`, `--host 0.0.0.0`, and the selected port.
- [ ] `npm run dev:session:tunnel -- --print-only` shows `ROTOM_ENABLE_SESSION_HOST=1`, `--host 127.0.0.1`, and the selected port.
- [ ] The full validation passes: `npm run typecheck`, `npm test`, and `npm run build`.
- [ ] Any named-tunnel smoke uses a stable hostname and confirms `wss://<host>/api/sessions/socket` without caching session paths.
- [ ] `git status --short` shows no generated `data/sessions/` files, real `.env` files, Cloudflare credentials, join codes, GM keys, private maps/sheets, screenshots with secrets, or private campaign data staged for commit.

## Known limits

- Live session does not review static export, public SaaS hosting, Cloudflare Workers, Durable Objects, serverless Node adapters, public multi-tenancy, or cloud databases as supported session hosts.
- Nitro WebSocket support is still explicitly enabled through an experimental configuration flag. Keep focused WebSocket transport tests in the validation and re-check upstream Nuxt/Nitro release notes before major version upgrades.
- The app does not encrypt local snapshots/backups, manage Cloudflare credentials, rotate secrets automatically, or provide production-grade internet abuse controls.
- Legacy `/api/events` SSE remains only for local-first non-session paths. It is not a dependency or runtime path for Live session commands, acknowledgements/rejections, presence, heartbeat, reconnect, or conflict handling.
