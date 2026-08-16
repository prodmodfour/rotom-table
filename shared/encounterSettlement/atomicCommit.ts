export const ENCOUNTER_SETTLEMENT_COMMIT_COMMAND_SCHEMA_VERSION = 1 as const
export const ENCOUNTER_SETTLEMENT_COMMIT_RESULT_SCHEMA_VERSION = 1 as const

export interface EncounterSettlementCommitCommand {
  readonly schemaVersion: typeof ENCOUNTER_SETTLEMENT_COMMIT_COMMAND_SCHEMA_VERSION
  readonly operationId: string
  readonly settlementId: string
  readonly expectedSettlementRevision: number
  readonly planDefinitionSha256: string
  readonly confirmed: true
}

export interface EncounterSettlementCommittedSheetRevision {
  readonly kind: 'pokemon' | 'trainer'
  readonly slug: string
  readonly revision: number
}

export interface EncounterSettlementCommittedGroupRevision {
  readonly slug: string
  readonly revision: number
}

export interface EncounterSettlementCommitResult {
  readonly schemaVersion: typeof ENCOUNTER_SETTLEMENT_COMMIT_RESULT_SCHEMA_VERSION
  readonly operationId: string
  readonly settlementId: string
  readonly settlementRevision: number
  readonly encounterId: string
  readonly encounterRevision: number
  readonly mapSlug: string
  readonly mapRevision: number | null
  readonly sheetRevisions: readonly EncounterSettlementCommittedSheetRevision[]
  readonly groupRevisions: readonly EncounterSettlementCommittedGroupRevision[]
  readonly historyFactIds: readonly string[]
  readonly attentionSourceIds: readonly string[]
  readonly completedAtCampaignMinute: number
}

export class EncounterSettlementCommitCommandParseError extends Error {
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'EncounterSettlementCommitCommandParseError'
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/
const HASH = /^[a-f0-9]{64}$/
const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)
const fail = (path: string, message: string): never => {
  throw new EncounterSettlementCommitCommandParseError(path, message)
}
const exactKeys = (value: Record<string, unknown>, keys: readonly string[], path: string): void => {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(path, `must contain exactly ${expected.join(', ')}.`)
  }
}
const id = (value: unknown, path: string): string => (
  typeof value === 'string' && ID.test(value)
    ? value
    : fail(path, 'must be one stable bounded identity.')
)
const revision = (value: unknown, path: string): number => (
  Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : fail(path, 'must be a safe non-negative integer.')
)

export const parseEncounterSettlementCommitCommand = (value: unknown): EncounterSettlementCommitCommand => {
  const object = isObject(value) ? value : fail('command', 'must be an object.')
  exactKeys(object, [
    'schemaVersion', 'operationId', 'settlementId', 'expectedSettlementRevision',
    'planDefinitionSha256', 'confirmed',
  ], 'command')
  if (object.schemaVersion !== ENCOUNTER_SETTLEMENT_COMMIT_COMMAND_SCHEMA_VERSION) {
    fail('command.schemaVersion', `must equal ${ENCOUNTER_SETTLEMENT_COMMIT_COMMAND_SCHEMA_VERSION}.`)
  }
  const planDefinitionSha256 = typeof object.planDefinitionSha256 === 'string'
    && HASH.test(object.planDefinitionSha256)
    ? object.planDefinitionSha256
    : fail('command.planDefinitionSha256', 'must be one lowercase SHA-256 digest.')
  if (object.confirmed !== true) fail('command.confirmed', 'must be true at the explicit commit boundary.')
  return Object.freeze({
    schemaVersion: ENCOUNTER_SETTLEMENT_COMMIT_COMMAND_SCHEMA_VERSION,
    operationId: id(object.operationId, 'command.operationId'),
    settlementId: id(object.settlementId, 'command.settlementId'),
    expectedSettlementRevision: revision(object.expectedSettlementRevision, 'command.expectedSettlementRevision'),
    planDefinitionSha256,
    confirmed: true,
  })
}

