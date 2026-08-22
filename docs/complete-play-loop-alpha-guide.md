# Complete Play Loop alpha guide

Rotom Table's complete loop is liveplay-only: acquire items, move them into exact custody, equip or use them, run and finish an encounter, settle rewards and captures, resolve follow-up work, advance the campaign day, and begin the next scene from current authority.

Choose the guide for your role:

- [Player guide](complete-play-loop-player-guide.md) — inventory, equipment, item use, decisions, recovery, and privacy.
- [GM guide](complete-play-loop-gm-guide.md) — guided adjudication, Finish Encounter, correction, Campaign attention, and Next day.
- [Contributor guide](complete-play-loop-contributor-guide.md) — canonical data, item states, providers, migrations, evidence, and tests.
- [Operator guide](complete-play-loop-operator-guide.md) — liveplay deployment, persistence, backup, checks, and troubleshooting.

## Shared product model

### Item states

- **Native:** the server has structured mechanics, validates current source/actor/target/choice authority, and commits effects plus custody atomically.
- **Guided:** the server creates a bounded private GM decision from reviewed structured data. The GM may choose only listed options; prose does not become mechanics.
- **Passive:** an equipped/held provider contributes only while exact custody, compatibility, activity, definition, and lifecycle authority remain current.

All 349 current canonical rows are in one of those three complete states: 205 native, 40 guided, and 104 passive. There are no blocked rows. `reference-only` and `not-applicable` remain review vocabulary but are not assigned to a current canonical row; neither may hide concrete mechanics.

### Acceptance boundaries

A preview is not acceptance. A command is accepted only when the server commits one exact transaction and returns durable evidence. Stale rows, changed definitions, invalid choices, incomplete reads, conflicting revisions, and unknown handlers fail closed.

A timeout is not rejection. Keep the exact pending command, reconnect, and check status. Reconnect never submits automatically. If no accepted result exists, explicitly retry the exact command or discard it after review; conflicts require a fresh offer and redeclaration.

### Privacy

Screens may show safe labels, quantities, costs, consequences, revision-neutral status, and role-authorised summaries. They do not expose operation identities, Profile identities, stable row identities, hashes, private notes, ownership evidence, or provider internals.

## Detailed references

- [Unified inventory actions](unified-inventory-actions.md)
- [Inventory source selection](inventory-source-selection.md)
- [Equipment lifecycle](equipment-lifecycle.md)
- [Guided item adjudication](guided-item-adjudication.md)
- [Finish Encounter](finish-encounter-experience.md)
- [Atomic settlement](encounter-settlement-atomic-commit.md)
- [Settlement convergence and correction](encounter-settlement-convergence.md)
- [Campaign continuation dashboard](campaign-continuation-dashboard.md)
- [Campaign-day continuation](campaign-day-continuation.md)
- [Authority guardrails](complete-play-loop-authority-guardrails.md)
- [Performance budgets](complete-play-loop-performance-and-scale.md)
- [Accessibility acceptance](complete-play-loop-accessibility-responsive-visual-acceptance.md)
- [Failure acceptance](complete-play-loop-concurrency-reconnect-failure.md)
- [Golden campaigns](complete-play-loop-golden-campaigns.md)
