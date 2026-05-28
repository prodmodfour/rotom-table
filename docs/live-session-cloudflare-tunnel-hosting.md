# Legacy live-session named Cloudflare Tunnel runbook

This runbook is retained for maintaining the old guarded session lobby/socket surfaces over a stable tunnel. It is not the normal remote-player setup for profile-based play.

Normal play still uses persistent player profiles and the regular app routes. If a trusted remote table uses a tunnel to reach the GM-hosted app, players should choose **Player Login**, select their profile, browse `/maps`, `/pokedex`, and PTU reference pages, and open the relevant player-visible map at `/maps/<slug>`. The GM links character sheets from `/player-profiles`. Do not use live-session join codes, map attachment, session-owned map copies, share links, or special map URLs for normal play.

## When this legacy runbook applies

Use these notes only when changing or smoke-testing the remaining `/sessions` identity page, `/api/sessions/*` endpoints, or `WebSocket /api/sessions/socket` over a named tunnel.

The GM still runs Rotom Table on a machine they control. A named Cloudflare Tunnel can forward a stable HTTPS hostname to that private server for a maintenance smoke. Quick Tunnel is development-only and should not be treated as a campaign-hosting path.

## Legacy tunnel startup

Start Rotom Table for legacy session maintenance with loopback binding:

```bash
npm run dev:session:tunnel
```

Then start the named tunnel in a separate terminal, for example:

```bash
cloudflared tunnel run rotom-table
```

Do not commit tunnel credentials, `cert.pem`, tokens, private keys, Access/WAF config, real `.env` files, screenshots with secrets, or generated `data/sessions/` runtime files.

## Minimal legacy smoke

Use separate browser profiles for GM and player identities.

- [ ] GM opens the public hostname, chooses **GM Login**, opens `/sessions`, and confirms the safety banner reports the expected remote/tunnel exposure.
- [ ] GM starts a legacy session and keeps the GM key private.
- [ ] Player opens `/sessions` through the same public hostname, joins with the GM-provided code and a safe display name, and sees only player-safe lobby state.
- [ ] Confirm `/api/sessions/socket` upgrades over `wss://` if socket code is the area under maintenance.
- [ ] Forget browser identities, stop Nuxt and `cloudflared`, and check that no secrets or private runtime data are staged.

For normal remote play, verify profile selection, linked-character sheet access, linked token control on `/maps/<slug>`, and reference browsing instead.

## Safety boundaries

- The local GM/player picker and any legacy join code are not public authentication.
- A tunnel exposes the app origin to anyone allowed through the tunnel/edge policy; use optional Cloudflare Access/WAF/IP restrictions as outer protection only.
- Do not document or create share links, invite links, anyone-with-link modes, per-map ACLs, or map-specific access grants.
- Keep profile-based player control, regular map URLs, and filesystem data-hygiene expectations intact.

See [Player profiles and linked character control](player-profiles.md), [Live session public exposure checks](live-session-public-exposure-checks.md), [Live session Quick Tunnel caveat](live-session-quick-tunnel-caveat.md), and [Live session security boundaries](live-session-security-boundaries.md).
