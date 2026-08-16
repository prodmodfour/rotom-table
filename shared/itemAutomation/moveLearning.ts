import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ITEM_MOVE_LEARNING_SCHEMA_VERSION = 1 as const
export const ITEM_MACHINE_USAGE_SCHEMA_VERSION = 1 as const
export const ITEM_MACHINE_KINDS = ['TM', 'HM'] as const
export type ItemMachineKind = typeof ITEM_MACHINE_KINDS[number]

export interface ItemMoveLearningApplicationV1 {
  readonly sourceOperationId: string
  readonly sourceInstanceId: string
  readonly canonicalItemId: string
  readonly canonicalDefinitionSha256: string
  readonly machineKind: ItemMachineKind
  readonly machineNumber: string
  readonly moveId: string
  readonly replacementKind: 'add' | 'replace'
  readonly replacedMoveId: string | null
  readonly moveListIndex: number
  readonly tutorPointCost: 0 | 1
  readonly previousTutorPointsSpent: number
  readonly resultingTutorPointsSpent: number
  readonly previousMoveCount: number
  readonly resultingMoveCount: number
  readonly previousMachineTutorCount: number
  readonly resultingMachineTutorCount: number
  readonly speciesId: string
  readonly speciesRecordSha256: string
  readonly moveRecordSha256: string
  readonly campaignMinute: number
  readonly appliedAt: number
}

export interface ItemMoveLearningStateV1 {
  readonly schemaVersion: typeof ITEM_MOVE_LEARNING_SCHEMA_VERSION
  readonly applications: readonly ItemMoveLearningApplicationV1[]
}

export interface ItemMachineDailyUseV1 {
  readonly sourceInstanceId: string
  readonly sourceOperationId: string
  readonly canonicalItemId: string
  readonly canonicalDefinitionSha256: string
  readonly campaignDayIndex: number
  readonly campaignMinute: number
}

export interface ItemMachineUsageStateV1 {
  readonly schemaVersion: typeof ITEM_MACHINE_USAGE_SCHEMA_VERSION
  /** At most one latest accepted use per reusable HM source instance. */
  readonly latestUses: readonly ItemMachineDailyUseV1[]
}

export class ItemMoveLearningStateValidationError extends Error {
  readonly path: string

  constructor(path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'ItemMoveLearningStateValidationError'
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>

const APPLICATION_FIELDS = [
  'sourceOperationId', 'sourceInstanceId', 'canonicalItemId', 'canonicalDefinitionSha256',
  'machineKind', 'machineNumber', 'moveId', 'replacementKind', 'replacedMoveId',
  'moveListIndex', 'tutorPointCost', 'previousTutorPointsSpent', 'resultingTutorPointsSpent',
  'previousMoveCount', 'resultingMoveCount', 'previousMachineTutorCount',
  'resultingMachineTutorCount', 'speciesId', 'speciesRecordSha256', 'moveRecordSha256',
  'campaignMinute', 'appliedAt',
] as const
const DAILY_USE_FIELDS = [
  'sourceInstanceId', 'sourceOperationId', 'canonicalItemId', 'canonicalDefinitionSha256',
  'campaignDayIndex', 'campaignMinute',
] as const
const SHA256_PATTERN = /^[a-f0-9]{64}$/u
const MACHINE_NUMBER_PATTERN = /^[0-9]{2,3}$/u
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u
const MACHINE_KINDS = new Set<string>(ITEM_MACHINE_KINDS)

const fail = (path: string, message: string): never => {
  throw new ItemMoveLearningStateValidationError(path, message)
}

const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) return fail(path, 'must be a plain object.')
  return value
}

const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  if (fields.some(field => !Object.hasOwn(value, field))
    || Object.keys(value).some(field => !expected.has(field))) {
    fail(path, 'has an invalid shape.')
  }
}

const text = (value: unknown, path: string, maximum = 500): string => {
  if (typeof value !== 'string' || !value || value.trim() !== value
    || value.length > maximum || CONTROL_CHARACTER_PATTERN.test(value)) {
    return fail(path, 'must be bounded non-empty safe text.')
  }
  return value
}

const sha256 = (value: unknown, path: string): string => {
  const result = text(value, path, 64)
  return SHA256_PATTERN.test(result) ? result : fail(path, 'must be a lowercase SHA-256 digest.')
}

const integer = (value: unknown, path: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    return fail(path, `must be a safe integer from ${minimum} through ${maximum}.`)
  }
  return Number(value)
}

