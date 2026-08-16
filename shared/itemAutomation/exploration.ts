import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ITEM_EXPLORATION_SCHEMA_VERSION = 1 as const
export const ITEM_BAIT_NEXT_TURN_STANDARD_FLAG_ID = 'item.bait.next-turn-standard' as const
export const ITEM_REPEL_NEXT_TURN_SHIFT_FLAG_ID = 'item.repel.next-turn-shift' as const
export const ITEM_EXPLORATION_CLOCK_REALTIME_EVENT_TYPE = 'item-exploration-clock-updated' as const
export const ITEM_EXPLORATION_SHARD_COLORS = [
  'Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Violet',
] as const
export type ItemExplorationShardColor = typeof ITEM_EXPLORATION_SHARD_COLORS[number]
export const ITEM_EXPLORATION_LIMITS = Object.freeze({
  routeLures: 32,
  attemptsPerLure: 3,
  repels: 64,
  dowsingUses: 256,
  shardAwardsPerUse: 128,
  rollCount: 128,
  identifierChars: 200,
})

export interface ItemRouteLureAttemptV1 {
  readonly attempt: 1 | 2 | 3
  readonly dueAtCampaignMinute: number
  readonly resolvedAtCampaignMinute: number
  readonly roll: number
  readonly success: boolean
}

export interface ItemRouteLureActivityV1 {
  readonly activityId: string
  readonly sourceOperationId: string
  readonly canonicalItemId: 'Bait' | 'Fishing Lure' | 'Honey'
  readonly canonicalDefinitionSha256: string
  readonly sourceInstanceId: string
  readonly reusable: boolean
  readonly startedAtCampaignMinute: number
  readonly nextCheckAtCampaignMinute: number | null
  readonly status: 'active' | 'awaiting-encounter' | 'completed' | 'cancelled'
  readonly attempts: readonly ItemRouteLureAttemptV1[]
  readonly outcome: 'encounter-introduced' | 'no-encounter' | 'lure-lost' | 'cancelled' | null
}

export interface ItemRepelCampaignEffectV1 {
  readonly effectId: string
  readonly sourceOperationId: string
  readonly canonicalItemId: 'Repel' | 'Super Repel' | 'Max Repel'
  readonly canonicalDefinitionSha256: string
  readonly sourceInstanceId: string
  readonly startedAtCampaignMinute: number
  readonly expiresAtCampaignMinute: number
  readonly maximumAffectedWildLevel: 15 | 25 | 35
}

export interface ItemDowsingRollV1 {
  readonly expression: string
  readonly baseDice: number
  readonly terrainBonusDice: 0 | 1
  readonly skillStuntBonusDice: 0 | 1
  readonly crystalResonanceBonusDice: 0 | 3
  readonly rolls: readonly number[]
  readonly successes: number
  readonly explodingSixes: number
}

export interface ItemShardInventoryVariantV1 {
  readonly schemaVersion: typeof ITEM_EXPLORATION_SCHEMA_VERSION
  readonly kind: 'shard-color'
  readonly color: ItemExplorationShardColor
}

export interface ItemDowsingUseV1 {
  readonly sourceOperationId: string
  readonly canonicalDefinitionSha256: string
  readonly sourceInstanceId: string
  readonly campaignDayIndex: number
  readonly resolvedAtCampaignMinute: number
  readonly terrainId: 'ordinary' | 'beach' | 'cave' | 'desert' | 'sandy-or-rocky'
  readonly skillStuntInstanceId: string | null
  readonly roll: ItemDowsingRollV1
  readonly shardAwards: readonly ItemExplorationShardColor[]
  /** Exact generated inventory row identities, retained only in server-private authority. */
  readonly shardInventoryRowIds: readonly string[]
}

export interface ItemExplorationStateV1 {
  readonly schemaVersion: typeof ITEM_EXPLORATION_SCHEMA_VERSION
  readonly routeLures: readonly ItemRouteLureActivityV1[]
  readonly repels: readonly ItemRepelCampaignEffectV1[]
  readonly dowsingUses: readonly ItemDowsingUseV1[]
}

export interface ItemExplorationProjectionV1 {
  readonly schemaVersion: typeof ITEM_EXPLORATION_SCHEMA_VERSION
  readonly routeLures: readonly {
    readonly activityId: string
    readonly itemLabel: string
    readonly status: ItemRouteLureActivityV1['status']
    readonly attemptsResolved: number
    readonly maximumAttempts: 3
    readonly nextCheckAtCampaignMinute: number | null
    readonly outcome: ItemRouteLureActivityV1['outcome']
    readonly canResolveCheck: boolean
    readonly needsGmEncounter: boolean
    readonly reusable: boolean
  }[]
  readonly repels: readonly {
    readonly itemLabel: string
    readonly maximumAffectedWildLevel: 15 | 25 | 35
    readonly expiresAtCampaignMinute: number
    readonly active: boolean
  }[]
  readonly dowsing: {
    readonly campaignDayIndex: number
    readonly uses: number
    readonly maximumUses: number
    readonly latest: {
      readonly resolvedAtCampaignMinute: number
      readonly successes: number
      readonly shardAwards: readonly ItemExplorationShardColor[]
    } | null
  }
}

