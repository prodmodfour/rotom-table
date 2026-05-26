# Live session implementation review

This page reviews the current Rotom Table GM-hosted live-session implementation. It links the product docs, source areas, validation evidence, and known limitations that maintainers should inspect before using session hosting at a table.

Audit date: 2026-05-26

Outcome: pass for the implemented live-session scope. Rotom Table now has guarded GM-hosted session mode with WebSocket commands, session-local identity, server-owned revisions, snapshot recovery, client integration, and hosting runbooks while preserving local-first map and sheet workflows outside explicit session mode.

## Locked scope reviewed

The implementation still matches the locked live-session architecture:

- GM-hosted table sessions, not SaaS, public multi-tenancy, or a generic collaborative document editor.
- LAN / same Wi-Fi as the primary hosting path, with a named Cloudflare Tunnel and stable hostname as the supported remote path.
- Quick Tunnel documented only as a temporary development smoke-test option, not the campaign-session path.
- `WebSocket /api/sessions/socket` for session commands, acks/rejections, small same-session patches, presence, heartbeat, and reconnect.
- Server-authoritative commands with `opId` idempotency, monotonic session/map revisions, permission checks, and stale same-resource rejection.
- Session-local identity only: GM key, join code, player display name, player ID, client ID, and GM-managed assigned resources.
- Local-first JSON persistence with atomic `snapshot.json`, optional `events.jsonl`, and latest-snapshot recovery; no Postgres, Redis, Durable Objects, hosted database, or cloud persistence layer.
- Explicit runtime opt-in through `ROTOM_ENABLE_SESSION_HOST=1` or the guarded `npm run dev:session:*` helpers.
- Plain `/maps/<slug>` and sheet editors remain local-first outside explicit `/maps/<slug>?session=1` session mode.

## Capability coverage

| Area | Current coverage | Primary evidence |
| --- | --- | --- |
| Architecture and vocabulary | Product scope, non-goals, ADRs, and validation expectations are documented with live-session terminology. | [Roadmap](live-session-roadmap.md), [glossary](live-session-glossary.md), [validation matrix](live-session-validation-matrix.md), ADRs 001-008. |
| Shared contracts | Session identity, permissions, revisions, commands, results, messages, validators, and predicates are shared across app and server code. | `shared/sessionCommands.ts`, `shared/sessionMessages.ts`, `shared/sessionTokenCommands.ts`, `tests/shared/sessionContractRegression.test.ts`, [session protocol](live-session-protocol.md). |
| State, persistence, and recovery | In-memory session state, local snapshots, optional event logs, duplicate `opId` tracking, cleanup, and recovery paths are covered. | `server/utils/sessionSnapshots.ts`, `tests/server/sessionStateQuality.test.ts`, [session storage](live-session-storage.md), [persistence/recovery audit](live-session-persistence-recovery-audit.md). |
| Identity, lobby, and permissions | Runtime-gated GM start, player join, identity continuity, GM/player summaries, assignments, lobby UI, and safety banner are implemented. | `/sessions`, `server/useCases/startGmSession.ts`, `server/useCases/joinPlayerSession.ts`, `tests/server/sessionLobbyFlow.test.ts`, [session lobby guide](live-session-lobby.md). |
| Session socket transport | Runtime-gated socket route, hello/auth, heartbeat, fanout, reconnect snapshot fallback, message validation, and legacy SSE boundary are covered. | `server/utils/sessionWebSocketServer.ts`, `src/composables/useSessionSocket.ts`, `tests/server/sessionWebSocketTransport.test.ts`, [session socket protocol](live-session-socket-protocol.md). |
| Token commands | Server-authoritative token movement, facing, spawn/delete, send-out, stale conflicts, optimistic movement, and two-client smoke coverage are present. | `server/useCases/applyMoveTokenCommand.ts`, `tests/server/sessionTokenCommandTwoClientSmoke.test.ts`, `tests/server/sessionMoveTokenWebSocketDispatch.test.ts`. |
| Table action commands | HP, combat stages, conditions, initiative, move/action boundaries, hazards, field effects, and terrain commands are documented and tested. | [table action commands](live-session-table-action-commands.md), `tests/server/sessionIntegratedCommandAudit.test.ts`, table action use-case and WebSocket tests. |
| Client session mode | Local/session map state split, session map composable, scene command routing, rejection/presence/reconnect UI, navigation, and multi-tab smoke helper are covered. | `src/composables/map-editor/useSessionMap.ts`, `tests/composables/map-editor/sessionClientIntegration.test.ts`, [client integration guide](live-session-client-integration.md). |
| Hosting and safety | LAN/named-tunnel runbooks, Quick Tunnel caveat, guarded startup scripts, public exposure checks, backup/recovery, security, dependency/runtime review, and hosting hardening tests are available. | [LAN hosting](live-session-lan-hosting.md), [named tunnel hosting](live-session-cloudflare-tunnel-hosting.md), [security review](live-session-security-review.md), `tests/server/sessionHostingHardening.test.ts`. |
| Readiness evidence | Command audit, LAN smoke results, named-tunnel docs review, local-mode audit, security audit, persistence/recovery audit, concurrency notes, and readiness summary are linked. | [command audit](live-session-command-audit.md), [LAN manual smoke results](live-session-lan-manual-smoke-results.md), [readiness summary](live-session-readiness-summary.md), `tests/docs/productTerminologyGuard.test.ts`. |

