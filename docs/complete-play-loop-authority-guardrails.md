# Complete Play Loop authority guardrails

P8-094 makes catalog completion and mutation ownership executable. The checked contract is `data/complete-play-loop/authority-guardrails.v1.json`; reviewed ownership lives in `scripts/reviewed-data/complete-play-loop-authority-guardrails.v1.json`.

Run:

```bash
npm run check:complete-play-loop-authority-guardrails
```

## What fails closed

The checker rejects:

- a canonical `data/reference/items.json` row that is missing, duplicated, unknown, blocked, or has unresolved provider requirements;
- a catalog provider with no reviewed runtime owner, an unexpected zero-member provider, or a stale implementation state;
- an active ItemSpec handler with no reviewed planner/reducer authority, or a reviewed handler no longer assigned by the registry;
- a mechanical resolver called from the client or from a new unreviewed production caller;
- client imports of server modules or a client-side persistence callback for capture mechanics;
- any new direct server assignment to an inventory document, including one added inside an already approved file, until its count and transaction role are reviewed;
- any root field added to `EncounterSettlementDocument` without at least one current owning provider, and any provider that owns no field;
- any owner, caller, canonical registry, or completion evidence whose SHA-256 fingerprint is stale.

The checker parses identities and source structure only. It never parses item effect prose and grants no mechanics.

## Authority model

Clients may enumerate safe offers, show previews, and submit strict commands. They do not roll, settle, or persist item mechanics. In particular, a Poké Ball throw has no setup-edit fallback: `resolvePokeballCaptureAttempt` is called only by `server/useCases/applyThrowPokeballCommand.ts`, and absence of liveplay authority fails closed.

Inventory mutation owners are classified as pure reducers, transaction-planned migrations, transaction repositories, transaction use cases, or projection redaction. A file allowlist alone is insufficient: the checker also pins the exact assignment count and file hash.

Settlement ownership is exhaustive at the document root. Eligibility, consequence snapshot, reward, Experience, loot, capture, outcome, cleanup, repository, and atomic-commit providers jointly own all 16 fields. A schema change cannot pass by silently leaving a field without a writer/revalidator.

## Changing authority safely

1. Change the server-owned mechanic or transaction boundary and its focused tests.
2. If a new provider, handler, caller, inventory assignment, or settlement field is deliberate, update the reviewed guardrail source with the narrowest owner set.
3. Regenerate the contract:

   ```bash
   python3 scripts/generate_complete_play_loop_authority_guardrails.py
   ```

4. Regenerate any upstream hash-bound catalog artifact whose evidence changed.
5. Run the checker and focused tests. Do not patch fingerprints by hand to bypass a failed ownership review.

A zero-count provider is allowed only when explicitly marked as a zero-only remediation sentinel. `canonical-data-defect` currently remains such a sentinel and may not acquire members without reopening canonical-data review.