export class ItemExplorationValidationError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'ItemExplorationValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const SHA256 = /^[a-f0-9]{64}$/
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{7,199}$/
const ROUTE_ITEM_SET = new Set<string>(['Bait', 'Fishing Lure', 'Honey'])
const REPEL_ITEM_SET = new Set<string>(['Repel', 'Super Repel', 'Max Repel'])
const ROUTE_STATUS_SET = new Set<string>(['active', 'awaiting-encounter', 'completed', 'cancelled'])
const ROUTE_OUTCOME_SET = new Set<string>(['encounter-introduced', 'no-encounter', 'lure-lost', 'cancelled'])
const TERRAIN_SET = new Set<string>(['ordinary', 'beach', 'cave', 'desert', 'sandy-or-rocky'])
const COLOR_SET = new Set<string>(ITEM_EXPLORATION_SHARD_COLORS)

const fail = (path: string, detail: string): never => { throw new ItemExplorationValidationError(path, detail) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail(path, 'must be a plain object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(value, field)) || Object.keys(value).some(field => !allowed.has(field))) {
    fail(path, 'has an invalid shape.')
  }
}
const array = (value: unknown, path: string, maximum: number): readonly unknown[] => {
  if (!Array.isArray(value) || value.length > maximum) fail(path, `must be an array of at most ${maximum} entries.`)
  return value as readonly unknown[]
}
const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > ITEM_EXPLORATION_LIMITS.identifierChars) {
    fail(path, 'must be bounded non-empty text.')
  }
  return value as string
}
const id = (value: unknown, path: string): string => {
  const parsed = text(value, path)
  return ID.test(parsed) ? parsed : fail(path, 'must be a stable operation or activity identity.')
}
const hash = (value: unknown, path: string): string => typeof value === 'string' && SHA256.test(value)
  ? value : fail(path, 'must be a SHA-256 value.')
const integer = (value: unknown, path: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    fail(path, `must be a safe integer from ${minimum} through ${maximum}.`)
  }
  return Number(value)
}
const bool = (value: unknown, path: string): boolean => typeof value === 'boolean'
  ? value : fail(path, 'must be boolean.')
const enumText = <Value extends string>(value: unknown, values: ReadonlySet<string>, path: string): Value => (
  typeof value === 'string' && values.has(value) ? value as Value : fail(path, 'contains an unsupported value.')
)
const nullable = <Value>(value: unknown, parser: (entry: unknown) => Value): Value | null => value === null ? null : parser(value)
const unique = (values: readonly string[], path: string): void => {
  if (new Set(values).size !== values.length) fail(path, 'must contain unique identities.')
}
const clone = (value: unknown): unknown => cloneStrictJson(value, 'itemExploration', {
  limits: { depth: 12, nodes: 8_192, objectFields: 24, arrayEntries: 512, stringLength: 500, objectKeyLength: 100 },
  rootLabel: 'item exploration state',
  valueLabel: 'item exploration state values',
  failNotJson: (path, detail) => fail(path, detail),
  failLimit: (path, detail) => fail(path, detail),
})

export const parseItemShardInventoryVariant = (value: unknown): ItemShardInventoryVariantV1 => {
  const path = 'itemVariant'
  const row = record(clone(value), path)
  exact(row, ['schemaVersion', 'kind', 'color'], path)
  if (row.schemaVersion !== ITEM_EXPLORATION_SCHEMA_VERSION || row.kind !== 'shard-color') {
    fail(path, 'must be a supported color-preserving Shard variant.')
  }
  return deepFreezeStrictJson({
    schemaVersion: ITEM_EXPLORATION_SCHEMA_VERSION,
    kind: 'shard-color',
    color: enumText<ItemExplorationShardColor>(row.color, COLOR_SET, `${path}.color`),
  })
}

