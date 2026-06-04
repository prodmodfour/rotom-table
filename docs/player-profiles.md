# Player profiles and linked character control

Rotom Table's normal player workflow uses persistent player profiles, not live-session map attachment. A player profile is a local campaign identity that owns links to existing Pokémon and trainer sheets.

The GM/Player picker and remembered player profile are trust-based table workflow controls, not public authentication. If this flow is reachable through a private VPS, tunnel, or reverse proxy, restrict access first with an outer layer such as VPN/Tailscale, Cloudflare Access, reverse-proxy auth, or a private network.

## Normal table flow

1. The GM starts the app with the usual local development command, such as `npm run dev`.
2. The GM chooses **GM Login** on `/login`.
3. The GM prepares sheets and a player-visible saved map as normal.
4. The GM opens `/players`, creates or selects player profiles, and links the existing Pokémon or trainer sheets each player should control.
5. Each player chooses **Player Login**, selects their GM-created persistent profile, then opens the relevant player-visible map from `/maps` or directly at `/maps/<slug>`.
6. Players act with tokens whose placement `sheetKind` and `sheetSlug` match one of their profile's linked characters.

In short, players normally open the relevant player-visible map and act with linked characters; they do not enter a separate session map flow.

Players do not need `/sessions`, a join code, a map attachment step, a special session-query map URL, a share link, or a per-map invite. Maps remain normal saved map documents; profile-linked characters decide player control.

## Player login and remembered profiles

**Player Login** opens the profile picker. Players can choose an existing GM-created profile, but profile creation itself stays GM-only. The browser remembers only the selected profile summary separately from the `rotom-role` cookie, so switching from GM to player does not create accounts, passwords, OAuth state, or real public authentication.

If a remembered profile is missing or invalid, the app clears that remembered selection and asks the player to choose again. Players without a selected profile can still reach the login/profile picker, map and sheet libraries, Pokédex, reference pages, and informational routes.

## GM profile management

The `/players` route is GM-only. GMs can:

- list persistent player profiles;
- create new persistent player profiles;
- view the profile ID, display name, and linked characters;
- link existing Pokémon and trainer sheets from the current sheet libraries;
- unlink character sheets that should no longer be controlled by that profile.

Profile links are character references, not sheet copies. A link points at an existing sheet by kind and slug. Duplicate links are rejected, and the server validates linked sheet references before saving profile updates.

## What linked characters allow

A selected player profile grants control only through its linked character refs:

- **Sheets:** players can load and save linked Pokémon/trainer sheets through the normal sheet editor. They can edit the same UI-editable fields the sheet editor exposes while derived/system fields remain protected by the existing save pipeline.
- **Maps:** players can open player-visible maps and control placed tokens whose `sheetKind`/`sheetSlug` matches a linked character.
- **Token actions:** linked tokens can move, turn, spend move usage, use supported table actions, and update token-scoped combat resources through document-backed map actions.

GM users still control all sheets and map tokens.

## What players can browse

Players can navigate normal player-facing app routes, including:

- `/maps` and player-visible `/maps/<slug>` pages;
- `/sheets` for public sheets and sheets linked to the selected profile;
- `/pokedex` and individual Pokédex pages;
- PTU reference pages such as `/moves`, `/maneuvers`, `/abilities`, `/capabilities`, `/conditions`, `/rules`, `/items`, `/features`, and `/edges`.

These browsing routes do not require a live session or map-specific invitation.

## What remains GM-only

Players cannot create player profiles, create maps, delete maps, create sheets, delete sheets, manage encounter tables, generate encounter sheets, manage player profile links, or use GM-only map-building/admin controls such as terrain building, hazards, field effects, token spawning/deletion, or resource library file management.

The role picker remains a trust-based local-table convenience. It is not hardened public authentication and should not be exposed as a public multi-user service without a separate security design.

## Troubleshooting

- **A player cannot control a token:** confirm the player selected the intended profile, the token placement references the linked sheet's current `sheetKind` and `sheetSlug`, and the map is player-visible.
- **A player cannot save a sheet:** confirm the sheet is linked to the selected profile or is otherwise public/player-accessible.
- **A profile-linked sheet disappeared from a player library:** refresh the profile selection from `/login`, then ask the GM to verify the link in `/players`.
- **A player sees GM-only controls:** check the browser role on `/login`; players should use **Player Login** and a selected profile.
