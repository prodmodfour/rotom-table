# Campaign continuation dashboard

The Campaign page at `/campaign` is the campaign-scoped place to answer “what should the table do next?” It is a liveplay dashboard, not a second sheet editor, encounter engine, settlement planner, breeding workshop, or Profile manager.

## Information hierarchy

The page deliberately presents work in this order:

1. current active or paused encounter resumption;
2. the freshest visible unfinished encounter settlement;
3. the highest-priority open attention item and every legal route for it;
4. all current attention grouped under **Needs a decision**, **Recovery & care**, **Growth & training**, **Team, captures & eggs**, and **Equipment**;
5. a compact blocking/urgency summary;
6. the GM-only **Next day** campaign tool; and
7. the existing GM guided-item adjudication queue.

The recommendation is the first item in the server's deterministic attention order. The browser does not re-rank by labels, names, prose, or local state. Empty groups remain visible as quiet explicit states so the absence of work is distinguishable from an incomplete load.

## Authoritative projection

`GET /api/campaign/continuation` returns strict schema version 1. It contains:

- the complete role/Profile-filtered `CampaignAttentionProjectionV1` from P8-089;
- at most one primary active encounter and a count of additional active encounters;
- at most one freshest unfinished settlement and a count of additional unfinished settlements;
- a role-safe count of active Eggs by lifecycle state; and
- one content-addressed whole-dashboard snapshot identity.

The endpoint accepts only the optional selected `profileId`. Authentication establishes the role. For a player, the server resolves the exact current Profile and counts only Eggs owned by directly linked Trainer sheets. Encounter summaries come from the existing role-filtered workspace list. An unfinished settlement is shown only when its encounter is in that visible list. Only the GM receives an unresolved-gate count; the player receives `null` rather than hidden settlement detail.

The attention, workspace, settlement, Egg, and campaign-clock reads are assembled inside one synchronous SQLite transaction. Each authority collection is complete and bounded to 10,000 records. Duplicate current identities, collection overflow, malformed stored settlements, disappearing settlement rows, changed Profile authority, role/scope mismatch, and partial attention authority fail closed.

## Privacy boundary

The projection and page intentionally do not render:

- Profile IDs or display names;
- Egg, settlement, operation, request, action, decision, authority, or attention row IDs;
- hashes, accepted-command evidence, source-event identity, revisions, provenance, or private notes;
- private canonical choices; or
- hidden encounter or settlement details.

Trainer and Pokémon sheet slugs may appear only as the already-authorized destination label and route. Profile, Egg, settlement, encounter, breeding-project, and campaign entities use generic safe labels. Legal action routes are server-issued app-relative handoffs; the destination workflow must reload current authority before any write.

## Realtime and request races

The dashboard subscribes to campaign-attention, sheet, encounter-library, and role-appropriate breeding invalidations. Reconnect, replay completion, and reconciliation requirements schedule a fresh complete projection load. Bursts are briefly coalesced.

The client never merges attention rows, Egg counters, encounter context, or settlement context locally. Every request receives a monotonically increasing generation scoped to the current role/Profile principal. Only the latest generation for that exact principal may replace state. A Profile change resets the whole retained projection; a delayed response from the previous Profile is discarded. Equal content-addressed responses retain object identity and cannot duplicate rows.

A refresh failure leaves the last complete projection visible with an explicit alert and retry. It never converts retained work into a local empty state.

## Interaction and accessibility

- All handoffs are real links; Refresh and Next day are buttons.
- Controls have at least a 44-pixel target and a visible cyan focus outline.
- Headings, lists, definition lists, status/alert regions, and explicit state words preserve non-color meaning.
- Desktop uses a 2:1 work/summary hierarchy. Narrow screens stack without horizontal overflow; action links become full-width controls.
- Motion is not required, and reduced-motion preferences disable incidental transitions or animation.
- Matte Workshop surfaces, warm text, one notched recommendation, restrained amber/cyan/mint state signals, and a single emphasized recommended route follow `DESIGN.md`.

The selected target-state artifact is `.pi/artifacts/ui-mockups/campaign-continuation-dashboard/v002.png`, scored 10/10 in the adjacent review. The implementation preserves the real `AppNavigation` and uses authoritative dynamic counts rather than mock values. P8-091 now opens the separate GM-only campaign-day preflight/postflight contract from the deliberately secondary Next day rail.