const parseRouteLure = (value: unknown, index: number): ItemRouteLureActivityV1 => {
  const path = `itemExploration.routeLures[${index}]`
  const row = record(value, path)
  exact(row, [
    'activityId', 'sourceOperationId', 'canonicalItemId', 'canonicalDefinitionSha256',
    'sourceInstanceId', 'reusable', 'startedAtCampaignMinute', 'nextCheckAtCampaignMinute',
    'status', 'attempts', 'outcome',
  ], path)
  const canonicalItemId = enumText<ItemRouteLureActivityV1['canonicalItemId']>(row.canonicalItemId, ROUTE_ITEM_SET, `${path}.canonicalItemId`)
  const startedAtCampaignMinute = integer(row.startedAtCampaignMinute, `${path}.startedAtCampaignMinute`)
  const attempts = array(row.attempts, `${path}.attempts`, 3).map((entry, attemptIndex): ItemRouteLureAttemptV1 => {
    const attemptPath = `${path}.attempts[${attemptIndex}]`
    const attempt = record(entry, attemptPath)
    exact(attempt, ['attempt', 'dueAtCampaignMinute', 'resolvedAtCampaignMinute', 'roll', 'success'], attemptPath)
    const number = integer(attempt.attempt, `${attemptPath}.attempt`, 1, 3)
    const due = integer(attempt.dueAtCampaignMinute, `${attemptPath}.dueAtCampaignMinute`)
    const resolved = integer(attempt.resolvedAtCampaignMinute, `${attemptPath}.resolvedAtCampaignMinute`)
    if (number !== attemptIndex + 1 || due !== startedAtCampaignMinute + number * 15 || resolved < due) {
      fail(attemptPath, 'does not match the reviewed 15-minute attempt sequence.')
    }
    return { attempt: number as 1 | 2 | 3, dueAtCampaignMinute: due, resolvedAtCampaignMinute: resolved, roll: integer(attempt.roll, `${attemptPath}.roll`, 1, 20), success: bool(attempt.success, `${attemptPath}.success`) }
  })
  const status = enumText<ItemRouteLureActivityV1['status']>(row.status, ROUTE_STATUS_SET, `${path}.status`)
  const nextCheckAtCampaignMinute = nullable(row.nextCheckAtCampaignMinute, entry => integer(entry, `${path}.nextCheckAtCampaignMinute`))
  const outcome = nullable(row.outcome, entry => enumText<NonNullable<ItemRouteLureActivityV1['outcome']>>(entry, ROUTE_OUTCOME_SET, `${path}.outcome`))
  const expectedNext = status === 'active' ? startedAtCampaignMinute + (attempts.length + 1) * 15 : null
  if (nextCheckAtCampaignMinute !== expectedNext
    || attempts.some((attempt, attemptIndex) => attempt.success && attemptIndex !== attempts.length - 1)
    || (status === 'awaiting-encounter' && !attempts.at(-1)?.success)
    || (status === 'active' && (attempts.length >= 3 || attempts.some(attempt => attempt.success)))
    || ((status === 'completed' || status === 'cancelled') !== (outcome !== null))) {
    fail(path, 'has inconsistent route-lure lifecycle state.')
  }
  return {
    activityId: id(row.activityId, `${path}.activityId`),
    sourceOperationId: id(row.sourceOperationId, `${path}.sourceOperationId`),
    canonicalItemId,
    canonicalDefinitionSha256: hash(row.canonicalDefinitionSha256, `${path}.canonicalDefinitionSha256`),
    sourceInstanceId: text(row.sourceInstanceId, `${path}.sourceInstanceId`),
    reusable: bool(row.reusable, `${path}.reusable`),
    startedAtCampaignMinute,
    nextCheckAtCampaignMinute,
    status,
    attempts,
    outcome,
  }
}

const parseRepel = (value: unknown, index: number): ItemRepelCampaignEffectV1 => {
  const path = `itemExploration.repels[${index}]`
  const row = record(value, path)
  exact(row, [
    'effectId', 'sourceOperationId', 'canonicalItemId', 'canonicalDefinitionSha256',
    'sourceInstanceId', 'startedAtCampaignMinute', 'expiresAtCampaignMinute',
    'maximumAffectedWildLevel',
  ], path)
  const canonicalItemId = enumText<ItemRepelCampaignEffectV1['canonicalItemId']>(row.canonicalItemId, REPEL_ITEM_SET, `${path}.canonicalItemId`)
  const started = integer(row.startedAtCampaignMinute, `${path}.startedAtCampaignMinute`)
  const expires = integer(row.expiresAtCampaignMinute, `${path}.expiresAtCampaignMinute`)
  const expected: readonly [number, number] = canonicalItemId === 'Repel'
    ? [60, 15] : canonicalItemId === 'Super Repel' ? [120, 25] : [300, 35]
  const level = integer(row.maximumAffectedWildLevel, `${path}.maximumAffectedWildLevel`, 1, 100)
  if (expires !== started + expected[0] || level !== expected[1]) fail(path, 'does not match the reviewed Repel variant.')
  return {
    effectId: id(row.effectId, `${path}.effectId`),
    sourceOperationId: id(row.sourceOperationId, `${path}.sourceOperationId`),
    canonicalItemId,
    canonicalDefinitionSha256: hash(row.canonicalDefinitionSha256, `${path}.canonicalDefinitionSha256`),
    sourceInstanceId: text(row.sourceInstanceId, `${path}.sourceInstanceId`),
    startedAtCampaignMinute: started,
    expiresAtCampaignMinute: expires,
    maximumAffectedWildLevel: level as 15 | 25 | 35,
  }
}

