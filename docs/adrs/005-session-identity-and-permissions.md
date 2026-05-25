# ADR 005: Session identity and permissions

Date: 2026-05-25

Status: Accepted

## Context

Track 2 sessions are GM-hosted and session-scoped. A GM starts one table session on a machine they control, and players join from browsers over LAN or a named Cloudflare Tunnel. The existing local GM/player role picker is a trusted-table convenience and is not hardened public authentication.

Live session commands still need clear authority boundaries. The server must know which connected browser is acting as the GM, which player is sending a command, which client instance is reconnecting, which resources that player can see, and which tokens or sheets the player may control. Those checks must happen on the GM-hosted server before a command mutates authoritative state.

Track 2 therefore needs enough identity to run one table session safely without turning Rotom Table into an account system, SaaS product, or public multi-tenant service.

## Decision

Track 2 uses **session-local identity and server-enforced permissions**.

A session has identities and credentials that are generated for that session only:

- **Session ID** — server-generated identifier that scopes state, sockets, snapshots, logs, presence, and broadcasts.
- **GM key** — secret session-local credential that proves a client is acting as the GM for this session. It is not a long-lived password or account credential.
- **Join code** — short session-local code that allows players to join the GM's current session. It is not sufficient to control table resources by itself.
- **Player ID** — server-generated identifier for one joined player within the session.
- **Client ID** — identifier for one browser/client instance, used for reconnect continuity, duplicate handling, diagnostics, and presence.
- **Display name** — player-provided table name shown in lobby and presence UI after sanitization. It is not an authentication factor.
- **Assignments** — GM-managed records that grant a player control over specific sheets, tokens, or later controllable resources.

There are no full user accounts in Track 2. There is no third-party auth provider, global user profile, password reset flow, cross-campaign identity, tenant membership model, or cloud identity store.

The GM-hosted server is responsible for permission decisions. Client UI may hide unavailable actions, but server validation is authoritative. Every session command and WebSocket handshake that relies on identity must be checked against the current session state before it can mutate or subscribe to authoritative data.

## Permission model

### GM authority

The GM identity has broad authority for one session: starting and ending the session, viewing and managing joined players, assigning or revoking controllable resources, selecting visible maps or state slices, and issuing GM-only table commands as those commands land.

GM authority is still bounded by validation and safety rules. A GM command may be rejected if it is malformed, targets missing resources, violates command-specific invariants, or fails later revision/conflict checks. The GM key is also scoped to one session and must not be treated as an account password.

### Player authority

A player identity can join the session, connect one or more clients, receive the state the server marks visible to that player, and issue commands only for resources the GM has assigned and that are currently visible/controllable.

A player cannot gain control by editing browser state, choosing a display name, knowing another player's name, or observing a token on the map. The server checks the player ID, client/session identity, assignment records, resource visibility, and command-specific payload before accepting a player command.

### Display names

Display names are for humans at the table. They must be sanitized for rendering and logging, may need disambiguation in the lobby, and must never be used as a stable identity or permission key. The server should keep using player IDs for permission checks even when two players choose similar or duplicate display names.

### Client IDs and reconnects

Client IDs identify browser instances, not people. They support reconnect handshakes, presence, command diagnostics, and duplicate operation handling. A reconnecting client still needs valid session identity for its role; a client ID alone is not permission to act as the GM or a player.

### Assignments and visibility

Assignments are explicit GM-managed grants such as "player A may control token T" or "player B may control sheet S." Visibility and control are separate concepts:

- a visible resource may be readable but not controllable;
- a controllable resource must also be visible when a player command acts on it;
- GM-only resources and hidden table state remain unavailable to player commands;
- assignment changes take effect on the server and are reflected through presence/session-state updates.

Later implementation tickets define the concrete TypeScript types and predicates for controllable resource references, assignment records, visibility checks, and permission results. This ADR locks the behaviour those implementations must preserve.

## Safety boundaries

- Session-hosting endpoints and sockets remain behind the explicit session-host runtime flag.
- A leaked GM key grants GM authority only for that session, but that is still sensitive and must not be logged casually, committed, or exposed in screenshots.
- Join codes should be treated as invite secrets for the current session, not as durable passwords.
- Session credentials, player IDs, client IDs, snapshots, and event logs are local session data and must not be committed as example campaign data.
- The local GM/player role picker remains a local trust convenience and must not be represented as public authentication.
- Named Cloudflare Tunnel exposure makes the GM-hosted server reachable to remote browsers, so server-side permission checks cannot rely on trusted LAN-only behaviour.

## Rejected alternatives

### Full accounts or external auth providers

Rejected for Track 2. Accounts would add registration, login, password or provider management, profile data, recovery flows, account/session linking, and long-term security obligations. Track 2 only needs session-local identity for a GM-hosted table session.

### Public multi-tenant identity

Rejected. A tenant/user/membership model would imply SaaS deployment, tenant isolation, hosted persistence, and broader public security hardening. Rotom Table Track 2 remains GM-hosted and local-first.

### Display-name based permissions

Rejected. Display names are user-controlled and may be duplicated or changed. Permissions must be keyed by server-generated player IDs and assignment records, not by names typed in a browser.

### Client-side permission authority

Rejected. Browser UI checks are useful for usability, but they are not the trust boundary. The server must validate every command and handshake against authoritative session identity, assignments, visibility, and resource state.

### Join code as control permission

Rejected. A join code only lets a player ask to join the current session. It must not grant blanket control over tokens, sheets, GM tools, or hidden state. Control comes from server-side GM assignments.

## Consequences

- Later session contract work must define shared types for session IDs, GM keys, join codes, player IDs, client IDs, display-name safe values, roles, assignments, controllable resources, and permission results.
- Join/lobby work must create player identities from join codes and display names without adding full accounts.
- WebSocket hello/auth work must validate GM/player session identity before a socket joins session fanout or receives state.
- Command validators and use cases must check role, assignments, visibility, and resource scope before mutating authoritative state.
- Presence and management UI must show display names and connection state while keeping server-generated IDs as the authority for permissions.
- Documentation must continue to warn that exposing the app through a tunnel is not the same as deploying hardened public authentication.

## Validation notes

Reviewers can validate this ADR by checking that later Track 2 work:

- uses session-local IDs and credentials rather than global accounts;
- keeps display names out of permission keys;
- requires server-side permission checks for commands and WebSocket subscriptions;
- treats join codes as session invites, not broad control grants;
- allows only the GM to manage assignments;
- separates visible resources from controllable resources;
- keeps session hosting gated and documents public exposure risks.
