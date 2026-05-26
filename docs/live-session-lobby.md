# live session lobby and manual QA

This guide documents the current live session lobby flow: how a GM starts a guarded session, how a player joins with a session-local display name, how the minimal lobby should behave on a LAN, and how to manually smoke-test the flow with two browsers.

It is intentionally scoped to the identity/join/lobby surface. For the GM flow that attaches a saved map to server-owned session state before players open it, see the [Live session map attachment flow](live-session-map-attachment.md). For guarded startup helpers, see the [live session host runtime scripts](live-session-host-runtime.md). For no-secret warnings around public/LAN exposure before session-local credentials and authoritative state are ready, see [Live session public exposure checks](live-session-public-exposure-checks.md). For same-Wi-Fi setup commands, IP discovery, player browser URLs, and cross-device troubleshooting, see the [Live session LAN hosting runbook](live-session-lan-hosting.md). For stable-hostname remote setup, WebSocket considerations, safety warnings, and rollback steps, see the [Live session named Cloudflare Tunnel runbook](live-session-cloudflare-tunnel-hosting.md). For the fuller two-player LAN/named-tunnel smoke covering reconnect, token movement, initiative, and conflict rejection, see the [Live session deployment smoke checklist](live-session-deployment-smoke-checklist.md). For temporary `trycloudflare.com` smoke-test caveats and legacy SSE limitations, see the [Live session Quick Tunnel caveat](live-session-quick-tunnel-caveat.md). For the client-integration smoke that opens explicit GM/player session-map tabs and checks basic token command propagation, see [Live session multi-tab local smoke script](live-session-multi-tab-smoke.md).

## Current lobby behaviour

- `/sessions` is an additive lobby route. It does not replace the existing `/login` trust picker or local-first map/sheet workflows.
- Map routes expose a compact **Table session** panel in the map navigation rail with links to `/sessions#gm-lobby-title`, `/sessions#player-lobby-title`, an **Attach current map** action for remembered GM sessions, and an explicit `/maps/<slug>?session=1` session-mode view for the current map.
- `GET /api/sessions/safety` returns a no-secret banner status so the GM can see whether hosting is disabled, local, LAN, remote, or unknown before sharing a join code. When hosting is enabled it also warns if no active session-local GM key/join code exists yet, if a remote/proxied request appears before session start, or if an active session record is missing expected credentials or authoritative state.
- `POST /api/sessions/start` creates a session-local GM identity, join code, initial authoritative state, and local JSON snapshot when session hosting is explicitly enabled.
- `POST /api/sessions/join` creates a session-local player ID/client ID/display name from a valid join code.
- `POST /api/sessions/manage` lets the GM refresh the read-only lobby summary with joined players, connected-client presence records, assignment counts, selected-map details, attached-map summaries, and the join code.
- `POST /api/sessions/maps/attach` lets a remembered GM session attach a persisted map by slug to the server-owned live session state; it never accepts a browser-supplied whole-map document as authority.
- `POST /api/sessions/player-state` lets a joined player refresh only their own identity, assignments, and visible session map summary.
- `POST /api/sessions/assignments` is the GM-only assignment endpoint; the lobby displays assignment counts and player assignment summaries, while full assignment editing remains a GM API/use-case operation rather than a rich lobby editor.

The lobby must not autosave whole maps, grant players map-edit authority, expose the GM key in page chrome, or imply that the local role picker is public authentication.

## Safety and identity rules

Session hosting is disabled by default. Start the app with a guarded helper before using the lobby endpoints:

```bash
npm run dev:session:lan
```

The helper sets the exact `ROTOM_ENABLE_SESSION_HOST=1` runtime flag for Nuxt. For same-machine-only smoke tests, the manual equivalent is `ROTOM_ENABLE_SESSION_HOST=1 npm run dev`; for LAN and named-tunnel safe defaults, prefer the runtime scripts guide.

Important boundaries:

- The GM must still choose **GM Login** in the existing local `/login` screen before pressing **Start GM session**.
- That local GM/player picker remains a trust switch for local campaign use. It is not hardened public auth.
- The session-local GM key is stored only in the GM browser's local session identity record and is required by GM management/assignment calls.
- The player join code creates only a session-local player identity. It is not a full account, password, or durable permission outside this session.
- Player display names are labels; duplicate names may exist because identity comes from generated `playerId` and `clientId` values.
- The browser continuity cookie is only a non-secret hint. GM keys and join codes must not be placed in cookies or committed to docs/logs.

## Expected LAN usage for the lobby

