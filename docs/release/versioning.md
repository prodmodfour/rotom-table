# Release identity and version policy

Rotom Table uses Semantic Versioning. `package.json#/version` is the only editable version source; package-lock metadata, server responses, the Settings **About Rotom Table** panel, build provenance, notes, and annotated tags must agree with it.

## Minting a version

Never edit either package file directly. Use the reviewed mint authority with the current and next identities:

```bash
npm run release:mint-version -- \
  --from 1.0.0-rc.3 \
  --to 1.0.0-rc.4 \
  --ticket P13-074 \
  --recorded-at YYYY-MM-DD
```

Allowed 1.0 transitions are `NONE → 1.0.0-rc.1`, sequential `rc.N → rc.N+1`, and one `rc.N → 1.0.0` transition. The command synchronizes `package.json`, `package-lock.json`, and the append-only mint ledger. `npm run check:release-readiness:identity` rejects out-of-band edits.

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

Tag publication remains owner-controlled. Never force-move or replace a tag. If an unpublished rehearsal diverges, leave its evidence immutable, fix the source, mint the next release candidate, and create a new annotated tag. If a published tag diverges from its commit, package identity, notes, or checksums, stop deployment and issue a new patch or release-candidate version; do not mutate history.

Post-1.0 fixes are tagged `v1.0.x` from `main`. Long-lived release branches are not part of the supported workflow.
