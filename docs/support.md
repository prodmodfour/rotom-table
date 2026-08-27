# Support expectations

Rotom Table is maintained as a hobby/private-table project. Support is best effort, not a commercial service agreement.

## Supported release shape

Support and release certification cover only the current release line on the machine-readable [`supported-platform-matrix.v1.json`](../data/release-readiness/supported-platform-matrix.v1.json):

- one private Linux x86-64 VPS for one known campaign group;
- Node 24, npm lockfile installation, and the built Nuxt/Nitro server;
- SQLite authority under an operator-controlled `ROTOM_CAMPAIGN_ROOT`;
- an outer access gate in front of the trusted GM/Player picker;
- the certified desktop and mobile Chromium projects;
- documented upgrade, backup, restore, and integrity-audit procedures.

During release-candidate preparation, support targets the latest `1.0.0-rc.N`. After release, it targets the latest published `1.0.x` unless a successor policy changes that boundary.

## Best-effort help

Useful, synthetic reports include:

- exact Rotom Table version and storage schema shown in Settings or `/api/version`;
- the supported OS/Node/npm/browser versions;
- a minimal reproduction against a disposable campaign root;
- the documented command used and its redacted error;
- confirmation that the relevant integrity or focused check was run.

Maintainers may fix a defect, request a focused reproduction, decline unsupported scope, or defer work to a reviewed plan. Contributions and issue reports do not create a delivery commitment.

## No implied promises

There is no response-time SLA, no uptime guarantee, no hosted service, no paid support, no data-recovery service, no bug bounty, no compatibility promise for old commits, and no guarantee that a contribution will be merged. In particular, support does not cover:

- public internet exposure, SaaS, multi-tenancy, federation, or use without an outer access gate;
- local development as a live campaign host;
- unsupported operating systems, architectures, Node versions, or browsers;
- direct SQLite/JSON surgery, database downgrade, or unsafe active-WAL file copies;
- modified forks, unreviewed plugins/assets, or documentary-source runtime changes;
- legal advice or assurance about downstream reuse of Pokémon/PTU material.

Backups and campaign custody remain the operator's responsibility. Recovery support means following the certified runbooks, not repairing private campaign files supplied to the repository.

## Security and private data

Report vulnerabilities privately under [`SECURITY.md`](../SECURITY.md). Never post real campaign databases, profiles, secrets, logs, traces, screenshots, hostnames, or backup archives in an issue or pull request. Maintainers should reject and remove private evidence rather than treating it as a support fixture.

## Documentation defects

Incorrect commands, broken links, and disagreements between documentation and the supported matrix are release defects. Report them with synthetic context. The authoritative operator entry point is [`README.md`](README.md); archived or explicitly historical documents are not current support instructions.
