# live session lobby and manual QA

> These documents describe obsolete/maintenance-only session infrastructure and are not the current multiplayer architecture.

This guide documents the remaining live session lobby identity surface. It does not describe normal map play. Normal player map control now comes from persistent player profiles on the normal `/maps/<slug>` route, and the old session map attachment endpoint has been removed.

For guarded startup helpers, see the [live session host runtime scripts](live-session-host-runtime.md). For no-secret warnings around public/LAN exposure before session-local credentials and authoritative state are ready, see [Live session public exposure checks](live-session-public-exposure-checks.md). For same-Wi-Fi setup commands, IP discovery, player browser URLs, and cross-device troubleshooting, see the [Live session LAN hosting runbook](live-session-lan-hosting.md). For stable remote-hostname setup, see the [Live session named Cloudflare Tunnel runbook](live-session-cloudflare-tunnel-hosting.md). For deployment smoke expectations, see the [Live session deployment smoke checklist](live-session-deployment-smoke-checklist.md). For temporary tunnel caveats, see the [Live session Quick Tunnel caveat](live-session-quick-tunnel-caveat.md).

## Current lobby behaviour

- `/sessions` is an additive legacy lobby route kept for direct maintenance/smoke access only. It is no longer linked from the normal app navigation and does not replace the existing `/login` trust picker, persistent player profile picker, or normal map/sheet workflows.
- `GET /api/sessions/safety` returns a no-secret banner status so the GM can see whether hosting is disabled, local, LAN, remote, or unknown before sharing a join code.
- `POST /api/sessions/start` creates a session-local GM identity, join code, initial authoritative state, and local JSON snapshot when session hosting is explicitly enabled.
- `POST /api/sessions/join` creates a session-local player ID/client ID/display name from a valid join code.
- `POST /api/sessions/manage` lets the GM refresh the read-only lobby summary with joined players, connected-client presence records, session metadata, and the join code.
- `POST /api/sessions/player-state` lets a joined player refresh only their own session-local identity/status for the isolated lobby surface.
- Legacy session-map navigation panels, token-assignment UI, and the multi-tab session-map smoke helper have been removed from the client.

The removed `/api/sessions/maps/attach` route is not part of the product flow. GMs should not instruct players to use the lobby or legacy session maps for normal play; players normally open the relevant player-visible map and act with profile-linked characters.

## Safety and identity rules

Session hosting is disabled by default. Start the app with a guarded helper before using the lobby endpoints:

```bash
npm run dev:session:lan
```

Important boundaries:

- The GM must still choose **GM Login** in the existing local `/login` screen before pressing **Start GM session**.
- The local GM/player picker remains a trust switch for local campaign use. It is not hardened public auth.
- The session-local GM key is stored only in the GM browser's local session identity record and is required by GM management calls.
- The player join code creates only a session-local player identity. It is not a full account, password, or durable permission outside this session.
- Player display names are labels; duplicate names may exist because identity comes from generated `playerId` and `clientId` values.
- The browser continuity cookie is only a non-secret hint. GM keys and join codes must not be placed in cookies or committed to docs/logs.

## Legacy lobby smoke checklist

Use one GM browser and one separate player browser/profile. Do not commit any generated `data/sessions/` files from the smoke test.

- [ ] Start the app without `ROTOM_ENABLE_SESSION_HOST=1`, open `/sessions`, and confirm session hosting is disabled.
- [ ] Restart with `ROTOM_ENABLE_SESSION_HOST=1 npm run dev` for same-machine testing, or `npm run dev:session:lan` for LAN testing.
- [ ] GM browser: choose **GM Login**, open `/sessions`, read the safety banner, and press **Start GM session**.
- [ ] GM browser: verify a join code is displayed and the GM key itself is not shown in page chrome.
- [ ] Player browser/profile: open `/sessions`, enter the join code and a display name, and press **Join session**.
- [ ] Player browser: verify active session status, display name, and revision.
- [ ] GM browser: press **Refresh lobby** and verify the joined-player list includes the player display name.
- [ ] Player browser: press **Forget in this browser** when the test is finished or when reusing the browser for another player.
- [ ] GM browser: press **Forget in this browser** after the test if the session should not remain remembered.
- [ ] Stop the dev server, unset `ROTOM_ENABLE_SESSION_HOST`, and remove private local session data only if you no longer need it.

## Troubleshooting notes

- **Host flag disabled:** confirm the process was started with `ROTOM_ENABLE_SESSION_HOST=1`; changing the shell variable after Nuxt starts is not enough.
- **The start button is disabled:** choose **GM Login** in the existing local `/login` route first.
- **Player cannot reach the LAN URL:** verify the GM used `--host 0.0.0.0`, both devices are on the same network, and the firewall permits the dev-server port.
- **Player join fails:** re-check the code from the GM lobby, make sure the session is still active, and refresh the GM lobby to confirm the session did not end.
- **No map or token controls:** this is expected. Use normal `/maps/<slug>` profile-based play and **Link character sheets** in `/players` for current map control.
- **Session files appeared locally:** `data/sessions/` is ignored/private runtime data. Back it up only when needed and do not commit it.