## Validation evidence index

| Area | Evidence |
| --- | --- |
| Shared protocol contracts | `tests/shared/sessionIdentity.test.ts`, `tests/shared/sessionPermissions.test.ts`, `tests/shared/sessionRevisions.test.ts`, `tests/shared/sessionCommands.test.ts`, `tests/shared/sessionCommandResults.test.ts`, `tests/shared/sessionMessages.test.ts`, `tests/shared/sessionCommandValidation.test.ts`, `tests/shared/sessionPermissionPredicates.test.ts`, and `tests/shared/sessionContractRegression.test.ts`. |
| State, persistence, and recovery | `tests/server/sessionStore.test.ts`, `tests/server/sessionSnapshots.test.ts`, `tests/server/sessionEventLog.test.ts`, `tests/server/sessionRevisionApplication.test.ts`, `tests/server/sessionOperationTracker.test.ts`, `tests/server/sessionCleanup.test.ts`, `tests/server/sessionStateQuality.test.ts`, [session storage](live-session-storage.md), and [persistence/recovery audit](live-session-persistence-recovery-audit.md). |
| Identity, lobby, and permissions | `tests/server/startGmSession.test.ts`, `tests/server/joinPlayerSession.test.ts`, `tests/server/getGmSessionManagement.test.ts`, `tests/server/getPlayerSessionState.test.ts`, `tests/server/updatePlayerAssignment.test.ts`, `tests/server/sessionLobbyFlow.test.ts`, `tests/server/sessionEndpointRoutes.test.ts`, `tests/composables/useSessionLobby.test.ts`, and [session lobby guide](live-session-lobby.md). |
| Session socket transport | `tests/server/sessionWebSocketServer.test.ts`, `tests/server/sessionWebSocketFanout.test.ts`, `tests/server/sessionWebSocketTransport.test.ts`, `tests/server/legacyRealtimeBoundary.test.ts`, `tests/composables/useSessionSocket.test.ts`, and [session socket protocol](live-session-socket-protocol.md). |
| Token and table commands | `tests/server/sessionIntegratedCommandAudit.test.ts`, `tests/server/sessionTokenCommandTwoClientSmoke.test.ts`, token command use-case/WebSocket tests, table action use-case/WebSocket tests, [integrated command audit](live-session-command-audit.md), and [table action commands](live-session-table-action-commands.md). |
| Client session mode | `tests/composables/map-editor/sessionClientIntegration.test.ts`, `tests/composables/map-editor/useSessionMapEditorState.test.ts`, `tests/composables/map-editor/useSessionMap.test.ts`, `tests/composables/map-editor/useSessionMapSceneCommands.test.ts`, `tests/utils/sessionCommandRejectionUi.test.ts`, `tests/utils/sessionPresencePanel.test.ts`, `tests/utils/sessionConnectionStatusUi.test.ts`, and [client integration guide](live-session-client-integration.md). |
| Hosting, safety, and operations | `tests/scripts/sessionHostDev.test.ts`, `tests/scripts/sessionMultiTabSmoke.test.ts`, `tests/server/sessionHostingHardening.test.ts`, `tests/server/sessionSafetyEndpoint.test.ts`, [session host runtime scripts](live-session-host-runtime.md), [public exposure checks](live-session-public-exposure-checks.md), [deployment smoke checklist](live-session-deployment-smoke-checklist.md), and [dependency/runtime review](live-session-dependency-runtime-review.md). |
| Readiness checks | [LAN manual smoke results](live-session-lan-manual-smoke-results.md), [named tunnel documentation review](live-session-named-tunnel-documentation-review.md), [local-mode no-regression audit](live-session-local-mode-no-regression-audit.md), [security readiness audit](live-session-security-readiness-audit.md), [persistence/recovery audit](live-session-persistence-recovery-audit.md), [concurrency benchmark notes](live-session-concurrency-benchmark-notes.md), [readiness summary](live-session-readiness-summary.md), `tests/docs/liveSessionImplementationReview.test.ts`, `tests/docs/liveSessionProductTerminologyCleanup.test.ts`, `tests/docs/liveSessionReadinessSummary.test.ts`, and `tests/docs/productTerminologyGuard.test.ts`. |
| Standard validation | `npm run typecheck`, `npm test`, and `npm run build`. |

