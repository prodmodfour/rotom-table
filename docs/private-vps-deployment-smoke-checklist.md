# Private VPS deployment smoke checklist

Run this checklist after every private VPS deploy before sharing the private URL with players or resuming a campaign session. It assumes the private trusted-table scope described in [Private VPS hosting scope](private-vps-hosting.md): Node.js 24 LTS, the built Nitro server started with `npm run start`, campaign JSON and reference override diffs outside the app checkout through `ROTOM_CAMPAIGN_ROOT`, and an outer access gate in front of the app. For multi-browser command/revision checks after this deployment smoke passes, use the [Private VPS live-play smoke checklist](private-vps-live-play-smoke.md).

Use synthetic or clearly disposable campaign edits for smoke checks. Do not put real environment files, hostnames, credentials, player details, logs, screenshots, backup archives, private campaign JSON, or campaign-specific reference overrides into the app repository while running this checklist.

## Preconditions

- [ ] The deployed checkout is the intended app revision under `/srv/rotom-table/app` or the operator's equivalent app path; if branch names are part of the deploy process, prefer `main` plus short-lived feature branches instead of unnecessary long-lived branch tiers.
- [ ] `ROTOM_CAMPAIGN_ROOT` points outside the app checkout, for example `/srv/rotom-table/campaign`; branch names are not data-isolation boundaries, and staging plus production must never share the same writable campaign root. If `ROTOM_DB_PATH` is set, it points to private operator-controlled campaign storage rather than the app checkout, and the database plus WAL sidecars are included in backups.
- [ ] The Node service binds to loopback, for example `NITRO_HOST=127.0.0.1` and `NITRO_PORT=3000`, unless the private host uses an equivalent non-public bind.
- [ ] The private host is protected by an outer access gate before Rotom Table's `/login` page, `/api/events`, `/api/health`, all `/api/*` routes, mutating `/api/maps/*` command routes, and WebSocket upgrade paths are reachable.
- [ ] A current private backup exists or the operator is comfortable discarding the disposable smoke edits. See the [Private VPS backup runbook](private-vps-backups.md).
- [ ] If this deployment is intended to save campaign changes in production, the real service environment intentionally sets exactly `ROTOM_ENABLE_HOSTED_WRITES=1`. If the flag is absent or set to any other value, covered production writes should fail closed instead of persisting.

## Build and process checks

From the private VPS app checkout, run the same install and verification commands used by CI:

```bash
cd /srv/rotom-table/app
node --version
npm ci
npm run typecheck
npm test
npm run build
```

Then confirm the built server starts with the documented command. For a manual one-shell smoke, run:

```bash
NODE_ENV=production \
NITRO_HOST=127.0.0.1 \
NITRO_PORT=3000 \
ROTOM_CAMPAIGN_ROOT=/srv/rotom-table/campaign \
npm run start
```

If systemd is supervising the real process, restart and inspect that service instead of leaving a duplicate manual process running:

```bash
sudo systemctl restart rotom-table.service
sudo systemctl status --no-pager rotom-table.service
journalctl -u rotom-table.service -n 80 --no-pager
```

## Health and access-gate checks

`/api/health` is a no-secret process health check only. It does not prove that `/api/events` SSE streaming, live-play command routes, revision reconciliation, conflict handling, or persistence are ready; run the live-play smoke checklist for those checks.

- [ ] From the VPS itself, the loopback health endpoint succeeds and returns no secrets:

  ```bash
  curl -fsS http://127.0.0.1:3000/api/health
  ```

- [ ] From an authorized device through the private reverse proxy or gate, `/api/health` succeeds over the intended private URL.
- [ ] From an unauthenticated or off-network browser, the outer access gate blocks `/login`, `/api/health`, `/api/events`, other `/api/*` routes, mutating `/api/maps/*` command routes, and WebSocket upgrade paths before Rotom Table responds.
- [ ] The Node port such as `:3000` is not reachable directly from arbitrary internet clients; only the intended private proxy/gate can reach the loopback service.

