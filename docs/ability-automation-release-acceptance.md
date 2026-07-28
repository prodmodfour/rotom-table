# Ability automation release acceptance record

Date: 2026-07-28

Scope: repository and local production-like acceptance for the frozen 483-Ability ruleset through AA-110. This record does **not** claim or perform a production deployment. The release candidate was validated against parent revision `a1a2980f`; this record ships with the resulting GitHub revision, which must be deployed through the normal release path.

## Automated acceptance

The final candidate passed the strict Ability checks and `bash scripts/quality-gate.sh`, including:

- 483/483 canonical manifest rows complete, with zero assisted, blocked, or unimplemented rows;
- 483/483 interaction statuses complete and the ten-domain compositional interaction certification;
- 45/45 frozen legacy-fragment owners bound to exact native runtimes under `native-only-no-dual-write`;
- exact runtime/source/provenance/capability/conformance hashes, including reviewed-manifest SHA-256 `76e9dc8c725872d2060a9b5e3ffd46de1128b623df60a014cd6fb13783fd110c` in both certification artifacts;
- catalog-scale registry, routing, 1,024-provider aggregation, common Move resolution, 64-trigger fan-out, and 128-pending-resume performance budgets;
- shell, secret, and generated/private-file guardrails;
- the strict 776/776 MoveSpec checks retained by the shared quality gate;
- Nuxt/TypeScript typechecking;
- 1,094 test files and 8,509 tests; and
- a production Nuxt/Nitro build.

The full suite covers exact retry, stale conflicts, atomic map/sheet/evidence persistence, deterministic rolls and traces, durable responses and resume, restart recovery, scene boundaries, suppression, forms, copied Abilities, nested Moves, movement, items, weather, terrain, hazards, privacy projections, authorization, realtime convergence, observability, legacy isolation, and sheet-write retirement of historical activation flags.

## Local production-like acceptance

AA-109 exercised independent GM, eligible-player, ineligible-player, and unauthenticated contexts against the local production-like server. The matrix covered active Intimidate, passive Compound Eyes, triggered Moxie, ordered simultaneous Cute Charm/Poison Point windows, exact retry, realtime snapshot reconciliation, hard refresh, disconnect/reconnect, process restart with two durable windows, scene-ledger alignment, and private-state redaction. The disposable after-state was preserved outside the campaign, the pre-acceptance SQLite backup was restored, and temporary profiles were removed.

The final AA-110 production output was then started through `../bin/start-prodlike.sh` and passed `/api/health`. An unauthenticated request to the retired route returned `401`; an authenticated request returned `410 Gone`; neither route attempt parsed a gameplay body or changed campaign authority. Malformed authenticated requests proved both native routes present and returned bounded `400` responses with aggregate `invalid` observations rather than an internal error. No application console error was accepted; headless WebGL `ReadPixels` GPU-stall warnings observed during the earlier browser matrix were presentation/runtime warnings and did not affect authoritative results.

Local production-like evidence is not evidence that production was deployed or observed.

## Runtime-retirement acceptance

- Native clients use only `POST /api/maps/abilities/declarations` and `POST /api/maps/abilities/resolve` through the Ability automation gateway.
- `POST /api/maps/tokens/use-ability` is an authenticated, non-mutating `410 Gone` tombstone.
- Legacy map and session `useAbility` executors reject before authoritative reads or writes; legacy WebSocket delivery receives a non-retryable unsupported-message rejection.
- The browser transaction registry, production compatibility wrappers, legacy Ability log writer, setup-sheet activation controls, and former browser Move-follow-up prompt builders are retired.
- Historical `abilities[].activated` data can be read for compatibility, cannot influence sheet/token Evasion or live-play mechanics, and is stripped by current sheet persistence.
- Moxie, Celebrate, Cute Charm, and Poison Point use native Ability-owned MoveSpec overlays with durable response/retry/resume semantics. Handler-materialized MoveSpecs retain their Ability overlays.
- The historical `ability-follow-ups` discriminator remains a bounded reader because the canonical Move Spite uses that continuation. New continuations in that lane can contain only reviewed Spite windows; persisted historical Ability windows fail closed and must be abandoned rather than executed.
- Deprecated command/data schemas remain only for bounded historical diagnosis. No legacy runtime can be selected, planned, dual-written, or persisted.

## Deployment and observation dependencies

Before production deployment, the operator must:

1. review the pushed GitHub release revision and rerun the release checks on that exact revision if its committed tree differs from this validated candidate;
2. take a consistent production SQLite/WAL backup;
3. verify that no historical non-Spite `ability-follow-ups` window is outstanding, abandoning/exporting it through the maintenance workflow instead of resuming it;
4. deploy through the normal GitHub-based application path rather than copying or hot-editing production app files; and
5. run the post-deploy GM/player/unauthorized canary from the Ability manual-QA runbook, including native declaration/resolve, realtime reconciliation, retry, reconnect, and restart checks.

Production-only observation remains intentionally unexecuted in this repository task. After deployment, monitor only the closed aggregate Ability observability schema and verify that legacy-route requests return the expected denial without state changes. Rollback uses the prior application release plus the consistent campaign backup; this repository migration does not rewrite production campaign data.
