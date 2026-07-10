import type { LegacyMoveAutomationAudit } from './move_automation_legacy_audit'

export const LEGACY_MOVE_AUTOMATION_FINGERPRINT_SCHEMA_VERSION = 1 as const

export interface LegacyMoveAutomationFingerprintEntry {
  readonly canonicalId: string
  readonly sourceModule: string
  readonly version: number
  readonly definitionHash: string
}

export interface LegacyMoveAutomationFingerprintIndex {
  readonly schemaVersion: typeof LEGACY_MOVE_AUTOMATION_FINGERPRINT_SCHEMA_VERSION
  readonly runtimeKind: 'legacy-v1'
  readonly entries: readonly LegacyMoveAutomationFingerprintEntry[]
}

type UnknownRecord = Record<string, unknown>

type MutableManifestRow = UnknownRecord & {
  canonicalId: string
  runtime: UnknownRecord & { kind: string }
}

type MutableManifest = UnknownRecord & {
  moves: MutableManifestRow[]
}

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const cloneManifest = (value: unknown): MutableManifest => {
  if (!isRecord(value) || !Array.isArray(value.moves)) {
    throw new Error('Move automation manifest must contain a moves array.')
  }
  const manifest = structuredClone(value) as MutableManifest
  const canonicalIds = new Set<string>()
  manifest.moves.forEach((row, index) => {
    if (!isRecord(row) || typeof row.canonicalId !== 'string' || !isRecord(row.runtime)) {
      throw new Error(`Move automation manifest row ${index} has an invalid runtime reference.`)
    }
    if (canonicalIds.has(row.canonicalId)) {
      throw new Error(`Move automation manifest contains duplicate row ${JSON.stringify(row.canonicalId)}.`)
    }
    canonicalIds.add(row.canonicalId)
    if (typeof row.runtime.kind !== 'string') {
      throw new Error(`Move automation manifest row ${JSON.stringify(row.canonicalId)} has no runtime kind.`)
    }
  })
  return manifest
}

export const buildLegacyMoveAutomationFingerprintIndex = (
  audit: LegacyMoveAutomationAudit,
): LegacyMoveAutomationFingerprintIndex => ({
  schemaVersion: LEGACY_MOVE_AUTOMATION_FINGERPRINT_SCHEMA_VERSION,
  runtimeKind: 'legacy-v1',
  entries: audit.entries.map(entry => ({
    canonicalId: entry.canonicalId,
    sourceModule: entry.sourceModule,
    version: entry.v1Version,
    definitionHash: entry.definitionHash,
  })),
})

const runtimeReference = (entry: LegacyMoveAutomationFingerprintEntry) => ({
  kind: 'legacy-v1' as const,
  version: entry.version,
  definitionHash: entry.definitionHash,
  sourceModule: entry.sourceModule,
})

const fingerprintByCanonicalId = (
  index: LegacyMoveAutomationFingerprintIndex,
): ReadonlyMap<string, LegacyMoveAutomationFingerprintEntry> => {
  const entries = new Map<string, LegacyMoveAutomationFingerprintEntry>()
  for (const entry of index.entries) {
    if (entries.has(entry.canonicalId)) {
      throw new Error(`Legacy fingerprint index contains duplicate entry ${JSON.stringify(entry.canonicalId)}.`)
    }
    entries.set(entry.canonicalId, entry)
  }
  return entries
}

/**
 * Link every manifest-selected v1 runtime to its evaluated definition. A later
 * movespec-v2 selection is preserved while the compatibility registry exists.
 */
export const linkLegacyMoveAutomationManifest = (
  value: unknown,
  index: LegacyMoveAutomationFingerprintIndex,
): MutableManifest => {
  const manifest = cloneManifest(value)
  const fingerprints = fingerprintByCanonicalId(index)
  const manifestRows = new Map(manifest.moves.map(row => [row.canonicalId, row]))

  for (const entry of index.entries) {
    const row = manifestRows.get(entry.canonicalId)
    if (!row) {
      throw new Error(`Legacy fingerprint ${JSON.stringify(entry.canonicalId)} has no manifest row.`)
    }
    if (row.runtime.kind === 'unimplemented') {
      throw new Error(`Registered legacy move ${JSON.stringify(entry.canonicalId)} cannot be unimplemented.`)
    }
    if (row.runtime.kind === 'legacy-v1') row.runtime = runtimeReference(entry)
  }

  for (const row of manifest.moves) {
    if (row.runtime.kind === 'legacy-v1' && !fingerprints.has(row.canonicalId)) {
      throw new Error(`Manifest legacy runtime ${JSON.stringify(row.canonicalId)} has no registry fingerprint.`)
    }
  }
  return manifest
}

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

export const assertLegacyMoveAutomationFingerprintIndexCurrent = (
  actual: unknown,
  expected: LegacyMoveAutomationFingerprintIndex,
): void => {
  if (!sameJson(actual, expected)) {
    throw new Error('Legacy v1 fingerprint index drifted from the evaluated runtime definitions; regenerate the links intentionally.')
  }
}

export const assertLegacyMoveAutomationManifestLinksCurrent = (
  actual: unknown,
  index: LegacyMoveAutomationFingerprintIndex,
): void => {
  const expected = linkLegacyMoveAutomationManifest(actual, index)
  const actualManifest = cloneManifest(actual)
  if (!sameJson(actualManifest, expected)) {
    throw new Error('Legacy v1 manifest source, version, or definition hash drifted; regenerate the links intentionally.')
  }
}
