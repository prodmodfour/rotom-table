# Complete Play Loop operator guide

Rotom Table is liveplay-only. Do not operate a parallel local-host campaign or treat browser-local state as authority.

## Production persistence

Use a private campaign root outside the application checkout. The default SQLite path is `<campaign-root>/rotom-table.sqlite`; include its WAL/SHM sidecars in coordinated backup procedures. Hosted writes require the explicit production opt-in documented in `.env.vps.example` and an outer private access gate.

The current application schema is 50. Schema 44 remains the historical Complete Play Loop baseline; v45 adds onboarding, v46 adds Contests, v47 adds replay-safe Encounter equipment actions, v48 adds fishing declarations, v49 adds Snag conversion, and v50 adds generic Skill Check documents and operation journals. Startup applies every migration in order and refuses an unknown future version without writing. Never skip a schema version or manually weaken a CHECK constraint.

## Before deployment

Run bounded checks first, then the final gate at a controlled closure window:

```bash
npm run check:complete-play-loop-item-catalog-closure
npm run check:complete-play-loop-authority-guardrails
npm run check:complete-play-loop-performance
npm run check:complete-play-loop-accessibility-visual
npm run check:complete-play-loop-concurrency-failure
npm run check:complete-play-loop-golden-campaigns
npm run check:deferred-closure-golden-journeys
npm run check:deferred-closure-migrations
npm run check:deferred-closure-backup-restore
npm run check:deferred-closure-accessibility
npm run check:deferred-closure-performance
npm run check:deferred-closure-privacy
npm run check:deferred-closure-docs
npm run typecheck
npm run build
bash scripts/quality-gate.sh
```

The quality gate installs exact dependencies, so run it only when network, memory, and downtime budgets allow. Keep TypeScript, Vitest, Nuxt, Vite, and build processes single/bounded on shared-memory hosts.

## Backup and restart

1. Stop or quiesce writes through the private deployment process.
2. Back up campaign JSON, SQLite, and WAL sidecars as one consistency unit.
3. Verify backup metadata and restore procedure in a separate private environment.
4. Start one application instance, allow migrations to finish, and check health.
5. Run the private liveplay smoke checklist.
6. Confirm current Campaign continuation and one retained-command status check before normal play.
7. When present, reload one generic Skill Check, one source-bound shield/net effect, and one linked Battle Contest/Encounter from persisted authority.

A restart must not rerun item, capture, Skill Check, Contest, or Encounter rolls; reapply equipment effects; recreate a Battle link; duplicate settlement/campaign-day commit; or duplicate correction. Durable journals answer exact retries. Follow the stopped-service closed-SQLite procedure and Plan 11 smoke checks in [Private VPS backups](private-vps-backups.md); never repair SQLite or JSON manually.

## Monitoring symptoms

Investigate, rather than suppress:

- operation identity collision or immutable payload drift;
- migration/check-constraint failure;
- repeated revision conflicts on an otherwise idle resource;
- incomplete authority read or 10,000-record bound failure;
- realtime journal accepted but projection repeatedly absent;
- retained client command with ambiguous or mismatched server status;
- cohort/provider/hash drift;
- horizontal overflow, Axe regression, or performance-budget overrun.

Do not log or copy Profile IDs, operation/preflight IDs, row IDs, hashes, private notes, equipment instances, ownership evidence, or full private provider payloads into user-facing diagnostics.

## Recovery and troubleshooting

### Unknown item or inventory result

Keep the exact client command. Restore connectivity and query status. If accepted, reload authority. If no accepted result exists, allow explicit exact retry. A stale/moved/reserved conflict requires redeclaration; never change quantity directly.

### Unknown settlement or next-day result

Use the matching status endpoint. Do not create replacement rewards, advance the clock separately, or clear attention. If accepted evidence exists, reload Campaign. If not, reopen current preflight/review and follow explicit retry rules.

### Realtime delivery interruption

Accepted state remains in SQLite even when post-commit publication fails. Reconnect performs bounded HTTP authority reload and resumes from journal sequence; it does not resubmit mutations.

### Migration failure

Stop. Preserve the database and sidecars. Reproduce against a copy, inspect the exact predecessor schema and row that violates the reviewed migration, and fix migration/tests. Never alter production rows merely to make startup pass.

### Audit or hash drift

Treat as integrity failure. Identify the changed canonical/runtime/evidence file, review the semantic impact, regenerate through the owning script, and rerun downstream checks. Do not patch a hash manually.

### Resource pressure or OOM

Stop duplicate Node/Vitest/Nuxt processes, inspect active processes, and resume one bounded command at a time. Do not repeatedly launch the full suite.

## Deferred Mechanics Closure operations

Ranged and weapon actions, item actions, Skill Checks, and both added Contest formats are liveplay-only. Their accepted state remains in the campaign SQLite database even if post-commit realtime delivery fails. A linked Battle Contest must be recovered as one coordinated Contest/Encounter/map lineage; independent **Finish Encounter** is forbidden for its Encounter.

GM/owner/public projections are rebuilt over HTTP after reconnect. Realtime events are access-scoped invalidations, not documents. Do not expose sheets, Profile IDs, private prompts, dice journals, providers, team pools, handoff receipts, source hashes, or combined settlement evidence in logs or support captures. See [Deferred mechanics closure](deferred-mechanics-closure.md) for the current surface and gate map.

## Existing deployment references

- [Private VPS deployment smoke checklist](private-vps-deployment-smoke-checklist.md)
- [Private VPS live-play smoke](private-vps-live-play-smoke.md)
- [Concurrency and failure acceptance](complete-play-loop-concurrency-reconnect-failure.md)
- [Authority guardrails](complete-play-loop-authority-guardrails.md)
- [Golden campaigns](complete-play-loop-golden-campaigns.md)