export const parseEncounterSettlementCommitResult = (value: unknown): EncounterSettlementCommitResult => {
  const object = isObject(value) ? value : fail('result', 'must be an object.')
  exactKeys(object, [
    'schemaVersion', 'operationId', 'settlementId', 'settlementRevision', 'encounterId',
    'encounterRevision', 'mapSlug', 'mapRevision', 'sheetRevisions', 'groupRevisions',
    'historyFactIds', 'attentionSourceIds', 'completedAtCampaignMinute',
  ], 'result')
  if (object.schemaVersion !== ENCOUNTER_SETTLEMENT_COMMIT_RESULT_SCHEMA_VERSION) {
    fail('result.schemaVersion', `must equal ${ENCOUNTER_SETTLEMENT_COMMIT_RESULT_SCHEMA_VERSION}.`)
  }
  const sheetRows = Array.isArray(object.sheetRevisions)
    ? object.sheetRevisions
    : fail('result.sheetRevisions', 'must be an array.')
  const groupRows = Array.isArray(object.groupRevisions)
    ? object.groupRevisions
    : fail('result.groupRevisions', 'must be an array.')
  const historyRows = Array.isArray(object.historyFactIds)
    ? object.historyFactIds
    : fail('result.historyFactIds', 'must be an array.')
  const attentionRows = Array.isArray(object.attentionSourceIds)
    ? object.attentionSourceIds
    : fail('result.attentionSourceIds', 'must be an array.')
  if (sheetRows.length > 10_000 || groupRows.length > 10_000
    || historyRows.length > 16_384 || attentionRows.length > 4_096) {
    fail('result', 'exceeds the accepted settlement-result bounds.')
  }
  const sheetRevisions = sheetRows.map((row, index) => {
    const entry = isObject(row)
      ? row
      : fail(`result.sheetRevisions[${index}]`, 'must be an object.')
    exactKeys(entry, ['kind', 'slug', 'revision'], `result.sheetRevisions[${index}]`)
    const kind = entry.kind === 'pokemon' || entry.kind === 'trainer'
      ? entry.kind
      : fail(`result.sheetRevisions[${index}].kind`, 'must be pokemon or trainer.')
    return Object.freeze({
      kind,
      slug: id(entry.slug, `result.sheetRevisions[${index}].slug`),
      revision: revision(entry.revision, `result.sheetRevisions[${index}].revision`),
    })
  })
  const groupRevisions = groupRows.map((row, index) => {
    const entry = isObject(row)
      ? row
      : fail(`result.groupRevisions[${index}]`, 'must be an object.')
    exactKeys(entry, ['slug', 'revision'], `result.groupRevisions[${index}]`)
    return Object.freeze({
      slug: id(entry.slug, `result.groupRevisions[${index}].slug`),
      revision: revision(entry.revision, `result.groupRevisions[${index}].revision`),
    })
  })
  const identityArray = (rows: readonly unknown[], path: string): readonly string[] => {
    const ids = rows.map((row, index) => id(row, `${path}[${index}]`))
    if (new Set(ids).size !== ids.length) fail(path, 'must contain unique identities.')
    return Object.freeze(ids)
  }
  const mapRevision = object.mapRevision === null
    ? null
    : revision(object.mapRevision, 'result.mapRevision')
  return Object.freeze({
    schemaVersion: ENCOUNTER_SETTLEMENT_COMMIT_RESULT_SCHEMA_VERSION,
    operationId: id(object.operationId, 'result.operationId'),
    settlementId: id(object.settlementId, 'result.settlementId'),
    settlementRevision: revision(object.settlementRevision, 'result.settlementRevision'),
    encounterId: id(object.encounterId, 'result.encounterId'),
    encounterRevision: revision(object.encounterRevision, 'result.encounterRevision'),
    mapSlug: id(object.mapSlug, 'result.mapSlug'),
    mapRevision,
    sheetRevisions: Object.freeze(sheetRevisions),
    groupRevisions: Object.freeze(groupRevisions),
    historyFactIds: identityArray(historyRows, 'result.historyFactIds'),
    attentionSourceIds: identityArray(attentionRows, 'result.attentionSourceIds'),
    completedAtCampaignMinute: revision(object.completedAtCampaignMinute, 'result.completedAtCampaignMinute'),
  })
}