## Reviewer reading path

For a concise review, read in this order:

1. [Live session roadmap](live-session-roadmap.md) and [Live session glossary](live-session-glossary.md) for scope and vocabulary.
2. [Live session protocol](live-session-protocol.md), [Live session socket protocol](live-session-socket-protocol.md), and [Live session table action commands](live-session-table-action-commands.md) for protocol and command behaviour.
3. [Live session client integration](live-session-client-integration.md) and [live session lobby](live-session-lobby.md) for user-facing flows.
4. [Live session LAN hosting](live-session-lan-hosting.md), [named Cloudflare Tunnel hosting](live-session-cloudflare-tunnel-hosting.md), [Quick Tunnel caveat](live-session-quick-tunnel-caveat.md), [session backup and recovery](live-session-backup-recovery.md), and [security review](live-session-security-review.md) for operation and safety.
5. [Live session integrated command audit](live-session-command-audit.md), [LAN manual smoke results](live-session-lan-manual-smoke-results.md), [security readiness audit](live-session-security-readiness-audit.md), [persistence/recovery audit](live-session-persistence-recovery-audit.md), and [concurrency benchmark notes](live-session-concurrency-benchmark-notes.md) for evidence.

## Known limitations preserved for live sessions

These limitations are intentionally explicit and are not defects in this live-session scope:

- Live session is for trusted small tables. It is not a high-concurrency public service, public account system, SaaS deployment, or multi-tenant isolation layer.
- The `/login` GM/player role picker remains trust-based local UI, not public authentication. Session-local GM keys and join codes do not replace production auth.
- No rate limiting, CAPTCHA, OAuth/MFA, abuse monitoring, encrypted backup service, tamper-proof audit log, horizontal scaling, Redis, Durable Objects, Postgres, or cloud database is introduced.
- WebSocket peer tracking, connected-client presence, and recent duplicate-`opId` memory are process-local. Restart recovery uses local snapshots and loses transient liveness/recent-operation memory.
- Event replay is not implemented in live sessions (`replayAvailable: false`); stale reconnects use actor-filtered snapshot fallback, which can be more expensive for large visible maps.
- Accepted command latency includes local JSON snapshot and sometimes sheet writes. Filesystem speed, fsync behaviour, sheet size, map size, and renderer cost can affect perceived latency.
- No WAN/named-tunnel latency benchmark or load/soak test was recorded. Operators should run the deployment smoke checklist with their actual players and network.
- Quick Tunnel remains development smoke-test only. It is not a stable campaign-session path and should not be treated as a performance baseline.
- Legacy `/api/events` SSE remains for non-session/local-first sync. Live session commands, acks/rejections, heartbeat, presence, and reconnect use the WebSocket route.
- Local-first whole-map and whole-sheet saves remain acceptable outside live session mode. Session-mode clients must not become the authority by autosaving whole maps.
- Private campaign maps, generated sheets, session snapshots/event logs, real join codes, GM keys, player details, tunnel credentials, private keys, tokens, screenshots with secrets, and real `.env` files must remain out of commits.

## Maintenance notes

- Keep live-session docs, tests, comments, and user-facing copy in product language.
- Keep useful readiness evidence in product/developer docs rather than process-history files.
- Run the standard validation commands after changing session routes, commands, transport, persistence, or hosting helpers.
