# Live session command-flow maintenance

This maintenance note records the current live-session command-flow coverage for the GM-hosted session model. It is an automated fake-WebSocket coverage pass, not a public-hosting or LAN smoke pass; the LAN/manual deployment checks are covered by [Live session deployment smoke checklist](live-session-deployment-smoke-checklist.md), [Live session LAN manual smoke results](live-session-lan-manual-smoke-results.md), and the product readiness docs.

Last checked: 2026-05-26

## Evidence

Automated coverage lives in `tests/server/sessionIntegratedCommandFlow.test.ts`.

The test opens one GM socket, two player sockets in the same session, and a GM socket in a different session. It then drives command frames through `handleSessionSocketMessage` with the real WebSocket dispatcher and server-authoritative use cases.

## Checked flows

| Area | Command or message | Expected result |
| --- | --- | --- |
| Token movement | assigned player sends `moveToken` | Accepted at revision 1, snapshot written once, sender receives `commandAck`, all same-session clients receive the same small `tokenMoved` patch, and the unrelated session receives nothing. |
| Token facing | GM sends `turnToken` | Accepted at revision 2, `tokenTurned` patch fans out to same-session clients only, and the authoritative token keeps the new facing/turned state. |
| HP | assigned player sends `modifyHp` | Accepted at revision 3, Pokémon sheet HP/Injury data is persisted, a session snapshot is written, and only a small `hpModified` patch is broadcast. |
| Conditions | assigned player sends `modifyConditions` | Accepted at revision 4, Pokémon sheet conditions are persisted, a session snapshot is written, and only a small `conditionsModified` patch is broadcast. |
| Initiative | GM sends `nextInitiative` | Accepted at revision 5, the authoritative map initiative lane advances from Pikachu to Bulbasaur, and a small `initiativeUpdated` patch broadcasts without whole-map fanout. |
| Permissions | unassigned view-only player attempts `moveToken` | Rejected with `commandReject`/`reason: "unauthorized"`; no snapshot is written, no revision is advanced, and no other client receives a patch. |
| Stale conflict | assigned player retries a same-token `moveToken` based on revision 0 after the token already moved | Rejected with `commandReject`/`reason: "stale"`, `baseRevision`, and the current authoritative token position; no snapshot is written, no revision is advanced, and no patch is broadcast. |
| Reconnect | assigned player reconnects from revision 0 after accepted commands | Server replies with `snapshotRequired: true` and a filtered `snapshot` at revision 5 because replay is unavailable. The player snapshot includes only that player identity/assignment and visible map state, without the GM key, join code, or the other player's identity. |

## Boundary checks

The checks confirm these live-session architecture boundaries for the covered flows:

- live session mutations travel through `WebSocket /api/sessions/socket` command frames, `commandAck`/`commandReject`, and small `patch` messages;
- accepted commands advance the server-owned session/map revision exactly once;
- rejected unauthorized and stale commands do not advance revisions or write snapshots;
- same-session fanout does not leak patches to an unrelated session;
- patches for the checked commands do not include whole-map `placements`, `voxels`, or `fieldEffects` payloads;
- reconnect snapshot fallback is server-authoritative and actor-filtered for a player client;
- no Quick Tunnel campaign path, public account system, SaaS host, cloud database, or browser-owned whole-map autosave is introduced by these checks.

## Follow-up manual coverage

These checks complement, but do not replace:

- [Live session multi-tab local smoke script](live-session-multi-tab-smoke.md) for local GM/player browser-tab checks;
- [Live session deployment smoke checklist](live-session-deployment-smoke-checklist.md) for LAN and named Cloudflare Tunnel deployment validation;
- [Live session local-mode maintenance checks](live-session-local-mode-maintenance.md) for plain map/sheet workflows, local autosave, and legacy SSE checks;
- [Live session concurrency benchmark notes](live-session-concurrency-benchmark-notes.md) for latency-sensitive behaviour observations and performance limitations;
- [Live session security and secret-hygiene readiness](live-session-security-secret-hygiene-readiness.md) for auth/session/cookie/permission boundary review;
- [Live session persistence/recovery maintenance](live-session-persistence-recovery-maintenance.md) for snapshot/event-log and local data hygiene review;
- [Live session implementation maintenance](live-session-implementation-maintenance.md) for implementation evidence, tests, docs, and known limitations.
