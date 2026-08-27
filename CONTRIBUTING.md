# Contributing

Rotom Table is a private trusted-table, liveplay-only fan project maintained for a known campaign group. Contributions are welcome for review, but acceptance, response time, roadmap inclusion, and ongoing support are not guaranteed. Contributions must preserve the supported private-VPS/SQLite shape unless a separately reviewed plan explicitly changes it.

Read [`DESIGN.md`](DESIGN.md), [`docs/architecture.md`](docs/architecture.md), and the relevant subsystem guide before editing. The active numbered implementation ledger and repository instructions own execution order.

## Development setup (not a liveplay host)

Use Node 24 and the lockfile:

```bash
nvm use
npm ci --include=dev
ROTOM_CAMPAIGN_ROOT=/tmp/rotom-table-contributor npm run dev
```

`npm run dev` is for development only. Supported table hosting uses the production build on the documented private VPS shape; see [`docs/private-vps-hosting.md`](docs/private-vps-hosting.md).

Use a disposable synthetic campaign root. Never point tests, scripts, screenshots, or review tooling at a real campaign. The GM/Player picker is not public authentication, even in development.

## Authority boundaries

- Runtime PTU identities and mechanics come only from the fourteen `data/reference/*.json` authorities and `shared/ruleset/natures.ts`.
- `books/`, `ptu-data/`, parser inputs, PDFs, websites, and wikis are documentary/provenance material, never runtime fallback authority.
- SQLite repositories and existing versioned contracts own campaign mutations. Do not add parallel JSON, browser, or UI authority.
- Role-safe server projections own privacy. Do not send broad GM/private payloads and hide them with client CSS.
- Supported deployment remains one private Linux x86-64 VPS per trusted campaign group, behind an outer access gate. Public authentication, SaaS, multi-tenancy, federation, and public-service hardening are out of scope.

## Change workflow

1. Start from a clean tree and identify the owning plan, contract, registry, or migration.
2. Make the smallest authority-preserving change and add focused tests.
3. Run the focused generator/check/test command for the affected domain with bounded workers where practical.
4. Batch related work before `npm run typecheck` and broad checks; run memory-heavy processes one at a time.
5. Before sharing, inspect `git status`, `git diff --check`, and every generated artifact diff.

Baseline checks for an ordinary code change:

```bash
npm run lint
npm run typecheck
npx vitest run <focused-test-files> --maxWorkers=1 --no-file-parallelism
npm run build
```

Use the complete repository gate only at a meaningful integration or release milestone:

```bash
bash scripts/quality-gate.sh
```

Release-boundary work must also pass:

```bash
npm run check:release-readiness
```

Do not weaken a gate, rebase a performance budget, rewrite archived evidence, or mark a blocked row complete to make validation pass.

## Domain-specific changes

- Move automation: [`docs/move-automation.md`](docs/move-automation.md) and `npm run check:move-automation-complete`.
- Ability automation: [`docs/ability-automation.md`](docs/ability-automation.md) and `npm run check:ability-automation-complete`.
- Encounter presentation and liveplay: [`docs/encounter-presentation-contract.md`](docs/encounter-presentation-contract.md), [`docs/encounter-workspace/design-system.md`](docs/encounter-workspace/design-system.md), `npm run check:encounter-presentation`, and `npm run check:encounter-design`.
- Breeding: [`docs/breeding/contributor-guide.md`](docs/breeding/contributor-guide.md).
- Contests: [`docs/contests/README.md`](docs/contests/README.md).
- GM Campaign Toolkit: [`docs/gm-campaign-toolkit/contributor-guide.md`](docs/gm-campaign-toolkit/contributor-guide.md).
- Visible UI: follow `DESIGN.md`, existing tokens/primitives, accessibility semantics, responsive behavior, and reduced-motion requirements.

## Data and evidence hygiene

Never commit or attach real campaign data, player information, credentials, environment files, backups, production logs, browser traces, private screenshots, release-evidence directories, or one-off scratch material. Use only synthetic fixtures and app-owned test roots.

Generated artifacts must be reproducible, sorted, source-hash-bound, and reviewed. A report that inventories risk is not owner approval or legal clearance.

## Fan-project, dependency, and asset boundaries

- Do not present Rotom Table as official, endorsed, or commercial.
- Do not claim ownership of Pokémon/PTU names, images, rules terms, concepts, text, or sprites.
- Do not add or download third-party media without recorded source, author where supplied, license/usage posture, and distribution review.
- Use the existing project-authored CSS/SVG/canvas visual language before introducing another asset.
- Preserve dependency and font notices in `public/THIRD_PARTY_NOTICES.txt`; regenerate it with `npm run generate:release-readiness:third-party-notices` after lock changes.
- Keep [`LICENSE`](LICENSE), [`NOTICE.md`](NOTICE.md), [`docs/fan-project-notice.md`](docs/fan-project-notice.md), and [`docs/media-attribution.md`](docs/media-attribution.md) aligned.

Licensing and distribution decisions remain owner-reserved. Contributors may surface facts and propose remediation but may not label uncertain material legally cleared.

## Reporting and support

Use a private channel for vulnerabilities as described in [`SECURITY.md`](SECURITY.md). Public issues and contributions must contain only synthetic, redacted evidence. This project provides best-effort hobby maintenance with no SLA, uptime, commercial-support, or compatibility promise outside the reviewed supported matrix; see [`docs/support.md`](docs/support.md).
