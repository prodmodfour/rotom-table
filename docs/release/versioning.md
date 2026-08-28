# Release identity and version policy

Rotom Table uses Semantic Versioning. `package.json#/version` is the only editable version source; package-lock metadata, server responses, the Settings **About Rotom Table** panel, build provenance, notes, and annotated tags must agree with it.

## Minting a version

Never edit either package file directly. Use the reviewed mint authority with the current and next identities:

```bash
npm run release:mint-version -- \
  --from 1.0.1 \
  --to 1.0.2 \
  --ticket P14-001 \
  --recorded-at YYYY-MM-DD
```

Replace the example ticket with the actual reviewed ticket from a registered numbered ledger. The completed 1.0 history used `NONE → 1.0.0-rc.1`, sequential `rc.N → rc.N+1`, and exactly one `rc.N → 1.0.0` transition. Post-1.0 transitions advance one patch at a time (`1.0.x → 1.0.x+1`). The command synchronizes `package.json`, `package-lock.json`, and the append-only mint ledger. `npm run check:release-readiness:identity` rejects out-of-band edits.

## Build and tag agreement

A release or release-candidate build supplies its immutable identity at build time:

```bash
COMMIT="$(git rev-parse HEAD)"
TAG="v$(node -p "require('./package.json').version")"
SOURCE_DATE_EPOCH="$(git show -s --format=%ct "$COMMIT")"
ROTOM_RELEASE_BUILD=1 \
ROTOM_BUILD_COMMIT="$COMMIT" \
ROTOM_BUILD_TAG="$TAG" \
SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH" \
npm run build
```

Create only annotated tags on `main`:

```bash
git tag -a "$TAG" -m "Rotom Table $(node -p "require('./package.json').version")"
node scripts/release-readiness/check-identity.mjs --require-tag
```

Tag publication remains owner-controlled. Never force-move or replace a tag. If a release-candidate rehearsal diverges, leave its evidence immutable, fix the source, mint the next release candidate, and create a new annotated tag. If any final tagged release diverges from its commit, package identity, notes, or checksums—even before publication—stop deployment and issue the next patch version; do not mutate history or weaken checksum comparison.

The immutable local `v1.0.0` tag is the first exercised example of this rule: released-identity verification produced three different output checksum manifests from identical supported-shape builds. It remains unpublished and cannot be represented as verified. The owner separately authorized `v1.0.1` as its deterministic successor; that patch is accepted only after a second clean tagged build reproduces every reference checksum.

Post-1.0 fixes are tagged `v1.0.x` from `main`. Long-lived release branches are not part of the supported workflow.
