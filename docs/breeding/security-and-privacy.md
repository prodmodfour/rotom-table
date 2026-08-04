# Breeding security, consent, privacy, and abuse policy

The executable policy inventory is `data/breeding-automation/security-policy.json` (`breeding-security-privacy-v1`). This document explains the reviewed boundary; server contracts and tests must remain hash-bound to the JSON definition.

## Trust boundary

Breeding is a campaign operation. A browser may request a preview, choose a server-issued option, grant narrowly scoped consent, or submit an exact-retry command. It may not submit species resolution, parent roles, traits, inheritance, elapsed time, a child patch, rewards, provider effects, or authority claims.

The server owns:

- campaign and profile authorization;
- Trainer control and parent linkage;
- current parent revisions and effective providers;
- consent validity;
- compiled species and family facts;
- checks, rolls, choices, spends, and time;
- project, Egg, lineage, child, and acquisition persistence;
- role-specific projections and realtime access.

Unknown fields, identities, audiences, mechanics, revisions, or contradictory results fail closed.

## Consent

Cross-owner breeding requires positive consent tied to one project, one parent slug and revision, one consenting profile, bounded scopes, campaign-time expiry/revocation state, an operation ID, and a command hash. It is not a reusable blanket grant.

A grant is accepted only when the profile currently controls the parent owner Trainer and that Trainer currently links the parent. Production rechecks control, linkage, parent revision, expiry, and revocation in the authoritative transaction.

The following never count as consent:

- selecting a parent in a browser;
- a public or player-visible sheet flag;
- a legacy session grant;
- prior participation in another project;
- a free-form note;
- another participant's claim.

A parent revision change before the snapshot invalidates consent and returns the project to awaiting consent. Revocation before Egg acceptance blocks production and remains audited. Revocation after acceptance does not rewrite the immutable Egg or parent snapshot. A GM override requires a typed reason ID and audited operation.

## Audience projections

There are five separate audiences, not one payload hidden with CSS:

- **Public** receives only a configured bounded summary and coarse public-safe lifecycle status.
- **Owner** receives their authorized project or Egg workflow, exact progress, safe explanations, choices they are allowed to make, and resolved offspring facts allowed by owner policy.
- **Participating owner** receives the consent request, their own parent's safe summary, and only their own contribution attribution. They do not receive the other parent's hidden identity or sheet.
- **GM** receives full mechanics, parents, consent, rolls, overrides, lineage, recovery, and audit state.
- **Diagnostic operator** receives hashes and traces only, never sheet, command, option, note, or private profile payloads.

Inheritance candidates shown to the Egg owner omit private attribution to another owner's parent. Full source attribution is GM-only; a participant may see attribution for their own parent.

Control never exceeds visibility. A deep link may adopt only an identity present in the current authorized projection. Unknown or contradictory projection data is discarded and refreshed from the server.

## Realtime and local persistence

Realtime events are refresh signals containing only bounded schema, sequence, aggregate-kind, hashed aggregate identity, revision, operation-kind, and audience-refresh scope fields. They do not carry parents, traits, rolls, consent payloads, commands, choices, sheets, lineage, notes, or authority.

Local persistence is limited to Workshop presentation preferences. Project, Egg, parent, consent, command, choice, roll, time, or authority payloads must not be stored in local storage or IndexedDB.

## Primary threats

The closed threat register covers:

- IDOR and existence-oracle attacks;
- cross-owner use without consent;
- hidden parent, Move, provider, or profile leakage;
- client mechanics and patch injection;
- rerolls, replay, and operation-ID collisions;
- stale consent and parent time-of-check/time-of-use races;
- concurrent double hatch and duplicate rewards;
- realtime and export leakage;
- restore tampering and missing rulesets;
- legacy map-metadata or editable-sheet authority confusion;
- oversized payload, enumeration, and write-rate exhaustion;
- parent evolution, trade, rename, or deletion after Egg acceptance.

Mitigations are exact command parsing, complete transactional read sets, expected revisions, persisted randomness, immutable snapshots, one Egg repository, operation hashes, exact retry results, audience-specific schemas, bounded payloads, rate limits, digest-bound exports, and restore validation.

## Closed limits

The v1 policy bounds commands to 32 KiB, realtime events to 4 KiB, exports to 64 MiB, IDs to 160 characters, narrative fields to 500 characters, choices to 64 options, effective parent Moves to 64 each, inheritance candidates to 256, and operation rolls to 32. List pages default to 25 and cap at 100.

A breeding project has exactly two parents, at most two consent records, and a parent may participate in only one active project at a time. Player writes are limited to 30 per minute and GM writes to 120 per session per minute. Exact-retry receipts remain with campaign data and are not expired merely to permit rerolling.

Negative, unsafe, duplicate, over-bound, and unknown-field input is rejected.

## Audit and failure behavior

Mutations record operation and command hashes, actor and role, aggregate revisions, authorization and consent evidence, ruleset/source/provider hashes, roll and choice identities, GM override reason IDs, terminal results, and event identities.

Unauthorized lookups return not-found or forbidden behavior without becoming an existence oracle. Consent errors include only the requester's own safe context. Stale revisions return a safe current projection. Replay gaps replace local state from a fresh authoritative audience projection.
