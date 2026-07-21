import type { AbilitySpecJsonObject } from './spec'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_MECHANIC_OPERATION_KIND = 'ability-mechanic' as const
export const AA060_ABILITY_MECHANIC_IDS = [
  'aa060.abominable', 'aa060.absorb-force', 'aa060.accelerate', 'aa060.adaptability',
  'aa060.aerilate', 'aa060.aftermath', 'aa060.air-lock', 'aa060.ambush',
  'aa060.analytic', 'aa060.anchored', 'aa060.anger-point', 'aa060.anticipation',
] as const
export const AA061_ABILITY_MECHANIC_IDS = [
  'aa061.aqua-boost', 'aa061.aqua-bullet', 'aa061.arena-trap', 'aa061.arena-trap-end',
  'aa061.aroma-veil', 'aa061.aura-break', 'aa061.aura-storm', 'aa061.bad-dreams',
  'aa061.ball-fetch', 'aa061.battery', 'aa061.battle-armor', 'aa061.beam-cannon',
  'aa061.beast-boost',
] as const
export const AA062_ABILITY_MECHANIC_IDS = [
  'aa062.beautiful-battle', 'aa062.beautiful-contest', 'aa062.berry-storage',
  'aa062.berserk', 'aa062.big-pecks', 'aa062.big-swallow', 'aa062.blaze',
  'aa062.blessed-touch', 'aa062.blow-away', 'aa062.blur', 'aa062.bodyguard',
  'aa062.bone-lord-passive', 'aa062.bone-lord-empower', 'aa062.bone-wielder',
] as const
export const AA063_ABILITY_MECHANIC_IDS = [
  'aa063.brimstone', 'aa063.bulletproof', 'aa063.bully', 'aa063.cave-crasher',
  'aa063.celebrate', 'aa063.chemical-romance', 'aa063.cherry-power',
  'aa063.chilling-neigh', 'aa063.chlorophyll', 'aa063.clay-cannons',
  'aa063.clear-body', 'aa063.cloud-nine',
] as const
export type Aa060AbilityMechanicId = (typeof AA060_ABILITY_MECHANIC_IDS)[number]
export type AbilityMechanicId = Aa060AbilityMechanicId
  | (typeof AA061_ABILITY_MECHANIC_IDS)[number]
  | (typeof AA062_ABILITY_MECHANIC_IDS)[number]
  | (typeof AA063_ABILITY_MECHANIC_IDS)[number]
