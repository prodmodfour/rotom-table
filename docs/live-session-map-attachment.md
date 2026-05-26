# Live session map attachment flow

This guide documents how a GM publishes a saved Rotom Table map into an active live session so the session socket and command handlers have a server-owned session map to mutate. It connects the `/sessions` lobby, the map navigation rail, `POST /api/sessions/maps/attach`, player visible-map navigation, and `?session=1` session map routes.

Use it after the GM has chosen a supported host path from the [LAN hosting runbook](live-session-lan-hosting.md) or [named Cloudflare Tunnel runbook](live-session-cloudflare-tunnel-hosting.md). For local-vs-session client behaviour, see the [Live session client integration guide](live-session-client-integration.md). For wire contracts and endpoint shapes, see the [live session protocol](live-session-protocol.md).

## Short version

1. Start Rotom Table with session hosting enabled, for example `npm run dev:session:lan` or `npm run dev:session:tunnel`.
2. In the GM browser, choose **GM Login** and open `/sessions#gm-lobby-title`.
3. Press **Start GM session** and keep the GM browser/profile private.
4. Open the saved map on the plain local-first route, `/maps/<map-slug>`, and make sure any intended edits have been saved.
5. In the map navigation rail, press **Attach current map to live session**.
6. Confirm the map is selected for the live session and available as a session map.
7. Share the player-facing URL and join code with trusted players.
8. Players join from `/sessions#player-lobby-title`, refresh their lobby state, and open a listed **Visible session maps** link.
9. The GM assigns controllable token and/or sheet resources for players who should act on the map by using **Assign map tokens** / **Assign control** in the map navigation rail.
10. GM and players use `/maps/<map-slug>?session=1` for live play so actions travel as session commands.

Plain `/maps/<map-slug>` remains local-first. Use it for map preparation and private editing. Use `/maps/<map-slug>?session=1` only when the table is playing through the live session.

## Why attachment is required

Starting a live session creates session identity, a join code, revision `0`, and an empty authoritative session state. It does not guess which saved campaign map should become the current table. The GM must attach a saved map by slug so the host can load the persisted map document, clone it into `AuthoritativeSessionState.maps`, and mark it as the selected session map when requested.

The attachment request identifies a persisted map. It does not accept a browser-provided map document as authority. Unsaved browser-only edits are not included; save the local map first, then attach it.

Once attached, session commands mutate the server-owned session map copy. Accepted commands advance session/map revisions, write a local session snapshot, and send small same-session patches. Rejected commands leave the authoritative session map unchanged. Browser-local seed state may help first paint in the session map view; the local seed is only a visual starting point, not command authority, and must be replaced by snapshots or patches from the host.

## GM UI flow

Use a GM browser/profile that remembers the session-local GM identity returned by the lobby.

1. Start the host with the explicit session-host runtime flag.
2. Choose **GM Login** at `/login`.
3. Open `/sessions#gm-lobby-title`, verify the safety banner, and press **Start GM session**.
4. Open the saved map on `/maps/<map-slug>`.
5. Expand the map navigation rail. The **Attach current map** panel should report **Local-first map view** and say it is ready to attach the persisted map.
6. Press **Attach current map to live session**.
7. After success, the panel reports the map was attached and offers **Open attached session map**. The GM management summary also reports the selected map slug, selected map revision, attached-map availability, and map count.
8. In **Player access**, use **Assign map tokens** to grant token control to joined players. Assignment buttons change between **Assign control** and **Unassign control** without exposing session secrets.
9. Open `/maps/<map-slug>?session=1` only when the GM wants the view to read the server-owned session map and send table actions as session commands.

The default attach action selects the attached map and makes it visible to joined players and future players. Reattaching the same persisted map republishes the map by slug, advances the session revision once, and preserves that session map's revision value so clients can continue reconciling against the same map lane.

## Attach endpoint contract

The UI calls the same small HTTP contract that operators can use for focused smoke tests:

```http
POST /api/sessions/maps/attach
```

```json
{
  "sessionId": "session_generated_table_id",
  "gmKey": "gmkey_exampleGeneratedSecretValue01",
  "gmClientId": "client_gm_browser_id",
  "mapSlug": "viridian-gym",
  "selectedMapBehavior": "select-attached-map",
  "visibilityBehavior": "visible-to-all-players"
}
```

Rules:

- The route fails closed unless `ROTOM_ENABLE_SESSION_HOST=1` is active.
- `gmKey` is the session-local GM credential. The local `/login` role picker is not public authority for this endpoint.
- `mapSlug` names a saved map in the app's map storage. The server loads the document by slug.
- Request fields such as `map`, `maps`, `document`, `mapDocument`, or `mapState` are rejected because live-session authority must not come from a browser-supplied whole-map payload.
- `selectedMapBehavior` defaults to `select-attached-map`. Use `preserve-current-selection` only when attaching a map without changing the active table selection.
- `visibilityBehavior` defaults to `visible-to-all-players`. Use `visible-to-joined-players` when only players who have already joined should receive the map grant, or `gm-only` when the GM is preparing a hidden session map.

A successful response returns no secrets and no map document. It includes the public session revision, selected map slug, map count, attached map slug/revision, selection result, visibility summary, and snapshot revision/written-at fields.

## Player flow after attachment

Players do not need the GM key or raw map JSON.

1. Open the player-facing `/sessions#player-lobby-title` URL from a separate browser profile, private window, or device.
2. Enter the join code and a display name.
3. Refresh the remembered player session if needed.
4. In the **Visible session maps** section, open the selected session map link. The link uses `/maps/<map-slug>?session=1`.
5. If the player sees a no-map state, ask the GM to attach a saved map or make the attached map visible to players, then refresh the lobby.
6. If the player can view the session map but a command is rejected as unauthorized, ask the GM to assign the relevant token or sheet.

