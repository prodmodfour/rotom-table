import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'
import type { SheetKind } from '../sheets'

export const ITEM_MEDICAL_TREATMENT_SCHEMA_VERSION = 1 as const
export const ITEM_MEDICAL_TREATMENT_DURATION_MINUTES = 360 as const
export const ITEM_MEDICAL_TREATMENT_TICK_MINUTES = 30 as const
export const ITEM_MEDICAL_TREATMENT_MAX_ENTRIES = 64 as const

export type ItemMedicalTreatmentStatus = 'active' | 'completed' | 'cancelled'
export type ItemMedicalTreatmentTerminalReason = 'full-duration' | 'hp-loss'

export interface ItemMedicalTreatmentV1 {
  readonly schemaVersion: typeof ITEM_MEDICAL_TREATMENT_SCHEMA_VERSION
  readonly treatmentId: string
  readonly revision: number
  readonly canonicalItemId: 'Bandages' | 'Poultices'
  readonly canonicalDefinitionSha256: string
  readonly sourceOperationId: string
  readonly target: { readonly kind: SheetKind, readonly slug: string }
  readonly status: ItemMedicalTreatmentStatus
  readonly appliedAtCampaignMinute: number
  readonly nextTickCampaignMinute: number
  readonly endsAtCampaignMinute: number
  readonly healedThroughCampaignMinute: number
  readonly ticksApplied: number
  readonly hitPointsRestored: number
  readonly injuryRemoved: boolean
  readonly terminalReason: ItemMedicalTreatmentTerminalReason | null
  readonly terminalCampaignMinute: number | null
}

export interface ItemMedicalTreatmentStateV1 {
  readonly schemaVersion: typeof ITEM_MEDICAL_TREATMENT_SCHEMA_VERSION
  readonly entries: readonly ItemMedicalTreatmentV1[]
}

export interface ItemMedicalTreatmentProjectionV1 {
  readonly schemaVersion: typeof ITEM_MEDICAL_TREATMENT_SCHEMA_VERSION
  readonly treatmentId: string
  readonly revision: number
  readonly itemLabel: string
  readonly status: ItemMedicalTreatmentStatus
  readonly appliedAtCampaignMinute: number
  readonly nextTickCampaignMinute: number | null
  readonly endsAtCampaignMinute: number
  readonly elapsedMinutes: number
  readonly remainingMinutes: number
  readonly ticksApplied: number
  readonly hitPointsRestored: number
  readonly injuryRemoved: boolean
  readonly terminalMessage: string | null
}

export class ItemMedicalTreatmentValidationError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'ItemMedicalTreatmentValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const ID = /^item-treatment:v1:[a-f0-9]{32}$/
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,199}$/
const SHA256 = /^[a-f0-9]{64}$/
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CONTROL = /[\u0000-\u001f\u007f]/u

const fail = (path: string, detail: string): never => { throw new ItemMedicalTreatmentValidationError(path, detail) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail(path, 'must be a plain object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.hasOwn(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length || unknown.length) fail(path, `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`)
}
const text = (value: unknown, path: string, maximum = 200): string => {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()
    || value.length > maximum || CONTROL.test(value)) fail(path, 'must be bounded non-empty trimmed text.')
  return value as string
}
const integer = (value: unknown, path: string, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    fail(path, `must be a safe integer from 0 through ${maximum}.`)
  }
  return Number(value)
}
const boolean = (value: unknown, path: string): boolean => {
  if (typeof value !== 'boolean') fail(path, 'must be boolean.')
  return value as boolean
}

export const emptyItemMedicalTreatmentState = (): ItemMedicalTreatmentStateV1 => deepFreezeStrictJson({
  schemaVersion: ITEM_MEDICAL_TREATMENT_SCHEMA_VERSION,
  entries: [],
})

