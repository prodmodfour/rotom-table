# Encounter Workspace synthetic acceptance report

Run: `encounter-workspace-synthetic-acceptance-2026-08-04`

The machine-readable result is [`data/encounter-workspace/synthetic-acceptance.v1.json`](../../data/encounter-workspace/synthetic-acceptance.v1.json). It is SHA-256-bound to the success criteria, canonical fixture index, performance budgets, and rollout contract. `tests/data/encounterWorkspaceSyntheticAcceptance.test.ts` fails if a source changes without a reviewed rerun, if a canonical script is skipped, if evidence disappears, or if a measured value misses its versioned target.

## Scope

All 20 scripts across the five canonical fixtures completed in the synthetic harness without facilitator rescue:

- simple Trainer duel;
- crowded wild pack;
- boss phases and environment;
- private reactions and reconnect;
- Capability movement and Feature interaction.

Production-build Chromium acceptance covered desktop and mobile Builder launch, cockpit navigation, exact tactical rendering, action declaration, privacy projection, accessible keyboard paths, responsive region navigation, local display preferences, table-display mode, aggregate metrics, and replay-safe authoritative persistence. Automated Axe checks found no serious or critical violations in required pages. Reviewed screenshots are stored beside the Playwright specs.

The large adapter benchmark projects 256 participants within the 16 ms p95 bound. Action filtering exercises the 2,048-offer contract within the 100 ms p95 bound. Browser acceptance samples tactical startup and a 60-frame p10 rate; the lower bounds are 2 seconds and 30 frames per second respectively. DOM offer and history rendering stays in 80-row batches.

## Interpretation

Every release-gate criterion passes in the **synthetic release environment**. `tactical-lens-invocation-observation` is review-only and is recorded as reviewed rather than treated as lower-is-better.

Synthetic reviewer and scripted timing values are deliberately identified by `measurementKind`. They are not represented as human field observations. Stage 1 rollout must continue aggregate monitoring, and stage 2 remains subject to the observation and rollback gates in `rollout.v1.json`.

## Reproduction

```bash
npx vitest run tests/data/encounterWorkspaceSyntheticAcceptance.test.ts \
  tests/data/encounterWorkspaceFixtures.test.ts \
  tests/server/encounterWorkspaceProjection.test.ts \
  tests/shared/encounterWorkspaceActions.test.ts \
  --maxWorkers=1 --no-file-parallelism

npx playwright test tests/e2e/gm-campaign-toolkit-liveplay.spec.ts \
  tests/e2e/encounter-workspace-shell.spec.ts \
  tests/e2e/encounter-design-system.spec.ts \
  --project=chromium --project=mobile-chromium --workers=1
```

Use an isolated external campaign root and a server that owns the configured port and serves assets from the current `.output`. A health response from a stale process is not acceptance evidence.
