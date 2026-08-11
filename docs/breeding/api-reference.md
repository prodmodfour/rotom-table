# Breeding Workshop API reference

## Scope and trust boundary

These endpoints support the liveplay Breeding Workshop. They accept role context and selectors only. They do not accept resolved mechanics, commands, scopes, rolls, read sets, receipts, consent claims, provider evidence, child documents, campaign-time credit, or aggregate patches.

Every endpoint requires the existing authenticated campaign role. A player request resolves `profileId` through the current selected Profile policy. A GM request must not adopt a player Profile. IDs and expected revisions are conflict selectors, not authorization.

Runtime request and response types under `shared/breeding/*.ts` are definitive. This guide describes schema v1 for integration and QA; it does not replace strict parsers.

## Common protocol

### Authentication and Profile context

- Role is established by the authenticated liveplay session as `player` or `gm`.
- Player requests include the exact current `profileId` where the schema declares it.
- GM POST requests use `profileId: null`; GM GET requests omit `profileId`.
- A player Profile must currently link the selected Trainer. A query/body Trainer slug does not grant control.

### Strict JSON ingress

All Breeding POST bodies must be one valid UTF-8 JSON object no larger than 32 KiB. The parser rejects:

- missing, unknown, non-enumerable, accessor-backed, or symbol fields;
- sparse, enriched, duplicate, unsorted, or over-limit arrays;
- malformed IDs/slugs, unsafe integers, contradictory nulls, or implicit coercion;
- `NaN`, infinity, BigInt, Promise-like values, or non-plain prototypes;
- mechanics or evidence fields not declared by the endpoint schema.

Use `Content-Type: application/json`. Do not send a full Project, Egg, Pokémon sheet, Profile, command, or projection back to the server.

### Responses

Success returns the endpoint's strict audience projection as JSON. Projection schemas are server-built, bounded, security-policy-bound, and self-hashed. Clients must parse the exact schema and verify its digest before adoption. Never merge a GM response into a player view.

Mutation responses may report a durable recovery state or exact replay. Treat either as authoritative presentation; do not infer or re-execute mechanics in the client.

### Errors

| Status | Meaning | Client action |
| --- | --- | --- |
| `400` | Malformed shape or contradictory selectors | Discard request state and rebuild from current controls. |
| `403` | Current role/Profile/Trainer authority unavailable | Stop; do not enumerate alternate IDs. |
| `409` | Stale revision, option, consent, reference, or operation authority | Reload the authorized projection before a new intent. |
| `413` | POST body exceeds 32 KiB UTF-8 or contradicts declared length | Remove undeclared data; never split one operation. |
| `429` | Mutation admission limit reached | Wait the integer `Retry-After`, then retry the same selector intent. |

The write limiter permits 30 writes per minute for one player Profile and 120 per minute for the authenticated GM process session. Reads, inspections, guidance, and unconfirmed choice requests do not consume mutation allowance. Rate-limit wall time is availability control only and never campaign time.

## Endpoint summary

| Method | Path | Purpose | Mutation admission |
| --- | --- | --- | --- |
| `GET` | `/api/breeding/workshop` | Bounded authorized Trainer contexts and safe empty state | No |
| `GET` | `/api/breeding/workshop/activity` | Current Project/Egg cards for one authorized Trainer | No |
| `POST` | `/api/breeding/projects/wizard` | Current non-mutating wizard and parent preview | No |
| `POST` | `/api/breeding/projects/wizard/guidance` | Current safe explanations and GM-only bounded diagnostics | No |
| `POST` | `/api/breeding/projects/wizard/choices` | Server-issued choices; explicit confirmed Project creation | Only when `confirmed: true` |
| `POST` | `/api/breeding/hatch` | Inspect, begin, special review, and complete hatch | Every intent except `inspect` |
| `POST` | `/api/breeding/consent` | View or explicitly mutate Project/transfer consent | Every intent except `view` |

## `GET /api/breeding/workshop`

### Query

Player fields:

