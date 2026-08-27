#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import process from 'node:process'

const ROOT = resolve(import.meta.dirname, '../..')
const DATA_ROOT = resolve(ROOT, 'data/release-readiness')
const BASELINE_PATH = resolve(DATA_ROOT, 'release-baseline.v1.json')
const BASELINE_SHA256 = '096e039949d67c926ec82ac860f22569280937da0aa0e4a4576589267b430d11'
const BASELINE_COMMIT = '84c4659e10bec5f39eea674e6439d24ac978e6ee'
const BASELINE_TRACKED_FILES = 16_791

const json = value => `${JSON.stringify(value, null, 2)}\n`
const sha256 = value => createHash('sha256').update(value).digest('hex')
const relativePath = absolute => absolute.slice(ROOT.length + 1)

const runGit = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const validateFrozenBaseline = () => {
  assert(existsSync(BASELINE_PATH), 'Missing frozen release baseline')
  const bytes = readFileSync(BASELINE_PATH)
  assert(sha256(bytes) === BASELINE_SHA256, `Frozen baseline hash mismatch; expected ${BASELINE_SHA256}`)
  const baseline = JSON.parse(bytes)
  assert(baseline.artifact === 'release-readiness-baseline', 'Unexpected baseline artifact id')
  assert(baseline.schemaVersion === 1, 'Unexpected baseline schema version')
  assert(baseline.verifiedAgainst?.headCommit === BASELINE_COMMIT, 'Baseline commit drift')
  assert(baseline.verifiedAgainst?.trackedFileCount === BASELINE_TRACKED_FILES, 'Baseline tracked-file count drift')
  assert(Array.isArray(baseline.rows) && baseline.rows.length === 20, 'Baseline must contain exactly 20 rows')
  assert(new Set(baseline.rows.map(row => row.id)).size === 20, 'Baseline row ids must be unique')
  runGit(['cat-file', '-e', `${BASELINE_COMMIT}^{commit}`])
  const historicalFiles = runGit(['ls-tree', '-r', '--name-only', BASELINE_COMMIT]).split('\n').filter(Boolean)
  assert(historicalFiles.length === BASELINE_TRACKED_FILES, 'Baseline commit tracked-file census drift')
  const historicalPackage = JSON.parse(runGit(['show', `${BASELINE_COMMIT}:package.json`]))
  assert(!Object.hasOwn(historicalPackage, 'version'), 'Baseline package unexpectedly has a version')
  const historicalHealth = runGit(['show', `${BASELINE_COMMIT}:server/api/health.get.ts`])
  assert(!historicalHealth.includes('version'), 'Baseline health route unexpectedly reports a version')
  assert(!historicalFiles.some(path => /(^|\/)(CHANGELOG|RELEASE_NOTES)(\.|$)/i.test(path)), 'Baseline unexpectedly contains release notes')
}

const gate = (id, family, title, ownerDecision = false, boundary = false) => ({
  id,
  family,
  title,
  evidenceRequired: true,
  proseOnlyClosureForbidden: true,
  ownerDecision,
  allowedFinalStates: ownerDecision
    ? ['Approved']
    : boundary
      ? ['Documented boundary']
      : ['Certified', 'Repaired'],
})