export const parseItemMedicalTreatmentState = (value: unknown): ItemMedicalTreatmentStateV1 => {
  if (value == null) return emptyItemMedicalTreatmentState()
  const root = record(cloneStrictJson(value, 'itemMedicalTreatments', {
    limits: { depth: 8, nodes: 4_096, objectFields: 24, arrayEntries: ITEM_MEDICAL_TREATMENT_MAX_ENTRIES, stringLength: 500, objectKeyLength: 100 },
    rootLabel: 'medical treatment data', valueLabel: 'medical treatment state',
    failNotJson: (path, detail) => fail(path, detail),
    failLimit: (path, detail) => fail(path, detail),
  }), 'itemMedicalTreatments')
  exact(root, ['schemaVersion', 'entries'], 'itemMedicalTreatments')
  if (root.schemaVersion !== ITEM_MEDICAL_TREATMENT_SCHEMA_VERSION) fail('itemMedicalTreatments.schemaVersion', 'must be 1.')
  if (!Array.isArray(root.entries) || root.entries.length > ITEM_MEDICAL_TREATMENT_MAX_ENTRIES) {
    fail('itemMedicalTreatments.entries', `must contain at most ${ITEM_MEDICAL_TREATMENT_MAX_ENTRIES} entries.`)
  }
  const entries = (root.entries as unknown[]).map((candidate, index): ItemMedicalTreatmentV1 => {
    const path = `itemMedicalTreatments.entries[${index}]`
    const row = record(candidate, path)
    exact(row, [
      'schemaVersion', 'treatmentId', 'revision', 'canonicalItemId', 'canonicalDefinitionSha256',
      'sourceOperationId', 'target', 'status', 'appliedAtCampaignMinute', 'nextTickCampaignMinute',
      'endsAtCampaignMinute', 'healedThroughCampaignMinute', 'ticksApplied', 'hitPointsRestored',
      'injuryRemoved', 'terminalReason', 'terminalCampaignMinute',
    ], path)
    if (row.schemaVersion !== ITEM_MEDICAL_TREATMENT_SCHEMA_VERSION) fail(`${path}.schemaVersion`, 'must be 1.')
    const treatmentId = text(row.treatmentId, `${path}.treatmentId`)
    if (!ID.test(treatmentId)) fail(`${path}.treatmentId`, 'must be an item-treatment:v1 identity.')
    if (row.canonicalItemId !== 'Bandages' && row.canonicalItemId !== 'Poultices') {
      fail(`${path}.canonicalItemId`, 'must be Bandages or Poultices.')
    }
    const definitionHash = text(row.canonicalDefinitionSha256, `${path}.canonicalDefinitionSha256`, 64)
    if (!SHA256.test(definitionHash)) fail(`${path}.canonicalDefinitionSha256`, 'must be a lowercase SHA-256 digest.')
    const sourceOperationId = text(row.sourceOperationId, `${path}.sourceOperationId`)
    if (!OPERATION_ID.test(sourceOperationId)) fail(`${path}.sourceOperationId`, 'must be a valid item operation identity.')
    const target = record(row.target, `${path}.target`)
    exact(target, ['kind', 'slug'], `${path}.target`)
    if (target.kind !== 'pokemon' && target.kind !== 'trainer') fail(`${path}.target.kind`, 'must be pokemon or trainer.')
    const slug = text(target.slug, `${path}.target.slug`, 120)
    if (!SLUG.test(slug)) fail(`${path}.target.slug`, 'must be a stable sheet slug.')
    if (row.status !== 'active' && row.status !== 'completed' && row.status !== 'cancelled') fail(`${path}.status`, 'is unsupported.')
    const status = row.status as ItemMedicalTreatmentStatus
    const applied = integer(row.appliedAtCampaignMinute, `${path}.appliedAtCampaignMinute`)
    const nextTick = integer(row.nextTickCampaignMinute, `${path}.nextTickCampaignMinute`)
    const ends = integer(row.endsAtCampaignMinute, `${path}.endsAtCampaignMinute`)
    const through = integer(row.healedThroughCampaignMinute, `${path}.healedThroughCampaignMinute`)
    const ticks = integer(row.ticksApplied, `${path}.ticksApplied`, 12)
    const restored = integer(row.hitPointsRestored, `${path}.hitPointsRestored`)
    const terminalMinute = row.terminalCampaignMinute === null
      ? null
      : integer(row.terminalCampaignMinute, `${path}.terminalCampaignMinute`)
    const terminalReason = row.terminalReason
    if (terminalReason !== null && terminalReason !== 'full-duration' && terminalReason !== 'hp-loss') {
      fail(`${path}.terminalReason`, 'is unsupported.')
    }
    if (ends !== applied + ITEM_MEDICAL_TREATMENT_DURATION_MINUTES
      || nextTick !== applied + ITEM_MEDICAL_TREATMENT_TICK_MINUTES * (ticks + 1)
      || through !== applied + ITEM_MEDICAL_TREATMENT_TICK_MINUTES * ticks
      || through > ends || nextTick > ends + ITEM_MEDICAL_TREATMENT_TICK_MINUTES) {
      fail(path, 'campaign-minute and tick evidence is inconsistent.')
    }
    if ((status === 'active') !== (terminalReason === null && terminalMinute === null)
      || (status === 'completed' && (terminalReason !== 'full-duration' || terminalMinute !== ends || ticks !== 12))
      || (status === 'cancelled' && (terminalReason !== 'hp-loss' || terminalMinute === null || terminalMinute < applied || terminalMinute > ends))
      || (row.injuryRemoved === true && status !== 'completed')) {
      fail(path, 'terminal evidence is inconsistent with status.')
    }
    return {
      schemaVersion: ITEM_MEDICAL_TREATMENT_SCHEMA_VERSION,
      treatmentId,
      revision: integer(row.revision, `${path}.revision`),
      canonicalItemId: row.canonicalItemId as 'Bandages' | 'Poultices',
      canonicalDefinitionSha256: definitionHash,
      sourceOperationId,
      target: { kind: target.kind as SheetKind, slug },
      status,
      appliedAtCampaignMinute: applied,
      nextTickCampaignMinute: nextTick,
      endsAtCampaignMinute: ends,
      healedThroughCampaignMinute: through,
      ticksApplied: ticks,
      hitPointsRestored: restored,
      injuryRemoved: boolean(row.injuryRemoved, `${path}.injuryRemoved`),
      terminalReason: terminalReason as ItemMedicalTreatmentTerminalReason | null,
      terminalCampaignMinute: terminalMinute,
    }
  })
  if (new Set(entries.map(entry => entry.treatmentId)).size !== entries.length) {
    fail('itemMedicalTreatments.entries', 'contains duplicate treatment identities.')
  }
  if (entries.filter(entry => entry.status === 'active').length > 1) {
    fail('itemMedicalTreatments.entries', 'may contain only one active treatment.')
  }
  return deepFreezeStrictJson({ schemaVersion: ITEM_MEDICAL_TREATMENT_SCHEMA_VERSION, entries })
}

