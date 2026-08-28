# Release command

Rotom Table has one fail-closed release preparation command:

```bash
npm run release:prepare
```

It creates an operator-local, git-ignored `release-evidence/` bundle for the immutable commit and annotated tag at `HEAD`. It does not publish a tag, release, artifact, hostname, or evidence file. Publication remains an owner action.

## Preconditions

Run from a reviewed source checkout on the supported Linux x86-64 shape with Node 24:

```bash
nvm use
git status --short              # no output
git rev-parse HEAD
git tag --points-at HEAD
```

The release command itself recreates `node_modules` with `npm ci --include=dev`, so the checked-in lock is the installed dependency authority rather than pre-existing local package state.

The package version must have been minted through the version authority. `v<package version>` must already exist as an **annotated** tag at `HEAD`, and its annotation must identify that version. Existing tags are immutable; if a rehearsal candidate changes, mint and tag the next candidate rather than moving the old tag. If a final tagged release needs a source repair, mint the next patch version.

The command accepts no bypass, skip, path, or “allow dirty” arguments. `.output/`, `.nuxt-build/`, and `release-evidence/` must remain git-ignored generated directories and may not be symlinks.

## What the command does

In order, the command:

1. proves Linux x86-64, Node 24, a clean tracked/untracked source tree, a full commit identity, and an annotated version-matching tag at `HEAD`;
2. installs the exact checked-in lock with `npm ci --include=dev` and proves installation did not change source;
3. runs the tag-aware identity gate;
4. runs the complete bounded `check:release-readiness` aggregate serially;
5. proves the source tree is still clean;
6. removes only the reviewed ignored build/evidence directories;
7. derives `SOURCE_DATE_EPOCH` from the immutable commit and runs the production build with release provenance (`ROTOM_RELEASE_BUILD=1`, exact commit, and exact tag);
8. normalizes Nuxt/Nitro release-only generated identity, asset ordering, and timestamps to immutable commit authority before hashing;
9. generates a sorted SHA-256 manifest and build provenance;
10. audits the built artifact for private data, credentials, campaign databases/sidecars, browser traces, unreviewed runtime dependencies, and documentary-tree runtime dependence;
11. writes a bounded gate summary and self-excluding release-evidence manifest;
12. re-verifies every output/evidence hash, identity, source binding, permission, and privacy posture, then proves the source tree remains clean.

A failed step exits non-zero and no later step is treated as passed. Evidence is written only after the bounded gates and production build pass; the evidence directory is recreated on every successful attempt.

## Deterministic local evidence bundle

A successful run creates exactly these root files:

- `release-evidence/checksums.sha256` — one sorted SHA-256 row for every `.output` file;
- `release-evidence/provenance.json` — package/schema/source/builder/build identity;
- `release-evidence/artifact-audit.json` — zero-finding privacy, dependency, and documentary-boundary audit;
- `release-evidence/gate-summary.json` — passed bounded commands and hashes for notes, changelog, lock, distribution manifest, and limitations;
- `release-evidence/release-bundle-manifest.json` — hashes and sizes for the four evidence inputs above, excluding its own bytes to avoid self-reference.

The bundle contains no wall-clock completion field, campaign value, credential, private hostname, or hosted-write value. Commit time is the deterministic time authority. Release builds disable nondeterministic per-component SSR style aggregators, derive Nuxt's build ID from package/commit identity, sort Nitro's embedded public-asset map, and replace generated Nitro dates/asset mtimes with `SOURCE_DATE_EPOCH`. Normal development and unreleased production builds are not rewritten. Files use exact mode `0640` (owner read/write, group read, no access for others); the evidence directory uses `0750` and remains outside the source distribution.

Verify an existing bundle without rebuilding:

```bash
npm run release:check-evidence
```

The check requires the same immutable commit/tag and exact `.output` bytes. Any source-binding, checksum, permission, identity, or audit drift fails.

## Recovery from failure

- **Dirty tree:** review or commit source changes; never bypass the check.
- **Missing/mismatched tag:** mint the intended next version if needed and create a new annotated tag at the reviewed commit. Never move an existing tag.
- **Gate failure:** repair the owning source or certification and rerun from the beginning. A repair after a final tag requires the next patch version.
- **Build, reproducibility, or audit failure:** preserve private diagnostic material outside the checkout if needed, repair the source, mint a successor candidate or patch when the tagged commit changed, and rerun. Never weaken checksum comparison or move the failed tag.
- **Evidence drift:** delete only ignored `.output/` and `release-evidence/`, then rerun from the immutable tagged source. Do not edit generated checksums or provenance by hand.
