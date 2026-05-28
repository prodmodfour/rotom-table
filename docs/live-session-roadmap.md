# Legacy live-session roadmap

This roadmap is retained as historical/maintenance context for the guarded live-session endpoint and socket code. It is no longer the Rotom Table play roadmap.

The current product direction is profile-based play:

- players choose or create a persistent profile after **Player Login**;
- GMs link existing Pokémon/trainer sheets to profiles from `/players`;
- players navigate to normal player-visible maps at `/maps/<slug>`;
- linked character refs grant sheet editing and map-token control;
- players can browse Pokédex and PTU reference pages without live-session identity;
- normal play has no map attachment, join code, share link, invite link, or per-map ACL.

See [Player profiles and linked character control](player-profiles.md).

## Legacy session scope that remains

The remaining legacy session code is direct-only maintenance surface area:

- `/sessions` identity/lobby page;
- guarded `/api/sessions/*` endpoints;
- `WebSocket /api/sessions/socket` helpers;
- ignored/private `data/sessions/` snapshots and optional event logs when the legacy host is enabled.

The old roadmap phases for session commands, snapshots, assignments, and hosting hardening are historical. They should not be used to reintroduce session-owned map authority into normal play.

## Non-goals that still apply

- public accounts, passwords, OAuth, SSO, MFA, or hosted multi-tenant auth;
- cloud databases or SaaS persistence as a prerequisite for local play;
- Quick Tunnel as a campaign-hosting recommendation;
- browser-owned whole-map collaborative autosave;
- share links, invite links, anyone-with-link modes, restricted links, or per-map ACLs.

## Validation

Use the standard app checks:

```bash
npm run typecheck
npm test
npm run build
```

Current profile-play coverage lives in profile storage/API, profile picker, linked sheet access, linked token-control, document-backed map action, route guard, library, and smoke-flow tests.

## Related docs

- [Player profiles and linked character control](player-profiles.md)
- [Legacy live-session protocol](live-session-protocol.md)
- [Legacy live-session socket protocol](live-session-socket-protocol.md)
- [Live session lobby and manual QA](live-session-lobby.md)
- [Live session validation matrix](live-session-validation-matrix.md)
- [Live session security boundaries](live-session-security-boundaries.md)
- [Live session dependency and runtime maintenance](live-session-dependency-runtime-maintenance.md)