const rubric = {
  artifact: 'release-gate-rubric',
  schemaVersion: 1,
  plan: 13,
  completionStates: {
    Certified: 'Executable, replayable evidence is bound to fixture or artifact hashes.',
    Approved: 'An explicit owner disposition is recorded for an owner-reserved row.',
    'Documented boundary': 'A reviewed P13-009 limitation is rendered verbatim into release notes.',
    Repaired: 'A matrix-exposed defect was fixed through its owning authority and re-certified.',
    Blocked: 'Required evidence, authority, or owner decision is missing; forbidden at acceptance.',
  },
  rules: {
    zeroGap: true,
    proseOnlyClosureForbidden: true,
    guaranteeDowngradeForbidden: true,
    blockedForbiddenAtAcceptance: true,
    documentedBoundaryRequiresRegisteredLimitation: true,
  },
  families: [
    'identity', 'upgrade', 'backup', 'catalog', 'distribution',
    'licensing', 'notes', 'provenance', 'acceptance', 'transition',
  ],
  rows: [
    gate('identity-policy', 'identity', 'Version policy and exactly-once mint'),
    gate('identity-package', 'identity', 'Package metadata identity'),
    gate('identity-server', 'identity', 'Role-safe server identity'),
    gate('identity-ui', 'identity', 'Accessible user-visible identity'),
    gate('identity-build', 'identity', 'Build-time identity and provenance'),
    gate('identity-agreement', 'identity', 'All version surfaces agree'),
    gate('identity-rc', 'identity', 'Release-candidate discipline'),
    gate('identity-checksums', 'identity', 'Checksums and provenance records'),
    gate('identity-tag', 'identity', 'Annotated tag convention and agreement'),
    gate('upgrade-historical-heads', 'upgrade', 'Every SQLite head v1-v55'),
    gate('upgrade-byte-preservation', 'upgrade', 'Reviewed exact-byte authority samples'),
    gate('upgrade-json-era', 'upgrade', 'JSON-era campaign import'),
    gate('upgrade-rejections', 'upgrade', 'Unsupported input rejection before writes'),
    gate('upgrade-interruption', 'upgrade', 'Interrupted migration atomicity and convergence'),
    gate('upgrade-contention', 'upgrade', 'WAL, lock, and read-only behavior'),
    gate('upgrade-performance', 'upgrade', 'Large-campaign upgrade budget'),
    gate('upgrade-rollback', 'upgrade', 'Backup-only rollback boundary'),
    gate('upgrade-guide', 'upgrade', 'Operator upgrade guide'),
    gate('backup-online', 'backup', 'Online backup under active WAL writes'),
    gate('backup-stopped', 'backup', 'Stopped-service backup'),
    gate('backup-fresh-host', 'backup', 'Fresh-host exact restore'),
    gate('backup-restore-upgrade', 'backup', 'Restore then upgrade'),
    gate('backup-mid-session', 'backup', 'Pending private state survives restore'),
    gate('backup-integrity', 'backup', 'Aggregate integrity audit'),
    gate('backup-privacy', 'backup', 'Archive trust-boundary content audit'),
    gate('backup-runbook', 'backup', 'Release-boundary backup runbook'),
    gate('catalog-census', 'catalog', 'Canonical source census'),
    gate('catalog-zero-gap', 'catalog', 'Complete-catalog zero-gap regression'),
    gate('catalog-no-documentary-read', 'catalog', 'Production documentary-read prohibition'),
    gate('catalog-registry-finality', 'catalog', 'Plans 1-12 mechanics finality'),
    gate('catalog-golden-journeys', 'catalog', 'Prior and 1.0 golden journeys'),
    gate('catalog-privacy', 'catalog', 'Structural privacy sweep'),
    gate('catalog-performance', 'catalog', 'Frozen performance-budget sweep'),
    gate('distribution-landing', 'distribution', 'Repository landing and documentation entry points'),
    gate('distribution-screenshots', 'distribution', 'Privacy-safe current screenshots'),
    gate('distribution-metadata', 'distribution', 'Package and repository metadata'),
    gate('distribution-tree-classification', 'distribution', 'Zero-unclassified tracked tree manifest'),
    gate('distribution-tree-disposition', 'distribution', 'Documentary-tree owner disposition', true),
    gate('distribution-private-exclusion', 'distribution', 'Private and ignored artifact exclusion'),
    gate('distribution-deployment', 'distribution', 'Supported deployment instructions'),
    gate('licensing-dependencies', 'licensing', 'Dependency license inventory'),
    gate('licensing-assets', 'licensing', 'Font, sprite, and media provenance inventory'),
    gate('licensing-disposition', 'licensing', 'License and notice owner dispositions', true),
    gate('notes-changelog', 'notes', 'Changelog spine'),
    gate('notes-operator', 'notes', 'Operator release notes'),
    gate('notes-gm-player', 'notes', 'GM and player release notes'),
    gate('notes-limitations', 'notes', 'Frozen known limitations'),
    gate('provenance-release-command', 'provenance', 'Fail-closed reproducible release command'),
    gate('provenance-artifact-audit', 'provenance', 'Built-artifact privacy and dependency audit'),
    gate('provenance-clean-host', 'provenance', 'Clean-host install rehearsal'),
    gate('provenance-full-rehearsal', 'provenance', 'Full rc release rehearsal'),
    gate('acceptance-quality', 'acceptance', 'Bounded full repository validation'),
    gate('acceptance-desktop', 'acceptance', 'Desktop production liveplay'),
    gate('acceptance-mobile', 'acceptance', 'Mobile production liveplay'),
    gate('acceptance-restore', 'acceptance', 'Release restore drill'),
    gate('acceptance-zero-unresolved', 'acceptance', 'Zero unresolved release or mechanics rows'),
    gate('acceptance-dossier', 'acceptance', 'Hash-bound acceptance dossier'),
    gate('acceptance-owner-go', 'acceptance', 'Owner go/no-go', true),
    gate('transition-atomic', 'transition', 'Atomic version, phase, notes, provenance, acceptance, and tag transaction'),
    gate('transition-released-identity', 'transition', 'Tagged released identity verification'),
    gate('transition-archive', 'transition', 'Ledger archive and post-1.0 boundary'),
    gate('boundary-trusted-role-picker', 'notes', 'Trusted-table role picker is not public authentication', false, true),
    gate('boundary-single-vps', 'notes', 'One private VPS per campaign group', false, true),
    gate('boundary-chromium', 'notes', 'Chromium-family browser certification only', false, true),
    gate('boundary-supplements', 'notes', 'Supplement packs are post-1.0', false, true),
    gate('boundary-local-hosting', 'notes', 'Local hosting is deprecated', false, true),
    gate('boundary-no-downgrade', 'notes', 'Downgrade requires exact backup restore', false, true),
  ],
}

