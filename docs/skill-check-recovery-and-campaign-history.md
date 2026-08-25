# Skill Check recovery and campaign history

P11-052 closes the generic Skill Check surface across reconnect, restart, concurrent delivery, campaign attention, and terminal campaign history. The runtime continues to use the schema-v1 `SkillCheckDocument` and schema-v50 SQLite tables established by P11-045.

## Liveplay workflow

The GM opens Generic Skill Checks in the Encounter Director, selects one through 32 current Trainer/Pokémon subjects and one canonical Skill per subject, then declares public/private text, DC or opposed policy, visibility, concealment, situational modifier, and expiry. Each controlled subject accepts or declines through its own Profile projection. The GM resolves only after the document is ready; the server owns every d6, modifier, comparison, result, and journal row. Spectators receive pending counts and permitted aggregates only.

The browser submits strict intent and issued identities, never a roll, total, winner, or correction result. See [Deferred mechanics closure](deferred-mechanics-closure.md) for player, GM, contributor, and operator context.

## Atomic command and recovery boundary

Every request, response, resolve, cancellation, and server timeout is represented by a strict command with a canonical command hash, operation identity, expected document revision, and principal key. A mutation performs the plus-one document replacement and operation-journal insert in one synchronous `BEGIN IMMEDIATE` transaction.

- A stale expected revision fails before a document, operation, roll, or invalidation write.
- Reusing an operation identity with different input or a different principal fails closed.
- Replaying byte-equivalent input under the original principal returns the original receipt. Resolution replay reads no current time, sheet authority, or entropy and never rolls again.
- Failures injected after the document write or after the operation write roll back both rows.
- File-backed SQLite close/reopen preserves the current document, operation evidence, journals, accepted results, and exact replay behavior.
- Group subjects still use one shared document CAS. Concurrent clients cannot both advance the same revision; the stale client reloads the current projection and submits a new command against that revision.

Campaign-attention invalidation is emitted only after the transaction commits. It is a transient reload hint rather than command authority. Exact replay and rollback emit no duplicate hint. If transient publication itself fails, the accepted command still returns successfully; manual refresh, reconnect, and complete-snapshot reconciliation recover presentation.

## Unresolved campaign attention

The complete campaign-attention authority read now includes every current Skill Check document in the same bounded SQLite transaction as the other providers.

- A pending check creates an informational GM observation.
- Each still-pending subject creates owner work for every exact controller Profile snapshotted when the request was created.
- A ready check or a check containing a declined response creates urgent GM review.
- Accepted, cancelled, and timed-out checks create no open attention.

Owner projection matches the exact Profile before replacing the internal Profile entity with a neutral campaign entity. The response therefore carries no Profile ID or display name. All actions return to `/play`; the campaign dashboard never exposes check IDs, subjects, prompts, Skills, notes, revisions, or operation evidence in visible copy.

## Terminal campaign history

`GET /api/skill-checks/campaign-history` is an authenticated, read-only terminal projection.

- GM calls cannot provide a Profile and receive generic `resolved` outcomes.
- Player calls require one server-resolved current Profile and include only checks whose stored controller snapshot contains that Profile.
- Accepted owner rows expose only the owner's own outcome, an aggregate `mixed` label for multiple controlled subjects, or explicit `withheld` under GM-only result visibility.
- Cancelled and timed-out rows carry no outcome.
- Entry identities are one-way hashes. Public label, lifecycle word, terminal time, and the allowed outcome are the complete shape.

The strict response parser rejects extra fields, cross-role shapes, invalid lifecycle/outcome combinations, duplicate identities, future or out-of-order times, and more than 20 rows. The campaign card initially renders four rows, requires explicit expansion for later rows, retains the last complete projection across malformed refreshes, and provides a 44-pixel `Open Live Encounter` action. It does not receive GM notes, situational modifiers, controller IDs, sheet slugs or revisions, subjects, dice, totals, journals, corrections, operations, hashes, or diagnostics.