const parseApplication = (value: unknown, index: number): ItemMoveLearningApplicationV1 => {
  const path = `itemMoveLearning.applications[${index}]`
  const input = record(value, path)
  exact(input, APPLICATION_FIELDS, path)
  const machineKind = text(input.machineKind, `${path}.machineKind`, 2)
  if (!MACHINE_KINDS.has(machineKind)) fail(`${path}.machineKind`, 'must be TM or HM.')
  const machineNumber = text(input.machineNumber, `${path}.machineNumber`, 3)
  if (!MACHINE_NUMBER_PATTERN.test(machineNumber)) fail(`${path}.machineNumber`, 'must be a zero-padded machine number.')
  const replacementKind = text(input.replacementKind, `${path}.replacementKind`, 10)
  if (replacementKind !== 'add' && replacementKind !== 'replace') {
    fail(`${path}.replacementKind`, 'must be add or replace.')
  }
  const replacedMoveId = input.replacedMoveId === null
    ? null
    : text(input.replacedMoveId, `${path}.replacedMoveId`, 160)
  const moveId = text(input.moveId, `${path}.moveId`, 160)
  const tutorPointCost = integer(input.tutorPointCost, `${path}.tutorPointCost`, 0, 1) as 0 | 1
  const previousTutorPointsSpent = integer(input.previousTutorPointsSpent, `${path}.previousTutorPointsSpent`, 0, 256)
  const resultingTutorPointsSpent = integer(input.resultingTutorPointsSpent, `${path}.resultingTutorPointsSpent`, 0, 256)
  const previousMoveCount = integer(input.previousMoveCount, `${path}.previousMoveCount`, 0, 8)
  const resultingMoveCount = integer(input.resultingMoveCount, `${path}.resultingMoveCount`, 0, 8)
  const previousMachineTutorCount = integer(input.previousMachineTutorCount, `${path}.previousMachineTutorCount`, 0, 3)
  const resultingMachineTutorCount = integer(input.resultingMachineTutorCount, `${path}.resultingMachineTutorCount`, 0, 3)
  if (resultingTutorPointsSpent !== previousTutorPointsSpent + tutorPointCost
    || (replacementKind === 'add'
      ? replacedMoveId !== null || resultingMoveCount !== previousMoveCount + 1
      : replacedMoveId === null || replacedMoveId === moveId || resultingMoveCount !== previousMoveCount)
    || resultingMachineTutorCount > 3) {
    fail(path, 'does not preserve reviewed replacement, Tutor Point, or Move-limit invariants.')
  }
  return {
    sourceOperationId: text(input.sourceOperationId, `${path}.sourceOperationId`, 200),
    sourceInstanceId: text(input.sourceInstanceId, `${path}.sourceInstanceId`, 1_024),
    canonicalItemId: text(input.canonicalItemId, `${path}.canonicalItemId`, 200),
    canonicalDefinitionSha256: sha256(input.canonicalDefinitionSha256, `${path}.canonicalDefinitionSha256`),
    machineKind: machineKind as ItemMachineKind,
    machineNumber,
    moveId,
    replacementKind: replacementKind as 'add' | 'replace',
    replacedMoveId,
    moveListIndex: integer(input.moveListIndex, `${path}.moveListIndex`, 0, 7),
    tutorPointCost,
    previousTutorPointsSpent,
    resultingTutorPointsSpent,
    previousMoveCount,
    resultingMoveCount,
    previousMachineTutorCount,
    resultingMachineTutorCount,
    speciesId: text(input.speciesId, `${path}.speciesId`, 200),
    speciesRecordSha256: sha256(input.speciesRecordSha256, `${path}.speciesRecordSha256`),
    moveRecordSha256: sha256(input.moveRecordSha256, `${path}.moveRecordSha256`),
    campaignMinute: integer(input.campaignMinute, `${path}.campaignMinute`),
    appliedAt: integer(input.appliedAt, `${path}.appliedAt`),
  }
}

const parseDailyUse = (value: unknown, index: number): ItemMachineDailyUseV1 => {
  const path = `itemMachineUsage.latestUses[${index}]`
  const input = record(value, path)
  exact(input, DAILY_USE_FIELDS, path)
  const campaignMinute = integer(input.campaignMinute, `${path}.campaignMinute`)
  const campaignDayIndex = integer(input.campaignDayIndex, `${path}.campaignDayIndex`)
  if (campaignDayIndex !== Math.floor(campaignMinute / 1_440)) {
    fail(path, 'campaign day does not match its authoritative campaign minute.')
  }
  return {
    sourceInstanceId: text(input.sourceInstanceId, `${path}.sourceInstanceId`, 1_024),
    sourceOperationId: text(input.sourceOperationId, `${path}.sourceOperationId`, 200),
    canonicalItemId: text(input.canonicalItemId, `${path}.canonicalItemId`, 200),
    canonicalDefinitionSha256: sha256(input.canonicalDefinitionSha256, `${path}.canonicalDefinitionSha256`),
    campaignDayIndex,
    campaignMinute,
  }
}

const cloneState = (value: unknown, label: string): unknown => cloneStrictJson(value, label, {
  limits: {
    depth: 8,
    nodes: 16_384,
    objectFields: 32,
    arrayEntries: 256,
    stringLength: 1_024,
    objectKeyLength: 100,
  },
  rootLabel: label,
  valueLabel: label,
  failNotJson: (path, detail) => fail(path, detail),
  failLimit: (path, detail) => fail(path, detail),
})