const versionSurfaces = {
  artifact: 'release-version-surface-inventory',
  schemaVersion: 1,
  sourceOfTruth: { path: 'package.json', pointer: '/version', format: 'semver' },
  storageSchemaSource: { path: 'shared/release/storageSchema.ts', export: 'STORAGE_SCHEMA_VERSION' },
  agreementKey: ['version', 'storageSchemaVersion'],
  requiredSurfaces: [
    { id: 'package', kind: 'metadata', path: 'package.json', required: true },
    { id: 'shared-module', kind: 'runtime-authority', path: 'shared/release/identity.ts', required: true },
    { id: 'health', kind: 'server', path: '/api/health', required: true, privacy: 'public-no-secret' },
    { id: 'about', kind: 'ui', path: '/settings', required: true, audience: ['gm', 'player'] },
    { id: 'build', kind: 'embedded-provenance', path: 'runtimeConfig.public.releaseIdentity', required: true },
    { id: 'changelog', kind: 'documentation', path: 'CHANGELOG.md', required: true },
    { id: 'notes', kind: 'documentation', path: 'docs/releases/1.0.0.md', required: true },
    { id: 'provenance', kind: 'artifact', path: 'release-evidence/provenance.json', required: true },
    { id: 'tag', kind: 'git', path: 'refs/tags/v<version>', required: true, annotated: true },
  ],
  absenceIsFailure: true,
}

