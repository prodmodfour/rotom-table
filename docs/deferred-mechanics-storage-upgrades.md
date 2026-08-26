# Deferred Mechanics Closure storage upgrades

P11 adds four contiguous SQLite schema versions to the existing campaign database. Startup applies them through `applyStorageMigrations`; operators must not hand-edit `PRAGMA user_version`, skip a version, weaken a table constraint, or rewrite campaign rows to make an upgrade pass.

| Version | Added authority |
| ---: | --- |
| 47 | replay-safe Encounter equipment-action operations |
| 48 | durable guided fishing declarations and cancellation |
| 49 | durable guided Snag Machine conversion adjudication |
| 50 | versioned generic Skill Check documents and operation receipts |

Trainer Participant and Battle Contest state remains inside the existing schema-v46 Contest document and operation tables. Their schema-v1 document parsers normalize only reviewed additive historical fields and fail closed on malformed or future documents; no separate Contest table or parallel migration exists.

## Fresh campaigns

A fresh database runs all registered versions in one `BEGIN IMMEDIATE` transaction and currently ends at schema v56. The accepted P11 v47–v50 equipment-action, guided-request, Contest, Skill Check, operation, and index authority remains present; P12 adds the contiguous GM Campaign Toolkit v51–v56 layer without rewriting it. Migration versions must remain contiguous and the declared latest version must equal the last registered migration.

## Existing campaigns

The supported upgrade begins from any known historical version. P11-082 specifically certifies:

- a Plan 10 schema-v46 campaign upgraded through v47, v48, v49, and v50;
- exact v47 equipment-action rows upgraded through later versions;
- exact v48 fishing rows preserved through the v49 guided-request table rebuild and v50;
- exact v49 Snag conversion rows preserved through v50; and
- ordinary schema-v46 Contest documents retained byte-for-byte and accepted by the current strict parser.

The v48 and v49 rebuilds require the exact predecessor table definition. If the definition is missing or manually weakened, migration rolls back, leaves the prior `user_version` in place, and creates no partial replacement table. Existing campaign rows, operation identities, revisions, timestamps, private evidence, and foreign-key relationships remain unchanged.

## Future-schema refusal

A database whose `PRAGMA user_version` is newer than this build's schema v56 is refused before any write. The app does not downgrade it, delete future tables, reinterpret unknown documents, or offer a manual-repair fallback. Upgrade the application to a build that knows the schema, then retry.

## Operator checks

Back up the campaign using the existing [private VPS backup runbook](private-vps-backups.md) before upgrading. After startup, verify the service health and inspect `PRAGMA integrity_check` and `PRAGMA foreign_key_check` on a private restore smoke copy. Do not copy JSON exports over SQLite authority.

Run the focused certification:

```bash
npm run check:deferred-closure-migrations
```

The gate covers fresh creation, every P11 transition, exact row preservation, rollback on predecessor drift, strict document recovery, restart durability, and future-version refusal. No manual repair step is accepted.