## GM and player profile-play checks

Use separate browser profiles or private windows so the GM and player cookies do not overlap.

- [ ] An authorized GM browser passes the outer access gate, reaches `/login`, and chooses **GM Login**. Remember that this is still a trust-based table role picker, not public authentication.
- [ ] The GM opens `/players` and confirms that the intended player profile exists, or creates a disposable smoke profile and links a synthetic or disposable Pokémon/trainer sheet.
- [ ] The GM confirms at least one saved map is player-visible and contains a token linked to the chosen player profile.
- [ ] A separate authorized player browser passes the same outer access gate, chooses **Player Login**, selects the GM-created profile, and sees the selected profile in the normal app navigation.
- [ ] The player opens `/maps` or the intended `/maps/<slug>` route, can view the player-visible map, and can act only with tokens linked to the selected profile.
- [ ] The player can open the linked sheet through the normal sheet flow and can still browse Pokédex/reference routes such as `/pokedex`, `/moves`, `/abilities`, `/rules`, and `/items`.

## Write persistence after restart

Run this section with disposable data. If hosted writes are intentionally disabled in production, stop here after confirming the app rejects covered writes; do not treat the host as ready for persistent table play until the operator intentionally enables exact `ROTOM_ENABLE_HOSTED_WRITES=1` behind the private access gate.

- [ ] Create or edit a clearly disposable map item, such as moving a smoke-test token on a player-visible map or creating a temporary map/folder named `Deploy Smoke <date>`.
- [ ] Create or edit a clearly disposable sheet field on a synthetic Pokémon or trainer sheet, or on a sheet the table explicitly agrees to modify for the smoke check.
- [ ] Confirm the corresponding JSON changes are under `ROTOM_CAMPAIGN_ROOT` rather than inside `/srv/rotom-table/app`. If you deliberately smoke-test Pokédex maintenance, confirm it writes `data/reference-overrides/pokedex.json` under the campaign root and leaves app-owned `data/reference/pokedex.json` unchanged.
- [ ] Restart the built process:

  ```bash
  sudo systemctl restart rotom-table.service
  curl -fsS http://127.0.0.1:3000/api/health
  ```

  For a manual smoke process, stop `npm run start` with `Ctrl+C` and start it again with the same environment values.

- [ ] Reload the GM and player browsers, then confirm the disposable map change and disposable sheet change both survived the restart.
- [ ] Delete the disposable smoke data, or keep it only in the private campaign repository if the operator intentionally wants that audit trail.

## Git and private-data hygiene

Before committing product changes or recording deployment notes in a shared place, inspect the app checkout:

```bash
cd /srv/rotom-table/app
git status --short
```

Confirm that no private data is staged in Git:

- [ ] no real `.env`, `.env.*`, systemd environment file, proxy config, tunnel credential, password file, token, private key, or provider export;
- [ ] no private `data/maps/`, `data/sheets/`, `data/trainers/`, `data/player-profiles/`, `data/reference-overrides/`, `encounter_tables/`, `data/sessions/`, SQLite database, or SQLite WAL sidecar files from the smoke pass;
- [ ] no backup archive such as `.tar`, `.tar.gz`, `.tgz`, or `.zip`;
- [ ] no screenshots, logs, player details, unreleased campaign notes, or generated restore staging directories.

If the campaign root is its own private Git repository, review that repository separately and commit only intentional private campaign changes there.

## Legacy `/sessions` boundary

This checklist verifies the current private VPS profile-play path: `/login`, `/players`, `/maps`, `/maps/<slug>`, `/sheets`, Pokédex, and reference pages. It does not require players to use `/sessions`, join codes, session-map attachment, or special session map URLs.

Use [Legacy live-session deployment smoke checklist](archive/live-session/live-session-deployment-smoke-checklist.md) only when maintaining the guarded legacy session lobby/socket endpoints. Keep those legacy checks isolated from normal private VPS profile play.