const platformMatrix = {
  artifact: 'release-supported-platform-matrix',
  schemaVersion: 1,
  supportPolicy: 'Only rows in this fixture are supported for Rotom Table 1.0.',
  operatingSystem: [{ family: 'Linux', architecture: 'x86-64', topology: 'private-vps' }],
  runtime: { node: '>=24 <25', nodeFile: '.nvmrc', packageManager: 'npm', install: 'npm ci --include=dev' },
  application: { framework: 'Nuxt 4', build: 'npm run build', start: 'npm run start', localDevHostingSupported: false },
  deployment: {
    serviceManager: 'systemd',
    originBinding: 'loopback',
    outerAccessGateRequired: true,
    campaignRootEnv: 'ROTOM_CAMPAIGN_ROOT',
    hostedWritesEnv: { name: 'ROTOM_ENABLE_HOSTED_WRITES', supportedValue: '1' },
    sessionHostEnv: { name: 'ROTOM_ENABLE_SESSION_HOST', supportedValue: '1' },
  },
  browsers: [
    { playwrightProject: 'chromium', device: 'Desktop Chrome' },
    { playwrightProject: 'mobile-chromium', device: 'Pixel 7' },
  ],
  database: {
    engine: 'SQLite',
    journalMode: 'WAL',
    backupMethods: ['online-sqlite-backup-api', 'stopped-service-copy'],
  },
  unsupported: ['nuxt-dev-hosting', 'public-saas', 'multi-tenant-service', 'non-Chromium certification', 'native-mobile-app'],
}

const historicalHeads = Array.from({ length: 55 }, (_, index) => ({
  fixtureId: `sqlite-head-v${index + 1}`,
  schemaVersion: index + 1,
  generator: 'scripts/release-readiness/generate-historical-heads.ts',
  certificationRow: 'upgrade-historical-heads',
}))

const upgradeInputs = {
  artifact: 'release-supported-upgrade-input-index',
  schemaVersion: 1,
  releaseSchemaVersion: 56,
  families: [
    { id: 'fresh-root', kind: 'fresh-or-empty-campaign-root', fixtures: ['empty-campaign-root'] },
    { id: 'sqlite-historical', kind: 'sqlite', fixtures: historicalHeads },
    {
      id: 'json-era',
      kind: 'documented-json-root',
      command: 'npm run migrate:sqlite',
      fixtures: ['json-era-minimal', 'json-era-representative', 'json-era-malformed'],
    },
  ],
  exactByteBoundaryHeads: [1, 5, 12, 21, 28, 41, 44, 45, 46, 50, 55],
  rejectionCorpus: [
    'corrupt-sqlite', 'partial-schema', 'unknown-schema-zero-nonempty',
    'future-schema-v57', 'non-database-file', 'read-only-input', 'locked-input', 'wal-sidecars-present',
  ],
  unknownInputPolicy: 'reject-before-write',
  downgradeSupported: false,
  rollback: 'restore-byte-exact-pre-upgrade-backup',
}