export const emptyItemMoveLearningState = (): ItemMoveLearningStateV1 => deepFreezeStrictJson({
  schemaVersion: ITEM_MOVE_LEARNING_SCHEMA_VERSION,
  applications: [],
})

export const parseItemMoveLearningState = (value: unknown): ItemMoveLearningStateV1 => {
  if (value === undefined) return emptyItemMoveLearningState()
  const root = record(cloneState(value, 'itemMoveLearning'), 'itemMoveLearning')
  exact(root, ['schemaVersion', 'applications'], 'itemMoveLearning')
  if (root.schemaVersion !== ITEM_MOVE_LEARNING_SCHEMA_VERSION || !Array.isArray(root.applications)
    || root.applications.length > 256) {
    fail('itemMoveLearning', 'uses an unsupported schema or application count.')
  }
  const applicationRows = root.applications as unknown[]
  const applications = applicationRows.map(parseApplication)
  if (new Set(applications.map(application => application.sourceOperationId)).size !== applications.length) {
    fail('itemMoveLearning.applications', 'must have unique source operation identities.')
  }
  return deepFreezeStrictJson({ schemaVersion: ITEM_MOVE_LEARNING_SCHEMA_VERSION, applications })
}

export const appendItemMoveLearningApplication = (input: {
  readonly current: unknown
  readonly application: ItemMoveLearningApplicationV1
}): ItemMoveLearningStateV1 => {
  const current = parseItemMoveLearningState(input.current)
  const application = parseApplication(input.application, current.applications.length)
  if (current.applications.some(value => value.sourceOperationId === application.sourceOperationId)) {
    fail('itemMoveLearning.applications', 'already contains this source operation identity.')
  }
  return parseItemMoveLearningState({
    schemaVersion: ITEM_MOVE_LEARNING_SCHEMA_VERSION,
    applications: [...current.applications, application],
  })
}

/** Active item-authored Move names reconstructed from immutable replacement history. */
export const activeItemMoveLearningNames = (value: unknown): ReadonlySet<string> => {
  const active = new Set<string>()
  for (const application of parseItemMoveLearningState(value).applications) {
    if (application.replacementKind === 'replace' && application.replacedMoveId !== null) {
      active.delete(application.replacedMoveId)
    }
    active.add(application.moveId)
  }
  return active
}

export const emptyItemMachineUsageState = (): ItemMachineUsageStateV1 => deepFreezeStrictJson({
  schemaVersion: ITEM_MACHINE_USAGE_SCHEMA_VERSION,
  latestUses: [],
})

export const parseItemMachineUsageState = (value: unknown): ItemMachineUsageStateV1 => {
  if (value === undefined) return emptyItemMachineUsageState()
  const root = record(cloneState(value, 'itemMachineUsage'), 'itemMachineUsage')
  exact(root, ['schemaVersion', 'latestUses'], 'itemMachineUsage')
  if (root.schemaVersion !== ITEM_MACHINE_USAGE_SCHEMA_VERSION || !Array.isArray(root.latestUses)
    || root.latestUses.length > 256) {
    fail('itemMachineUsage', 'uses an unsupported schema or source count.')
  }
  const dailyUseRows = root.latestUses as unknown[]
  const latestUses = dailyUseRows.map(parseDailyUse)
  if (new Set(latestUses.map(use => use.sourceInstanceId)).size !== latestUses.length
    || new Set(latestUses.map(use => use.sourceOperationId)).size !== latestUses.length) {
    fail('itemMachineUsage.latestUses', 'must have unique source and operation identities.')
  }
  return deepFreezeStrictJson({ schemaVersion: ITEM_MACHINE_USAGE_SCHEMA_VERSION, latestUses })
}

export const recordItemMachineDailyUse = (input: {
  readonly current: unknown
  readonly use: ItemMachineDailyUseV1
}): ItemMachineUsageStateV1 => {
  const current = parseItemMachineUsageState(input.current)
  const use = parseDailyUse(input.use, current.latestUses.length)
  const previous = current.latestUses.find(value => value.sourceInstanceId === use.sourceInstanceId)
  if (previous && previous.campaignDayIndex >= use.campaignDayIndex) {
    fail('itemMachineUsage.latestUses', previous.campaignDayIndex === use.campaignDayIndex
      ? 'this HM source was already used during the current campaign day.'
      : 'cannot replace a reusable-source receipt with an older campaign day.')
  }
  return parseItemMachineUsageState({
    schemaVersion: ITEM_MACHINE_USAGE_SCHEMA_VERSION,
    latestUses: [
      ...current.latestUses.filter(value => value.sourceInstanceId !== use.sourceInstanceId),
      use,
    ].sort((left, right) => left.sourceInstanceId.localeCompare(right.sourceInstanceId)),
  })
}