const parseDowsingUse = (value: unknown, index: number): ItemDowsingUseV1 => {
  const path = `itemExploration.dowsingUses[${index}]`
  const row = record(value, path)
  exact(row, [
    'sourceOperationId', 'canonicalDefinitionSha256', 'sourceInstanceId', 'campaignDayIndex',
    'resolvedAtCampaignMinute', 'terrainId', 'skillStuntInstanceId', 'roll',
    'shardAwards', 'shardInventoryRowIds',
  ], path)
  const roll = record(row.roll, `${path}.roll`)
  exact(roll, [
    'expression', 'baseDice', 'terrainBonusDice', 'skillStuntBonusDice',
    'crystalResonanceBonusDice', 'rolls', 'successes', 'explodingSixes',
  ], `${path}.roll`)
  const baseDice = integer(roll.baseDice, `${path}.roll.baseDice`, 1, 8)
  const terrainBonusDice = integer(roll.terrainBonusDice, `${path}.roll.terrainBonusDice`, 0, 1) as 0 | 1
  const skillStuntBonusDice = integer(roll.skillStuntBonusDice, `${path}.roll.skillStuntBonusDice`, 0, 1) as 0 | 1
  const crystalResonanceBonusDice = integer(roll.crystalResonanceBonusDice, `${path}.roll.crystalResonanceBonusDice`, 0, 3) as 0 | 3
  if (crystalResonanceBonusDice !== 0 && crystalResonanceBonusDice !== 3) fail(`${path}.roll.crystalResonanceBonusDice`, 'must be 0 or 3.')
  const rolls = array(roll.rolls, `${path}.roll.rolls`, ITEM_EXPLORATION_LIMITS.rollCount)
    .map((entry, rollIndex) => integer(entry, `${path}.roll.rolls[${rollIndex}]`, 1, 6))
  const initialDice = baseDice + terrainBonusDice + skillStuntBonusDice + crystalResonanceBonusDice
  const explodingSixes = rolls.filter(value => value === 6).length
  const successes = rolls.filter(value => value >= 4).length
  if (roll.expression !== `${initialDice}d6!6` || rolls.length !== initialDice + explodingSixes
    || roll.successes !== successes || roll.explodingSixes !== explodingSixes) {
    fail(`${path}.roll`, 'does not match reviewed exploding d6 success mechanics.')
  }
  const shardAwards = array(row.shardAwards, `${path}.shardAwards`, ITEM_EXPLORATION_LIMITS.shardAwardsPerUse)
    .map((entry, colorIndex) => enumText<ItemExplorationShardColor>(entry, COLOR_SET, `${path}.shardAwards[${colorIndex}]`))
  const shardInventoryRowIds = array(row.shardInventoryRowIds, `${path}.shardInventoryRowIds`, ITEM_EXPLORATION_LIMITS.shardAwardsPerUse)
    .map((entry, rowIndex) => text(entry, `${path}.shardInventoryRowIds[${rowIndex}]`))
  if (shardAwards.length !== successes || shardInventoryRowIds.length !== shardAwards.length) {
    fail(path, 'must grant exactly one color-preserving Shard per success.')
  }
  unique(shardInventoryRowIds, `${path}.shardInventoryRowIds`)
  const resolvedAt = integer(row.resolvedAtCampaignMinute, `${path}.resolvedAtCampaignMinute`)
  const day = integer(row.campaignDayIndex, `${path}.campaignDayIndex`)
  if (Math.floor(resolvedAt / 1_440) !== day) fail(`${path}.campaignDayIndex`, 'must match the resolution campaign day.')
  return {
    sourceOperationId: id(row.sourceOperationId, `${path}.sourceOperationId`),
    canonicalDefinitionSha256: hash(row.canonicalDefinitionSha256, `${path}.canonicalDefinitionSha256`),
    sourceInstanceId: text(row.sourceInstanceId, `${path}.sourceInstanceId`),
    campaignDayIndex: day,
    resolvedAtCampaignMinute: resolvedAt,
    terrainId: enumText<ItemDowsingUseV1['terrainId']>(row.terrainId, TERRAIN_SET, `${path}.terrainId`),
    skillStuntInstanceId: nullable(row.skillStuntInstanceId, entry => text(entry, `${path}.skillStuntInstanceId`)),
    roll: {
      expression: String(roll.expression), baseDice, terrainBonusDice, skillStuntBonusDice,
      crystalResonanceBonusDice, rolls, successes, explodingSixes,
    },
    shardAwards,
    shardInventoryRowIds,
  }
}

export const emptyItemExplorationState = (): ItemExplorationStateV1 => deepFreezeStrictJson({
  schemaVersion: ITEM_EXPLORATION_SCHEMA_VERSION,
  routeLures: [],
  repels: [],
  dowsingUses: [],
})