export interface AbilityMechanicOperation extends AbilitySpecJsonObject {
  readonly kind: typeof ABILITY_MECHANIC_OPERATION_KIND
  readonly id: string
  readonly mechanicId: AbilityMechanicId
  readonly config: AbilitySpecJsonObject
}
export class AbilityMechanicValidationError extends Error {
  constructor(readonly code: 'invalid-mechanic' | 'limit-exceeded' | 'not-json', readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityMechanicValidationError'
  }
}
type UnknownRecord = Record<string, unknown>
const ROOT_FIELDS = ['kind', 'id', 'mechanicId', 'config'] as const
const CONFIG_FIELDS: Readonly<Record<AbilityMechanicId, readonly string[]>> = {
  'aa060.abominable': ['baseHpBonus', 'ignoreRecoil'],
  'aa060.absorb-force': ['damageClass', 'resistanceSteps'],
  'aa060.accelerate': ['requiresDamaging', 'requiresStab', 'speedNumerator', 'speedDenominator', 'existingPriorityAccuracyBonus'],
  'aa060.adaptability': ['requiresStab', 'bonusDiceCount', 'bonusDiceSides'],
  'aa060.aerilate': ['fromType', 'toType', 'requiresDamaging'],
  'aa060.aftermath': ['burstSize', 'tickLoss'],
  'aa060.air-lock': ['weatherKind', 'sustainAction'],
  'aa060.ambush': ['maximumDamageBase', 'accuracyPenalty', 'durationRounds', 'conditionId'],
  'aa060.analytic': ['damageBonus', 'requiresTargetActedEarlier'],
  'aa060.anchored': ['maximumDistance', 'anchorShiftAction', 'attackRangeId', 'bonusDiceCount', 'bonusDiceSides', 'forcePhysical'],
  'aa060.anger-point': ['attackStages', 'conditionId'],
  'aa060.anticipation': ['usesPerTargetPerEncounter', 'revealSpecificMoves'],
  'aa061.aqua-boost': ['moveType', 'adjacency', 'damageBonus', 'maximumProviders'],
  'aa061.aqua-bullet': ['connectionMoveId', 'moveType', 'action', 'skySpeed', 'movementShape', 'movementTiming', 'provokeAttacksOfOpportunity'],
  'aa061.arena-trap': ['radius', 'conditions', 'excludeTypes', 'excludeCapabilities'],
  'aa061.arena-trap-end': [],
  'aa061.aroma-veil': ['adjacency', 'conditions', 'includeSelf'],
  'aa061.aura-break': ['maximumRange', 'invertDamageBaseBonuses', 'invertDamageRollBonuses'],
  'aa061.aura-storm': ['damageBonusPerInjury'],
  'aa061.bad-dreams': ['radius', 'requiredCondition', 'targetTickLoss', 'healTemporaryOnAnyLoss', 'userTemporaryTickGain'],
  'aa061.ball-fetch': ['movementLimit', 'action', 'mustEndCloser'],
  'aa061.battery': ['adjacency', 'damageClass', 'baseBonus', 'electricBonus', 'consumeOnNextEligibleAttack'],
  'aa061.battle-armor': ['preventCriticalHits'],
  'aa061.beam-cannon': ['requiredRange', 'effectRangeIncrease', 'criticalRangeIncrease'],
  'aa061.beast-boost': ['stageIncrease', 'statScope', 'tieResolution'],
  'aa062.beautiful-battle': ['branch', 'action', 'frequency', 'specialAttackStages', 'allyRadius', 'curedConditions'],
  'aa062.beautiful-contest': ['branch', 'action', 'frequency', 'contestStat', 'bonusDice'],
  'aa062.berry-storage': ['itemCategory', 'storedBuffInstances', 'sceneTradeLimit', 'ignoreNormalDigestionLimits', 'expiresAt'],
  'aa062.berserk': ['firstHalfHpCrossingPerEncounter', 'enragedAlwaysTriggers', 'specialAttackStages'],
  'aa062.big-pecks': ['protectedStat', 'preventStatLowering', 'preventCombatStageLowering'],
  'aa062.big-swallow': ['connectionMoveId', 'affectedMoveIds', 'virtualCountBonus', 'maximumStockpileCount'],
  'aa062.blaze': ['moveType', 'normalDamageBonus', 'lowHpDamageBonus', 'lowHpThreshold'],
  'aa062.blessed-touch': ['action', 'frequency', 'adjacency', 'healing'],
  'aa062.blow-away': ['connectionMoveId', 'additionalPushMeters', 'hitPointLossTicks'],
  'aa062.blur': ['appliesToMovesWithoutAccuracyCheck', 'imposedAccuracyCheck', 'targetEvasionMultiplier'],
  'aa062.bodyguard': ['adjacency', 'action', 'frequency', 'swapPositions', 'redirectAttack', 'resistanceSteps', 'areaEscapeRequired'],
  'aa062.bone-lord-passive': ['connectionMoveId', 'eligibleMoveIds'],
  'aa062.bone-lord-empower': ['action', 'usage', 'eligibleMoveIds', 'boneClubStageLosses', 'bonemerangRange', 'removeKeyword', 'boneRushAutomaticHits'],
  'aa062.bone-wielder': ['moveIds', 'moveType', 'ignoreTypeImmunity'],
  'aa063.brimstone': ['damagingAttackTypes', 'triggeringConditions', 'resultingConditions'],
  'aa063.bulletproof': ['resistanceSteps', 'rangedOnly', 'directTargetOnly', 'excludedAreaKinds'],
  'aa063.bully': ['action', 'frequency', 'meleeOnly', 'superEffectiveOnly', 'pushMeters', 'conditions', 'injuries'],
  'aa063.cave-crasher': ['resistedMoveTypes', 'resistanceSteps'],
  'aa063.celebrate': ['action', 'frequency', 'damagingOnly', 'targetRelationship', 'disengageDistance', 'disengageAction', 'opportunityAttacks'],
  'aa063.chemical-romance': ['connectionMoveId', 'triggeringMoveIds', 'targetGender', 'condition', 'sourceBound'],
  'aa063.cherry-power': ['action', 'frequency', 'temporaryHitPoints', 'curedConditionGroup'],
  'aa063.chilling-neigh': ['action', 'frequency', 'damagingOnly', 'faintedRelationship', 'attackStages', 'foeRadius', 'evasionPenalty', 'duration'],
  'aa063.chlorophyll': ['initiativeMultiplier', 'weather', 'alternativeHpThreshold'],
  'aa063.clay-cannons': ['action', 'frequency', 'duration', 'rangedMovesOnly', 'virtualOriginRadius', 'chooseOriginPerMove'],
  'aa063.clear-body': ['preventCombatStageLoweringFrom', 'statusAfflictionStageChangesAllowed'],
  'aa063.cloud-nine': ['action', 'frequency', 'weatherResult', 'removeAllWeatherZones'],
}
const MECHANIC_SET = new Set<string>([
  ...AA060_ABILITY_MECHANIC_IDS, ...AA061_ABILITY_MECHANIC_IDS,
  ...AA062_ABILITY_MECHANIC_IDS, ...AA063_ABILITY_MECHANIC_IDS,
])
const ID = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const fail = (code: AbilityMechanicValidationError['code'], path: string, detail: string): never => { throw new AbilityMechanicValidationError(code, path, detail) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail('invalid-mechanic', path, 'must be an object.')
  return value as UnknownRecord
}
const exact = (input: UnknownRecord, fields: readonly string[], path: string): void => {
  const set = new Set(fields)
  if (fields.some(field => !Object.prototype.hasOwnProperty.call(input, field))
    || Object.keys(input).some(field => !set.has(field))) fail('invalid-mechanic', path, 'has invalid shape.')
}
const integer = (value: unknown, path: string, minimum = 0, maximum = 10_000): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) fail('invalid-mechanic', path, `must be an integer from ${minimum} through ${maximum}.`)
  return Number(value)
}
const bool = (value: unknown, path: string): boolean => typeof value === 'boolean' ? value : fail('invalid-mechanic', path, 'must be boolean.')
const exactNumber = (value: unknown, expected: number, path: string): number => (
  typeof value === 'number' && Number.isFinite(value) && value === expected
    ? value
    : fail('invalid-mechanic', path, `must equal ${expected}.`)
)
const stableId = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200 || !ID.test(value)) fail('invalid-mechanic', path, 'must be a stable ID.')
  return value as string
}
const oneOf = <T extends string>(value: unknown, values: readonly T[], path: string): T => (
  typeof value === 'string' && values.includes(value as T) ? value as T : fail('invalid-mechanic', path, 'is unsupported.')
)
const stringArray = (value: unknown, expected: readonly string[], path: string): readonly string[] => {
  if (!Array.isArray(value) || value.length !== expected.length
    || value.some((entry, index) => entry !== expected[index])) fail('invalid-mechanic', path, 'must match the reviewed canonical values.')
  return Object.freeze([...expected])
}
const diceBonus = (value: unknown, expected: { diceCount: number; diceSides: number; modifier: number }, path: string): AbilitySpecJsonObject => {
  const input = record(value, path)
  exact(input, ['diceCount', 'diceSides', 'modifier'], path)
  if (integer(input.diceCount, `${path}.diceCount`, 1, 20) !== expected.diceCount
    || integer(input.diceSides, `${path}.diceSides`, 2, 100) !== expected.diceSides
    || integer(input.modifier, `${path}.modifier`, 0, 100) !== expected.modifier) fail('invalid-mechanic', path, 'does not match the reviewed bonus.')
  return { ...expected }
}
const parseConfig = (mechanicId: AbilityMechanicId, value: unknown, path: string): AbilitySpecJsonObject => {
  const config = record(value, path)
  exact(config, CONFIG_FIELDS[mechanicId], path)
  switch (mechanicId) {
    case 'aa060.abominable': return { baseHpBonus: integer(config.baseHpBonus, `${path}.baseHpBonus`, 1, 100), ignoreRecoil: bool(config.ignoreRecoil, `${path}.ignoreRecoil`) }
    case 'aa060.absorb-force': return { damageClass: oneOf(config.damageClass, ['physical'], `${path}.damageClass`), resistanceSteps: integer(config.resistanceSteps, `${path}.resistanceSteps`, 1, 8) }
    case 'aa060.accelerate': return {
      requiresDamaging: bool(config.requiresDamaging, `${path}.requiresDamaging`), requiresStab: bool(config.requiresStab, `${path}.requiresStab`),
      speedNumerator: integer(config.speedNumerator, `${path}.speedNumerator`, 1, 100), speedDenominator: integer(config.speedDenominator, `${path}.speedDenominator`, 1, 100),
      existingPriorityAccuracyBonus: integer(config.existingPriorityAccuracyBonus, `${path}.existingPriorityAccuracyBonus`, 0, 20),
    }
    case 'aa060.adaptability': return { requiresStab: bool(config.requiresStab, `${path}.requiresStab`), bonusDiceCount: integer(config.bonusDiceCount, `${path}.bonusDiceCount`, 1, 20), bonusDiceSides: integer(config.bonusDiceSides, `${path}.bonusDiceSides`, 2, 100) }
    case 'aa060.aerilate': return { fromType: oneOf(config.fromType, ['normal'], `${path}.fromType`), toType: oneOf(config.toType, ['flying'], `${path}.toType`), requiresDamaging: bool(config.requiresDamaging, `${path}.requiresDamaging`) }
    case 'aa060.aftermath': return { burstSize: integer(config.burstSize, `${path}.burstSize`, 1, 100), tickLoss: integer(config.tickLoss, `${path}.tickLoss`, 1, 100) }
    case 'aa060.air-lock': return { weatherKind: oneOf(config.weatherKind, ['normal'], `${path}.weatherKind`), sustainAction: oneOf(config.sustainAction, ['swift'], `${path}.sustainAction`) }
    case 'aa060.ambush': return {
      maximumDamageBase: integer(config.maximumDamageBase, `${path}.maximumDamageBase`, 0, 100), accuracyPenalty: integer(config.accuracyPenalty, `${path}.accuracyPenalty`, -20, -1),
      durationRounds: integer(config.durationRounds, `${path}.durationRounds`, 1, 100), conditionId: stableId(config.conditionId, `${path}.conditionId`),
    }
    case 'aa060.analytic': return { damageBonus: integer(config.damageBonus, `${path}.damageBonus`, 1, 1_000), requiresTargetActedEarlier: bool(config.requiresTargetActedEarlier, `${path}.requiresTargetActedEarlier`) }
    case 'aa060.anchored': return {
      maximumDistance: integer(config.maximumDistance, `${path}.maximumDistance`, 1, 100), anchorShiftAction: oneOf(config.anchorShiftAction, ['swift'], `${path}.anchorShiftAction`),
      attackRangeId: stableId(config.attackRangeId, `${path}.attackRangeId`), bonusDiceCount: integer(config.bonusDiceCount, `${path}.bonusDiceCount`, 1, 20),
      bonusDiceSides: integer(config.bonusDiceSides, `${path}.bonusDiceSides`, 2, 100), forcePhysical: bool(config.forcePhysical, `${path}.forcePhysical`),
    }
    case 'aa060.anger-point': return { attackStages: integer(config.attackStages, `${path}.attackStages`, 1, 6), conditionId: stableId(config.conditionId, `${path}.conditionId`) }
    case 'aa060.anticipation': return { usesPerTargetPerEncounter: integer(config.usesPerTargetPerEncounter, `${path}.usesPerTargetPerEncounter`, 1, 10), revealSpecificMoves: bool(config.revealSpecificMoves, `${path}.revealSpecificMoves`) }
    case 'aa061.aqua-boost': return {
      moveType: oneOf(config.moveType, ['water'], `${path}.moveType`), adjacency: integer(config.adjacency, `${path}.adjacency`, 1, 1),
      damageBonus: integer(config.damageBonus, `${path}.damageBonus`, 5, 5), maximumProviders: integer(config.maximumProviders, `${path}.maximumProviders`, 1, 1),
    }
    case 'aa061.aqua-bullet': return {
      connectionMoveId: oneOf(config.connectionMoveId, ['Aqua Jet'], `${path}.connectionMoveId`), moveType: oneOf(config.moveType, ['water'], `${path}.moveType`),
      action: oneOf(config.action, ['full'], `${path}.action`), skySpeed: integer(config.skySpeed, `${path}.skySpeed`, 10, 10),
      movementShape: oneOf(config.movementShape, ['straight-line'], `${path}.movementShape`), movementTiming: oneOf(config.movementTiming, ['before-move'], `${path}.movementTiming`),
      provokeAttacksOfOpportunity: bool(config.provokeAttacksOfOpportunity, `${path}.provokeAttacksOfOpportunity`),
    }
    case 'aa061.arena-trap': {
      const capabilities = config.excludeCapabilities
      if (!Array.isArray(capabilities) || capabilities.length !== 3) fail('invalid-mechanic', `${path}.excludeCapabilities`, 'must contain three reviewed capability exclusions.')
      const parsedCapabilities = (capabilities as unknown[]).map((entry: unknown, index: number) => {
        const item = record(entry, `${path}.excludeCapabilities[${index}]`)
        exact(item, ['kind', 'minimum'], `${path}.excludeCapabilities[${index}]`)
        const kinds = ['levitate', 'sky', 'burrow'] as const
        return { kind: oneOf(item.kind, [kinds[index]!], `${path}.excludeCapabilities[${index}].kind`), minimum: integer(item.minimum, `${path}.excludeCapabilities[${index}].minimum`, 4, 4) }
      })
      return {
        radius: integer(config.radius, `${path}.radius`, 5, 5),
        conditions: stringArray(config.conditions, ['slowed', 'trapped'], `${path}.conditions`),
        excludeTypes: stringArray(config.excludeTypes, ['flying'], `${path}.excludeTypes`),
        excludeCapabilities: parsedCapabilities,
      }
    }
    case 'aa061.arena-trap-end': return {}
    case 'aa061.aroma-veil': return {
      adjacency: integer(config.adjacency, `${path}.adjacency`, 1, 1),
      conditions: stringArray(config.conditions, ['confused', 'enraged', 'suppressed'], `${path}.conditions`),
      includeSelf: bool(config.includeSelf, `${path}.includeSelf`),
    }
    case 'aa061.aura-break': return {
      maximumRange: integer(config.maximumRange, `${path}.maximumRange`, 6, 6),
      invertDamageBaseBonuses: bool(config.invertDamageBaseBonuses, `${path}.invertDamageBaseBonuses`),
      invertDamageRollBonuses: bool(config.invertDamageRollBonuses, `${path}.invertDamageRollBonuses`),
    }
    case 'aa061.aura-storm': return { damageBonusPerInjury: integer(config.damageBonusPerInjury, `${path}.damageBonusPerInjury`, 3, 3) }
    case 'aa061.bad-dreams': return {
      radius: integer(config.radius, `${path}.radius`, 5, 5), requiredCondition: oneOf(config.requiredCondition, ['sleep'], `${path}.requiredCondition`),
      targetTickLoss: integer(config.targetTickLoss, `${path}.targetTickLoss`, 1, 1), healTemporaryOnAnyLoss: bool(config.healTemporaryOnAnyLoss, `${path}.healTemporaryOnAnyLoss`),
      userTemporaryTickGain: integer(config.userTemporaryTickGain, `${path}.userTemporaryTickGain`, 1, 1),
    }
    case 'aa061.ball-fetch': return {
      movementLimit: oneOf(config.movementLimit, ['speed'], `${path}.movementLimit`), action: oneOf(config.action, ['free'], `${path}.action`),
      mustEndCloser: bool(config.mustEndCloser, `${path}.mustEndCloser`),
    }
    case 'aa061.battery': return {
      adjacency: integer(config.adjacency, `${path}.adjacency`, 1, 1), damageClass: oneOf(config.damageClass, ['special'], `${path}.damageClass`),
      baseBonus: diceBonus(config.baseBonus, { diceCount: 2, diceSides: 6, modifier: 4 }, `${path}.baseBonus`),
      electricBonus: diceBonus(config.electricBonus, { diceCount: 3, diceSides: 6, modifier: 6 }, `${path}.electricBonus`),
      consumeOnNextEligibleAttack: bool(config.consumeOnNextEligibleAttack, `${path}.consumeOnNextEligibleAttack`),
    }
    case 'aa061.battle-armor': return { preventCriticalHits: bool(config.preventCriticalHits, `${path}.preventCriticalHits`) }
    case 'aa061.beam-cannon': return {
      requiredRange: oneOf(config.requiredRange, ['ranged-one-target'], `${path}.requiredRange`),
      effectRangeIncrease: integer(config.effectRangeIncrease, `${path}.effectRangeIncrease`, 3, 3),
      criticalRangeIncrease: integer(config.criticalRangeIncrease, `${path}.criticalRangeIncrease`, 3, 3),
    }
    case 'aa061.beast-boost': return {
      stageIncrease: integer(config.stageIncrease, `${path}.stageIncrease`, 1, 1), statScope: oneOf(config.statScope, ['highest-non-hp'], `${path}.statScope`),
      tieResolution: oneOf(config.tieResolution, ['choice'], `${path}.tieResolution`),
    }
    case 'aa062.beautiful-battle': return {
      branch: oneOf(config.branch, ['battle'], `${path}.branch`), action: oneOf(config.action, ['standard'], `${path}.action`),
      frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`), specialAttackStages: integer(config.specialAttackStages, `${path}.specialAttackStages`, 1, 1),
      allyRadius: integer(config.allyRadius, `${path}.allyRadius`, 5, 5), curedConditions: stringArray(config.curedConditions, ['enraged'], `${path}.curedConditions`),
    }
    case 'aa062.beautiful-contest': return {
      branch: oneOf(config.branch, ['contest'], `${path}.branch`), action: oneOf(config.action, ['standard'], `${path}.action`),
      frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`), contestStat: oneOf(config.contestStat, ['beauty'], `${path}.contestStat`),
      bonusDice: integer(config.bonusDice, `${path}.bonusDice`, 2, 2),
    }
    case 'aa062.berry-storage': return {
      itemCategory: oneOf(config.itemCategory, ['berry'], `${path}.itemCategory`), storedBuffInstances: integer(config.storedBuffInstances, `${path}.storedBuffInstances`, 3, 3),
      sceneTradeLimit: integer(config.sceneTradeLimit, `${path}.sceneTradeLimit`, 1, 1), ignoreNormalDigestionLimits: bool(config.ignoreNormalDigestionLimits, `${path}.ignoreNormalDigestionLimits`),
      expiresAt: oneOf(config.expiresAt, ['extended-rest'], `${path}.expiresAt`),
    }
    case 'aa062.berserk': return {
      firstHalfHpCrossingPerEncounter: bool(config.firstHalfHpCrossingPerEncounter, `${path}.firstHalfHpCrossingPerEncounter`),
      enragedAlwaysTriggers: bool(config.enragedAlwaysTriggers, `${path}.enragedAlwaysTriggers`),
      specialAttackStages: integer(config.specialAttackStages, `${path}.specialAttackStages`, 1, 1),
    }
    case 'aa062.big-pecks': return {
      protectedStat: oneOf(config.protectedStat, ['defense'], `${path}.protectedStat`), preventStatLowering: bool(config.preventStatLowering, `${path}.preventStatLowering`),
      preventCombatStageLowering: bool(config.preventCombatStageLowering, `${path}.preventCombatStageLowering`),
    }
    case 'aa062.big-swallow': return {
      connectionMoveId: oneOf(config.connectionMoveId, ['Stockpile'], `${path}.connectionMoveId`),
      affectedMoveIds: stringArray(config.affectedMoveIds, ['Spit Up', 'Swallow'], `${path}.affectedMoveIds`),
      virtualCountBonus: integer(config.virtualCountBonus, `${path}.virtualCountBonus`, 1, 1), maximumStockpileCount: integer(config.maximumStockpileCount, `${path}.maximumStockpileCount`, 3, 3),
    }
    case 'aa062.blaze': {
      const threshold = record(config.lowHpThreshold, `${path}.lowHpThreshold`)
      exact(threshold, ['numerator', 'denominator'], `${path}.lowHpThreshold`)
      return {
        moveType: oneOf(config.moveType, ['fire'], `${path}.moveType`), normalDamageBonus: integer(config.normalDamageBonus, `${path}.normalDamageBonus`, 5, 5),
        lowHpDamageBonus: integer(config.lowHpDamageBonus, `${path}.lowHpDamageBonus`, 10, 10),
        lowHpThreshold: { numerator: integer(threshold.numerator, `${path}.lowHpThreshold.numerator`, 1, 1), denominator: integer(threshold.denominator, `${path}.lowHpThreshold.denominator`, 3, 3) },
      }
    }
    case 'aa062.blessed-touch': {
      const healing = record(config.healing, `${path}.healing`)
      exact(healing, ['kind', 'numerator', 'denominator'], `${path}.healing`)
      return {
        action: oneOf(config.action, ['standard'], `${path}.action`), frequency: oneOf(config.frequency, ['daily-x2'], `${path}.frequency`),
        adjacency: integer(config.adjacency, `${path}.adjacency`, 1, 1), healing: {
          kind: oneOf(healing.kind, ['fraction-max-hp'], `${path}.healing.kind`), numerator: integer(healing.numerator, `${path}.healing.numerator`, 1, 1), denominator: integer(healing.denominator, `${path}.healing.denominator`, 4, 4),
        },
      }
    }
    case 'aa062.blow-away': return {
      connectionMoveId: oneOf(config.connectionMoveId, ['Whirlwind'], `${path}.connectionMoveId`), additionalPushMeters: integer(config.additionalPushMeters, `${path}.additionalPushMeters`, 2, 2),
      hitPointLossTicks: integer(config.hitPointLossTicks, `${path}.hitPointLossTicks`, 1, 1),
    }
    case 'aa062.blur': return {
      appliesToMovesWithoutAccuracyCheck: bool(config.appliesToMovesWithoutAccuracyCheck, `${path}.appliesToMovesWithoutAccuracyCheck`),
      imposedAccuracyCheck: integer(config.imposedAccuracyCheck, `${path}.imposedAccuracyCheck`, 2, 2),
      targetEvasionMultiplier: exactNumber(config.targetEvasionMultiplier, 0.5, `${path}.targetEvasionMultiplier`),
    }
    case 'aa062.bodyguard': return {
      adjacency: integer(config.adjacency, `${path}.adjacency`, 1, 1), action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['scene-x2'], `${path}.frequency`),
      swapPositions: bool(config.swapPositions, `${path}.swapPositions`), redirectAttack: bool(config.redirectAttack, `${path}.redirectAttack`), resistanceSteps: integer(config.resistanceSteps, `${path}.resistanceSteps`, 1, 1),
      areaEscapeRequired: bool(config.areaEscapeRequired, `${path}.areaEscapeRequired`),
    }
    case 'aa062.bone-lord-passive': return {
      connectionMoveId: oneOf(config.connectionMoveId, ['Bonemerang'], `${path}.connectionMoveId`), eligibleMoveIds: stringArray(config.eligibleMoveIds, ['Bone Club', 'Bone Rush', 'Bonemerang'], `${path}.eligibleMoveIds`),
    }
    case 'aa062.bone-lord-empower': {
      const losses = record(config.boneClubStageLosses, `${path}.boneClubStageLosses`)
      exact(losses, ['defense', 'specialAttack'], `${path}.boneClubStageLosses`)
      return {
        action: oneOf(config.action, ['free'], `${path}.action`), usage: oneOf(config.usage, ['scene-per-move'], `${path}.usage`),
        eligibleMoveIds: stringArray(config.eligibleMoveIds, ['Bone Club', 'Bone Rush', 'Bonemerang'], `${path}.eligibleMoveIds`),
        boneClubStageLosses: { defense: integer(losses.defense, `${path}.boneClubStageLosses.defense`, 1, 1), specialAttack: integer(losses.specialAttack, `${path}.boneClubStageLosses.specialAttack`, 1, 1) },
        bonemerangRange: oneOf(config.bonemerangRange, ['line-6'], `${path}.bonemerangRange`), removeKeyword: oneOf(config.removeKeyword, ['double-strike'], `${path}.removeKeyword`),
        boneRushAutomaticHits: integer(config.boneRushAutomaticHits, `${path}.boneRushAutomaticHits`, 4, 4),
      }
    }
    case 'aa062.bone-wielder': return {
      moveIds: stringArray(config.moveIds, ['Bone Club', 'Bone Rush', 'Bonemerang'], `${path}.moveIds`), moveType: oneOf(config.moveType, ['ground'], `${path}.moveType`),
      ignoreTypeImmunity: bool(config.ignoreTypeImmunity, `${path}.ignoreTypeImmunity`),
    }
    case 'aa063.brimstone': return {
      damagingAttackTypes: stringArray(config.damagingAttackTypes, ['fire', 'poison'], `${path}.damagingAttackTypes`),
      triggeringConditions: stringArray(config.triggeringConditions, ['burned', 'poisoned', 'badly-poisoned'], `${path}.triggeringConditions`),
      resultingConditions: stringArray(config.resultingConditions, ['burned', 'poisoned'], `${path}.resultingConditions`),
    }
    case 'aa063.bulletproof': return {
      resistanceSteps: integer(config.resistanceSteps, `${path}.resistanceSteps`, 1, 1), rangedOnly: bool(config.rangedOnly, `${path}.rangedOnly`),
      directTargetOnly: bool(config.directTargetOnly, `${path}.directTargetOnly`),
      excludedAreaKinds: stringArray(config.excludedAreaKinds, ['burst', 'cardinally-adjacent', 'cone', 'line', 'close-blast', 'ranged-blast', 'pass'], `${path}.excludedAreaKinds`),
    }
    case 'aa063.bully': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      meleeOnly: bool(config.meleeOnly, `${path}.meleeOnly`), superEffectiveOnly: bool(config.superEffectiveOnly, `${path}.superEffectiveOnly`),
      pushMeters: integer(config.pushMeters, `${path}.pushMeters`, 2, 2), conditions: stringArray(config.conditions, ['tripped'], `${path}.conditions`),
      injuries: integer(config.injuries, `${path}.injuries`, 1, 1),
    }
    case 'aa063.cave-crasher': return {
      resistedMoveTypes: stringArray(config.resistedMoveTypes, ['ground', 'rock'], `${path}.resistedMoveTypes`),
      resistanceSteps: integer(config.resistanceSteps, `${path}.resistanceSteps`, 1, 1),
    }
    case 'aa063.celebrate': return {
      action: oneOf(config.action, ['swift'], `${path}.action`), frequency: oneOf(config.frequency, ['at-will'], `${path}.frequency`),
      damagingOnly: bool(config.damagingOnly, `${path}.damagingOnly`), targetRelationship: oneOf(config.targetRelationship, ['enemy'], `${path}.targetRelationship`),
      disengageDistance: integer(config.disengageDistance, `${path}.disengageDistance`, 1, 1), disengageAction: oneOf(config.disengageAction, ['free'], `${path}.disengageAction`),
      opportunityAttacks: oneOf(config.opportunityAttacks, ['ignore'], `${path}.opportunityAttacks`),
    }
    case 'aa063.chemical-romance': return {
      connectionMoveId: oneOf(config.connectionMoveId, ['Sweet Scent'], `${path}.connectionMoveId`),
      triggeringMoveIds: stringArray(config.triggeringMoveIds, ['Poison Gas', 'Smog', 'Sweet Scent', 'Toxic', 'Venom Drench'], `${path}.triggeringMoveIds`),
      targetGender: oneOf(config.targetGender, ['male'], `${path}.targetGender`), condition: oneOf(config.condition, ['infatuated'], `${path}.condition`),
      sourceBound: bool(config.sourceBound, `${path}.sourceBound`),
    }
    case 'aa063.cherry-power': return {
      action: oneOf(config.action, ['swift'], `${path}.action`), frequency: oneOf(config.frequency, ['daily'], `${path}.frequency`),
      temporaryHitPoints: integer(config.temporaryHitPoints, `${path}.temporaryHitPoints`, 15, 15),
      curedConditionGroup: oneOf(config.curedConditionGroup, ['persistent-status-afflictions'], `${path}.curedConditionGroup`),
    }
    case 'aa063.chilling-neigh': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['at-will'], `${path}.frequency`),
      damagingOnly: bool(config.damagingOnly, `${path}.damagingOnly`), faintedRelationship: oneOf(config.faintedRelationship, ['enemy'], `${path}.faintedRelationship`),
      attackStages: integer(config.attackStages, `${path}.attackStages`, 1, 1), foeRadius: integer(config.foeRadius, `${path}.foeRadius`, 3, 3),
      evasionPenalty: integer(config.evasionPenalty, `${path}.evasionPenalty`, 2, 2), duration: oneOf(config.duration, ['one-full-round'], `${path}.duration`),
    }
    case 'aa063.chlorophyll': {
      const threshold = record(config.alternativeHpThreshold, `${path}.alternativeHpThreshold`)
      exact(threshold, ['numerator', 'denominator'], `${path}.alternativeHpThreshold`)
      return {
        initiativeMultiplier: integer(config.initiativeMultiplier, `${path}.initiativeMultiplier`, 2, 2), weather: oneOf(config.weather, ['sunny'], `${path}.weather`),
        alternativeHpThreshold: { numerator: integer(threshold.numerator, `${path}.alternativeHpThreshold.numerator`, 1, 1), denominator: integer(threshold.denominator, `${path}.alternativeHpThreshold.denominator`, 2, 2) },
      }
    }
    case 'aa063.clay-cannons': return {
      action: oneOf(config.action, ['swift'], `${path}.action`), frequency: oneOf(config.frequency, ['at-will'], `${path}.frequency`),
      duration: oneOf(config.duration, ['end-of-round'], `${path}.duration`), rangedMovesOnly: bool(config.rangedMovesOnly, `${path}.rangedMovesOnly`),
      virtualOriginRadius: integer(config.virtualOriginRadius, `${path}.virtualOriginRadius`, 2, 2), chooseOriginPerMove: bool(config.chooseOriginPerMove, `${path}.chooseOriginPerMove`),
    }
    case 'aa063.clear-body': return {
      preventCombatStageLoweringFrom: stringArray(config.preventCombatStageLoweringFrom, ['enemy-feature', 'enemy-ability', 'enemy-move'], `${path}.preventCombatStageLoweringFrom`),
      statusAfflictionStageChangesAllowed: bool(config.statusAfflictionStageChangesAllowed, `${path}.statusAfflictionStageChangesAllowed`),
    }
    case 'aa063.cloud-nine': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      weatherResult: oneOf(config.weatherResult, ['normal'], `${path}.weatherResult`), removeAllWeatherZones: bool(config.removeAllWeatherZones, `${path}.removeAllWeatherZones`),
    }
  }
}
export const parseAbilityMechanicOperation = (value: unknown, path = 'abilityMechanic'): AbilityMechanicOperation => {
  const cloned = cloneStrictJson(value, path, {
    limits: { depth: 5, nodes: 128, objectFields: 16, arrayEntries: 16, stringLength: 200, objectKeyLength: 200 },
    rootLabel: 'ability mechanic operation', valueLabel: 'ability mechanic values',
    failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
    failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
  })
  const input = record(cloned, path)
  exact(input, ROOT_FIELDS, path)
  if (input.kind !== ABILITY_MECHANIC_OPERATION_KIND || typeof input.mechanicId !== 'string' || !MECHANIC_SET.has(input.mechanicId)) {
    fail('invalid-mechanic', path, 'has unsupported kind or mechanic ID.')
  }
  const mechanicId = input.mechanicId as AbilityMechanicId
  return deepFreezeStrictJson({
    kind: ABILITY_MECHANIC_OPERATION_KIND,
    id: stableId(input.id, `${path}.id`),
    mechanicId,
    config: parseConfig(mechanicId, input.config, `${path}.config`),
  }) as AbilityMechanicOperation
}
export const isAbilityMechanicOperation = (value: AbilitySpecJsonObject): value is AbilityMechanicOperation => value.kind === ABILITY_MECHANIC_OPERATION_KIND
