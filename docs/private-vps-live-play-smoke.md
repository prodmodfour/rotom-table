# Private VPS live-play smoke checklist

Run this checklist after the normal [Private VPS deployment smoke checklist](private-vps-deployment-smoke-checklist.md) when a private trusted-table host is expected to support live play from multiple browsers. Use disposable campaign data or table-approved smoke tokens. Do not record real hostnames, access tokens, player details, screenshots, logs, campaign JSON, SQLite databases, or backup archives in the app repository.

`/api/health` only proves that the built Nitro process can answer a simple no-secret request. It is not live-play readiness: the checks below verify the outer access gate, `/api/events` SSE stream, command routes, revision/conflict behavior, reconnect reconciliation, and SQLite persistence together.

## Preconditions

- [ ] The host has passed the deployment smoke checklist, including loopback Node binding, reverse proxy, outer access gate, and Git/private-data hygiene.
- [ ] The same outer access gate protects page loads, `/api/events`, `/api/health`, all `/api/*` routes, mutating `/api/maps/*` command routes, and WebSocket upgrade paths that exist now or are added later.
- [ ] Production writes are intentionally enabled with exactly `ROTOM_ENABLE_HOSTED_WRITES=1` if this smoke should persist map or sheet changes.
- [ ] The current private campaign has a player-visible smoke map with at least two controllable tokens linked to two different persistent player profiles, plus a separate GM browser profile.
- [ ] For a real campaign host, the operator created a current `SESSION_TAG=pre-session` or `SESSION_TAG=pre-deploy` backup with the [Private VPS backup runbook](private-vps-backups.md). Disposable throwaway campaigns may skip this only when the entire campaign root can be deleted.

## Backup and rollback checkpoint

- [ ] Confirm the chosen backup archive listing includes `rotom-table.sqlite` when the campaign has been migrated to database-backed live play, plus any `rotom-table.sqlite-wal` and `rotom-table.sqlite-shm` sidecars that existed at backup time.
- [ ] Confirm residual JSON campaign files are in the same backup, including `data/player-profiles/`, encounter tables, and any setup/edit map or sheet JSON kept for inspection, imports, exports, or maintenance.
- [ ] If this smoke follows a deploy, keep the pre-deploy/pre-session archive until the deploy and live-play smoke pass. If the deploy fails, stop the service and follow the backup runbook's [rollback after a bad deploy](private-vps-backups.md#rollback-after-a-bad-deploy) steps instead of continuing to play on questionable state.
- [ ] After a successful smoke on a real campaign, create a `SESSION_TAG=post-session`, `SESSION_TAG=post-smoke`, or `SESSION_TAG=post-deploy` archive so the verified live-play SQLite state can be restored later.

## Browser setup

Use three separate browser profiles, private windows, or devices so cookies and selected profiles do not overlap:

1. GM browser: pass the outer access gate, choose **GM Login**, open the same `/maps/<slug>` smoke map.
2. Player A browser: pass the same gate, choose **Player Login**, select profile A, and open the same map.
3. Player B browser: pass the same gate, choose **Player Login**, select profile B, and open the same map.

Confirm both player browsers can see only player-visible content and can control only their linked tokens.

## Live-play command and revision checks

- [ ] Move Player A's token in Player A's browser. The GM and Player B browsers receive the accepted movement without refreshing, and the moving browser does not rely on whole-map autosave.
- [ ] Move Player A's token and Player B's token at nearly the same time from the two player browsers. Both different-token moves are accepted or reconciled according to the current resource-scope rules, and all browsers converge on the same token positions.
- [ ] Try a same-token conflict by moving the same token from two browsers using stale views or near-simultaneous actions. One action is accepted and the other is rejected or reconciled as a stale/conflicting command; the older browser state must not overwrite the accepted server state.
- [ ] While one player moves a token, have the GM advance initiative. Both changes are accepted when their resource scopes are compatible, or the stale command is rejected with a visible reconciliation path. All browsers should show the same final initiative lane and token positions.
- [ ] Use one sheet-backed command such as HP, conditions, combat stages, or Daily move usage on a disposable token. Confirm the acting browser receives the authoritative result and the other browsers receive the map/sheet update without direct `/api/sheets/save` live-play writes.

## Reconnect and refresh checks

- [ ] Disconnect one player browser from the network, block its connection, or temporarily stop/reload the reverse proxy long enough for the map UI to show reconnecting/reconciling status.
- [ ] While that browser is disconnected, move a different token or advance initiative from another browser.
- [ ] Reconnect the disconnected browser. It should reload/reconcile authoritative map state before allowing more commands; missed SSE events must not be treated as harmless.
- [ ] Refresh both player browsers and the GM browser. Confirm the final map revision state, token positions, initiative state, and relevant sheet-backed values match across all browsers.

## Service restart persistence check

- [ ] Restart the Node service, for example `sudo systemctl restart rotom-table.service`.
- [ ] Confirm the loopback `/api/health` endpoint responds after restart, then reopen the smoke map in all browsers.
- [ ] Confirm the final token positions, initiative state, and sheet-backed live-play values survived the restart through the authoritative repositories.
- [ ] Inspect service logs, for example `journalctl -u rotom-table.service -n 120 --no-pager`, and confirm `/api/events` SSE connect/disconnect logs appear without secrets. Do not commit copied logs.

## Proxy and access-gate checks

- [ ] In browser developer tools, the `/api/events` request remains pending as `text/event-stream` and is not buffered, cached, or redirected after login.
- [ ] The reverse proxy does not cache `/maps/*`, `/api/events`, `/api/maps/*`, `/api/sheets/*`, or accepted command responses.
- [ ] An unauthenticated or off-network browser cannot reach `/login`, `/api/health`, `/api/events`, any `/api/maps/*` command route, or WebSocket upgrade paths before the outer access gate challenges or blocks it.

## Cleanup

Delete disposable smoke data or keep it only in the private campaign store if the table intentionally wants an audit trail. If the smoke modified a real campaign and the table is keeping those changes, take the post-smoke or post-session backup described above before inviting players. Before committing app changes, confirm no smoke data, SQLite databases, WAL sidecars, logs, screenshots, backups, real `.env` files, hostnames, or access-gate exports are staged.

## Related docs

- [Private VPS hosting scope](private-vps-hosting.md)
- [Private VPS deployment smoke checklist](private-vps-deployment-smoke-checklist.md)
- [Private VPS backup runbook](private-vps-backups.md)
- [Live play authority](live-play-authority.md)