export const parseItemExplorationState = (value: unknown): ItemExplorationStateV1 => {
  if (value === undefined || value === null) return emptyItemExplorationState()
  const root = record(clone(value), 'itemExploration')
  exact(root, ['schemaVersion', 'routeLures', 'repels', 'dowsingUses'], 'itemExploration')
  if (root.schemaVersion !== ITEM_EXPLORATION_SCHEMA_VERSION) fail('itemExploration.schemaVersion', 'is unsupported.')
  const routeLures = array(root.routeLures, 'itemExploration.routeLures', ITEM_EXPLORATION_LIMITS.routeLures).map(parseRouteLure)
  const repels = array(root.repels, 'itemExploration.repels', ITEM_EXPLORATION_LIMITS.repels).map(parseRepel)
  const dowsingUses = array(root.dowsingUses, 'itemExploration.dowsingUses', ITEM_EXPLORATION_LIMITS.dowsingUses).map(parseDowsingUse)
  unique(routeLures.map(row => row.activityId), 'itemExploration.routeLures.activityId')
  unique(routeLures.map(row => row.sourceOperationId), 'itemExploration.routeLures.sourceOperationId')
  unique(repels.map(row => row.effectId), 'itemExploration.repels.effectId')
  unique(repels.map(row => row.sourceOperationId), 'itemExploration.repels.sourceOperationId')
  unique(dowsingUses.map(row => row.sourceOperationId), 'itemExploration.dowsingUses.sourceOperationId')
  unique(dowsingUses.flatMap(row => row.shardInventoryRowIds), 'itemExploration.dowsingUses.shardInventoryRowIds')
  return deepFreezeStrictJson({ schemaVersion: ITEM_EXPLORATION_SCHEMA_VERSION, routeLures, repels, dowsingUses })
}

export const projectItemExplorationState = (input: {
  readonly state: unknown
  readonly campaignMinute: number
  readonly occultEducationRank: number
}): ItemExplorationProjectionV1 => {
  const state = parseItemExplorationState(input.state)
  const campaignDayIndex = Math.floor(input.campaignMinute / 1_440)
  const maximumUses = Math.floor(input.occultEducationRank / 2)
  const today = state.dowsingUses.filter(use => use.campaignDayIndex === campaignDayIndex)
  const latest = today.at(-1) ?? null
  return deepFreezeStrictJson({
    schemaVersion: 1,
    routeLures: state.routeLures.slice(-16).map(activity => ({
      activityId: activity.activityId,
      itemLabel: activity.canonicalItemId,
      status: activity.status,
      attemptsResolved: activity.attempts.length,
      maximumAttempts: 3 as const,
      nextCheckAtCampaignMinute: activity.nextCheckAtCampaignMinute,
      outcome: activity.outcome,
      canResolveCheck: activity.status === 'active' && activity.nextCheckAtCampaignMinute !== null
        && input.campaignMinute >= activity.nextCheckAtCampaignMinute,
      needsGmEncounter: activity.status === 'awaiting-encounter',
      reusable: activity.reusable,
    })),
    repels: state.repels.slice(-16).map(effect => ({
      itemLabel: effect.canonicalItemId,
      maximumAffectedWildLevel: effect.maximumAffectedWildLevel,
      expiresAtCampaignMinute: effect.expiresAtCampaignMinute,
      active: input.campaignMinute < effect.expiresAtCampaignMinute,
    })),
    dowsing: {
      campaignDayIndex,
      uses: today.length,
      maximumUses,
      latest: latest ? {
        resolvedAtCampaignMinute: latest.resolvedAtCampaignMinute,
        successes: latest.roll.successes,
        shardAwards: latest.shardAwards,
      } : null,
    },
  })
}

export interface ItemRepelPositioningDecisionV1 {
  readonly decisionId: string
  readonly sourceOperationId: string
  readonly canonicalItemId: 'Repel' | 'Super Repel' | 'Max Repel'
  readonly canonicalDefinitionSha256: string
  readonly sourceInstanceId: string
  readonly sourcePlacementId: string
  readonly targetPlacementId: string
  readonly maximumAffectedWildLevel: 15 | 25 | 35
  readonly accuracy: {
    readonly naturalRoll: number
    readonly userAccuracy: number
    readonly targetSpeedEvasion: number
    readonly accuracyCheck: number
    readonly hit: true
  }
  readonly status: 'pending-position'
}

export interface ItemExplorationEncounterStateV1 {
  readonly schemaVersion: typeof ITEM_EXPLORATION_SCHEMA_VERSION
  readonly repelPositioning: readonly ItemRepelPositioningDecisionV1[]
}

export const emptyItemExplorationEncounterState = (): ItemExplorationEncounterStateV1 => deepFreezeStrictJson({
  schemaVersion: ITEM_EXPLORATION_SCHEMA_VERSION,
  repelPositioning: [],
})

