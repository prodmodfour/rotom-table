# GM Campaign Toolkit guide

The **Campaign Toolkit** is the GM-only Workshop for campaign encounter tables, deterministic wild encounters, ordinary NPC Trainer packages, and session preparation. It prepares campaign authority for the existing Encounter Builder. It does not launch a map, become an Encounter Document, or replace ordinary sheets, liveplay, settlement, or Campaign continuation.

## Access and privacy

Only the active GM can open Toolkit routes or APIs. Players do not receive Toolkit navigation, candidate pools, preparation documents, generation journals, source evidence, private notes, or Toolkit realtime events.

Treat these surfaces as private even when sharing a screen:

- NPC identity, tactics, and notes;
- uncommitted wild or NPC candidates;
- scene and candidate GM notes;
- unresolved decisions;
- withheld handouts;
- generation, package, and launch diagnostics.

Player-safe preparation copy is published only through a structurally separate server projection after launch. Hiding a field in the browser is not a privacy boundary.

## Preparation-to-play workflow

1. Review or author a campaign encounter table under **Tables**.
2. Build an inert wild preview under **Wild encounter**, or an inert Trainer-plus-roster preview under **NPC Trainers**.
3. Commit only an accepted package. The commit creates ordinary campaign sheets atomically.
4. Open **Session prep**, compose ordered scenes, add existing or generated material, and review every candidate.
5. Move the preparation from Draft to In review, resolve every readiness reason, then choose **Ready for Builder**.
6. Open one unlaunched scene in the existing Encounter Builder.
7. Review its immutable source, current map, accepted cast, placement, and story material, then launch.
8. Run and settle the Encounter through ordinary liveplay. Return to Session prep for the next unlaunched scene or use the Campaign continuation card.

A Ready preparation is still a plan. It creates no map placement, Encounter Document, initiative, or public scene by itself.

## Campaign tables

The table library begins with the four reviewed migrated campaign tables. Search and filter active or archived tables by name, habitat, level, and status.

### Author or edit a table

A valid table has:

- a campaign name and explicit habitat tags;
- at least one weighted Species row and an explicit weighted **Nothing** row;
- canonical Species identities;
- bounded minimum and maximum Levels;
- optional time-of-day and weather availability;
- one bounded fixed or party-scaled group-size policy;
- optional private campaign notes.

Weights are relative, not percentage fields. The distribution preview explains the current total. Unknown Species, invalid Levels, unsupported habitat values, malformed predicates, and ambiguous canonical identities fail closed.

Saving is revision checked. If another GM tab accepted a change first, compare your draft with the warning and choose **Reload accepted revision** before editing again. Do not copy values from browser developer tools or change a revision to bypass a conflict.

### Copy, import, export, and archive

- **Copy** creates a new campaign table pinned to the reviewed source revision.
- **Import table** accepts only the strict versioned Toolkit envelope and revalidates every canonical identity.
- **Export** is a GM-only interchange operation for one reviewed table. It is not a package, preparation, journal, or diagnostics export.
- **Archive** removes a table from new generation while preserving history and pinned preparation references. Restore it only after reviewing current canonical validity.

Legacy files under `encounter_tables/` are not runtime authority. Do not add a file there and expect it to appear in the library.

## Wild encounter generation

1. Choose an active table.
2. Request 1–30 encounter slots, with optional time-of-day, weather, Shiny chance, and canonical held item policy.
3. Choose **Preview encounter**.
4. Review Nothing/Repel counts and every exact candidate: Species, Level, Gender, Nature, held item, Abilities, Moves, capabilities, and stat totals.
5. Select 1–10 candidates and choose **Commit package**.

The server owns every random draw and legality decision. A preview is inert: it creates no sheet, package, operation, map change, or realtime row. Changing any input invalidates the visible preview and requires a fresh one.

A successful commit creates ordinary Pokémon sheets in the campaign and one immutable package receipt. Continue with **Open in Encounter Builder** for a direct encounter or **Add to Session prep** for later composition.

### Route Repel

Entering generation from a Trainer's active route Repel carries only the current Trainer and campaign-clock authority. The server rechecks both before preview and commit. If that context changed or expired, clear the route context or return to the Trainer activity; never reproduce the filter manually.

## NPC Trainer packages

