# Encounter Workspace rollout and rollback

The machine-readable rollout contract is [`data/encounter-workspace/rollout.v1.json`](../../data/encounter-workspace/rollout.v1.json). The Encounter Workspace is presentation and orchestration. It does not become authority for maps, sheets, commands, choices, receipts, or mechanics during rollout.

## Staged migration

1. **Internal, disabled as the default.** Keep the workspace route enabled for acceptance while live-play links still default to the Battlefield Workshop. Collect aggregate-only UX metrics.
2. **GM opt-in.** Enable selected campaigns after operator briefing. Move one flow at a time: discovery, turn observation, action declaration, pending response/recovery, tactical input, then Director controls.
3. **Workspace default with Workshop fallback.** Change only `encounterWorkspaceDefaultForLivePlay`. Keep the Workshop and source-owned tactical workflows available.

A stage advances only after its manifest entry and exit gates pass. Aggregate rows are grouped by closed role, viewport, input, motion, fixture, spatiality, and terminal-status dimensions. They contain no campaign, encounter, participant, prompt, option, or command identity.

## Rollback drill

1. Stop stage advancement and record the triggering criterion.
2. Set `encounterWorkspaceDefaultForLivePlay=false`.
3. Keep `battlefieldWorkshopEnabled=true` so existing exact-geometry and source-owned command workflows remain available.
4. Leave `encounterWorkspaceEnabled=true` for diagnosis unless projection privacy itself is compromised. If it is compromised, disable workspace availability too.
5. Do **not** downgrade SQLite, delete Encounter Documents, delete receipts/events, or rewrite maps and sheets. Presentation flags are independent from campaign authority.
6. Preserve exact failed request and operation receipt. Retry only through the owning replay-safe command use case.
7. Validate `/maps/:slug`, `/play`, and explicit `/play/:encounterId`; verify current actor, pending interactions, accepted history, and revisions converge.
8. Run privacy, replay, migration, compatibility-route, desktop/mobile accessibility, and tactical-boundary suites.
9. Re-enter at the previous stage only after the trigger has a reviewed fix and all gates pass.

## Critical triggers

Any private projection leak, duplicate durable mutation, or command-authority bypass rolls back immediately. High-severity aggregate regressions use the thresholds in the manifest, including task completion below 95%, any serious accessibility violation, or tactical startup p95 above 2 seconds.

## Operator smoke checklist

- [ ] GM, owning player, public, and diagnostic projections expose only their authorized identities.
- [ ] Deep links adopt only identities in the loaded projection.
- [ ] The Action Dock declares through an authoritative offer receipt; final mechanics stay source-owned.
- [ ] Pending private options are absent from public responses and DOM.
- [ ] Retry/reconnect produces one durable mutation and converges to the newest revision.
- [ ] Tactical lens origin/source/revision checks reject invalid bridge messages.
- [ ] Closing a decision, tactical lens, settings dialog, and Director dialog restores meaningful focus.
- [ ] Mobile controls are unobscured and at least 44 by 44 CSS pixels.
- [ ] Reduced-motion and high-contrast preferences affect presentation only.
- [ ] Rollback changes flags only and leaves all campaign records readable.
