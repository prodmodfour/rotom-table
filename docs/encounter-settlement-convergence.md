# Encounter settlement convergence, correction, and recovery

P8-081 adds the privacy and resilience boundary around atomic encounter settlement. The reviewed contract is [`data/complete-play-loop/encounter-settlement-convergence.v1.json`](../data/complete-play-loop/encounter-settlement-convergence.v1.json).

## Role-safe current loads

`GET /api/encounter-settlements/:settlementId` first checks current map access, then derives one projection from current SQLite authority:

- public viewers receive public rewards, public gates, cleanup categories, completion state, and public history only;
- a player with a selected Profile receives public information plus consequences, gates, destinations, and history that current sheet/Profile or shared-group policy authorizes;
- the GM receives the complete presentation projection, including GM-only narrative outcomes.

The response never includes settlement, reward, allocation, receipt, fact, operation, Profile, source-row, or definition-hash identities. Consequence field paths and before/after values are GM-only. Public and owner history is rebuilt from an allowlist for each fact kind rather than returning stored payloads.

Only the player-facing `main` shared inventory grants destination-owner projection authority. Merely finding another valid group-inventory row does not grant a player access to its rewards or history.

An optional expected revision marks the response `stale-draft` when it differs from the current settlement revision. The current projection is still returned so a client can discard its stale draft and require explicit redeclaration.

## Durable audience-specific realtime

Settlement commit and correction append realtime rows inside the same SQLite transaction as their accepted evidence. Publication occurs only after commit. A publication failure is reported but cannot roll back or reinterpret the accepted transaction; reconnect replay reads the durable rows.

Each accepted revision journals separate public, GM, participant-sheet-owner, and authorized shared-group-owner projections. Access descriptors are re-evaluated from current map, sheet/Profile, and group policy on every SSE delivery and replay. Settlement audience validation additionally ensures:

- a GM receives the GM projection, not later redacted owner variants;
- a player never receives a GM projection;
- public projections use map access;
- owner projections use sheet or shared-group access.

The role-safe load endpoint remains the canonical aggregate after reconnect or when one Profile controls several participant sheets. Realtime revisions are convergence signals; they are not durable capabilities and do not authorize a mutation.

## Explicit uncertain-operation recovery

`POST /api/encounter-settlements/operations/status` accepts exactly one strict commit or correction command. It is GM-only and principal-bound. The response is intentionally small:

- `accepted` returns only operation kind, accepted settlement revision, accepted campaign minute, and `retry: not-needed`;
- `unknown` returns `retry: explicit-only`.

It never returns operation or settlement identities, hashes, stored commands, plans, receipts, or private results. A mismatched principal, changed command, cross-journal identity collision, malformed command, or ambiguous durable row fails closed. Reconnection never submits retained work automatically.

## Authority-linked post-settlement correction

Correction does not rewrite an accepted reward, receipt, history fact, or prior mechanical result. The owning mechanical workflow first supplies one complete current authority snapshot and hash. A strict GM-confirmed correction offer then adds:

- one accepted `gm-correction` decision;
- one correction receipt linked to the exact original non-completion receipt;
- one revision of the still-completed settlement document; and
- one immutable correction operation record.

Completion and cancellation receipts are ineligible. A source receipt may be superseded only once. The offer binds the source receipt, closed reason code, current settlement revision, owning authority reference and hash, campaign minute, exact successor, and GM principal. Commit revalidates the whole offer under a SQLite write lock and checks the current campaign minute before writing.

Correction response and list projections expose only a safe reason code, settlement revision, and campaign minute when the receipt audience is visible to that viewer. They omit source receipts, decisions, principals, authorities, operations, and hashes.

## Immutable audit and exact replay

Accepted commit and correction operations retain private command, plan/offer, authority, result, and hash evidence. Repository reads recompute the accepted plan or offer hashes and cross-check indexed columns. Settlement history and attention-source rows are compared byte-semantically with the hash-bound accepted commit plan, so payload drift fails closed rather than becoming new history.

Commit and correction journals reject an operation identity already present in the other journal. The same command and principal exact-replays from SQLite after restart without reauthorization, writes, or publication. Another command or principal cannot inspect or reuse that identity.

Corrections, operation evidence, and stored private payloads are server-only. Public presentation is always regenerated through the projection allowlists.
