# Live session readiness summary

This page summarizes the current Rotom Table GM-hosted live-session implementation for maintainers and operators. It is a product/developer readiness index, not a status log.

Last checked: 2026-05-26

Current readiness baseline: ready for trusted-table live-session smoke testing within the documented limits. The implementation keeps the existing local-first app intact while adding an explicit session-hosting mode for small groups.

## Readiness checks

- Session hosting remains opt-in through `ROTOM_ENABLE_SESSION_HOST=1` or the guarded `npm run dev:session:*` helpers.
- Standard validation is `npm run typecheck`, `npm test`, and `npm run build` from the repository root.
- No maintenance-only notes, private/generated maps or sheets, session snapshots, event logs, tunnel credentials, tokens, private keys, screenshots with secrets, or real `.env` files are intentionally added to the repository.
- The documented limitations remain product limitations, not hidden follow-up work: trusted small-table scale, no public auth or SaaS hardening, process-local WebSocket presence/recent-`opId` memory, snapshot fallback without event replay, local JSON write latency, no WAN/load benchmark, Quick Tunnel development-smoke only, and no committed private/session/secret data.

## Architecture lock confirmed

The live-session implementation still matches the locked architecture:

- GM-hosted table sessions for trusted small tables, not SaaS, public multi-tenancy, or a generic collaborative document editor.
- LAN / same Wi-Fi remains the primary hosting path; a named Cloudflare Tunnel with a stable hostname remains the supported remote path.
- Quick Tunnel remains a temporary development smoke-test option only and is not the campaign-session path.
- Session concurrency uses `WebSocket /api/sessions/socket` for hello/auth, commands, acknowledgements/rejections, small same-session patches, presence, heartbeat, and reconnect.
- Live session mutations use server-authoritative command envelopes with `opId` idempotency, monotonic session/map revisions, permission checks, and stale same-resource rejection.
- Identity remains session-local: GM key, join code, display name, player ID, client ID, and GM-managed assignments rather than full accounts.
- Persistence remains local-first JSON with atomic `snapshot.json`, optional `events.jsonl`, and latest-snapshot recovery; no Postgres, Redis, Durable Objects, hosted database, or cloud persistence service is added.
- Plain `/maps/<slug>` and sheet editors remain local-first outside explicit `/maps/<slug>?session=1` session mode; live session clients do not become authoritative by autosaving whole maps.

## Evidence index

Use these product/developer documents and tests to maintain the live-session scope:

- [Live session implementation maintenance](live-session-implementation-maintenance.md) links primary docs, source areas, tests, and known limitations.
- [Live session command-flow maintenance](live-session-command-flow-maintenance.md) covers move, turn, HP, conditions, initiative, reconnect, permissions, stale conflicts, same-session patch fanout, and cross-session isolation.
- [Live session LAN manual smoke results](live-session-lan-manual-smoke-results.md) records the multi-browser LAN pass with redacted join-code evidence, WebSocket presence, reconnect snapshot fallback, and cleanup.
- [Live session named-tunnel maintenance checklist](live-session-named-tunnel-maintenance.md) keeps the named Cloudflare Tunnel doc/source baseline and safety assumptions.
- [Live session local-mode maintenance checks](live-session-local-mode-maintenance.md) confirms plain local map/sheet workflows, local autosave, and legacy SSE boundaries remain intact.
- [Live session security and secret-hygiene readiness](live-session-security-secret-hygiene-readiness.md) reviews auth/session/cookie/permission boundaries, public exposure warnings, committed-data hygiene, and remaining security non-goals.
- [Live session persistence/recovery maintenance](live-session-persistence-recovery-maintenance.md) tracks local snapshots, optional event logs, backup/recovery docs, cleanup, and data hygiene.
- [Live session concurrency benchmark notes](live-session-concurrency-benchmark-notes.md) records latency-sensitive behaviour observations and performance limits for the trusted small-table scope.
- `tests/server/sessionIntegratedCommandFlow.test.ts`, `tests/server/sessionWebSocketTransport.test.ts`, `tests/server/sessionHostingHardening.test.ts`, `tests/composables/map-editor/sessionClientIntegration.test.ts`, `tests/docs/liveSessionDocsMaintenance.test.ts`, `tests/docs/liveSessionReadinessSummary.test.ts`, and `tests/docs/productTerminologyGuard.test.ts` provide focused regression coverage around the readiness surface.

## Operator boundary

This readiness summary does not change hosting, auth, persistence, or transport behaviour. It points GMs to the current live-session runbooks and reminds maintainers to keep public docs in product language.
