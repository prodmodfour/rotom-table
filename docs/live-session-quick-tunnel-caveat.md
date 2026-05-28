# Live session Quick Tunnel caveat

Quick Tunnel remains a temporary development smoke-test option for legacy session endpoint/socket maintenance only. It is not a supported campaign play path.

Normal profile-based play does not require a tunnel-specific live-session flow. Players use **Player Login**, select persistent profiles, browse Pokédex/reference pages, and open regular player-visible maps at `/maps/<slug>`. GMs link characters from `/players`.

## If you use Quick Tunnel for legacy smoke

- Treat the URL as temporary and unstable.
- Do not paste real join codes, GM keys, private player names, snapshots, event logs, tunnel credentials, real `.env` values, or screenshots with secrets into docs or issues.
- Do not use Quick Tunnel to replace named-tunnel setup for any serious remote test.
- Do not add share links, invite links, per-map ACLs, or anyone-with-link modes.
- Stop the tunnel and clear browser session identities when the smoke is done.

For normal remote play decisions, review the trust-based auth limitations in [Security](../SECURITY.md) and the profile flow in [Player profiles and linked character control](player-profiles.md).