export const activeItemMedicalTreatment = (value: unknown): ItemMedicalTreatmentV1 | null => (
  parseItemMedicalTreatmentState(value).entries.find(entry => entry.status === 'active') ?? null
)

export const parseItemMedicalTreatmentProjection = (value: unknown): ItemMedicalTreatmentProjectionV1 => {
  const row = record(cloneStrictJson(value, 'itemMedicalTreatmentProjection', {
    limits: { depth: 5, nodes: 256, objectFields: 24, arrayEntries: 16, stringLength: 500, objectKeyLength: 100 },
    rootLabel: 'medical treatment projection', valueLabel: 'medical treatment projection',
    failNotJson: (path, detail) => fail(path, detail), failLimit: (path, detail) => fail(path, detail),
  }), 'itemMedicalTreatmentProjection')
  exact(row, [
    'schemaVersion', 'treatmentId', 'revision', 'itemLabel', 'status', 'appliedAtCampaignMinute',
    'nextTickCampaignMinute', 'endsAtCampaignMinute', 'elapsedMinutes', 'remainingMinutes',
    'ticksApplied', 'hitPointsRestored', 'injuryRemoved', 'terminalMessage',
  ], 'itemMedicalTreatmentProjection')
  if (row.schemaVersion !== 1) fail('itemMedicalTreatmentProjection.schemaVersion', 'must be 1.')
  const treatmentId = text(row.treatmentId, 'itemMedicalTreatmentProjection.treatmentId')
  if (!ID.test(treatmentId)) fail('itemMedicalTreatmentProjection.treatmentId', 'must be an item-treatment:v1 identity.')
  if (row.status !== 'active' && row.status !== 'completed' && row.status !== 'cancelled') fail('itemMedicalTreatmentProjection.status', 'is unsupported.')
  const status = row.status as ItemMedicalTreatmentStatus
  const appliedAtCampaignMinute = integer(row.appliedAtCampaignMinute, 'itemMedicalTreatmentProjection.appliedAtCampaignMinute')
  const endsAtCampaignMinute = integer(row.endsAtCampaignMinute, 'itemMedicalTreatmentProjection.endsAtCampaignMinute')
  const elapsedMinutes = integer(row.elapsedMinutes, 'itemMedicalTreatmentProjection.elapsedMinutes')
  const remainingMinutes = integer(row.remainingMinutes, 'itemMedicalTreatmentProjection.remainingMinutes')
  const nextTickCampaignMinute = row.nextTickCampaignMinute === null
    ? null
    : integer(row.nextTickCampaignMinute, 'itemMedicalTreatmentProjection.nextTickCampaignMinute')
  const terminalMessage = row.terminalMessage === null
    ? null
    : text(row.terminalMessage, 'itemMedicalTreatmentProjection.terminalMessage', 500)
  const duration = endsAtCampaignMinute - appliedAtCampaignMinute
  if (duration !== ITEM_MEDICAL_TREATMENT_DURATION_MINUTES
    || elapsedMinutes > duration || remainingMinutes > duration
    || (status === 'active' && (nextTickCampaignMinute === null || terminalMessage !== null
      || elapsedMinutes + remainingMinutes !== duration))
    || (status !== 'active' && (nextTickCampaignMinute !== null || terminalMessage === null || remainingMinutes !== 0))) {
    fail('itemMedicalTreatmentProjection', 'has inconsistent timing or terminal evidence.')
  }
  return deepFreezeStrictJson({
    schemaVersion: ITEM_MEDICAL_TREATMENT_SCHEMA_VERSION,
    treatmentId,
    revision: integer(row.revision, 'itemMedicalTreatmentProjection.revision'),
    itemLabel: text(row.itemLabel, 'itemMedicalTreatmentProjection.itemLabel'),
    status,
    appliedAtCampaignMinute,
    nextTickCampaignMinute,
    endsAtCampaignMinute,
    elapsedMinutes,
    remainingMinutes,
    ticksApplied: integer(row.ticksApplied, 'itemMedicalTreatmentProjection.ticksApplied', 12),
    hitPointsRestored: integer(row.hitPointsRestored, 'itemMedicalTreatmentProjection.hitPointsRestored'),
    injuryRemoved: boolean(row.injuryRemoved, 'itemMedicalTreatmentProjection.injuryRemoved'),
    terminalMessage,
  })
}