const distributionInventory = {
  artifact: 'release-distribution-inventory',
  schemaVersion: 1,
  releaseVersion: '1.0.0-rc.1',
  status: 'CERTIFIED',
  distributable: 'tagged-source-repository-plus-documented-production-build',
  trackedTreeAuthority: {
    policy: 'data/release-readiness/tracked-tree-policy.v1.json',
    inventory: 'data/release-readiness/tracked-tree-inventory.v1.json',
    classificationStatus: 'COMPLETE',
  },
  classes: [
    {
      id: 'runtime-source',
      includes: ['src/', 'server/', 'shared/', 'schemas/', 'nuxt.config.ts', 'package.json', 'package-lock.json'],
    },
    { id: 'runtime-public-media', includes: ['public/'], rightsClass: 'third-party' },
    {
      id: 'canonical-runtime-data',
      includes: ['data/reference/', 'shared/ruleset/natures.ts'],
      rightsClass: 'third-party',
    },
    {
      id: 'reviewed-product-data',
      includes: ['data/'],
      excludes: ['data/reference/', 'data/release-readiness/'],
    },
    {
      id: 'release-evidence-and-policy',
      includes: ['data/release-readiness/', 'scripts/release-readiness/'],
    },
    { id: 'documentation-and-presentation', includes: ['README.md', 'CHANGELOG.md', 'docs/', 'DESIGN.md'] },
    { id: 'deployment', includes: ['deploy/', '.env.example', '.env.vps.example'] },
    {
      id: 'tooling-tests-and-configuration',
      includes: ['scripts/', 'tests/', '.github/', '.pi/', '*.config.*', 'requirements.txt', 'justfile'],
    },
    {
      id: 'governance',
      includes: ['implementation-plans/', 'AGENTS.md', 'CONTRIBUTING.md', 'SECURITY.md', 'LICENSE', 'NOTICE.md'],
    },
    {
      id: 'owner-disposition-retained-labelled',
      includes: ['books/', 'ptu-data/', 'encounter_tables/', 'trainer_sizes/'],
      dispositionEvidence: 'data/release-readiness/documentary-tree-disposition.v1.json',
    },
    {
      id: 'owner-disposition-pruned',
      excludes: ['pokesheet.pdf', 'notepad/'],
      sourceTreeMembership: false,
      dispositionEvidence: 'data/release-readiness/documentary-tree-disposition.v1.json',
    },
  ],
  generatedOrPrivatePathsNeverCommittedToTheSourceDistribution: [
    '*.sqlite', '*.sqlite-*', '*.db', '*.db-*', '.env', '.env.*.local',
    'playwright-report/', 'test-results/', '.playwright-*/', 'campaign/', 'backups/',
    'logs/', 'run/', '.output/', '.nuxt-*/', 'node_modules/', 'release-evidence/',
  ],
  productionBuild: {
    command: 'npm ci --include=dev && npm run build',
    generatedOutput: '.output/',
    sourceTreeMembership: false,
    supportedDeployment: 'private Linux x86-64 VPS',
    operatorRunbook: 'docs/private-vps-hosting.md',
  },
  ownerDispositionResults: [
    {
      path: 'books/', classification: 'documentary', disposition: 'retain-and-label',
      label: 'books/README.md', ownerTicket: 'P13-058', status: 'OWNER_APPROVED_APPLIED',
    },
    {
      path: 'ptu-data/', classification: 'documentary', disposition: 'retain-and-label',
      label: 'ptu-data/README.md', ownerTicket: 'P13-058', status: 'OWNER_APPROVED_APPLIED',
    },
    {
      path: 'encounter_tables/', classification: 'private-data-sensitive', disposition: 'retain-and-label',
      label: 'encounter_tables/README.md', ownerTicket: 'P13-058', status: 'OWNER_APPROVED_APPLIED',
    },
    {
      path: 'trainer_sizes/', classification: 'mixed-authored-generated-third-party', disposition: 'retain-and-label',
      label: 'trainer_sizes/README.md', ownerTicket: 'P13-058', status: 'OWNER_APPROVED_APPLIED',
    },
    {
      path: 'pokesheet.pdf', classification: 'documentary', disposition: 'prune',
      ownerTicket: 'P13-058', status: 'OWNER_APPROVED_APPLIED',
    },
    {
      path: 'notepad/', classification: 'documentary', disposition: 'prune',
      ownerTicket: 'P13-058', status: 'OWNER_APPROVED_APPLIED',
    },
  ],
  ownerPrunedPathsForbidden: ['pokesheet.pdf', 'notepad/'],
  disposition: 'PHASE_6_DISTRIBUTION_AND_NOTICES_CERTIFIED',
}

