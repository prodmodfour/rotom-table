# Live session multi-tab local smoke script

This guide covers the local browser smoke helper for the Live session client integration path. It opens GM and player entry points on one development machine and gives a short checklist for verifying that explicit session-mode map views use server-authoritative token commands and same-session WebSocket patches.

This is a local development smoke check, not a LAN runbook, named-tunnel runbook, public auth hardening guide, deployment smoke checklist, or replacement for the automated Vitest suite. For guarded startup helpers, see the [live session host runtime scripts](live-session-host-runtime.md). For cross-device same-Wi-Fi setup, IP discovery, and player URLs, see the [Live session LAN hosting runbook](live-session-lan-hosting.md). For remote stable-hostname setup, WebSocket considerations, safety warnings, and rollback steps, see the [Live session named Cloudflare Tunnel runbook](live-session-cloudflare-tunnel-hosting.md). For the two-player LAN/named-tunnel smoke covering reconnect, token movement, initiative, and conflict rejection, see the [Live session deployment smoke checklist](live-session-deployment-smoke-checklist.md). For temporary `trycloudflare.com` caveats and legacy SSE limitations, see the [Live session Quick Tunnel caveat](live-session-quick-tunnel-caveat.md). For the underlying local-mode/session-mode boundary and recovery guidance, see the [Live session client integration guide](live-session-client-integration.md).

## Script

Start Rotom Table in one terminal with the guarded LAN helper:

```bash
npm run dev:session:lan
```

For same-machine-only smoke tests, the manual equivalent remains `ROTOM_ENABLE_SESSION_HOST=1 npm run dev`; LAN binding is useful when the same checklist is reused across devices.

Then run the smoke helper from a second terminal:

```bash
npm run smoke:session:multi-tab -- --map <map-slug>
```

Useful options:

```bash
npm run smoke:session:multi-tab -- --map <map-slug> --no-open
npm run smoke:session:multi-tab -- --base-url http://127.0.0.1:3000 --map <map-slug>
npm run smoke:session:multi-tab -- --map <map-slug> --player-tabs 2
npm run smoke:session:multi-tab -- --map <map-slug> --skip-checks
```

The script opens or prints:

- `/login` for the GM local role picker;
- `/sessions#gm-lobby-title` for GM start/manage;
- `/sessions#player-lobby-title` for player join;
- `/maps/<map-slug>` as a local-first comparison route;
- `/maps/<map-slug>?session=1` for explicit GM and player session-map tabs.

Use a separate browser profile, browser container, or private/incognito window for the player. GM and player identities are browser-local records; using the same profile for both can overwrite the remembered identity and invalidate the smoke.

By default the helper also runs focused automated checks:

```bash
npm test -- tests/server/sessionTokenCommandTwoClientSmoke.test.ts tests/composables/map-editor/sessionClientIntegration.test.ts
```

Those tests lock the fake two-client WebSocket command fanout and the client session-map/optimistic reconciliation behaviour that the browser smoke is checking manually.

## Browser smoke checklist

### Preparation

- [ ] `git status --short` is clean before the smoke.
- [ ] The map named by `<map-slug>` exists locally and has at least one placed token.
- [ ] The app was started with `npm run dev:session:lan` or the same-machine manual equivalent `ROTOM_ENABLE_SESSION_HOST=1 npm run dev`.
- [ ] The GM uses one browser profile/window and the player uses a separate browser profile/window.

### Start and join

- [ ] GM profile: open `/login` and choose **GM Login**.
- [ ] GM profile: open `/sessions#gm-lobby-title`, read the safety banner, and press **Start GM session**.
- [ ] GM profile: verify a join code is visible and the GM key is not shown in page chrome.
- [ ] Player profile: open `/sessions#player-lobby-title`, enter the join code plus a safe display name, and press **Join session**.
- [ ] Player profile: verify the player summary is active and does not reveal the GM key, join code, other players, hidden maps, or raw snapshots.

### Basic token command propagation

- [ ] GM profile: open `/maps/<map-slug>?session=1`.
- [ ] Player profile: open `/maps/<map-slug>?session=1`.
- [ ] GM profile: move or turn one placed token from the explicit session-map view.
- [ ] GM profile: verify no player-facing rejection banner appears for the accepted command.
- [ ] Player profile: verify the same token position/facing changes without refreshing and without a whole-map save.
- [ ] Both profiles: verify the session panel still shows the same session and presence/revision state stays consistent.
- [ ] Optional conflict check: cause a stale same-token action and verify the rejection banner gives safe refresh/retry guidance while optimistic state rolls back or reconciles to the server current state.
- [ ] Optional reconnect check: reload the player session-map tab and verify reconnect/snapshot UI recovers or clearly reports stale/missing map state instead of making browser-local edits authoritative.

Unassigned player token movement should be rejected. That is expected unless the GM has explicitly assigned the token or sheet to that player for the session.

### Local-mode comparison

- [ ] Open the plain `/maps/<map-slug>` route in another tab.
- [ ] Verify that the plain local route remains local-first and does not require a session identity.
- [ ] Verify that session-only optimistic state does not become a local whole-map autosave.

### Cleanup

- [ ] Player profile: use **Forget in this browser** if the test identity should not remain remembered.
- [ ] GM profile: use **Forget in this browser** after recording evidence.
- [ ] Stop the dev server and unset `ROTOM_ENABLE_SESSION_HOST`.
- [ ] Do not commit generated `data/sessions/` files or private map/sheet data from the smoke pass.

## Evidence template

Keep evidence generic; do not paste real join codes, GM keys, private player names, snapshots, or campaign data.

| Item | Expected | Observed |
| --- | --- | --- |
| Script | Opened/printed GM and player URLs for the expected base URL and map slug | |
| Automated checks | Focused two-client server smoke and client integration tests passed | |
| GM start | Join code shown; GM key not shown in page chrome | |
| Player join | Player identity created from code and display name | |
| Token propagation | Accepted token move/turn appears in GM and player session-map tabs | |
| Rejection/reconnect | Stale/reconnect UI is safe and does not expose secrets or raw snapshots | |
| Local-mode boundary | Plain `/maps/<slug>` stays local-first; session mode does not autosave whole maps | |
| Cleanup | Browser identities cleared as needed; no private runtime data committed | |

## Boundaries

- This smoke keeps the locked Live session architecture: GM-hosted, local-first JSON persistence, WebSocket session channel, server-authoritative commands, session-local identity, and an explicit host flag.
- It does not make the trust-based local GM/player picker public authentication.
- It does not add a database, cloud persistence layer, or SaaS deployment target.
- It does not replace the [Live session LAN hosting runbook](live-session-lan-hosting.md), [Live session named Cloudflare Tunnel runbook](live-session-cloudflare-tunnel-hosting.md), [Live session deployment smoke checklist](live-session-deployment-smoke-checklist.md), or [Live session Quick Tunnel caveat](live-session-quick-tunnel-caveat.md). LAN setup is documented separately for same-network play; named tunnels are documented separately for stable-hostname remote play; deployment smoke covers two players plus reconnect/token/initiative/conflict checks; Quick Tunnel remains development smoke-test only and legacy SSE remains a non-session/local path.
