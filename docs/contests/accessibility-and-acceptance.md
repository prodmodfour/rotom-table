# Pokémon Contest accessibility and acceptance

## Interaction contract

- Native links, buttons, radios, selects, inputs, details/summary, and forms provide keyboard and switch access.
- Primary actions and dice steppers have at least 44px targets.
- Focus-visible treatment uses design tokens and never relies on color alone.
- The primary current decision precedes secondary score/history content in focus order.
- Destructive cancellation is visually separated from normal controls.
- Accepted/rejected/uncertain states use bounded `status`/`alert` announcements; individual dice are available in an inspector instead of flooding live regions.
- Reduced-motion mode removes transitions and scrolling choreography without hiding terminal state.
- At 200% zoom and 320px reflow, controls stack and any stage-card horizontal movement is contained, not a page-wide trap.
- Public spectators can identify stage, round, actor, center, leader, and last accepted result without receiving offers or GM notes.

## Automated evidence

Focused suites:

```bash
npx vitest run \
  tests/data/contestCoverage.test.ts \
  tests/shared/contestPreparation.test.ts \
  tests/shared/contestEngine.test.ts \
  tests/shared/contestGoldenReplay.test.ts \
  tests/server/contestPreparationRuntime.test.ts \
  tests/server/contestsRuntime.test.ts \
  tests/server/contestsAuthority.test.ts \
  tests/server/contestRealtimePrivacy.test.ts \
  tests/server/contestStorageRecovery.test.ts \
  tests/server/contestPerformanceBudgets.test.ts \
  tests/server/contestUxMetrics.test.ts \
  --maxWorkers=1 --no-file-parallelism
```

Production browser acceptance is `tests/e2e/contests-acceptance.spec.ts`. It creates ordinary sheets and a real Contest through hosted APIs, runs concurrent GM/spectator clients, checks structural privacy, keyboard submission, realtime convergence, axe serious/critical results, 320px reflow, atomic settlement, ribbon persistence, and desktop/mobile screenshots under `.pi/artifacts/ui-validation/contests/`. The accepted package-pinned Playwright traces are archived under `.pi/artifacts/ui-validation/contests/traces/`; their hashes are bound by `data/contests/alpha-acceptance.v1.json`.

## Manual table-distance pass

At the official desktop and mobile viewports, verify:

1. active contestant and center of attention are identifiable within ten seconds;
2. Appeal, Fumble, score, and Voltage are distinguishable at table distance;
3. long Trainer/Pokémon/Move names wrap without covering controls;
4. unavailable Moves include a safe reason;
5. a pending reroll cannot be skipped accidentally;
6. error recovery leaves the legal control operable and focused;
7. spectator and owner views contain no GM note or other owner planning;
8. reduced-motion, keyboard-only, touch, and screen-reader journeys reach settlement.

A serious accessibility, privacy, authority, data-loss, or horizontal-page-trap defect blocks acceptance.