const licensingInventory = {
  artifact: 'release-licensing-attribution-inventory',
  schemaVersion: 1,
  releaseVersion: '1.0.0-rc.1',
  status: 'OWNER_DISPOSITION_RECORDED',
  automationMayApprove: false,
  reports: {
    dependencies: 'data/release-readiness/dependency-license-report.v1.json',
    mediaAssets: 'data/release-readiness/media-asset-inventory.v1.json',
    documentaryTrees: 'data/release-readiness/documentary-tree-disposition.v1.json',
    ownerDisposition: 'data/release-readiness/licensing-notice-disposition.v1.json',
  },
  inventorySummary: {
    npmPackageInstances: 971,
    npmUnknownLicenses: 0,
    npmPotentiallyIncompatibleCopyleft: 0,
    pythonResolutionLockBound: true,
    sourceDistributionMediaFiles: 9444,
    unclassifiedMediaFiles: 0,
    unknownProvenanceMediaFiles: 0,
    unknownRedistributionMediaFiles: 7949,
    explicitSourceRestrictionConflictFiles: 1460,
    runtimeFontBinaries: 18,
    audioFiles: 0,
  },
  families: [
    {
      id: 'license-scope',
      sources: ['LICENSE', 'package.json'],
      finding: 'The Rotom MIT grant is limited to original project work and excludes third-party Pokémon/PTU material.',
      disposition: 'APPROVED_AS_WRITTEN',
    },
    {
      id: 'fan-content-posture',
      sources: ['NOTICE.md', 'docs/fan-project-notice.md'],
      finding: 'The project is non-commercial and unofficial; expanded notices explicitly state that posture and attribution are not redistribution permission.',
      disposition: 'APPROVED_EXPANDED_NOTICE',
    },
    {
      id: 'ptu-derived-data-and-text',
      sources: ['data/reference/', 'books/', 'ptu-data/'],
      prunedSources: ['pokesheet.pdf'],
      finding: 'Canonical runtime data plus retained documentary/parser trees contain third-party PTU-derived material and remain explicitly outside the Rotom grant.',
      disposition: 'APPROVED_RETAIN_OUTSIDE_GRANT',
    },
    {
      id: 'sprites-and-media',
      sources: ['public/', 'trainer_sizes/', 'docs/screenshots/', 'tests/e2e/**/*-snapshots/'],
      finding: 'Most Pokémon/item/Trainer art has no explicit redistribution license. The 29 unknown-source images were replaced with original code/vector work; 1,460 edited Trainer profiles remain by explicit owner risk acceptance under the recommendation-5 exception.',
      potentialBlocker: true,
      acceptedRisk: 'RECOMMENDATION_5_RETAIN_EDITED_TRAINER_PROFILES',
      disposition: 'APPROVED_REMEDIATED_WITH_RECORDED_EXCEPTION',
    },
    {
      id: 'fonts',
      sources: ['@fontsource/atkinson-hyperlegible', '@fontsource/eb-garamond', '@fontsource/jetbrains-mono'],
      finding: 'Three Fontsource families produce 18 runtime binaries under OFL-1.1; package copyright and license texts are preserved in the generated third-party notice bundle.',
      disposition: 'APPROVED_NOTICE_PRESERVED',
    },
    {
      id: 'npm-dependencies',
      sources: ['package-lock.json', 'public/THIRD_PARTY_NOTICES.txt', 'data/release-readiness/dependency-license-report.v1.json'],
      finding: '971 lock-bound instances have zero unknown or mandatory incompatible-copyleft entries; flagged licenses and root notices are indexed and preserved, and node-forge uses its BSD-3-Clause option.',
      disposition: 'APPROVED_NOTICE_PRESERVED',
    },
    {
      id: 'python-dependencies',
      sources: ['requirements.txt', 'public/THIRD_PARTY_NOTICES.txt', 'data/release-readiness/dependency-license-report.v1.json'],
      finding: 'The complete two-direct/four-transitive Python helper graph is exact-version pinned; certifi\'s MPL-2.0 posture is indexed in the notice bundle.',
      potentialBlocker: false,
      disposition: 'APPROVED_PINNED_AND_NOTICED',
    },
    {
      id: 'existing-notices',
      sources: ['NOTICE.md', 'docs/fan-project-notice.md', 'docs/media-attribution.md', 'public/THIRD_PARTY_NOTICES.txt'],
      finding: 'Expanded repository, fan-project, media-attribution, and generated dependency notices enumerate Fontsource, PokéSprite, PokémonDB, Pokémon Showdown, Trainer artist strings, derivatives, and the accepted risk.',
      disposition: 'APPROVED_EXPANDED',
    },
  ],
  ownerDispositionArtifact: 'data/release-readiness/licensing-notice-disposition.v1.json',
  releaseGate: 'All eight families carry explicit owner dispositions. The only retained potential-blocker condition is recommendation 5, preserved as a named owner-accepted risk rather than silently cleared by automation.',
}

