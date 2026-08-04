# ADR 015: Role-projected Encounter Workspace

- Status: Accepted
- Date: 2026-08-04

## Context

The compatibility map route combines map rendering, sheet state, initiative, automation offers, pending interactions, accepted outcomes, and recovery controls across source-specific panels. A replacement workspace must improve live-play hierarchy without moving authority into the browser or revealing hidden campaign facts. It must also coexist with the current map persistence model while structured objectives, phases, stakes, notes, and waves do not yet exist there.

## Decision

1. Keep `LiveTableSnapshot`, server command handlers, and automation runtimes authoritative.
2. Build a bounded schema-v1 `EncounterWorkspaceViewModel` on the server from a revision-aligned map snapshot and generic Encounter Presentation projection.
3. Require distinct GM, player-owner, public, and diagnostic projection policies. Non-GM policies require explicit visible participant sets; control must be an explicit subset of visibility.
4. Sanitize accepted events that involve hidden participants rather than relying on client-side hiding.
5. Declare map-backed authoring limitations explicitly and leave unsupported structured collections empty.
6. Model client interaction with pure selection, phase-machine, priority, accepted-queue, and adoption reducers. Accepted server facts remain the only source of mechanical change.
7. Treat replay gaps and uncertain revisions as command-blocking recovery states.
8. Persist only versioned, bounded presentation preferences. Preference storage cannot contain campaign data or influence mechanics, action authorization, target legality, pending options, or server projection.
9. Migrate the `/maps/:slug` experience incrementally behind a reversible route boundary, retaining compatibility access until the acceptance matrix is complete.

## Consequences

- Privacy is structural and testable at the server boundary.
- GM and player clients share one workspace vocabulary without sharing the same data shape.
- Reconnect, duplicate realtime delivery, local HTTP echo, and replay-gap replacement have deterministic behavior.
- Unsupported encounter concepts are visible as limitations rather than inferred or silently fabricated.
- Local preferences can be reset or discarded without changing encounter state.
- Later workspace UI phases can replace compatibility panels without rewriting command or automation authority.