Visibility and control are separate. A visible map grant lets the player open the session map. A controllable token or sheet assignment lets the player send commands for that resource.

## Assigning controllable resources

Map attachment can grant map visibility, but it does not automatically let every player move every token. Player commands still pass server-side assignment checks.

The normal GM UI is the map navigation rail on the attached map:

1. Refresh the GM lobby so joined players and assignment counts are current.
2. Open the selected session map or attached map page as the GM.
3. In **Player access**, expand **Assign map tokens**.
4. Use **Assign control** for each current map token a player should control; use **Unassign control** to remove that token control while leaving unrelated map visibility intact.
5. Ask players to refresh or retry from the latest session map state after assignments change.

The controls call the GM-only assignment endpoint:

```http
POST /api/sessions/assignments
```

```json
{
  "sessionId": "session_generated_table_id",
  "gmKey": "gmkey_exampleGeneratedSecretValue01",
  "gmClientId": "client_gm_browser_id",
  "playerId": "player_generated_id",
  "action": "assign",
  "resources": [
    { "kind": "sheet", "sheetKind": "trainer", "sheetSlug": "misty" },
    {
      "kind": "token",
      "tokenId": "token-starmie",
      "mapSlug": "viridian-gym",
      "sheetKind": "pokemon",
      "sheetSlug": "starmie"
    }
  ]
}
```

Assigning a token or sheet adds that resource to the player's controllable and visible resources. Unassigning removes matching token/sheet control without removing unrelated map visibility. The GM lobby summary shows joined players and assignment counts so the GM can verify who has access before asking players to act.

## Session map readiness and common failure states

Use this readiness check before asking players to move tokens:

- **Host flag disabled** — attach, join, assignment, and session socket calls fail closed unless the app was started with `ROTOM_ENABLE_SESSION_HOST=1`.
- **No map attached** — `/sessions` may show a live session and joined players, but players will not see a **Visible session maps** link and `/maps/<slug>?session=1` cannot claim authoritative readiness for that map.
- **No token assigned** — the player can see the session map, but controls stay disabled or commands reject as unauthorized until the GM assigns the relevant current map token or sheet.
- **Stale revision** — the browser built a command from an older session/map revision. Refresh the session map snapshot, inspect the latest table state, and retry only if the action still applies.
- **Disconnected socket** — the session map is showing the last authoritative state it received. Reconnect or refresh the snapshot before sending more commands; do not use the plain local-first route as live-session authority.

## Authority and persistence boundary

Keep these boundaries visible during operation:

- Local-first mode (`/maps/<map-slug>`) edits the saved map document through the existing local workflows.
- Attaching a map copies the saved map into server-owned session state; it does not make the browser's editable map ref live authority.
- Session mode (`/maps/<map-slug>?session=1`) reads snapshots and patches from the session host and sends table actions as session commands with `opId` and `baseRevision`.
- Accepted commands mutate the server-owned attached map and write session snapshots under `data/sessions/<sessionId>/`, which is ignored/private runtime data.
- Reconnect asks the host for an authoritative snapshot when replay is unavailable. It must not rebuild authority from local storage, stale optimistic previews, screenshots, or copied map JSON.
- If the GM wants later local map edits to become the active session map, save them first and attach the map again.

## Operator checklist

Before play:

- [ ] Standard checks passed recently: `npm run typecheck`, `npm test`, and `npm run build`.
- [ ] Session hosting is enabled only for the intended LAN or named-tunnel host path.
- [ ] The GM has started a fresh live session and verified the safety banner.
- [ ] The target map exists, is saved, and contains the tokens/sheets needed for the table.
- [ ] The GM attached the saved map and confirmed the selected map is available for session mode.
- [ ] Players joined with display names and can see the map in **Visible session maps**.
- [ ] The GM assigned controllable resources for players who should move or act with tokens/sheets.
- [ ] GM and players opened `/maps/<map-slug>?session=1` for live play.
- [ ] No GM keys, join codes, snapshots, event logs, private maps/sheets, tunnel credentials, real `.env` files, or screenshots with secrets are staged for commit.

## Troubleshooting

| Symptom | Likely cause | Safe recovery |
| --- | --- | --- |
| **Attach current map** is disabled | The browser is not logged in as local GM, does not remember a GM live session, is remembering a player identity, or no saved map slug is open. | Choose **GM Login**, start or refresh the GM live session in the same browser profile, use **Forget in this browser** if the profile remembers a player identity, then reopen the saved map. |
| Attach fails with hosting disabled | The Nuxt process was not started with `ROTOM_ENABLE_SESSION_HOST=1`. | Stop the server and restart with `npm run dev:session:lan`, `npm run dev:session:tunnel`, or the documented manual equivalent. |
| Attach fails with map not found | The slug does not resolve to a saved map. | Open the map from the map library, confirm the slug, save intended edits, then attach again. |
| Player joined but sees no session maps | No map is attached, the map was attached with GM-only visibility, or the player has not refreshed state after attachment. | The GM attaches the saved map with player visibility or grants map visibility, then the player refreshes the lobby. |
| Player can see the map but cannot move a token | Visibility was granted, but the token/sheet is not controllable for that player. | The GM assigns the relevant token or sheet, then the player refreshes or retries from the latest session map. |
| Session command uses an old table position | The browser acted from a stale revision or optimistic preview. | Use the refresh/reconnect action so the session map is rebuilt from the host snapshot, then retry only if the action still makes sense. |