export const parseItemExplorationEncounterState = (value: unknown): ItemExplorationEncounterStateV1 => {
  if (value === undefined || value === null) return emptyItemExplorationEncounterState()
  const root = record(cloneStrictJson(value, 'itemExplorationEncounter', {
    limits: { depth: 8, nodes: 2_048, objectFields: 20, arrayEntries: 64, stringLength: 500, objectKeyLength: 100 },
    rootLabel: 'item exploration encounter state',
    valueLabel: 'item exploration encounter state values',
    failNotJson: (path, detail) => fail(path, detail),
    failLimit: (path, detail) => fail(path, detail),
  }), 'itemExplorationEncounter')
  exact(root, ['schemaVersion', 'repelPositioning'], 'itemExplorationEncounter')
  if (root.schemaVersion !== ITEM_EXPLORATION_SCHEMA_VERSION) fail('itemExplorationEncounter.schemaVersion', 'is unsupported.')
  const repelPositioning = array(root.repelPositioning, 'itemExplorationEncounter.repelPositioning', 32)
    .map((entry, index): ItemRepelPositioningDecisionV1 => {
      const path = `itemExplorationEncounter.repelPositioning[${index}]`
      const row = record(entry, path)
      exact(row, [
        'decisionId', 'sourceOperationId', 'canonicalItemId', 'canonicalDefinitionSha256',
        'sourceInstanceId', 'sourcePlacementId', 'targetPlacementId',
        'maximumAffectedWildLevel', 'accuracy', 'status',
      ], path)
      const canonicalItemId = enumText<ItemRepelPositioningDecisionV1['canonicalItemId']>(row.canonicalItemId, REPEL_ITEM_SET, `${path}.canonicalItemId`)
      const level = integer(row.maximumAffectedWildLevel, `${path}.maximumAffectedWildLevel`, 1, 100)
      const expectedLevel = canonicalItemId === 'Repel' ? 15 : canonicalItemId === 'Super Repel' ? 25 : 35
      const accuracy = record(row.accuracy, `${path}.accuracy`)
      exact(accuracy, ['naturalRoll', 'userAccuracy', 'targetSpeedEvasion', 'accuracyCheck', 'hit'], `${path}.accuracy`)
      const naturalRoll = integer(accuracy.naturalRoll, `${path}.accuracy.naturalRoll`, 1, 20)
      const userAccuracy = integer(accuracy.userAccuracy, `${path}.accuracy.userAccuracy`, -20, 20)
      const targetSpeedEvasion = integer(accuracy.targetSpeedEvasion, `${path}.accuracy.targetSpeedEvasion`, 0, 20)
      const accuracyCheck = integer(accuracy.accuracyCheck, `${path}.accuracy.accuracyCheck`, 6, 26)
      const hit = naturalRoll === 20 || (naturalRoll !== 1 && naturalRoll + userAccuracy >= accuracyCheck)
      if (level !== expectedLevel || accuracy.hit !== true || !hit || accuracyCheck !== 6 + targetSpeedEvasion
        || row.status !== 'pending-position') {
        fail(path, 'does not match a reviewed successful AC 6 Repel spray.')
      }
      return {
        decisionId: id(row.decisionId, `${path}.decisionId`),
        sourceOperationId: id(row.sourceOperationId, `${path}.sourceOperationId`),
        canonicalItemId,
        canonicalDefinitionSha256: hash(row.canonicalDefinitionSha256, `${path}.canonicalDefinitionSha256`),
        sourceInstanceId: text(row.sourceInstanceId, `${path}.sourceInstanceId`),
        sourcePlacementId: text(row.sourcePlacementId, `${path}.sourcePlacementId`),
        targetPlacementId: text(row.targetPlacementId, `${path}.targetPlacementId`),
        maximumAffectedWildLevel: level as 15 | 25 | 35,
        accuracy: { naturalRoll, userAccuracy, targetSpeedEvasion, accuracyCheck, hit: true },
        status: 'pending-position',
      }
    })
  unique(repelPositioning.map(row => row.decisionId), 'itemExplorationEncounter.repelPositioning.decisionId')
  unique(repelPositioning.map(row => row.sourceOperationId), 'itemExplorationEncounter.repelPositioning.sourceOperationId')
  unique(repelPositioning.map(row => row.targetPlacementId), 'itemExplorationEncounter.repelPositioning.targetPlacementId')
  return deepFreezeStrictJson({ schemaVersion: ITEM_EXPLORATION_SCHEMA_VERSION, repelPositioning })
}


export const ITEM_EXPLORATION_OPERATION_ID_PATTERN = /^item-exploration:v1:[a-f0-9]{32}$/

export interface ResolveItemRouteLureCheckCommandV1 {
  readonly schemaVersion: typeof ITEM_EXPLORATION_SCHEMA_VERSION
  readonly operationId: string
  readonly kind: 'resolve-route-lure-check'
  readonly trainerSlug: string
  readonly trainerRevision: number
  readonly campaignClockRevision: number
  readonly activityId: string
}

export interface SettleItemRouteLureCommandV1 {
  readonly schemaVersion: typeof ITEM_EXPLORATION_SCHEMA_VERSION
  readonly operationId: string
  readonly kind: 'settle-route-lure'
  readonly trainerSlug: string
  readonly trainerRevision: number
  readonly campaignClockRevision: number
  readonly activityId: string
  readonly outcome: 'encounter-introduced' | 'cancelled' | 'lure-lost'
  readonly encounterSelection: {
    readonly referenceId: string
    readonly comparablePartyLevelConfirmed: true
  } | null
}