- `profileId` — selected current Profile ID; omission produces the safe Profile-required state.
- `trainerSheetSlug` — optional requested authorized Trainer context.
- `ownershipCursor` — optional opaque ordering cursor returned by a prior page.

GM fields:

- `trainerSheetSlug` — optional requested current campaign Trainer.
- `ownershipCursor` — optional cursor.

Unknown query fields are rejected. The cursor only selects the next canonical page and never authorizes ownership.

### Response

`BreedingWorkshopProjectionV1` includes audience, generated campaign minute, Profile-selection state, current/next cursor, at most 100 ownership contexts, selected context, safe empty state, security-policy hash, and projection hash. Each context contains only Trainer slug/revision, safe display name, availability, unavailable reason, and `hasProjects`/`hasEggs` booleans.

It does not contain aggregate IDs, parents, Species, consent, choices, mechanics, operations, or Profile IDs.

## `GET /api/breeding/workshop/activity`

### Query

- Player: exact `profileId` and `trainerSheetSlug`.
- GM: `trainerSheetSlug`; omit Profile.

### Response

`BreedingWorkshopActivityProjectionV1` returns the authorized Trainer summary, up to 50 recent owner Projects and 50 owner Eggs, truncation flags, bounded history, current campaign progress, transfer presentation, recovery summaries, security-policy hash, and projection hash.

Owner Project cards structurally hide a participating parent's identity. GM cards may include current parent references for adjudication but still omit Profile, command, roll, read-set, receipt, and provider evidence.

## Wizard selector request

Both wizard and guidance use `BreedingProjectWizardRequestV1`:

```json
{
  "schemaVersion": 1,
  "profileId": "profile_example0001",
  "destinationTrainerSlug": "trainer-mira",
  "breederTrainerSlug": "trainer-mira",
  "parentRefs": [
    { "pokemonSheetSlug": "parent-one", "expectedSheetRevision": 4 },
    { "pokemonSheetSlug": "parent-two", "expectedSheetRevision": 7 }
  ]
}
```

Use `profileId: null` as GM. `parentRefs` contains zero to two unique current selectors. Revisions prevent stale adoption; they do not grant access.

## `POST /api/breeding/projects/wizard`

Returns `BreedingProjectWizardProjectionV1`: destination/Breeder contexts, current parent discovery, safe compatibility preview, consent/review status, and the fixed campaign timeline of 240 initial minutes, DC 12, 240 additional minutes, and at least 480 minutes before Egg production.

This endpoint never creates a Project, records consent, rolls a check, advances time, or creates an Egg.

## `POST /api/breeding/projects/wizard/guidance`

Accepts the same wizard request. Returns `BreedingProjectGuidanceProjectionV1`, including the exact current wizard projection, closed reason explanations, safe Breeder/Dilettante contribution status, and `gmDiagnostics`.

- Owner response: `gmDiagnostics` is exactly `null`.
- GM response: diagnostics contain bounded counts and enums only.

Cross-owner private mechanics are not resolved or projected before consent.

## `POST /api/breeding/projects/wizard/choices`

### Request

`BreedingProjectChoicesRequestV1` contains:

- `schemaVersion: 1`;
- player Profile ID or GM `null`;
- destination and Breeder Trainer slugs;
- zero to two parent sheet/revision refs;
- current opaque `draftId`;
- sorted unique current `selectedOptionIds`;
- explicit `confirmed` boolean.

An unconfirmed request refreshes choices only. A confirmed request enters write admission and rebuilds all current authority before Project creation.

```json
{
  "schemaVersion": 1,
  "profileId": "profile_example0001",
  "destinationTrainerSlug": "trainer-mira",
  "breederTrainerSlug": "trainer-mira",
  "parentRefs": [
    { "pokemonSheetSlug": "parent-one", "expectedSheetRevision": 4 },
    { "pokemonSheetSlug": "parent-two", "expectedSheetRevision": 7 }
  ],
  "draftId": "breeding-project-draft:v1:0123456789abcdef0123456789abcdef",
  "selectedOptionIds": [],
  "confirmed": false
}
```

### Response

