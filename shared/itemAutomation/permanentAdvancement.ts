import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ITEM_PERMANENT_ADVANCEMENT_SCHEMA_VERSION = 1 as const
export const ITEM_PERMANENT_ADVANCEMENT_APPLICATION_KINDS = [
  'stat-vitamin',
  'heart-booster',
  'pp-up',
  'rare-candy',
  'stat-suppressant',
] as const
export type ItemPermanentAdvancementApplicationKind = typeof ITEM_PERMANENT_ADVANCEMENT_APPLICATION_KINDS[number]
export type ItemPermanentAdvancementStat = 'hp' | 'atk' | 'def' | 'satk' | 'sdef' | 'spd'

export interface ItemPermanentAdvancementApplicationV1 {
  readonly sourceOperationId: string
  readonly canonicalItemId: string
  readonly canonicalDefinitionSha256: string
  readonly kind: ItemPermanentAdvancementApplicationKind
  readonly stat: ItemPermanentAdvancementStat | null
  readonly moveName: string | null
  readonly moveListIndex: number | null
  readonly previousFrequency: string | null
  readonly resultingFrequency: string | null
  readonly previousLevel: number | null
  readonly resultingLevel: number | null
  readonly appliedAt: number
}

export interface ItemPermanentAdvancementStateV1 {
  readonly schemaVersion: typeof ITEM_PERMANENT_ADVANCEMENT_SCHEMA_VERSION
  readonly applications: readonly ItemPermanentAdvancementApplicationV1[]
}

export class ItemPermanentAdvancementValidationError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'ItemPermanentAdvancementValidationError'
  }
}

const APPLICATION_FIELDS = [
  'sourceOperationId', 'canonicalItemId', 'canonicalDefinitionSha256', 'kind', 'stat',
  'moveName', 'moveListIndex', 'previousFrequency', 'resultingFrequency',
  'previousLevel', 'resultingLevel', 'appliedAt',
] as const
const ROOT_FIELDS = ['schemaVersion', 'applications'] as const
const OPERATION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{7,199}$/
const SHA256 = /^[a-f0-9]{64}$/
const CONTROL = /[\u0000-\u001f\u007f]/
const KINDS = new Set<string>(ITEM_PERMANENT_ADVANCEMENT_APPLICATION_KINDS)
const STATS = new Set<string>(['hp', 'atk', 'def', 'satk', 'sdef', 'spd'])

const fail = (path: string, detail: string): never => {
  throw new ItemPermanentAdvancementValidationError(path, detail)
}
const record = (value: unknown, path: string): Record<string, unknown> => {
  if (!isPlainJsonObject(value)) fail(path, 'must be a plain object.')
  return value as Record<string, unknown>
}
const exact = (value: Record<string, unknown>, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  if (fields.some(field => !Object.hasOwn(value, field))
    || Object.keys(value).some(field => !expected.has(field))) fail(path, 'has an invalid shape.')
}
const text = (value: unknown, path: string, maximum = 500): string => {
  if (typeof value !== 'string' || !value || value.trim() !== value
    || value.length > maximum || CONTROL.test(value)) fail(path, 'must be bounded safe text.')
  return value as string
}
const nullableText = (value: unknown, path: string): string | null => value === null ? null : text(value, path)
const integer = (value: unknown, path: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    fail(path, `must be a safe integer from ${minimum} through ${maximum}.`)
  }
  return Number(value)
}
const nullableInteger = (value: unknown, path: string, minimum: number, maximum: number): number | null => (
  value === null ? null : integer(value, path, minimum, maximum)
)