export interface SettleItemDirectRepelCommandV1 {
  readonly schemaVersion: typeof ITEM_EXPLORATION_SCHEMA_VERSION
  readonly operationId: string
  readonly kind: 'settle-direct-repel'
  readonly mapSlug: string
  readonly mapRevision: number
  readonly decisionId: string
  readonly destination: {
    readonly x: number
    readonly y: number
    readonly z: number
  }
}

export type ItemExplorationOperationCommandV1 =
  | ResolveItemRouteLureCheckCommandV1
  | SettleItemRouteLureCommandV1
  | SettleItemDirectRepelCommandV1

export interface ItemExplorationOperationResultV1 {
  readonly schemaVersion: typeof ITEM_EXPLORATION_SCHEMA_VERSION
  readonly operationId: string
  readonly kind: ItemExplorationOperationCommandV1['kind']
  readonly status: 'accepted'
  readonly exactReplay: boolean
  readonly message: string
  readonly trainerSlug: string | null
  readonly trainerRevision: number | null
  readonly mapSlug: string | null
  readonly mapRevision: number | null
  readonly activity: ItemExplorationProjectionV1['routeLures'][number] | null
}

const operationId = (value: unknown, path: string): string => {
  const parsed = text(value, path)
  return ITEM_EXPLORATION_OPERATION_ID_PATTERN.test(parsed)
    ? parsed
    : fail(path, 'must be an item exploration operation ID.')
}

const slug = (value: unknown, path: string): string => {
  const parsed = text(value, path)
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parsed) ? parsed : fail(path, 'must be a canonical slug.')
}

const parseDestination = (value: unknown, path: string): SettleItemDirectRepelCommandV1['destination'] => {
  const row = record(value, path)
  exact(row, ['x', 'y', 'z'], path)
  return {
    x: integer(row.x, `${path}.x`, -1_000, 1_000),
    y: integer(row.y, `${path}.y`, -1_000, 1_000),
    z: integer(row.z, `${path}.z`, -1_000, 1_000),
  }
}

export const parseItemExplorationOperationCommand = (value: unknown): ItemExplorationOperationCommandV1 => {
  const root = record(clone(value), 'itemExplorationCommand')
  if (root.schemaVersion !== ITEM_EXPLORATION_SCHEMA_VERSION) fail('itemExplorationCommand.schemaVersion', 'is unsupported.')
  const kind = enumText<ItemExplorationOperationCommandV1['kind']>(
    root.kind,
    new Set(['resolve-route-lure-check', 'settle-route-lure', 'settle-direct-repel']),
    'itemExplorationCommand.kind',
  )
  if (kind === 'settle-direct-repel') {
    exact(root, ['schemaVersion', 'operationId', 'kind', 'mapSlug', 'mapRevision', 'decisionId', 'destination'], 'itemExplorationCommand')
    return deepFreezeStrictJson({
      schemaVersion: 1,
      operationId: operationId(root.operationId, 'itemExplorationCommand.operationId'),
      kind,
      mapSlug: slug(root.mapSlug, 'itemExplorationCommand.mapSlug'),
      mapRevision: integer(root.mapRevision, 'itemExplorationCommand.mapRevision'),
      decisionId: id(root.decisionId, 'itemExplorationCommand.decisionId'),
      destination: parseDestination(root.destination, 'itemExplorationCommand.destination'),
    })
  }
  const baseFields = ['schemaVersion', 'operationId', 'kind', 'trainerSlug', 'trainerRevision', 'campaignClockRevision', 'activityId']
  if (kind === 'resolve-route-lure-check') {
    exact(root, baseFields, 'itemExplorationCommand')
    return deepFreezeStrictJson({
      schemaVersion: 1,
      operationId: operationId(root.operationId, 'itemExplorationCommand.operationId'),
      kind,
      trainerSlug: slug(root.trainerSlug, 'itemExplorationCommand.trainerSlug'),
      trainerRevision: integer(root.trainerRevision, 'itemExplorationCommand.trainerRevision'),
      campaignClockRevision: integer(root.campaignClockRevision, 'itemExplorationCommand.campaignClockRevision'),
      activityId: id(root.activityId, 'itemExplorationCommand.activityId'),
    })
  }
  exact(root, [...baseFields, 'outcome', 'encounterSelection'], 'itemExplorationCommand')
  const outcome = enumText<SettleItemRouteLureCommandV1['outcome']>(
    root.outcome,
    new Set(['encounter-introduced', 'cancelled', 'lure-lost']),
    'itemExplorationCommand.outcome',
  )
  let encounterSelection: SettleItemRouteLureCommandV1['encounterSelection'] = null
  if (root.encounterSelection !== null) {
    const selection = record(root.encounterSelection, 'itemExplorationCommand.encounterSelection')
    exact(selection, ['referenceId', 'comparablePartyLevelConfirmed'], 'itemExplorationCommand.encounterSelection')
    if (selection.comparablePartyLevelConfirmed !== true) {
      fail('itemExplorationCommand.encounterSelection.comparablePartyLevelConfirmed', 'must be exact GM confirmation.')
    }
    encounterSelection = {
      referenceId: id(selection.referenceId, 'itemExplorationCommand.encounterSelection.referenceId'),
      comparablePartyLevelConfirmed: true,
    }
  }
  if ((outcome === 'encounter-introduced') !== (encounterSelection !== null)) {
    fail('itemExplorationCommand.encounterSelection', 'is required only for an introduced encounter.')
  }
  return deepFreezeStrictJson({
    schemaVersion: 1,
    operationId: operationId(root.operationId, 'itemExplorationCommand.operationId'),
    kind,
    trainerSlug: slug(root.trainerSlug, 'itemExplorationCommand.trainerSlug'),
    trainerRevision: integer(root.trainerRevision, 'itemExplorationCommand.trainerRevision'),
    campaignClockRevision: integer(root.campaignClockRevision, 'itemExplorationCommand.campaignClockRevision'),
    activityId: id(root.activityId, 'itemExplorationCommand.activityId'),
    outcome,
    encounterSelection,
  })
}

