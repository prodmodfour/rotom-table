# Campaign-day preflight, postflight, and continuation acceptance

P8-091 replaces the Campaign page's direct confirmation with an authoritative GM-only review. Advancing one day is still one server-owned campaign operation; the browser can neither predict nor apply recovery, campaign time, Egg progress, or expiring effects.

## Endpoints and commands

`POST /api/campaign/next-day/preflight` accepts exactly schema version 1, a durable `campaign-day:v1:` operation identity, `kind: "advance-one-day"`, and `days: 1`. It is GM-only. The response is one strict `CampaignDayPreflightProjectionV1` in `ready`, `blocked`, or `already-accepted` state.

A ready response contains an opaque content-addressed preflight identity. `POST /api/campaign/next-day` accepts the same exact operation command plus that reviewed identity and a bounded client identity. Unknown fields, malformed identities, a player role, a non-one-day command, changed authority, or blockers fail closed. The preflight identity is command authority, not a durable capability, and is never rendered.

## Exact authority and dry run

The preflight authority digest covers the exact current command, campaign clock, role/Profile-aware continuation projection, Profiles, sheets, maps and interaction modes, Eggs, and all persisted operation sources that feed Campaign attention. Every collection is complete and bounded to 10,000 records. It therefore changes when an active encounter, unfinished settlement, blocking decision, sheet, treatment, Egg, map effect, Profile link, or clock checkpoint changes.

Impact is not a second implementation of next-day mechanics. The server opens a SQLite savepoint and executes `advanceCampaignDayUseCase` with the production repositories, planners, validation, and atomic write path. It captures the accepted summary and affected-sheet successors, suppresses publication, then rolls back to the savepoint and releases it. The preview leaves no operation, sheet, clock, Egg, map, history, or realtime row behind.

Commit plans normally, then invokes the exact preflight-authority assertion inside the same SQLite write transaction before its first reservation or write. A race between review and commit therefore cannot apply a plan under changed authority. Existing sheet/map/clock/Egg revision checks remain in force as a second boundary. Recovery, daily resources, treatment progression, clock advancement, Egg reconciliation, due campaign-time effects, operation acceptance, and durable realtime events commit together or roll back together.

## Blockers and privacy-safe impact

A preflight blocks on:

- any role-visible active or paused encounter;
- any role-visible unfinished settlement; and
- every current Campaign attention item whose authoritative urgency is `blocking`.

The client never infers blockers from labels, colors, notes, or local counts. Each blocker has one generic reason/count and an app-relative server-issued review link. The destination workflow reloads authority before writing.

The impact projection includes bounded aggregate counts and at most 100 affected sheets. Affected rows expose only the authorized sheet label, kind, safe app-relative route, and typed change categories: HP, Injury, Conditions, Daily Moves, AP, or Daily resources. It does not expose Profile IDs, operation/request IDs, source-event IDs, revisions, hashes, Egg IDs, private treatment evidence, notes, provenance, canonical choices, or hidden settlement gates.

## Browser review and recovery

The GM opens **Review next day** from the secondary Campaign rail. The modal shows the exact clock transition, blocker state, recovery metrics, bounded affected sheets, and secondary effect counts. A ready review still requires the explicit checkbox **I reviewed these campaign-wide changes.** before the 44-pixel commit control enables. Native `<dialog>` modality supplies focus containment; Escape and both close controls return focus to the originating Campaign button. Escape and close are disabled during commit.

The exact operation command is retained in strict local storage before preflight. Client mutation starts only from the reviewed `ready` boundary. A network or unknown failure leaves that exact command retained and labels acceptance as uncertain. Reconnection never submits it automatically. **Check accepted status** explicitly posts the same operation to preflight: an accepted operation returns its immutable result; otherwise fresh authority must be reviewed and reconfirmed. A 409 stale/preflight conflict is known not to have accepted that command and requires a fresh review.

Storage changes from another tab invalidate the in-memory review, cancel stale response authority, and require an explicit exact status check. A fresh nonterminal check re-establishes one retained command; commit rechecks storage immediately before posting. Offline state disables recheck and commit. Request generations discard delayed responses after close, replacement, or cross-tab loss.

After acceptance the modal replaces the preview with the exact accepted recovery summary and the Campaign dashboard reloads its whole continuation snapshot. The postflight shows the newly authoritative remaining blocking/urgent/open totals. It never locally subtracts previewed work or assumes recovery cleared an attention item.

## Continuation certification

The accepted chain is composed from the already-certified authoritative surfaces rather than duplicating their mechanics:

1. P8-082 finishes an encounter and atomically settles rewards, captures, cleanup, outcomes, history, and attention seeds.
2. P8-083–P8-089 project exact owner/GM decisions, treatment/recovery work, roster work, and resolution changes.
3. Existing medical and attention packages certify treatment authority and its privacy boundary.
4. P8-091 previews and commits one exact campaign day, then reloads remaining attention.
5. Existing encounter lifecycle tests certify beginning the next scene from current persisted authority.

`tests/e2e/campaign-day-continuation.spec.ts` runs the Campaign portion across simultaneous GM and selected-Profile player clients. It proves the player cannot see the GM tool, the GM must review and confirm, postflight receives the refreshed remaining work, and the player replaces its owner projection after refresh. Chromium and mobile Chromium run the same journey; mobile is additionally constrained to 320 pixels. Axe reports no serious or critical WCAG A/AA/2.1 AA findings in the dialog.

## Visual acceptance

The selected target is `.pi/artifacts/ui-mockups/campaign-day-preflight/v003.png` (9/10). Generated portrait imagery was explicitly excluded because it has no authoritative source and would make dynamic rows less legible. The implementation keeps the target's hierarchy: amber preflight spine, prominent clock transition, mint ready state, compact recovery metrics, real affected-sheet rows, deliberate confirmation, and one primary commit action. It uses the current AppNavigation and Workshop tokens.

Production evidence is under `.pi/artifacts/ui-validation/campaign-day-continuation/`. Desktop preserves a centered bounded review over the 2:1 dashboard. At 320 pixels the dialog reflows metrics and sheet rows into one readable column with internal vertical scrolling and no page-level horizontal overflow. Motion is not required and reduced-motion preferences disable incidental transitions.