const parseApplication = (value: unknown, index: number): ItemPermanentAdvancementApplicationV1 => {
  const path = `itemPermanentAdvancement.applications[${index}]`
  const input = record(value, path)
  exact(input, APPLICATION_FIELDS, path)
  const kind = text(input.kind, `${path}.kind`, 30)
  if (!KINDS.has(kind)) fail(`${path}.kind`, 'contains an unsupported application kind.')
  const stat = input.stat === null ? null : text(input.stat, `${path}.stat`, 10)
  if (stat !== null && !STATS.has(stat)) fail(`${path}.stat`, 'contains an unsupported Base Stat.')
  const application: ItemPermanentAdvancementApplicationV1 = {
    sourceOperationId: text(input.sourceOperationId, `${path}.sourceOperationId`, 200),
    canonicalItemId: text(input.canonicalItemId, `${path}.canonicalItemId`, 200),
    canonicalDefinitionSha256: text(input.canonicalDefinitionSha256, `${path}.canonicalDefinitionSha256`, 64),
    kind: kind as ItemPermanentAdvancementApplicationKind,
    stat: stat as ItemPermanentAdvancementStat | null,
    moveName: nullableText(input.moveName, `${path}.moveName`),
    moveListIndex: nullableInteger(input.moveListIndex, `${path}.moveListIndex`, 0, 255),
    previousFrequency: nullableText(input.previousFrequency, `${path}.previousFrequency`),
    resultingFrequency: nullableText(input.resultingFrequency, `${path}.resultingFrequency`),
    previousLevel: nullableInteger(input.previousLevel, `${path}.previousLevel`, 1, 100),
    resultingLevel: nullableInteger(input.resultingLevel, `${path}.resultingLevel`, 1, 100),
    appliedAt: integer(input.appliedAt, `${path}.appliedAt`),
  }
  if (!OPERATION_ID.test(application.sourceOperationId)) fail(`${path}.sourceOperationId`, 'has an invalid operation identity.')
  if (!SHA256.test(application.canonicalDefinitionSha256)) fail(`${path}.canonicalDefinitionSha256`, 'must be a lowercase SHA-256 digest.')
  const statApplication = application.kind === 'stat-vitamin' || application.kind === 'stat-suppressant'
  const moveApplication = application.kind === 'pp-up'
  const levelApplication = application.kind === 'rare-candy'
  if (statApplication !== (application.stat !== null)
    || moveApplication !== (application.moveName !== null
      && application.moveListIndex !== null
      && application.previousFrequency !== null
      && application.resultingFrequency !== null)
    || levelApplication !== (application.previousLevel !== null && application.resultingLevel !== null)
    || (!moveApplication && (application.moveName !== null || application.moveListIndex !== null
      || application.previousFrequency !== null || application.resultingFrequency !== null))
    || (!levelApplication && (application.previousLevel !== null || application.resultingLevel !== null))
    || (levelApplication && application.resultingLevel !== application.previousLevel! + 1)) {
    fail(path, 'does not match its application kind.')
  }
  return application
}

export const emptyItemPermanentAdvancementState = (): ItemPermanentAdvancementStateV1 => deepFreezeStrictJson({
  schemaVersion: ITEM_PERMANENT_ADVANCEMENT_SCHEMA_VERSION,
  applications: [],
})

export const parseItemPermanentAdvancementState = (value: unknown): ItemPermanentAdvancementStateV1 => {
  if (value === undefined) return emptyItemPermanentAdvancementState()
  const detached = cloneStrictJson(value, 'itemPermanentAdvancement', {
    limits: {
      depth: 8,
      nodes: 4_096,
      objectFields: 16,
      arrayEntries: 256,
      stringLength: 500,
      objectKeyLength: 100,
    },
    rootLabel: 'item permanent advancement state',
    valueLabel: 'item permanent advancement state values',
    failNotJson: (path, detail) => fail(path, detail),
    failLimit: (path, detail) => fail(path, detail),
  })
  const root = record(detached, 'itemPermanentAdvancement')
  exact(root, ROOT_FIELDS, 'itemPermanentAdvancement')
  if (root.schemaVersion !== ITEM_PERMANENT_ADVANCEMENT_SCHEMA_VERSION) {
    fail('itemPermanentAdvancement.schemaVersion', `must be ${ITEM_PERMANENT_ADVANCEMENT_SCHEMA_VERSION}.`)
  }
  const rawApplications = root.applications
  if (!Array.isArray(rawApplications)) {
    fail('itemPermanentAdvancement.applications', 'must be an array of at most 256 entries.')
  }
  const applicationRows = rawApplications as unknown[]
  if (applicationRows.length > 256) {
    fail('itemPermanentAdvancement.applications', 'must be an array of at most 256 entries.')
  }
  const applications = applicationRows.map(parseApplication)
  if (new Set(applications.map(application => application.sourceOperationId)).size !== applications.length) {
    fail('itemPermanentAdvancement.applications', 'must have unique source operation identities.')
  }
  return deepFreezeStrictJson({
    schemaVersion: ITEM_PERMANENT_ADVANCEMENT_SCHEMA_VERSION,
    applications,
  })
}

export const appendItemPermanentAdvancementApplication = (input: {
  readonly current: unknown
  readonly application: ItemPermanentAdvancementApplicationV1
}): ItemPermanentAdvancementStateV1 => {
  const current = parseItemPermanentAdvancementState(input.current)
  const application = parseApplication(input.application, current.applications.length)
  if (current.applications.some(value => value.sourceOperationId === application.sourceOperationId)) {
    fail('itemPermanentAdvancement.applications', 'already contains this source operation identity.')
  }
  return parseItemPermanentAdvancementState({
    schemaVersion: ITEM_PERMANENT_ADVANCEMENT_SCHEMA_VERSION,
    applications: [...current.applications, application],
  })
}