const parseProjectedActivity = (
  value: unknown,
): ItemExplorationProjectionV1['routeLures'][number] => {
  const row = record(value, 'itemExplorationResult.activity')
  exact(row, [
    'activityId', 'itemLabel', 'status', 'attemptsResolved', 'maximumAttempts',
    'nextCheckAtCampaignMinute', 'outcome', 'canResolveCheck', 'needsGmEncounter', 'reusable',
  ], 'itemExplorationResult.activity')
  return {
    activityId: id(row.activityId, 'itemExplorationResult.activity.activityId'),
    itemLabel: text(row.itemLabel, 'itemExplorationResult.activity.itemLabel'),
    status: enumText<ItemRouteLureActivityV1['status']>(row.status, ROUTE_STATUS_SET, 'itemExplorationResult.activity.status'),
    attemptsResolved: integer(row.attemptsResolved, 'itemExplorationResult.activity.attemptsResolved', 0, 3),
    maximumAttempts: integer(row.maximumAttempts, 'itemExplorationResult.activity.maximumAttempts', 3, 3) as 3,
    nextCheckAtCampaignMinute: nullable(row.nextCheckAtCampaignMinute, entry => integer(entry, 'itemExplorationResult.activity.nextCheckAtCampaignMinute')),
    outcome: nullable(row.outcome, entry => enumText<NonNullable<ItemRouteLureActivityV1['outcome']>>(entry, ROUTE_OUTCOME_SET, 'itemExplorationResult.activity.outcome')),
    canResolveCheck: bool(row.canResolveCheck, 'itemExplorationResult.activity.canResolveCheck'),
    needsGmEncounter: bool(row.needsGmEncounter, 'itemExplorationResult.activity.needsGmEncounter'),
    reusable: bool(row.reusable, 'itemExplorationResult.activity.reusable'),
  }
}

export const parseItemExplorationOperationResult = (value: unknown): ItemExplorationOperationResultV1 => {
  const root = record(clone(value), 'itemExplorationResult')
  exact(root, [
    'schemaVersion', 'operationId', 'kind', 'status', 'exactReplay', 'message',
    'trainerSlug', 'trainerRevision', 'mapSlug', 'mapRevision', 'activity',
  ], 'itemExplorationResult')
  if (root.schemaVersion !== ITEM_EXPLORATION_SCHEMA_VERSION || root.status !== 'accepted') {
    fail('itemExplorationResult', 'must be an accepted schema-v1 result.')
  }
  const kind = enumText<ItemExplorationOperationCommandV1['kind']>(
    root.kind,
    new Set(['resolve-route-lure-check', 'settle-route-lure', 'settle-direct-repel']),
    'itemExplorationResult.kind',
  )
  const trainerSlug = nullable(root.trainerSlug, entry => slug(entry, 'itemExplorationResult.trainerSlug'))
  const trainerRevision = nullable(root.trainerRevision, entry => integer(entry, 'itemExplorationResult.trainerRevision'))
  const mapSlug = nullable(root.mapSlug, entry => slug(entry, 'itemExplorationResult.mapSlug'))
  const mapRevision = nullable(root.mapRevision, entry => integer(entry, 'itemExplorationResult.mapRevision'))
  const activity = nullable(root.activity, parseProjectedActivity)
  if (kind === 'settle-direct-repel'
    ? trainerSlug !== null || trainerRevision !== null || mapSlug === null || mapRevision === null || activity !== null
    : trainerSlug === null || trainerRevision === null || mapSlug !== null || mapRevision !== null || activity === null) {
    fail('itemExplorationResult', 'aggregate fields do not match the operation kind.')
  }
  return deepFreezeStrictJson({
    schemaVersion: 1,
    operationId: operationId(root.operationId, 'itemExplorationResult.operationId'),
    kind,
    status: 'accepted',
    exactReplay: bool(root.exactReplay, 'itemExplorationResult.exactReplay'),
    message: text(root.message, 'itemExplorationResult.message'),
    trainerSlug,
    trainerRevision,
    mapSlug,
    mapRevision,
    activity,
  })
}
