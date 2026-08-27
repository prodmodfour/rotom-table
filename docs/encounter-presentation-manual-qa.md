# Encounter presentation operator recovery and manual QA

Use an isolated campaign or the local production-like workspace. Do not alter production application files directly; deploy repository changes through GitHub. Back up production campaign data before any explicitly requested data operation.

## Automated release floor

```bash
npm ci --include=dev
npm run check:encounter-presentation
npm run lint
npm run typecheck
npm test
npm run test:nuxt
npx playwright install chromium
npm run test:e2e
npm run build
```

`test:e2e` builds and starts the production Nitro artifact. The contract preview route is enabled only by the Playwright server environment and is 404 in ordinary production.

## GM/player multi-client checklist

1. Open GM and player contexts with separate browser storage and the intended player profile.
2. Load the same live-play map. Confirm both snapshots have the same map revision but role-specific projection audience.
3. Select a GM-controlled enemy and a player-controlled participant.
   - Player actions contain only controlled actors.
   - GM sees table management actions.
   - Neither surface displays operation/placement/hash IDs as default copy.
4. Trigger a Move and an Ability.
   - Generic declaration is sent before the source workflow.
   - Both clients converge on authoritative HP/conditions/position.
   - The initiating tab and remote tab show one generic outcome/history row.
   - Hidden Ability identity is shown to non-owners only as “Ability”.
5. Exercise Maneuver, Order, movement, Poké Ball, initiative, hazard, field, terrain, scene, and direct participant actions. Verify the generic offer determines availability; legacy menu text cannot manufacture an action.
6. Exhaust a scene/daily action and apply a disabling condition. The action remains understandable with the safe server reason and cannot be activated.

## Pending and recovery checklist

1. Suspend a Move at a choice/reaction window.
2. An unauthorized observer sees only a safe waiting prompt and outstanding count.
3. The responder sees exact options; GM also sees force-pass/cancel recovery.
4. Reload the responder. The same resolution/window/retry and option IDs return.
5. Submit the same response twice. It must not reroll, respent, or recommit.
6. Test pass, cancel, force-pass, expiry/conflict, multi-cell cardinality, and confirmation.
7. Repeat with an Ability pending-view fixture. Confirm responder projection omits hidden Ability/actor identity while GM projection carries audited details.

## Reconnect, replay, and correction

1. Disconnect one client, accept several actions, then reconnect within retention. Rows replay in sequence and duplicate presentation IDs render once.
2. Force a cursor gap or prune old rows. The client blocks commands, loads one aggregate snapshot, replaces (not merges) presentation history, and resumes only after map/sheet/projection revisions agree.
3. Restart the built server between suspension and response. Durable pending Move identity and accepted operation result remain stable.
4. Apply a GM Move correction. Confirm correction headline/history links to the original presentation and rollback IDs reference projected changes.
5. Check the operation-status and abandonment paths: old pre-contract rows may lack generic presentation; new rows retain the exact original.

## Accessibility and motion

- Complete the full offer and pending response flow with keyboard only; focus moves to a newly required response heading and remains visible.
- At 200% zoom and a narrow mobile viewport, controls remain in the viewport and scroll without trapping focus.
- With reduced motion enabled, generic VFX use static/fade/shortened hints and do not convey unique information.
- With animations disabled or hints dropped, map state and history remain complete.
- Verify polite versus assertive live-region announcements with a screen reader. Duplicate deliveries must not repeat announcements.
- Run axe on settled action, pending, result, error, and recovery states. Review contrast and tactical comprehension manually because axe cannot judge them.

## Debugging without leakage

GM diagnostics may inspect `projectionId`, schema version, map revision, source refs, reason codes, and bounded traces. Player support should capture only audience, map/revision, safe reason code, and presentation ID. Never paste private campaign sheets, option payloads, profile IDs, hidden sources, or audit traces into public issue reports.

Useful checks:

```bash
npm run check:encounter-presentation
npx vitest run tests/shared/encounterPresentationRealtime.test.ts \
  tests/server/encounterPresentationReplay.test.ts \
  tests/server/loadLiveTableSnapshot.test.ts
```

## Recovery actions

- **Malformed or mismatched projection:** stop new commands and request `/api/maps/live-state`.
- **Persistent stale projection:** confirm all clients target the same campaign root and deployed commit; inspect map revision and realtime cursor.
- **Publication failure after commit:** do not repeat mechanics manually. Query operation status/snapshot; durable state/result is authoritative and realtime can be replayed.
- **Pending response no longer valid:** use GM force-pass/cancel only through the authorized recovery view.
- **Oversized payload rejection:** reduce projected rows/options or split source-owned choices; never raise limits ad hoc or send executable mechanics.
- **Suspected privacy leak:** stop the affected session, preserve private logs securely, identify the projection boundary, add a serialized-output regression test, and deploy via the normal repository path.
