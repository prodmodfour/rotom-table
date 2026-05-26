# Track 2 integrated multi-client command audit

This audit records the final Track 2 command-flow pass for the GM-hosted session model. It is an automated fake-WebSocket audit, not a public-hosting or LAN smoke pass; the LAN/manual deployment checks are covered by [Track 2 deployment smoke checklist](track-2-deployment-smoke-checklist.md), [Track 2 LAN manual smoke results](track-2-lan-manual-smoke-results.md), and the final audit docs.

Audit date: 2026-05-26

## Evidence

Automated coverage lives in `tests/server/sessionIntegratedCommandAudit.test.ts`.

The test opens one GM socket, two player sockets in the same session, and a GM socket in a different session. It then drives command frames through `handleSessionSocketMessage` with the real WebSocket dispatcher and server-authoritative use cases.

## Audited flows

| Area | Command or message | Audit result |
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

The audit confirms these Track 2 architecture boundaries for the covered flows:

- live session mutations travel through `WebSocket /api/sessions/socket` command frames, `commandAck`/`commandReject`, and small `patch` messages;
- accepted commands advance the server-owned session/map revision exactly once;
- rejected unauthorized and stale commands do not advance revisions or write snapshots;
- same-session fanout does not leak patches to an unrelated session;
- patches for the audited commands do not include whole-map `placements`, `voxels`, or `fieldEffects` payloads;
- reconnect snapshot fallback is server-authoritative and actor-filtered for a player client;
- no Quick Tunnel campaign path, public account system, SaaS host, cloud database, or browser-owned whole-map autosave is introduced by this audit.

## Follow-up manual coverage

This audit complements, but does not replace:

- [Track 2 multi-tab local smoke script](track-2-multi-tab-smoke.md) for local GM/player browser-tab checks;
- [Track 2 deployment smoke checklist](track-2-deployment-smoke-checklist.md) for LAN and named Cloudflare Tunnel deployment validation;
- [Track 2 local-mode no-regression audit](track-2-local-mode-no-regression-audit.md) for plain map/sheet workflows, local autosave, and legacy SSE checks;
- [Track 2 final concurrency benchmark notes](track-2-concurrency-benchmark-notes.md) for latency-sensitive behaviour observations and performance limitations;
- [Track 2 final session security audit](track-2-final-session-security-audit.md) for auth/session/cookie/permission boundary review;
- [Track 2 final persistence/recovery audit](track-2-final-persistence-recovery-audit.md) for snapshot/event-log and local data hygiene review;
- [Track 2 final implementation review](track-2-final-implementation-review.md) for completed chunk PRs, tests, docs, and known limitations.