const knownLimitations = {
  artifact: 'release-known-limitations',
  schemaVersion: 1,
  status: 'OWNER_ACCEPTED_FROZEN',
  ownerAcceptance: {
    basis: 'Plan 13 activation decision 9',
    ticket: 'P13-070',
    renderedAt: 'docs/releases/1.0.0.md#known-limitations-frozen',
  },
  freezePolicy: 'Only reviewed rows may close as Documented boundary; all other gate failures are blockers.',
  rows: [
    { id: 'trusted-role-picker', statement: 'The GM/Player role picker is a trusted-table convenience, not public authentication.' },
    { id: 'single-private-vps', statement: 'Rotom Table 1.0 supports one private Linux x86-64 VPS per campaign group, behind an outer access gate.' },
    { id: 'chromium-only', statement: 'Browser certification covers the Playwright Desktop Chrome and Pixel 7 Chromium projects only.' },
    { id: 'supplements-post-1.0', statement: 'Supplement and expansion content packs are post-1.0 and require separately reviewed app-owned canonical data.' },
    { id: 'local-hosting-deprecated', statement: 'Local hosting is deprecated; supported play uses a production Nitro build.' },
    { id: 'downgrade-by-restore', statement: 'Database downgrade is unsupported; rollback means restoring the exact pre-upgrade backup.' },
  ],
}

const evidenceCommands = {
  artifact: 'release-evidence-command-index',
  schemaVersion: 1,
  schemas: [
    'data/release-readiness/schemas/certification.schema.v1.json',
    'data/release-readiness/schemas/rehearsal.schema.v1.json',
    'data/release-readiness/schemas/dossier.schema.v1.json',
    'data/release-readiness/schemas/final-acceptance.schema.v1.json',
  ],
  commands: [
    { id: 'phase-1', command: 'npm run check:release-readiness:phase1', bounded: true },
    { id: 'presentation', command: 'npm run check:release-readiness:presentation', bounded: true },
    { id: 'private-artifacts', command: 'npm run check:release-readiness:private-artifacts', bounded: true },
    { id: 'dependency-licenses', command: 'npm run check:release-readiness:dependency-licenses', bounded: true },
    { id: 'media-assets', command: 'npm run check:release-readiness:media-assets', bounded: true },
    { id: 'licensing', command: 'npm run check:release-readiness:licensing-inventories', bounded: true },
    { id: 'support', command: 'npm run check:release-readiness:support', bounded: true },
    { id: 'deployment', command: 'npm run check:release-readiness:deployment', bounded: true },
    { id: 'distribution', command: 'npm run check:release-readiness:distribution', bounded: true },
    { id: 'distribution-acceptance', command: 'npm run check:release-readiness:distribution-acceptance', bounded: true },
    { id: 'changelog', command: 'npm run check:release-readiness:changelog', bounded: true },
    { id: 'release-notes', command: 'npm run check:release-readiness:release-notes', bounded: true },
    { id: 'release-command', command: 'npm run check:release-readiness:release-command', bounded: true },
    { id: 'artifact-audit', command: 'npm run check:release-readiness:artifact-audit', bounded: true },
    { id: 'clean-host', command: 'npm run check:release-readiness:clean-host', bounded: true },
    { id: 'aggregate', command: 'npm run check:release-readiness', bounded: true },
  ],
  wideningPolicy: 'Focused release checks compose existing gates; full suites remain closure-only.',
}

