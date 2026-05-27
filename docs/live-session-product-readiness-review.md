# Live session product readiness review

This review gives operators and maintainers a concise entry point for the current Rotom Table live-session feature. It summarizes the architecture, real table flow, validation coverage, limitations, and before-game checklist without changing application behaviour.

Last checked: 2026-05-26

Current product readiness: ready for trusted-table live-session rehearsal and play within the documented limits. Local-first map and sheet editing remains the default outside explicit session mode.

## Architecture summary

- Live sessions are GM-hosted table sessions for trusted small groups, not public SaaS or a generic shared-document editor.
- LAN / same-Wi-Fi hosting is the primary path. A named Cloudflare Tunnel with a stable hostname is the supported remote path.
- Session hosting is disabled by default and must be explicitly enabled with `ROTOM_ENABLE_SESSION_HOST=1` or the guarded `npm run dev:session:*` helpers.
- Session commands use `WebSocket /api/sessions/socket` for hello/auth, acknowledgements, rejections, same-session patches, heartbeat, presence, and reconnect.
- The server owns live-session map state. Commands carry `opId`, `baseRevision`, actor identity, resource IDs, and validated payloads; accepted commands advance monotonic revisions and rejected commands do not.
- Identity is session-local: GM key, join code, player ID, client ID, display name, and GM-managed assignments. The local GM/player role picker remains a trust-based UI convenience.
- Persistence stays local-first: `snapshot.json` is written atomically, optional `events.jsonl` can be kept locally, and recovery uses the latest valid snapshot. No database, hosted persistence service, Redis, Postgres, Durable Objects, or multi-tenant cloud layer is required.
- Plain `/maps/<slug>` and sheet routes remain local-first. `/maps/<slug>?session=1` is the explicit session map path, and session-mode clients do not gain authority by autosaving whole maps.

## Real user flow

1. The GM starts Rotom Table with session hosting enabled and opens `/sessions`.
2. The GM starts a live session, opens a saved map, and uses the normal `/maps/<map-slug>` route so session hosting owns the authoritative session map.
3. Players join from the lobby with display names and the GM-provided join code.
4. The GM uses **Assign map tokens** and **Assign control** for each player who should move a visible token.
5. Players open **Visible session maps**, which links to `/maps/<map-slug>?session=1`.
6. Player movement and table actions are sent as session commands. The server accepts authorized commands, rejects stale or unauthorized commands safely, and broadcasts same-session patches.
7. Disconnecting clients reconnect through the session socket and receive filtered snapshots for the maps and resources they can see.
8. After play, the GM cleans up browser identities and private runtime data according to the storage and backup runbooks.

## Validation and evidence

Standard validation remains:

```bash
npm run typecheck
npm test
npm run build
```

Focused coverage includes:

- `tests/server/sessionAcceptedPlayerMoveFlow.test.ts` for start, session map seeding, join, assign, authenticate sockets, accepted movement, patch fanout, and cross-session isolation.
- `tests/server/sessionUnauthorizedPlayerControlFlow.test.ts` for visible-but-unassigned player rejection without revision advance, snapshot write, or patch fanout.
- `tests/composables/sessionLobbyMapFlowIntegration.test.ts` for remembered GM assignment and player visible-map navigation.
- `tests/composables/localFirstEditingNoRegression.test.ts` for plain local map/sheet editing, legacy realtime boundaries, and non-session navigation.
- `tests/docs/productTerminologyGuard.test.ts` and related docs tests for product vocabulary, current links, secret hygiene, and operator runbook coverage.

## Current verification checkpoint

The current product/developer verification pass should use the standard validation commands plus focused session and profile tests. The removed real-flow smoke helper and session map attachment endpoint are no longer part of the verification path.

Result expectations:

- The product terminology guard passes for tracked filenames and content, including stale external-process and review-management wording.
- Automated session command tests use seeded session map state instead of the removed attach endpoint.
- A repository scan finds no old external-process or review-workflow statements in tracked files.

## Readiness confirmation

For this source revision, the live-session readiness criteria are satisfied:

- Product vocabulary and repository-hygiene scans pass for tracked filenames and content.
- Typecheck, automated tests, and the production build pass for the server-owned assignment/session-command flow described above.
- No product-level blockers are recorded for the GM start → join → assign token → session command → reconnect snapshot flow.
- Local-first map and sheet editing remains the default outside explicit session mode.

## Known limits to keep visible

- Live sessions assume trusted table participants. They are not hardened public authentication, abuse protection, or public multi-user hosting.
- Join codes and GM keys are session-local secrets. They do not replace accounts, passwords, SSO, MFA, rate limits, CAPTCHA, or authorization outside this trusted-table scope.
- Presence, connected peers, and recent duplicate-`opId` memory are process-local. Restart recovery uses local snapshots and loses transient liveness memory.
- Event replay is unavailable for reconnect; stale reconnects use actor-filtered snapshot fallback.
- Command latency includes local JSON snapshot writes and can vary with filesystem speed, map size, sheet size, and renderer work.
- No WAN load/soak benchmark is recorded. Operators should run the smoke checklist with the actual devices and network before a table session.
- Quick Tunnel remains a temporary development smoke-test option, not a stable campaign-session path.
- Private campaign maps, generated sheets, session snapshots, optional event logs, tunnel credentials, GM keys, join codes, player details, screenshots with secrets, private keys, tokens, and real `.env` files must stay out of committed files.

## Operator checklist before play

- Start from the intended runbook: [LAN hosting](live-session-lan-hosting.md) for same-Wi-Fi play or [named Cloudflare Tunnel hosting](live-session-cloudflare-tunnel-hosting.md) for remote players.
- Confirm the session-host safety banner and public exposure state before sharing a join code.
- Verify any legacy session map is visible before players open the session map; normal profile-based play uses `/maps/<slug>` without session attachment.
- Join from at least one real player device, open **Visible session maps**, and verify `/maps/<map-slug>?session=1` loads a server-owned session map.
- Assign each player the correct visible/controllable map token and verify unassigned players see a helpful rejection or disabled state.
- Move one assigned token, confirm the GM and other players receive the patch, then reconnect a player and confirm snapshot recovery.
- Keep local-first editing expectations clear: plain map and sheet routes remain local; live table actions belong in session mode.
- Back up or remove private `data/sessions/` runtime data according to the backup/recovery guide after the rehearsal or game.

## Current documentation map

- [Live session roadmap](live-session-roadmap.md) and [glossary](live-session-glossary.md) for scope, vocabulary, and non-goals.
- [lobby guide](live-session-lobby.md), and [client integration guide](live-session-client-integration.md) for the user path.
- [Live session protocol](live-session-protocol.md), [session socket protocol](live-session-socket-protocol.md), and [table action commands](live-session-table-action-commands.md) for command contracts.
- [Live session validation matrix](live-session-validation-matrix.md), [implementation maintenance](live-session-implementation-maintenance.md), and [readiness summary](live-session-readiness-summary.md) for maintainer evidence.
- [deployment smoke checklist](live-session-deployment-smoke-checklist.md) and [concurrency benchmark notes](live-session-concurrency-benchmark-notes.md) for smoke and latency expectations.
- [Live session local-mode maintenance checks](live-session-local-mode-maintenance.md), [persistence/recovery maintenance](live-session-persistence-recovery-maintenance.md), and [security and secret-hygiene readiness](live-session-security-secret-hygiene-readiness.md) for no-regression, data, and safety boundaries.
