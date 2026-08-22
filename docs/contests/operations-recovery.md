# Pokémon Contest operations and recovery

## Liveplay operation

Contests are liveplay-only. Use the normal production host/session configuration; do not depend on deprecated local-only behavior. Health, auth cookies, player-profile policy, SQLite authority, persisted realtime replay, and hosted-write policy are shared with the rest of Rotom Table.

## Normal recovery

- **Stale revision:** refetch, review the current turn, and submit a new intent with a new operation ID.
- **Uncertain network outcome:** retry the exact operation ID and byte-equivalent intent. The operation receipt returns the original terminal result without rerolling or spending again.
- **Disconnected controller:** no automatic appeal occurs. The GM may wait, reassign to a profile that owns all enrolled sheets, take GM control, or cancel.
- **Realtime gap:** reload the role-projected Contest. Scores and journals come from SQLite, not client memory.
- **Process restart:** reopen the same campaign database. The current round, pending reroll, cross-round effects, dice evidence, and operation receipts are document state.
- **Settlement write conflict/failure:** the transaction rolls back all Contest and sheet writes. The Contest remains settling; reload, resolve the sheet conflict, and retry.
- **Post-commit publish failure:** authority is committed. Reconnect replay delivers persisted events; never manually duplicate rewards.

Early schema-v1 Trainer result rows that predate explicit `ribbonAwarded` and `ribbonIds` evidence remain readable and are labeled **Ribbon status unavailable**. Never infer a Ribbon from first place; only committed settlement evidence can display one.

## Backup and restore

Use the normal campaign-database backup procedure. A consistent SQLite backup contains Contest documents, receipts, preparation operations, sheet rewards, and realtime events. Restore the whole campaign database, not selected Contest rows. After restore:

1. check SQLite migration version is at least 46;
2. run the Contest migration and fixture checks against the deployed build;
3. load an active Contest as GM and public spectator;
4. compare revision, stage, round, accepted journal count, and pending decision;
5. exact-retry a known accepted operation only in a disposable acceptance copy.

`tests/server/contestStorageRecovery.test.ts` certifies fresh schema, close/reopen, file backup, restore, document equivalence, and operation-receipt equivalence.

## Troubleshooting signals

Stable safe errors include `contest.revision-conflict`, `contest.operation-conflict`, `contest.option-not-offered`, `contest.wrong-turn`, `contest.dice-overspend`, `contest.intervention-window-closed`, `contest.prize-undecided`, and `contest.settlement-failed`. Internal hashes and private plans are not returned to players.

Aggregate UX rows contain only day, metric ID, sample count, total, and maximum. They never contain Contest, profile, character, Move, note, or roll identity.