export const ENCOUNTER_SETTLEMENT_CORRECTION_COMMAND_SCHEMA_VERSION = 1 as const
export const ENCOUNTER_SETTLEMENT_CORRECTION_RESULT_SCHEMA_VERSION = 1 as const

export interface EncounterSettlementCorrectionCommand {
  readonly schemaVersion: typeof ENCOUNTER_SETTLEMENT_CORRECTION_COMMAND_SCHEMA_VERSION
  readonly operationId: string
  readonly settlementId: string
  readonly expectedSettlementRevision: number
  readonly offerDefinitionSha256: string
  readonly confirmed: true
}

export interface EncounterSettlementCorrectionResult {
  readonly schemaVersion: typeof ENCOUNTER_SETTLEMENT_CORRECTION_RESULT_SCHEMA_VERSION
  readonly operationId: string
  readonly settlementId: string
  readonly settlementRevision: number
  readonly reasonCode: string
  readonly correctedAtCampaignMinute: number
}

export class EncounterSettlementCorrectionParseError extends Error {
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'EncounterSettlementCorrectionParseError'
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/
const HASH = /^[a-f0-9]{64}$/
const REASON = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const fail = (path: string, message: string): never => {
  throw new EncounterSettlementCorrectionParseError(path, message)
}
const object = (value: unknown, path: string): Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : fail(path, 'must be an object.')
)
const exact = (row: Record<string, unknown>, fields: readonly string[], path: string): void => {
  const actual = Object.keys(row).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    fail(path, `must contain exactly ${expected.join(', ')}.`)
  }
}
const id = (value: unknown, path: string): string => (
  typeof value === 'string' && ID.test(value) ? value : fail(path, 'must be one stable bounded identity.')
)
const revision = (value: unknown, path: string): number => (
  Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : fail(path, 'must be a safe non-negative integer.')
)
const hash = (value: unknown, path: string): string => (
  typeof value === 'string' && HASH.test(value)
    ? value
    : fail(path, 'must be one lowercase SHA-256 digest.')
)

export const parseEncounterSettlementCorrectionCommand = (
  value: unknown,
): EncounterSettlementCorrectionCommand => {
  const row = object(value, 'command')
  exact(row, [
    'schemaVersion', 'operationId', 'settlementId', 'expectedSettlementRevision',
    'offerDefinitionSha256', 'confirmed',
  ], 'command')
  if (row.schemaVersion !== 1) fail('command.schemaVersion', 'must equal 1.')
  if (row.confirmed !== true) fail('command.confirmed', 'must be true at the explicit correction boundary.')
  return Object.freeze({
    schemaVersion: 1,
    operationId: id(row.operationId, 'command.operationId'),
    settlementId: id(row.settlementId, 'command.settlementId'),
    expectedSettlementRevision: revision(row.expectedSettlementRevision, 'command.expectedSettlementRevision'),
    offerDefinitionSha256: hash(row.offerDefinitionSha256, 'command.offerDefinitionSha256'),
    confirmed: true,
  })
}

export const parseEncounterSettlementCorrectionResult = (
  value: unknown,
): EncounterSettlementCorrectionResult => {
  const row = object(value, 'result')
  exact(row, [
    'schemaVersion', 'operationId', 'settlementId', 'settlementRevision',
    'reasonCode', 'correctedAtCampaignMinute',
  ], 'result')
  if (row.schemaVersion !== 1) fail('result.schemaVersion', 'must equal 1.')
  const reasonCode = typeof row.reasonCode === 'string' && REASON.test(row.reasonCode)
    && row.reasonCode.length <= 100
    ? row.reasonCode
    : fail('result.reasonCode', 'must be one closed bounded reason code.')
  return Object.freeze({
    schemaVersion: 1,
    operationId: id(row.operationId, 'result.operationId'),
    settlementId: id(row.settlementId, 'result.settlementId'),
    settlementRevision: revision(row.settlementRevision, 'result.settlementRevision'),
    reasonCode,
    correctedAtCampaignMinute: revision(row.correctedAtCampaignMinute, 'result.correctedAtCampaignMinute'),
  })
}