1. Choose a reviewed campaign archetype policy.
2. Enter the Trainer name and optional private identity, tactics, and notes.
3. Choose a roster size from zero through the policy maximum of six.
4. Choose **Preview NPC package**.
5. Review the exact Trainer stats, Skill highlights, Features, equipment, money, guided decisions, and every roster member.
6. Choose **Commit package**.

Guided prose is a GM decision, not generated mechanical authority. Structured Trainer and Pokémon mechanics are validated against app-owned canonical data and existing character-creation rules.

The commit is all-or-nothing: one ordinary Trainer plus its ordinary owned Pokémon roster, or no new sheets. Continue directly to Builder or add the package to Session prep. Do not create replacement sheets when a response is uncertain.

## Session preparation

### Compose a Draft

Create a session, then add up to 20 ordered scenes. Each scene can contain:

- a player-safe summary and private GM notes;
- one current map reference;
- reviewed campaign tables;
- committed wild or NPC packages;
- current ordinary Trainer or Pokémon sheets;
- private placement intent and candidate notes.

A preparation can link at most 50 campaign documents. It can also contain up to 50 handouts and 50 unresolved decisions.

Every encounter candidate begins as an option. Mark each one **Selected** or **Excluded** before readying. A table reference remains preparation material; Builder launch requires selected sources that resolve to ordinary sheets.

Use **Import scenes** or **Copy** for reuse. The new preparation records the exact source revision and receives fresh scene and candidate identities. Reuse never aliases a mutable source document.

### Review and ready

Choose **Send to review**, then use the **Ready for Builder** rail to clear every reason:

- at least one scene exists;
- all candidate options are selected or excluded;
- all unresolved decisions are resolved;
- every table, package, sheet, and map still exists at the pinned revision.

Save edits before lifecycle transitions. Ready locks scene content for immutable Builder resolution. **Reopen review** before changing it. Cancelling preserves history; launched preparations archive instead of cancelling.

Handouts marked **On launch** can enter the player-safe launched projection. Withheld handouts and every GM note remain private.

## Encounter Builder and launch

Open Builder only from an accepted package or a Ready/unlaunched preparation scene. The source panel must report **Current · immutable**. Builder resolves current ordinary sheet references and never trusts copied browser mechanics or rerolls generation.

For a prepared scene:

- its map revision is pinned;
- its accepted cast and placement intent are resolved from the source;
- player-safe stakes and private GM material are locked;
- the source preparation and scene are revalidated inside the launch transaction.

You may review the presentation recipe, side, role, visibility, and initiative settings that Builder exposes. **Launch encounter** atomically commits map placements, the Encounter Document, launch operation, interaction mode, preparation launch evidence, and post-commit realtime. Any stale source or interrupted write leaves all of those unchanged.

After launch, use the ordinary Encounter Workspace, Director commands, correction, and Finish Encounter workflows. A settled scene does not automatically launch the next preparation scene.

## Exact retry, concurrency, and reconnect

Toolkit mutations use exact operation identities retained by the current browser flow.

- If the accepted response arrives, use the resulting package, table, preparation, or launch once.
- If connectivity fails while the result is unknown, keep the page and retry the same action or refresh for accepted authority. Do not alter inputs or start a replacement operation.
- An exact retry returns the original result without rerolling, duplicating sheets, rewriting a preparation, or republishing realtime.
- Changed material under an accepted operation conflicts.
- A stale revision means another accepted write won. Reload current authority and deliberately repeat the user decision against that revision.
- Reconnect reloads documents over HTTP; realtime carries only identity and revision invalidation.

Preview tokens are short-lived, server-signed review authority. If an uncommitted preview expires or any input changes, request a new preview. Never preserve, copy, decode, or submit a token outside the current flow.

## Deployment migration

Toolkit persistence extends the existing SQLite chain from schema 50 through schema 56:

- **v51** — campaign encounter tables and exact table operations; seeds the four reviewed migrated tables;
- **v52** — wild generation journals and package receipts;
- **v53** — backup-safe server-only preview signing secret;
- **v54** — campaign-owned NPC archetype policies and exact operations;
- **v55** — NPC generation journals and package receipts;
- **v56** — session-preparation documents and exact operations.