`BreedingProjectChoicesProjectionV1` nests current guidance and exposes only current opaque options, rank status, campaign-setting labels, confirmation state, and a bounded accepted Project reference after success. It does not resolve final Nature, Ability, Gender, offspring Species, or Egg facts.

## `POST /api/breeding/hatch`

### Request

`BreedingHatchWorkflowRequestV1` fields:

- `schemaVersion: 1`;
- player Profile ID or GM `null`;
- owner `trainerSheetSlug`;
- `eggId` and `expectedEggRevision`;
- `intent`: `inspect`, `begin`, `resolve-special`, or `complete`;
- `destinationOptionId` — non-null exactly for `begin`;
- `selectedOptionId` — non-null exactly for `resolve-special`;
- `confirmed` — `false` exactly for `inspect`, `true` for mutation intents.

Inspection example:

```json
{
  "schemaVersion": 1,
  "profileId": "profile_example0001",
  "trainerSheetSlug": "trainer-mira",
  "eggId": "pokemon-egg:v1:0123456789abcdef0123456789abcdef",
  "expectedEggRevision": 4,
  "intent": "inspect",
  "destinationOptionId": null,
  "selectedOptionId": null,
  "confirmed": false
}
```

The client never sends destination kind/capacity, d100, outcome, child data, roster entries, traits, or acquisition facts.

### Response

`BreedingHatchWorkflowProjectionV1` reports strict stage, safe Egg summary, current decision, destination offers, role-appropriate special state, accepted child reveal, recovery, transition, and hashes. Owners never receive GM special options or raw operation evidence. Accepted completion exposes only bounded navigation/presentation facts.

## `POST /api/breeding/consent`

### Request

`BreedingConsentWorkflowRequestV1` always contains all fields:

- `schemaVersion: 1`;
- player Profile ID or GM `null`;
- selected `trainerSheetSlug`;
- one intent;
- Project selectors: `projectId`, `expectedProjectRevision`, `parentSheetSlug`, `consentId`;
- transfer selectors: `eggId`, `expectedEggRevision`, `destinationTrainerSlug`, `transferConsentId`;
- `confirmed`.

Unused selectors must be `null`. Valid intents are:

- `view`;
- `grant-project-consent`;
- `revoke-project-consent`;
- `offer-egg-transfer`;
- `accept-egg-transfer`;
- `revoke-egg-transfer-consent`;
- `complete-egg-transfer`;
- `gm-cancel-project`.

View example:

```json
{
  "schemaVersion": 1,
  "profileId": "profile_example0001",
  "trainerSheetSlug": "trainer-mira",
  "intent": "view",
  "projectId": null,
  "expectedProjectRevision": null,
  "parentSheetSlug": null,
  "consentId": null,
  "eggId": null,
  "expectedEggRevision": null,
  "destinationTrainerSlug": null,
  "transferConsentId": null,
  "confirmed": false
}
```

Every mutation intent requires exact selectors and `confirmed: true`. GM cancellation is GM-only. GM authority cannot grant/revoke Project consent or create either transfer consent.

### Response

`BreedingConsentWorkflowProjectionV1` contains current private cards, bounded notifications, safe transition, and hashes. Counterpart identity and private mechanics are omitted where the viewer does not own them. Pending operations replace normal actions with recovery state and no command payload.

## Realtime and caching

Breeding mutations publish restricted refresh notifications, not full mechanics payloads. On a refresh or replay gap, discard stale local projection state and call the relevant GET/POST inspection endpoint again. Do not cache a server-issued option beyond the projection/draft/revision that issued it. Do not persist consent, Project, Egg, option, command, or mechanic data in browser storage.

## Non-HTTP operational surfaces

Campaign-clock advancement, archive restore, integrity diagnostics, reviewed alternate-source Egg creation, and low-level operation recovery are server/operator use cases, not public browser APIs. Do not expose them by copying internal commands into a new route. Any future route requires a strict selector schema, current authorization, privacy projection, abuse admission, transaction/retry evidence, documentation, and acceptance coverage.
