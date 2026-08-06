import { cloneStrictJson, deepFreezeStrictJson, type StrictJsonObject } from './automation/strictJson'
import { parseBreedingOperationIdSyntax, type BreedingOperationId } from './breeding/ids'

export const CAMPAIGN_CLOCK_SCHEMA_VERSION = 1 as const
export interface CampaignClockV1 {
  readonly schemaVersion: 1
  readonly revision: number
  readonly campaignMinute: number
  readonly lastOperationId: BreedingOperationId | null
}
export class CampaignClockContractError extends Error {
  readonly code: 'campaign-clock.invalid-document' | 'campaign-clock.invalid-invariant'
  readonly field: string
  constructor(code: CampaignClockContractError['code'], field: string, message: string) { super(`Campaign clock ${field}: ${message}`); this.name = 'CampaignClockContractError'; this.code = code; this.field = field }
}
const fail = (code: CampaignClockContractError['code'], field: string, message: string): never => { throw new CampaignClockContractError(code, field, message) }
const exact = (value: unknown, fields: readonly string[], path: string): StrictJsonObject => {
  const cloned = cloneStrictJson(value, path, {
    limits: { depth: 2, nodes: 8, objectFields: 4, arrayEntries: 0, stringLength: 96, objectKeyLength: 48 },
    rootLabel: path, valueLabel: 'campaign clock',
    failNotJson: (field, detail) => fail('campaign-clock.invalid-document', field, detail),
    failLimit: (field, detail) => fail('campaign-clock.invalid-document', field, detail),
  })
  if (!cloned || typeof cloned !== 'object' || Array.isArray(cloned)) fail('campaign-clock.invalid-document', path, 'must be a plain object.')
  const row = cloned as StrictJsonObject; const actual = Object.keys(row).sort(); const expected = [...fields].sort()
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) fail('campaign-clock.invalid-document', path, `must contain exactly: ${fields.join(', ')}.`)
  return row
}
const integer = (value: unknown, field: string): number => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fail('campaign-clock.invalid-document', field, 'must be a safe nonnegative integer.')
export const parseCampaignClockV1 = (value: unknown, path = 'campaignClock'): CampaignClockV1 => {
  const row = exact(value, ['schemaVersion', 'revision', 'campaignMinute', 'lastOperationId'], path)
  if (row.schemaVersion !== 1) fail('campaign-clock.invalid-document', `${path}.schemaVersion`, 'must equal 1.')
  const revision = integer(row.revision, `${path}.revision`)
  const lastOperationId = row.lastOperationId === null ? null : parseBreedingOperationIdSyntax(row.lastOperationId) ?? fail('campaign-clock.invalid-document', `${path}.lastOperationId`, 'must be an operation ID or null.')
  if ((revision === 0) !== (lastOperationId === null)) fail('campaign-clock.invalid-invariant', path, 'revision 0 alone must have no last operation.')
  return deepFreezeStrictJson({ schemaVersion: 1, revision, campaignMinute: integer(row.campaignMinute, `${path}.campaignMinute`), lastOperationId })
}
export const createCampaignClockSuccessorV1 = (input: {
  readonly current: unknown
  readonly targetCampaignMinute: number
  readonly operationId: unknown
}): CampaignClockV1 => {
  const current = parseCampaignClockV1(input.current, 'currentClock')
  const target = integer(input.targetCampaignMinute, 'targetCampaignMinute')
  const operationId = parseBreedingOperationIdSyntax(input.operationId) ?? fail('campaign-clock.invalid-document', 'operationId', 'must be an operation ID.')
  if (target <= current.campaignMinute) fail('campaign-clock.invalid-invariant', 'targetCampaignMinute', 'must be strictly later than the current campaign minute for a revision successor.')
  if (current.revision === Number.MAX_SAFE_INTEGER) fail('campaign-clock.invalid-invariant', 'currentClock.revision', 'cannot advance beyond the safe revision range.')
  return deepFreezeStrictJson({ schemaVersion: 1, revision: current.revision + 1, campaignMinute: target, lastOperationId: operationId })
}
