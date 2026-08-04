# Encounter workspace UX success criteria

- Contract: `encounter-ux-success-v1`
- Date: 2026-08-04
- Structured criteria: [`data/encounter-workspace/ux-success-criteria.json`](../../data/encounter-workspace/ux-success-criteria.json)
- Task baseline: [Current encounter task inventory](current-encounter-task-inventory.md)
- Baseline evidence owner: EUX-009

## Policy

The encounter redesign is accepted by measurable task, safety, accessibility, privacy, and performance outcomes—not by screenshot preference alone. The structured contract freezes 25 criteria before implementation fixtures are built.

Baseline values that do not yet exist are explicitly `pending`; EUX-009 captures them against the compatibility route. Targets are not retroactively weakened to make the existing UI pass. Criteria with `releaseGate: true` must pass before EUX-100.

Metrics never make mechanics authoritative in the browser. They observe presentation transitions and accepted terminal state. Production aggregation cannot retain participant IDs, rules choice values, private prompts, hidden identities, or raw mechanic payloads.

## Primary outcomes

| Outcome | Target |
| --- | ---: |
| Critical task completion without facilitator rescue | ≥95% overall and reviewed per task |
| Expected action discovery | median ≤5s; p90 ≤10s |
| Pointer action activation after actor selection | p90 ≤3 interactions |
| Keyboard activation of a known action | p90 ≤8 interactions |
| Authorized response completion | median ≤8s; p90 ≤15s |
| Unintended response abandonment/GM rescue | ≤2% |
| Non-spatial tasks forced into tactical lens | 0% |
| Exact spatial choices complete through tactical lens | 100% |
| Uncertain command reaches safe terminal state | p90 ≤30s |
| Duplicate durable mutations after retry/reconnect | 0 |
| Reconnect workspace convergence | p90 ≤5s |
| Private choice/hidden-state disclosures | 0 |

## Accessibility and readability gates

- zero serious or critical Axe violations across required audiences, themes, viewports, pending, recovery, and tactical states;
- 100% completion of critical keyboard-only scripts with focus restoration;
- 100% of primary narrow-layout controls meet a 44×44 CSS-pixel target, with documented equivalent-control exceptions only;
- current actor, round, blocking responder/prompt, and critical HP state identified within five seconds by at least 95% of table-distance checks;
- 100% completion of core non-tactical flows at 200% zoom and 320 CSS-pixel width without clipped commit/cancel controls or two-axis page scrolling;
- colour, motion, and hover are never the sole information channel.

Automated checks are necessary but not sufficient. EUX-093 retains manual screen-reader, switch-access, zoom, and table-display evidence.

## Performance gates

| Measure | Target |
| --- | ---: |
| Pure map-backed adapter + role projection, largest fixture | p95 ≤16ms |
| Local selection/dock/filter/inspector event-to-paint | p95 ≤100ms |
| Accepted event adoption to presentation start | p95 ≤250ms |
| Tactical lens cold readiness on lower-end profile | p95 ≤2s |
| Tactical lens warm readiness | p95 ≤1s |
| Large-fixture tactical interaction | p10 ≥30 FPS |

The lower-end hardware/browser profile is recorded with EUX-009 and held stable for EUX-068/EUX-095. Optional VFX may be reduced for the frame-rate test; exact geometry, participant state, focus, and decision controls may not be removed.

## Progressive spatiality measurement

Tactical lens frequency is **not** a global lower-is-better metric.

- non-spatial tasks have a hard 0% forced-lens gate;
- exact spatial tasks have a hard 100% usable-lens gate;
- relationship and mixed tasks are measured by spatiality and fixture so unexpected invocations can be reviewed;
- explicit user inspection does not count as a forced invocation;
- cancellation and focus restoration are part of exact-spatial completion.

This prevents the team from gaming the redesign by either forcing the map everywhere or hiding it when exact geometry matters.

## Event timing model

The metric vocabulary is source-agnostic:

```text
workspace-ready
  -> actor-selected
  -> action-dock-opened / action-filtered
  -> action-activated
  -> decision-presented
  -> decision-submitted
  -> resolution-waiting
  -> resolution-settled
  -> accepted-presentation-started
  -> accepted-presentation-settled
```

Conditional branches use:

```text
tactical-lens-opened -> tactical-lens-ready
system-recovery-opened -> system-recovery-terminal
```

Only monotonic local timing, fixture/task labels, role kind, viewport/input/motion classes, spatiality, and terminal status are needed. Correlation to server diagnostics remains an explicit authorized test/Inspector operation rather than normal telemetry.

## Measurement protocol

1. Use the five canonical fixtures from EUX-004 through EUX-008.
2. Run required audience variants separately; never infer privacy from CSS-hidden content.
3. Begin timers only at the defined visible event and end at user commit or authoritative terminal event as specified.
4. Keep network wait out of discovery and local-interaction metrics; include it in reconnect/recovery convergence where specified.
5. Record median/p90/p95/p10 from enough deterministic runs to make the percentile meaningful; test harnesses use fixed warm-up and sample counts.
6. Report failures per task, fixture, role kind, viewport class, input kind, and motion preference using only allowed aggregate dimensions.
7. Preserve screenshots, accessibility trees, trace summaries, and raw benchmark output only in explicit non-private test fixtures.
8. A criterion marked `review` generates evidence and an outlier decision; it is not silently converted to pass/fail.

## Visual hierarchy gates

- zero obscured primary prompt, option, commit, cancel, or recovery controls in required visual fixtures;
- every fixture-declared expected action remains visible to its authorized user, including unavailable actions, with a concise non-diagnostic reason;
- no internal ID, hash, handler, operation key, or automation coverage label appears in ordinary player flow;
- one blocking decision or system workflow is visually primary;
- public waiting, authorized choices, and GM recovery remain structurally distinct projections.

## EUX-003 acceptance

The contract covers:

- action-discovery time and interaction count;
- pending-response completion and abandonment;
- progressive tactical-lens use;
- uncertain-command recovery, reconnect, and duplicate prevention;
- task completion, expected unavailable actions, and overlay collisions;
- privacy, keyboard, touch, zoom, automated accessibility, and table-distance readability;
- adapter, interaction, accepted-presentation, tactical startup, and frame-rate budgets;
- privacy-safe event names and aggregate dimensions;
- honest pending baseline ownership under EUX-009.