const objectSchema = (title, requiredProperties) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title,
  type: 'object',
  additionalProperties: true,
  required: requiredProperties,
  properties: {
    schemaVersion: { const: 1 },
    status: { type: 'string' },
  },
})

const artifacts = new Map([
  ['data/release-readiness/release-gate-rubric.v1.json', rubric],
  ['data/release-readiness/version-surface-inventory.v1.json', versionSurfaces],
  ['data/release-readiness/supported-platform-matrix.v1.json', platformMatrix],
  ['data/release-readiness/supported-upgrade-inputs.v1.json', upgradeInputs],
  ['data/release-readiness/distribution-inventory.v1.json', distributionInventory],
  ['data/release-readiness/licensing-attribution-inventory.v1.json', licensingInventory],
  ['data/release-readiness/known-limitations.v1.json', knownLimitations],
  ['data/release-readiness/evidence-command-index.v1.json', evidenceCommands],
  ['data/release-readiness/schemas/certification.schema.v1.json', objectSchema('Rotom Table release certification', ['schemaVersion', 'certificationId', 'status', 'gateRows', 'evidence'])],
  ['data/release-readiness/schemas/rehearsal.schema.v1.json', objectSchema('Rotom Table release rehearsal', ['schemaVersion', 'rehearsalId', 'status', 'identity', 'evidence'])],
  ['data/release-readiness/schemas/dossier.schema.v1.json', objectSchema('Rotom Table 1.0 acceptance dossier', ['schemaVersion', 'dossierId', 'status', 'certifications', 'dispositions'])],
  ['data/release-readiness/schemas/final-acceptance.schema.v1.json', objectSchema('Rotom Table 1.0 final acceptance', ['schemaVersion', 'acceptanceId', 'status', 'version', 'productPhase', 'tag'])],
])

const rendered = new Map([...artifacts].map(([path, value]) => [path, json(value)]))
const phaseAcceptance = {
  artifact: 'release-readiness-phase-1-acceptance',
  schemaVersion: 1,
  ticket: 'P13-010',
  status: 'Certified',
  baseline: { path: relativePath(BASELINE_PATH), sha256: BASELINE_SHA256, rows: 20 },
  rubric: { families: rubric.families.length, rows: rubric.rows.length, unregisteredFamilies: 0 },
  artifacts: [...rendered].map(([path, bytes]) => ({ path, sha256: sha256(bytes) })),
  command: 'npm run check:release-readiness:phase1',
  assertions: {
    baselineFrozen: true,
    allArtifactsHashBound: true,
    allGateFamiliesRegistered: true,
    ownerDispositionsRemainUnresolvedUntilPhase6: true,
    proseOnlyClosureForbidden: true,
  },
}
rendered.set('data/release-readiness/phase-1-acceptance.v1.json', json(phaseAcceptance))

const mode = process.argv.includes('--write') ? 'write' : process.argv.includes('--check') ? 'check' : null
if (!mode) {
  process.stderr.write('Usage: node scripts/release-readiness/generate-phase-1.mjs --write|--check\n')
  process.exitCode = 2
} else {
  try {
    validateFrozenBaseline()
    for (const [path, expected] of rendered) {
      const absolute = resolve(ROOT, path)
      if (mode === 'write') {
        mkdirSync(dirname(absolute), { recursive: true })
        writeFileSync(absolute, expected)
      } else {
        assert(existsSync(absolute), `Missing generated release artifact: ${path}`)
        assert(readFileSync(absolute, 'utf8') === expected, `Release artifact drift: ${path}`)
      }
    }
    process.stdout.write(`Release readiness Phase 1 ${mode === 'write' ? 'artifacts generated' : 'drift check passed'} (${rendered.size} generated artifacts; frozen baseline ${BASELINE_SHA256}).\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
