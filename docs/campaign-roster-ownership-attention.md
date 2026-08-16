# Campaign team, capture, hatch, ownership, and equipment attention

P8-088 adds the read-only continuation detector for roster capacity, captured and hatched Pokémon, ownership and Profile links, and current equipment incompatibility. It never chooses a team or Box destination, renames a Pokémon, transfers ownership, edits a Profile, or reconciles equipment.

## Complete authority boundary

`projectCampaignRosterOwnershipAttention` requires one explicitly complete, current, unique, and bounded read of:

- Pokémon and Trainer sheet documents with their exact SQLite revisions;
- hash-bound Player Profile authorities;
- immutable encounter-settlement attention sources and history facts;
- authoritative Pokémon Egg documents and immutable breeding origins; and
- breeding operation ledger records.

Each collection is capped at 10,000 records. A Trainer roster and a Profile link collection are separately capped at 10,000 entries. Duplicate aggregate identities, partial-read declarations, future Egg or sheet authority, malformed Profile hashes, missing capture facts, orphan lineage, or a hatch whose Egg, origin, operation, child, owner, and accepted result do not agree fail closed.

Capture review is not reconstructed from a sheet name or caught-ball label. Every `capture-settled` fact must have exactly one durable `capture-review` source written by the same atomic settlement operation. The source must name the same Pokémon and exact post-settlement sheet authority. Resolved source rows remain terminal attention records with no stale action.

A hatch is accepted only when the strict Egg and self-hashed lineage match byte-semantically and the terminal `complete-hatch` operation agrees with the Egg, origin, child, owner Trainer, destination, commit minute, command hash, scopes, and exact aggregate revisions. The detector exposes none of that private evidence.

## Detection policy

The detector surfaces:

- `team-overflow` when a current team contains more than the canonical six members;
- `capture-review` for durable open settlement follow-up, including captured Pokémon initially or currently in the Box;
- `hatch-review` for each exact settled hatch so naming, destination, and child review can be completed explicitly;
- `ownership-review` for malformed, overlapping, missing, duplicate, unassigned, wrong-owner, stale Profile-link, or missing Profile-control authority; and
- `equipment-review` when current equipment state is malformed, contains unresolved migration entries, retains a current compatibility reason, or differs from a no-write reconciliation against reviewed definitions.

Roster values are accepted only as exact canonical slugs. The detector does not normalize duplicate rows away. Team and Box must be disjoint, a roster Pokémon must exist, and an acquired Pokémon must have exactly one current Trainer roster claim. A hatched child must remain with its exact Egg owner unless a later explicit ownership workflow establishes other authority. A capture or hatch owner Trainer without any current linked Profile becomes GM-only Profile-link work. Multiple Profiles may control the same Trainer; shared custody is not silently converted into multiple Pokémon owners because the Trainer roster remains the single ownership authority.

Equipment evaluation delegates to the existing strict equipment parser and current compatibility reconciliation. It does not parse legacy slot labels, item names, or activity prose. Dynamic suppression and breakage alone are not misclassified as compatibility; reviewed definition, record, owner, slot, exclusivity, configuration, Capability, Skill, Species, and Evolution-stage reasons are.

## Explicit workflows and privacy

Every open item points to one existing bounded workflow:

| Reason | Decision | Action | Destination |
| --- | --- | --- | --- |
| `team-overflow` | repair team | review team | exact Trainer sheet team workflow |
| `capture-review` | review capture | review capture | exact captured Pokémon sheet |
| `hatch-review` | review hatch | review hatch | exact child Pokémon sheet |
| `ownership-review` | assign ownership | review ownership | exact affected sheet or campaign Profile-link workflow |
| `equipment-review` | repair equipment | review equipment | exact owner sheet equipment workflow |

Actions are non-mutating handoffs bound to current or immutable revision authority. The destination workflow must reload and reauthorize before offering a write. The detector never automatically moves a seventh Pokémon to the Box, changes a current destination, links a Profile, transfers an Egg or child, selects a nickname, or persists reconciled equipment state.

Player-facing items contain only bounded reasons, entity slugs the recipient may already access, routes, and authority revisions. They contain no character names, Species, nickname, roster contents, team count, Profile ID, Profile display name, Egg or breeding operation command, settlement operation ID, equipment instance ID, inventory provenance, definition hash, lineage hash, or private source JSON. Stale Profile authority uses a hash-derived opaque authority reference and a campaign-level GM route; the real Profile identity never enters the item.

P8-089 combines these stable detector items with role/Profile authorization and durable realtime lifecycle handling. That layer can mark an unchanged hatch-review identity resolved or superseded without inventing client-local bookkeeping. P8-090 renders the safe reason and reloads authorized detail only on the campaign dashboard or destination workflow.