For detailed same-network setup and troubleshooting, use the [Live session LAN hosting runbook](live-session-lan-hosting.md). For the current lobby, the expected table shape is still GM-hosted and LAN-first:

1. The GM runs Rotom Table on their own machine or a small machine they control.
2. Session hosting is explicitly enabled with `ROTOM_ENABLE_SESSION_HOST=1`, typically via `npm run dev:session:lan` for LAN smoke testing.
3. Players on the same Wi-Fi/LAN open the GM machine's private address in a browser, for example `http://192.168.1.42:3000/sessions`.
4. The GM verifies the `/sessions` safety banner before sharing the join code.
5. Players join with the code and a display name; the server creates session-local player/client identity and keeps authoritative state on the GM host.

When testing LAN access in development, bind the dev server to the LAN interface with the helper:

```bash
npm run dev:session:lan
```

Use the URL printed by Nuxt or the GM machine's private IP address. If a browser cannot connect, check that both devices are on the same network and that the GM machine's firewall allows the dev-server port. Stop the server or unset `ROTOM_ENABLE_SESSION_HOST` after the smoke test.

Remote campaign play should use the [Live session named Cloudflare Tunnel runbook](live-session-cloudflare-tunnel-hosting.md) with a stable hostname. Quick Tunnel may be mentioned only as a temporary development smoke-test option, must not be treated as the supported campaign path, and is documented in the [Live session Quick Tunnel caveat](live-session-quick-tunnel-caveat.md).

## GM flow

1. Start the app with session hosting enabled.
2. In the GM browser, open `/login` and choose **GM Login**.
3. Open `/sessions` from the navigation.
4. Read the safety banner. Do not share a join code if the exposure is surprising. A no-active-session warning is expected before the GM starts a session; missing-credential, missing-state, or unknown-readiness warnings are blockers.
5. Press **Start GM session**.
6. Confirm the lobby shows a session ID, revision `0`, a player join code, and safety readiness that is no longer missing session-local credentials or authoritative state.
7. Open the saved map on the plain `/maps/<slug>` local-first route and confirm intended edits are saved.
8. Expand the map navigation rail and press **Attach current map to live session**. This publishes the persisted map by slug into server-owned session map state, selects it by default, and grants player visibility by default.
9. Share only the join code and the app URL with trusted players.
10. Use **Refresh lobby** after players join to confirm they appear in the joined-player list and that the selected map is available for session mode.
11. Assign controllable token and/or sheet resources for players who should act on the map; map visibility alone lets players open the session map but does not grant token control.
12. From a map view, use **Open attached session map** or **Open session map** only when you intentionally want that route to use `?session=1` and WebSocket commands. The plain `/maps/<slug>` route remains local-first.
13. Keep the GM browser/private profile open. If the GM browser forgets the session identity, the simplest current recovery is to start a new session and share the new code.

## Player flow

1. In a separate browser, profile, or incognito/private window, open `/sessions` on the same Rotom Table host.
2. Enter the GM's join code. Hyphens and casing may be normalized by the server.
3. Enter a table display name.
4. Press **Join session**.
5. Confirm the player summary shows the chosen display name, active session status, and current revision.
6. Confirm the assignment panel says the GM has not assigned controllable sheets or tokens yet unless assignment data was created by a GM endpoint call.
7. Confirm **Visible session maps** lists the attached map when the GM attached it with player visibility. If no map is listed, ask the GM to attach a saved map or grant visibility, then refresh the remembered session.
8. Use the visible map link to open `/maps/<slug>?session=1` only after the browser has a remembered player identity.
9. Reload the page and use **Refresh remembered session** to confirm the browser-local identity can refresh the player-filtered state.
10. Use **Forget in this browser** when the test is finished or when reusing the browser for another player.

## Two-browser manual QA checklist

Use one GM browser and one separate player browser/profile. Do not commit any generated `data/sessions/` files from the smoke test.

### Preparation

- [ ] `git status --short` is clean before the smoke test.
- [ ] Dependencies are installed with `npm install`.
- [ ] The target verification commands have passed recently: `npm run typecheck`, `npm test`, and `npm run build`.

### Disabled/fail-closed check

- [ ] Start the app without `ROTOM_ENABLE_SESSION_HOST=1`.
- [ ] Open `/sessions`.
- [ ] The safety banner reports hosting disabled.
- [ ] **Start GM session** fails closed or remains unavailable until the flag is enabled.

### Enabled GM start