Startup applies these versions in order inside the established migration authority. It preserves existing maps, sheets, liveplay, settlements, and campaign data. A database from a future schema is refused before writes.

Before deployment, create a verified private backup. Never skip a version, manually create Toolkit tables, transplant operation rows, or edit document JSON to make migration pass. The old pokegen script, host-process generation, file-result workflow, and file-backed table runtime are retired; do not restore them as fallback behavior.

## Backup and restore

The complete Toolkit authority lives in the campaign SQLite database, including:

- campaign tables and operation receipts;
- wild and NPC generation journals and package receipts;
- ordinary generated sheets and NPC roster custody;
- the preview-signing secret;
- preparations and launch evidence;
- maps, Encounter Documents, settlement, realtime, and continuation authority.

Follow [Private VPS backups](../private-vps-backups.md). Prefer a stopped-service archive of the full campaign root and database sidecars, or SQLite's online backup API while writes are paused. Copying only the main database file during WAL writes is unsafe.

For a restore smoke test:

1. restore to a separate private campaign root;
2. run SQLite integrity and foreign-key checks;
3. run `npm run audit:gm-toolkit-storage -- --database <restored.sqlite>`;
4. boot one production process against the restored copy;
5. verify one table, one committed package and ordinary sheet, one preparation, and—when present—one launched scene;
6. restart the smoke process and verify the same authority without a redraw, duplicate sheet, duplicate launch, or migration rerun.

The signing secret must restore with the database. Never replace it independently to "fix" a preview; request a new preview after restore instead.

## Troubleshooting

### A control is disabled

Read the adjacent readiness or unavailable reason. Save current edits, resolve pending candidates/decisions, or refresh the pinned source. Do not remove disabled styling or call the API manually.

### A table, map, package, or sheet changed

Reload the accepted revision. A preparation or Builder handoff deliberately fails stale references rather than silently substituting current data. Reopen review and select current authority when a change is intended.

### A preview produces no Pokémon

Nothing rows, active predicates, or Route Repel may consume every requested slot. Review the displayed counts and table policy, then make an explicit changed request. Do not force a candidate or reuse an older preview.

### NPC roster completion fails

The server attempts a bounded number of journaled slots while honoring Nothing rows. Reduce the requested roster or review the archetype's source table/policy. A failure creates no Trainer or Pokémon.

### The result of Commit or Launch is unknown

Do not create another package, sheet, preparation, or Encounter. Restore connectivity and retry the unchanged current action or reload accepted authority. If the UI reports a conflict, follow its recovery path rather than changing an operation identity.

### Another GM tab changed the document

One revision wins. Keep the stale draft only for comparison, reload the accepted revision, and reapply intended changes manually through current controls. Never overwrite the database or lower the expected revision.

### Realtime appears delayed

Refresh the authoritative page. Accepted state is in SQLite before any realtime publication; reconnect uses bounded HTTP reload. Do not resubmit a mutation merely to provoke an event.

### Migration, integrity, or Toolkit audit fails

Stop writes and preserve the database plus WAL/SHM sidecars. Reproduce against a private copy, identify the exact migration or dangling authority, and repair code or a reviewed source-bound migration. Never patch a hash, receipt, journal, generated sheet, custody link, or preparation JSON directly.

### A player can see private Toolkit material

Treat this as a privacy incident. Stop sharing the affected surface, preserve the request/route context without copying private payloads into public logs, and verify server role projection. CSS redaction is not an acceptable repair.

## Never do this

- roll generation in the browser or by hand and present it as Toolkit output;
- run retired pokegen/file-generation scripts;
- use books, parser output, websites, or legacy files as runtime canonical data;
- manually insert or edit generated sheets, packages, journals, preparations, launch receipts, or revisions;
- expose private Toolkit responses, identifiers, tokens, hashes, or diagnostics to players;
- treat a preview, Ready preparation, or realtime event as live Encounter authority;
- launch the same scene by constructing a new map/Encounter path outside Builder;
- repair uncertainty by repeating work under a new operation.

## Related guides

- [Encounter Builder](../encounter-workspace/encounter-builder.md)
- [Complete Play Loop GM guide](../complete-play-loop-gm-guide.md)
- [Complete Play Loop operator guide](../complete-play-loop-operator-guide.md)
- [Private VPS backup runbook](../private-vps-backups.md)
