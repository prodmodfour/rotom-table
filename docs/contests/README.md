# Pokémon Contests

Rotom Table runs Pokémon Contests as ordinary liveplay campaign activity. Contest preparation changes ordinary Trainer and Pokémon sheets; a running Contest is one revisioned server document; settlement writes experience, ribbons, prizes, and history back to ordinary sheets in one transaction.

## Guides

- [Player and GM guide](player-and-gm-guide.md) — preparation, setup, variants, play, interventions, and settlement.
- [Architecture and API](architecture-and-api.md) — document boundary, commands, projections, realtime, and persistence.
- [Canonical-data maintenance](canonical-data-maintenance.md) — reviewed migration and coverage checks.
- [Operations and recovery](operations-recovery.md) — liveplay hosting, restart, exact retry, backup, and troubleshooting.
- [Accessibility and acceptance](accessibility-and-acceptance.md) — keyboard, touch, screen reader, reflow, privacy, and validation evidence.
- [Trainer Participant runtime](trainer-participant-runtime.md) — native paired enrollment, methods, shared dice, performer turns, Voltage, projections, settlement, and fixtures.
- [Battle Contest runtime](battle-contest-runtime.md) — native dual-engine setup, handoffs, Appeals, lifecycle, recovery, joined cockpit, and combined settlement.

## Authority in one diagram

```mermaid
flowchart LR
  C[data/reference/contests.json] --> D[Contest document]
  M[data/reference/moves.json contest identity] --> D
  S[Ordinary Trainer and Pokémon sheets] --> P[Preparation operations]
  P --> S
  S --> D
  D --> R[Role-safe live projections]
  D --> X[Atomic settlement]
  X --> S
  X --> H[Ribbons, results, campaign attention]
```

Documentary books, parser inputs, PDFs, and websites are provenance only. Runtime modules consume app-owned `data/reference/*.json` files.

## Alpha acceptance

`data/contests/alpha-acceptance.v1.json` is the frozen machine-readable P10-100 closure record. It binds the reviewed catalog, deterministic fixtures, authority/runtime implementation, browser journey, guides, and repository validation status. Plan 11 preserves that accepted history through `data/deferred-closure/successor-chain.v1.json` and natively activates Trainer Participant and Battle only after their ordered executable certificates and current fixture heads pass. Current runtime status comes from app-owned `data/reference/contests.json`, not by editing the historical acceptance record.