- [ ] Restart with `ROTOM_ENABLE_SESSION_HOST=1 npm run dev` for same-machine testing, or `npm run dev:session:lan` for LAN testing.
- [ ] GM browser: choose **GM Login** at `/login`.
- [ ] GM browser: open `/sessions` directly or from the map navigation rail **Start/manage session** shortcut and verify the safety banner classification matches the expected host (`local` for localhost, `lan` for a private IP).
- [ ] GM browser: press **Start GM session**.
- [ ] GM browser: record that a join code is displayed and the GM key itself is not shown in the page chrome.

### Player join

- [ ] Player browser/profile: open the same `/sessions` URL, or use the map navigation rail **Join session** shortcut if starting from a map view.
- [ ] Enter the join code and a display name.
- [ ] Press **Join session**.
- [ ] Player browser: verify active session status, display name, revision, and player-only assignment summary.
- [ ] Player browser: verify the response does not reveal the GM key, join code, other players, or map documents.

### Map attachment

- [ ] GM browser: open a saved map on the plain `/maps/<map-slug>` route.
- [ ] Map view: expand the navigation rail and press **Attach current map to live session**.
- [ ] GM browser: verify the attach status reports success and the **Open attached session map** link points to `/maps/<map-slug>?session=1`.
- [ ] GM browser: press **Refresh lobby** and verify the selected map is attached and available for session mode.
- [ ] Player browser: press **Refresh remembered session** and verify **Visible session maps** lists the attached map without exposing the map document.

### GM management refresh

- [ ] GM browser: press **Refresh lobby**.
- [ ] GM browser: verify the joined-player list includes the player display name.
- [ ] GM browser: verify assignment counts are visible and remain empty unless a GM assignment endpoint call has been made.
- [ ] GM browser: verify refreshing the lobby does not create a new join code or duplicate player entry.
- [ ] Map view: expand the navigation rail, verify the **Table session** panel links to start/manage, join, attach the current map, and `?session=1`, and verify following **Return to local map** removes the session query rather than changing the saved map.

### Identity continuity and cleanup

- [ ] Reload the GM browser and press **Refresh remembered session**; the GM lobby summary refreshes using browser-local identity.
- [ ] Reload the player browser and press **Refresh remembered session**; the player-filtered summary refreshes using browser-local identity.
- [ ] Player browser: press **Forget in this browser** and confirm the remembered session clears locally.
- [ ] GM browser: press **Forget in this browser** after the test if the session should not remain remembered.
- [ ] Stop the dev server, unset `ROTOM_ENABLE_SESSION_HOST`, and remove any private local session data only if you no longer need it.

### Negative checks

- [ ] Player browser: an invalid or expired join code shows a safe error and does not create a player identity.
- [ ] A non-GM local role cannot start a GM session from the lobby.
- [ ] The lobby does not expose raw snapshots, map documents, GM keys, real secrets, or private campaign data.
- [ ] For live token movement, use the focused [Live session multi-tab local smoke script](live-session-multi-tab-smoke.md); this lobby-only checklist should still confirm that the join/manage UI itself does not send map autosaves or expose raw session data.

## Evidence template

When recording a manual pass in a PR or build note, keep it generic and avoid real campaign/player details:

| Item | Expected | Observed |
| --- | --- | --- |
| Safety banner | Disabled/local/LAN classification matches startup mode | |
| GM start | Join code shown; GM key not visible in page chrome | |
| Player join | Player identity created from code and display name | |
| Map attachment | Saved map attached by slug; session map available without exposing map JSON | |
| GM refresh | Joined player appears once | |
| Player refresh | Player-filtered state reloads after page refresh and lists visible session maps | |
| Cleanup | Remembered identity cleared; no private data committed | |

## Troubleshooting notes

- **Start fails while testing locally:** confirm the process was started with `ROTOM_ENABLE_SESSION_HOST=1`; changing the shell variable after Nuxt starts is not enough.
- **The start button is disabled:** choose **GM Login** in the existing local `/login` route first.
- **Player cannot reach the LAN URL:** verify the GM used `--host 0.0.0.0`, both devices are on the same network, and the firewall permits the dev-server port.
- **Player join fails:** re-check the code from the GM lobby, make sure the session is still active, and refresh the GM lobby to confirm the session did not end.
- **Player has no visible maps:** ask the GM to attach a saved map to the live session or grant player visibility, then refresh the remembered session.
- **A browser has stale identity:** use **Forget in this browser**, then join again or start a new session.
- **Session files appeared locally:** `data/sessions/` is ignored/private runtime data. Back it up only when needed and do not commit it.
