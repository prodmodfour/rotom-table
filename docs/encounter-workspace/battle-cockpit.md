# Battle Cockpit: turn, roster, stage, and decisions

Phases 5 and 6 establish the participant-led encounter spine and source-agnostic action/decision surfaces on `/play/:encounterId`.

## Turn rail

`EncounterTurnRail.vue` presents round, initiative, past/current/upcoming/fainted state, and waiting-decision counts from `EncounterWorkspaceTurn`. Participant buttons inspect without changing initiative. Previous/next controls exist only for the GM and submit ordinary revision-bound `previousInitiative`/`nextInitiative` commands. The workspace reloads authoritative state after acceptance; the control never advances locally.

## Participant anatomy and privacy

`EncounterParticipantCard.vue` presents portrait, identity, role, side symbol, current/control badges, HP, temporary HP, conditions, selection, and inspection. Owner and GM variants may show projected injuries and resources. The public variant omits those rows structurally and does not include them in its accessible name.

No component loads a sheet or infers private state. All values come from the role-projected workspace.

## Side rosters, groups, and teams

`EncounterSideRoster.vue` keeps every participant identity independent while allowing three or more same-species wild participants to collapse into one presentation group. Expansion restores the individual cards and deep-link focus. Current actors and Pokémon on a visible Trainer side are not collapsed as wild groups.

GM/diagnostic projections may include every map-backed Trainer team. Player-owner projections include only controlled Trainer teams. Public projections include no team or reserve identities. Team derivation uses a projected Trainer’s `currentTeam` and `boxedPokemon`; active members must be visible placements on the Trainer’s side, and unplaced authorized sheets become party/boxed reserve rows. Hidden opponents remain a count, never placeholder identities.

Send-out, recall, switch, and reserve controls render only when the server projects matching generic campaign-operation offers. The roster does not invent commands from team membership.

## Battle Stage

`EncounterBattleStage.vue` puts the current actor first, with a full participant card, tactical-focus affordance, selected/inspected context, cast, and environment/objective summary. Weather, terrain, rooms, hazards, and zones are map-backed. Structured objectives remain explicitly unavailable until the later encounter-document decision.

Accepted and corrected participant treatments are derived from the latest authoritative `AcceptedEncounterPresentation` revision. They may trigger finite visual treatment and an `aria-live` summary but never mutate HP, status, resources, or initiative. Reduced-motion mode removes the motion while retaining the state treatment.

## Actions, decisions, and history

The persistent dock, generic decision layer, ordered resolution stack, structured accepted feed, and uncertain-command recovery are documented in `docs/encounter-workspace/action-decision-resolution.md`. These surfaces consume role-projected presentation contracts and do not calculate mechanics in the browser.

## Verification

- `tests/shared/encounterWorkspaceParticipantPresentation.test.ts` checks anatomy mapping, identity-preserving wild grouping, and accepted/corrected derivation.
- `tests/components/encounterWorkspaceParticipants.test.ts` checks privacy variants, turn semantics, grouping/expansion, reserves, hidden counts, environment, objectives, focus hierarchy, and correction treatment.
- `tests/server/encounterWorkspaceProjection.test.ts` checks team privacy and map-backed reserve derivation.
- `tests/e2e/encounter-workspace-shell.spec.ts` exercises the canonical participant fixture on desktop and mobile, keyboard expansion, deep-link focus, GM initiative advancement, automated accessibility, and reviewed visual snapshots.
