# Legacy live-session LAN hosting runbook

This runbook is retained for direct-only legacy session lobby/socket maintenance. It is not the normal LAN play setup for Rotom Table.

For normal table play on a trusted LAN, start the app with `npm run dev`, have the GM choose **GM Login**, link character sheets to persistent player profiles at `/players`, and have players choose **Player Login** before opening player-visible maps at `/maps/<slug>`. Players can browse Pokédex and PTU reference pages directly. No `/sessions` lobby, join code, session map attachment, session-owned map copy, or special map URL is required.

## When to use this legacy runbook

Use these notes only when maintaining the old guarded session endpoints or socket transport:

- `/sessions`
- `GET /api/sessions/safety`
- `POST /api/sessions/start`
- `POST /api/sessions/join`
- `POST /api/sessions/manage`
- `POST /api/sessions/player-state`
- `POST /api/sessions/assignments`
- `WebSocket /api/sessions/socket`

Session hosting remains disabled unless `ROTOM_ENABLE_SESSION_HOST=1` is set. The local GM/player role picker and any session-local join code are trust-based conveniences, not public authentication.

## Start a LAN maintenance host

```bash
npm run dev:session:lan
```

The helper starts Nuxt with `ROTOM_ENABLE_SESSION_HOST=1 --host 0.0.0.0 --port 3000`. To inspect the command without starting Nuxt:

```bash
npm run dev:session:lan -- --print-only
```

Use a different port when needed:

```bash
npm run dev:session:lan -- --port 3001
```

Manual macOS/Linux equivalent:

```bash
ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host 0.0.0.0 --port 3000
```

PowerShell equivalent:

```powershell
$env:ROTOM_ENABLE_SESSION_HOST = "1"
npm run dev -- --host 0.0.0.0 --port 3000
```

## LAN URL safety

Find a private LAN IPv4 address for the GM machine. Useful commands include `ipconfig getifaddr en0`, `hostname -I`, `ip -4 addr show scope global`, and Windows `ipconfig`.

Good private ranges usually start with `192.168.`, `10.`, or `172.16.` through `172.31.`. Do not give players `localhost`, `127.0.0.1`, `0.0.0.0`, a `169.254.x.x` link-local address, or a public IP address.

## Minimal legacy smoke

Use separate browser profiles for GM and player identities.

- [ ] Start without the flag and confirm `/sessions` reports hosting disabled.
- [ ] Restart with `npm run dev:session:lan`.
- [ ] GM chooses **GM Login**, opens `/sessions`, reads the safety banner, and starts a legacy session.
- [ ] Player opens `/sessions` from the LAN URL, joins with a safe display name and join code, and sees only player-safe lobby state.
- [ ] GM refreshes the lobby and sees the joined player.
- [ ] Forget the legacy session identity in each browser profile when finished.
- [ ] Stop Nuxt, unset `ROTOM_ENABLE_SESSION_HOST`, and check that no generated `data/sessions/` files, join codes, GM keys, real `.env` files, screenshots with secrets, or private campaign data are staged.

For the current supported map-control smoke, use [Player profiles and linked character control](player-profiles.md) and `tests/server/profilePlaySmoke.test.ts` instead of this legacy runbook.

## Boundaries

- Legacy LAN session hosting is not hardened public authentication.
- Do not port-forward the dev server or improvise public exposure.
- Do not add a database, cloud persistence layer, SaaS deployment target, share link, invite link, per-map ACL, or shared-document autosave model to keep this legacy path alive.
- Keep map rendering quality, filesystem-backed JSON workflows, profile-linked control, and regular `/maps/<slug>` play intact.

See [live session host runtime scripts](live-session-host-runtime.md), [Live session public exposure checks](live-session-public-exposure-checks.md), [Live session security boundaries](live-session-security-boundaries.md), and [Live session dependency and runtime maintenance](live-session-dependency-runtime-maintenance.md) for the remaining legacy-session boundaries.
