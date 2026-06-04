# Private VPS readiness summary

Rotom Table's VPS update is ready for review as **private trusted-table hosting** support. It keeps the local-first campaign workflow, adds a reviewed private host path, and does not claim public SaaS or public multi-user-service readiness.

## Selected Node runtime

- Selected runtime: **Node.js 24 LTS** with npm.
- Repo-level version files: `.nvmrc` and `.node-version` both request Node 24.
- Package metadata: `package.json` declares `engines.node` as `>=24 <25`.
- CI/runtime validation: GitHub Actions uses Node 24, and the standard install/typecheck/test/build checks were validated under Node 24.
- Fallback: no Node 22 fallback is documented for this branch because no concrete Node 24 incompatibility was found.

## Deployment path chosen

- Primary private VPS path: **systemd with a direct Node.js runtime**.
- Build and boot command: run `npm run build`, then have systemd start the built Nitro server through `npm run start` from the app checkout. The equivalent direct command is `node .output/server/index.mjs`.
- Network boundary: Nitro should bind to loopback, for example `NITRO_HOST=127.0.0.1` and `NITRO_PORT=3000`, behind a private reverse proxy and an outer access gate.
- Environment boundary: private host settings live outside Git, for example `/etc/rotom-table/rotom-table.env`; campaign JSON and campaign reference override diffs live outside the app checkout through `ROTOM_CAMPAIGN_ROOT`.
- Docker and Compose were intentionally not added because systemd plus direct Node runtime is the selected initial deployment path.

## Hosted-write policy summary

Production hosted filesystem writes fail closed unless a private operator explicitly sets the exact opt-in:

```bash
ROTOM_ENABLE_HOSTED_WRITES=1
```

When `NODE_ENV=production`, an unset flag or any value other than exactly `1` keeps covered writes disabled. Non-production local development writes remain available without the hosted-write flag, preserving the local-first flow.

Covered routes include map, sheet, encounter-table, persistent encounter-generation, player-profile, Pokédex maintenance, and campaign next-day writes. Pokédex maintenance persists a campaign-owned reference override diff, not an app-checkout reference edit. The flag controls filesystem persistence only; it is not authentication, authorization, rate limiting, abuse monitoring, or a backup substitute. Private VPS use still requires an outer access gate before the app.

## Final validation evidence

The branch was validated with the standard commands:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

The chosen boot path was also smoke-checked by starting the built Nitro server with `npm run start` on a loopback smoke port and verifying the no-secret `/api/health` endpoint.

## Known follow-ups and limits

- Public service mode is separate work. It still needs real authentication and authorization, hosted persistence designed for multi-user operation, route-by-route public hardening, rate limiting or abuse controls, content/asset rights review, private/public data separation, and incident-response practices.
- Every real private host still needs host-specific validation of its outer access gate, reverse proxy, firewall, WebSocket forwarding, backup and restore practice, private campaign root, and exact hosted-write flag state before players use it.
- Legacy `/sessions` surfaces remain guarded maintenance paths, not the normal private VPS profile-play flow.
- Docker/Compose deployment can be added later only if it is selected and validated as a separate deployment path.

## Related docs

- [Private VPS hosting scope](private-vps-hosting.md)
- [Private VPS deployment smoke checklist](private-vps-deployment-smoke-checklist.md)
- [Private VPS backup runbook](private-vps-backups.md)
- [API route mutation audit](api-route-mutation-audit.md)
- [Security](../SECURITY.md)
