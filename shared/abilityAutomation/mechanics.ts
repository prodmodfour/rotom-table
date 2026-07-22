import type { AbilitySpecJsonObject } from './spec'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_MECHANIC_OPERATION_KIND = 'ability-mechanic' as const
export const AA068_DUST_CLOUD_BURST_BRANCH_ID = 'ability.dust-cloud.burst-1' as const
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
export const AA064_ABILITY_MECHANIC_IDS = [
  'aa064.cluster-mind', 'aa064.color-change', 'aa064.color-theory', 'aa064.comatose',
  'aa064.combo-striker', 'aa064.competitive', 'aa064.compound-eyes', 'aa064.confidence',
  'aa064.conqueror', 'aa064.contrary', 'aa064.copy-master', 'aa064.corrosion',
] as const
export const AA065_ABILITY_MECHANIC_IDS = [
  'aa065.corrosive-toxins', 'aa065.cotton-down', 'aa065.courage', 'aa065.covert',
  'aa065.cruelty', 'aa065.crush-trap', 'aa065.cud-chew', 'aa065.curious-medicine',
  'aa065.cursed-body', 'aa065.cute-charm', 'aa065.cute-tears', 'aa065.damp',
] as const
export const AA066_ABILITY_MECHANIC_IDS = [
  'aa066.dancer', 'aa066.danger-syrup', 'aa066.dark-art', 'aa066.dark-aura',
  'aa066.dauntless-shield', 'aa066.daze', 'aa066.dazzling', 'aa066.deadly-poison',
  'aa066.decoy', 'aa066.deep-sleep', 'aa066.defeatist', 'aa066.defiant',
] as const
export const AA067_ABILITY_MECHANIC_IDS = [
  'aa067.defy-death', 'aa067.delayed-reaction', 'aa067.delivery-bird',
  'aa067.desert-weather', 'aa067.designer', 'aa067.diamond-defense',
  'aa067.dig-away', 'aa067.dire-spore', 'aa067.discipline', 'aa067.disguise',
  'aa067.dodge', 'aa067.download',
] as const
export const AA068_ABILITY_MECHANIC_IDS = [
  'aa068.dragons-maw', 'aa068.dream-smoke', 'aa068.dreamspinner', 'aa068.drizzle',
  'aa068.drought', 'aa068.drown-out', 'aa068.dry-skin', 'aa068.dust-cloud',
  'aa068.early-bird', 'aa068.effect-spore', 'aa068.eggscellence',
  'aa068.electric-surge',
] as const
export type Aa060AbilityMechanicId = (typeof AA060_ABILITY_MECHANIC_IDS)[number]
export type AbilityMechanicId = Aa060AbilityMechanicId
  | (typeof AA061_ABILITY_MECHANIC_IDS)[number]
  | (typeof AA062_ABILITY_MECHANIC_IDS)[number]
  | (typeof AA063_ABILITY_MECHANIC_IDS)[number]
  | (typeof AA064_ABILITY_MECHANIC_IDS)[number]
  | (typeof AA065_ABILITY_MECHANIC_IDS)[number]
  | (typeof AA066_ABILITY_MECHANIC_IDS)[number]
  | (typeof AA067_ABILITY_MECHANIC_IDS)[number]
  | (typeof AA068_ABILITY_MECHANIC_IDS)[number]
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
  'aa064.cluster-mind': ['movePoolSlots'],
  'aa064.color-change': ['action', 'frequency', 'typeSource', 'duration'],
  'aa064.color-theory': ['parameterId', 'acquisition', 'dieSides', 'pureBonus', 'mixedBonus', 'statByColor'],
  'aa064.comatose': ['action', 'frequency', 'condition', 'healing'],
  'aa064.combo-striker': ['action', 'frequency', 'damagingOnly', 'naturalAccuracyResults', 'followUpMoveId', 'recursive'],
  'aa064.competitive': ['trigger', 'excludedSources', 'resultingStage', 'resultingDelta'],
  'aa064.compound-eyes': ['accuracyRollBonus'],
  'aa064.confidence': ['action', 'frequency', 'relationship', 'radius', 'stageDelta'],
  'aa064.conqueror': ['action', 'frequency', 'damagingOnly', 'damageClasses', 'faintedRelationship', 'stageDeltas'],
  'aa064.contrary': ['invertCombatStageChanges'],
  'aa064.copy-master': ['connectionMoveId', 'triggeringMoveIds', 'resultingStageDelta', 'selectedCombatStat'],
  'aa064.corrosion': ['attackType', 'resistanceStepsIgnored', 'immunityMultiplier', 'poisonTypeImmunityBypass'],
  'aa065.corrosive-toxins': ['connectionMoveId', 'action', 'frequency', 'condition', 'bypassConditionImmunity', 'bypassBlessings', 'bypassHpLossPrevention'],
  'aa065.cotton-down': ['action', 'frequency', 'burstSize', 'speedStageDelta', 'condition', 'duration'],
  'aa065.courage': ['hpThreshold', 'damageBonus', 'damageReduction'],
  'aa065.covert': ['evasionBonus', 'terrainSource'],
  'aa065.cruelty': ['action', 'frequency', 'grantedInjuries', 'hpLossPerPurchase', 'slowCost', 'healingBlockCost', 'healingBlockDuration'],
  'aa065.crush-trap': ['connectionMoveId', 'action', 'frequency', 'triggeringManeuverId', 'damageSource', 'automaticHit', 'criticalHit', 'effectRanges'],
  'aa065.cud-chew': ['action', 'frequency', 'consumptionPeriod', 'restoreItem'],
  'aa065.curious-medicine': ['action', 'frequency', 'radius', 'relationship', 'resetCombatStages', 'entryReactionAction'],
  'aa065.cursed-body': ['action', 'frequency', 'damagingOnly', 'condition'],
  'aa065.cute-charm': ['action', 'frequency', 'relationship', 'requiredRange', 'requiredGenderRelation', 'condition'],
  'aa065.cute-tears': ['action', 'frequency', 'damagingOnly', 'stageDelta', 'statSource'],
  'aa065.damp': ['radius', 'preventedMoveIds', 'preventedAbilityId', 'bonusMoveType', 'bonusDice'],
  'aa066.dancer': ['action', 'frequency', 'radius', 'moveClass', 'danceMoveIds', 'immediateUse'],
  'aa066.danger-syrup': ['connectionMoveId', 'action', 'frequency', 'trigger', 'ignoreMoveFrequency', 'blindOnHit', 'blindDuration'],
  'aa066.dark-art': ['moveType', 'lastChanceThreshold', 'damageBonus'],
  'aa066.dark-aura': ['moveType', 'damageBaseBonus', 'relationships'],
  'aa066.dauntless-shield': ['stat', 'defaultStageBonus'],
  'aa066.daze': ['action', 'frequency', 'accuracyCheck', 'range', 'condition'],
  'aa066.dazzling': ['action', 'frequency', 'target', 'initiativePenalty', 'preventPriorityMoves', 'preventInterruptMovesAgainstUser'],
  'aa066.deadly-poison': ['action', 'frequency', 'triggerCondition', 'replacementCondition'],
  'aa066.decoy': ['action', 'frequency', 'nestedMoveId', 'evasionBonus', 'duration'],
  'aa066.deep-sleep': ['requiredCondition', 'healing', 'timing'],
  'aa066.defeatist': ['threshold', 'highHpBonusDice', 'lowHpDamagePenalty', 'lowHpInitiativeBonus'],
  'aa066.defiant': ['trigger', 'excludedSources', 'resultingStage', 'resultingDelta'],
  'aa067.defy-death': ['action', 'maximumInjuriesPerUse', 'dailyInjuryLimit', 'healingPerInjury', 'ignoreNormalDailyInjuryLimit'],
  'aa067.delayed-reaction': ['action', 'frequency', 'trigger', 'immediateDamageFraction', 'deferredDamageTiming', 'deferredDamageKind'],
  'aa067.delivery-bird': ['heldItemCapacity', 'chooseAffectedItem'],
  'aa067.desert-weather': ['sandstormImmunity', 'sunnyFireResistanceSteps', 'rainyTurnEndTemporaryHealing'],
  'aa067.designer': ['action', 'selectedTypeCount', 'resistanceSteps', 'maximumSuits', 'replacementPolicy'],
  'aa067.diamond-defense': ['connectionMoveId', 'moveFrequency', 'damageTypeOptions', 'selectionPolicy'],
  'aa067.dig-away': ['action', 'frequency', 'connectionMoveId', 'trigger', 'avoidAttack', 'consumeMoveFrequency', 'requireDiggableTerrain'],
  'aa067.dire-spore': ['connectionMoveId', 'trigger', 'condition'],
  'aa067.discipline': ['action', 'frequency', 'trigger', 'curedConditions'],
  'aa067.disguise': ['action', 'frequency', 'trigger', 'avoidAttack', 'stageDelta', 'selectedStat'],
  'aa067.dodge': ['action', 'frequency', 'trigger', 'avoidAttack'],
  'aa067.download': ['action', 'frequency', 'target', 'lowerDefenseStage', 'lowerSpecialDefenseStage', 'tieStage'],
  'aa068.dragons-maw': ['action', 'frequency', 'trigger', 'moveType', 'target', 'vulnerabilitySteps', 'immuneBaselineResistanceSteps'],
  'aa068.dream-smoke': ['action', 'frequency', 'trigger', 'requiredRange', 'condition'],
  'aa068.dreamspinner': ['action', 'frequency', 'radius', 'relationship', 'requiredCondition', 'foeHpLoss', 'temporaryHpGain'],
  'aa068.drizzle': ['action', 'frequency', 'weather', 'durationRounds'],
  'aa068.drought': ['action', 'frequency', 'weather', 'durationRounds'],
  'aa068.drown-out': ['action', 'frequency', 'trigger', 'keyword', 'cancelMove', 'retainTriggeringUsage'],
  'aa068.dry-skin': ['fireHitHpLoss', 'sunnyTurnEndHpLoss', 'waterMoveImmunity', 'waterHitHealing', 'rainyTurnEndHealing'],
  'aa068.dust-cloud': ['connectionMoveId', 'keyword', 'alternateRange'],
  'aa068.early-bird': ['initiativeSpeedNumerator', 'initiativeSpeedDenominator', 'sleepSaveBonus'],
  'aa068.effect-spore': ['action', 'frequency', 'trigger', 'requiredRange', 'rollSides', 'conditions'],
  'aa068.eggscellence': ['connectionMoveId', 'affectedMoveIds', 'grantStab', 'requiredUserType', 'accuracyThreshold', 'effectivenessSteps'],
  'aa068.electric-surge': ['action', 'frequency', 'terrain', 'durationRounds'],
}
const MECHANIC_SET = new Set<string>([
  ...AA060_ABILITY_MECHANIC_IDS, ...AA061_ABILITY_MECHANIC_IDS,
  ...AA062_ABILITY_MECHANIC_IDS, ...AA063_ABILITY_MECHANIC_IDS,
  ...AA064_ABILITY_MECHANIC_IDS, ...AA065_ABILITY_MECHANIC_IDS,
  ...AA066_ABILITY_MECHANIC_IDS, ...AA067_ABILITY_MECHANIC_IDS,
  ...AA068_ABILITY_MECHANIC_IDS,
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
const integerArray = (value: unknown, expected: readonly number[], path: string): readonly number[] => {
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
    case 'aa064.cluster-mind': return {
      movePoolSlots: integer(config.movePoolSlots, `${path}.movePoolSlots`, 2, 2),
    }
    case 'aa064.color-change': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['at-will'], `${path}.frequency`),
      typeSource: oneOf(config.typeSource, ['triggering-move'], `${path}.typeSource`), duration: oneOf(config.duration, ['scene'], `${path}.duration`),
    }
    case 'aa064.color-theory': {
      const stats = record(config.statByColor, `${path}.statByColor`)
      const expected: Readonly<Record<string, readonly string[]>> = {
        red: ['attack'], 'red-orange': ['attack', 'defense'], orange: ['defense'],
        'yellow-orange': ['defense', 'special-attack'], yellow: ['special-attack'],
        'yellow-green': ['special-attack', 'special-defense'], green: ['special-defense'],
        'blue-green': ['special-defense', 'speed'], blue: ['speed'],
        'blue-violet': ['speed', 'hp'], violet: ['hp'], 'red-violet': ['hp', 'attack'],
      }
      exact(stats, Object.keys(expected), `${path}.statByColor`)
      const statByColor = Object.fromEntries(Object.entries(expected).map(([color, values]) => [
        color, stringArray(stats[color], values, `${path}.statByColor.${color}`),
      ]))
      return {
        parameterId: oneOf(config.parameterId, ['color'], `${path}.parameterId`),
        acquisition: oneOf(config.acquisition, ['server-roll'], `${path}.acquisition`),
        dieSides: integer(config.dieSides, `${path}.dieSides`, 12, 12), pureBonus: integer(config.pureBonus, `${path}.pureBonus`, 6, 6),
        mixedBonus: integer(config.mixedBonus, `${path}.mixedBonus`, 3, 3), statByColor,
      }
    }
    case 'aa064.comatose': return {
      action: oneOf(config.action, ['move'], `${path}.action`), frequency: oneOf(config.frequency, ['at-will'], `${path}.frequency`),
      condition: oneOf(config.condition, ['asleep'], `${path}.condition`), healing: oneOf(config.healing, ['tick'], `${path}.healing`),
    }
    case 'aa064.combo-striker': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['at-will'], `${path}.frequency`),
      damagingOnly: bool(config.damagingOnly, `${path}.damagingOnly`), naturalAccuracyResults: integerArray(config.naturalAccuracyResults, [1, 10, 11], `${path}.naturalAccuracyResults`),
      followUpMoveId: oneOf(config.followUpMoveId, ['Struggle'], `${path}.followUpMoveId`), recursive: bool(config.recursive, `${path}.recursive`),
    }
    case 'aa064.competitive': return {
      trigger: oneOf(config.trigger, ['combat-stage-lowered'], `${path}.trigger`),
      excludedSources: stringArray(config.excludedSources, ['own-move', 'own-ability'], `${path}.excludedSources`),
      resultingStage: oneOf(config.resultingStage, ['special-attack'], `${path}.resultingStage`),
      resultingDelta: integer(config.resultingDelta, `${path}.resultingDelta`, 2, 2),
    }
    case 'aa064.compound-eyes': return {
      accuracyRollBonus: integer(config.accuracyRollBonus, `${path}.accuracyRollBonus`, 3, 3),
    }
    case 'aa064.confidence': return {
      action: oneOf(config.action, ['standard'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      relationship: oneOf(config.relationship, ['ally'], `${path}.relationship`), radius: integer(config.radius, `${path}.radius`, 5, 5),
      stageDelta: integer(config.stageDelta, `${path}.stageDelta`, 1, 1),
    }
    case 'aa064.conqueror': {
      const stages = record(config.stageDeltas, `${path}.stageDeltas`)
      exact(stages, ['attack', 'special-attack', 'speed'], `${path}.stageDeltas`)
      return {
        action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
        damagingOnly: bool(config.damagingOnly, `${path}.damagingOnly`),
        damageClasses: stringArray(config.damageClasses, ['physical', 'special'], `${path}.damageClasses`),
        faintedRelationship: oneOf(config.faintedRelationship, ['enemy'], `${path}.faintedRelationship`),
        stageDeltas: {
          attack: integer(stages.attack, `${path}.stageDeltas.attack`, 1, 1),
          'special-attack': integer(stages['special-attack'], `${path}.stageDeltas.special-attack`, 1, 1),
          speed: integer(stages.speed, `${path}.stageDeltas.speed`, 1, 1),
        },
      }
    }
    case 'aa064.contrary': return {
      invertCombatStageChanges: bool(config.invertCombatStageChanges, `${path}.invertCombatStageChanges`),
    }
    case 'aa064.copy-master': return {
      connectionMoveId: oneOf(config.connectionMoveId, ['Copycat'], `${path}.connectionMoveId`),
      triggeringMoveIds: stringArray(config.triggeringMoveIds, ['Copycat', 'Mimic'], `${path}.triggeringMoveIds`),
      resultingStageDelta: integer(config.resultingStageDelta, `${path}.resultingStageDelta`, 1, 1),
      selectedCombatStat: bool(config.selectedCombatStat, `${path}.selectedCombatStat`),
    }
    case 'aa064.corrosion': return {
      attackType: oneOf(config.attackType, ['poison'], `${path}.attackType`),
      resistanceStepsIgnored: integer(config.resistanceStepsIgnored, `${path}.resistanceStepsIgnored`, 1, 1),
      immunityMultiplier: exactNumber(config.immunityMultiplier, 0.25, `${path}.immunityMultiplier`),
      poisonTypeImmunityBypass: stringArray(config.poisonTypeImmunityBypass, ['poison', 'steel'], `${path}.poisonTypeImmunityBypass`),
    }
    case 'aa065.corrosive-toxins': return {
      connectionMoveId: oneOf(config.connectionMoveId, ['Toxic'], `${path}.connectionMoveId`),
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      condition: oneOf(config.condition, ['badly-poisoned'], `${path}.condition`),
      bypassConditionImmunity: bool(config.bypassConditionImmunity, `${path}.bypassConditionImmunity`),
      bypassBlessings: bool(config.bypassBlessings, `${path}.bypassBlessings`),
      bypassHpLossPrevention: bool(config.bypassHpLossPrevention, `${path}.bypassHpLossPrevention`),
    }
    case 'aa065.cotton-down': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      burstSize: integer(config.burstSize, `${path}.burstSize`, 1, 1), speedStageDelta: integer(config.speedStageDelta, `${path}.speedStageDelta`, -1, -1),
      condition: oneOf(config.condition, ['slowed'], `${path}.condition`), duration: oneOf(config.duration, ['one-full-round'], `${path}.duration`),
    }
    case 'aa065.courage': {
      const threshold = record(config.hpThreshold, `${path}.hpThreshold`)
      exact(threshold, ['numerator', 'denominator'], `${path}.hpThreshold`)
      return {
        hpThreshold: { numerator: integer(threshold.numerator, `${path}.hpThreshold.numerator`, 1, 1), denominator: integer(threshold.denominator, `${path}.hpThreshold.denominator`, 3, 3) },
        damageBonus: integer(config.damageBonus, `${path}.damageBonus`, 5, 5), damageReduction: integer(config.damageReduction, `${path}.damageReduction`, 5, 5),
      }
    }
    case 'aa065.covert': return {
      evasionBonus: integer(config.evasionBonus, `${path}.evasionBonus`, 2, 2), terrainSource: oneOf(config.terrainSource, ['natural-habitat'], `${path}.terrainSource`),
    }
    case 'aa065.cruelty': return {
      action: oneOf(config.action, ['swift'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      grantedInjuries: integer(config.grantedInjuries, `${path}.grantedInjuries`, 1, 1), hpLossPerPurchase: integer(config.hpLossPerPurchase, `${path}.hpLossPerPurchase`, 2, 2),
      slowCost: integer(config.slowCost, `${path}.slowCost`, 1, 1), healingBlockCost: integer(config.healingBlockCost, `${path}.healingBlockCost`, 2, 2),
      healingBlockDuration: oneOf(config.healingBlockDuration, ['encounter-until-switch-or-breather'], `${path}.healingBlockDuration`),
    }
    case 'aa065.crush-trap': return {
      connectionMoveId: oneOf(config.connectionMoveId, ['Wrap'], `${path}.connectionMoveId`), action: oneOf(config.action, ['free'], `${path}.action`),
      frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`), triggeringManeuverId: oneOf(config.triggeringManeuverId, ['Grapple'], `${path}.triggeringManeuverId`),
      damageSource: oneOf(config.damageSource, ['Struggle'], `${path}.damageSource`), automaticHit: bool(config.automaticHit, `${path}.automaticHit`),
      criticalHit: oneOf(config.criticalHit, ['never'], `${path}.criticalHit`), effectRanges: oneOf(config.effectRanges, ['never'], `${path}.effectRanges`),
    }
    case 'aa065.cud-chew': return {
      action: oneOf(config.action, ['swift'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      consumptionPeriod: oneOf(config.consumptionPeriod, ['current-encounter'], `${path}.consumptionPeriod`), restoreItem: bool(config.restoreItem, `${path}.restoreItem`),
    }
    case 'aa065.curious-medicine': return {
      action: oneOf(config.action, ['swift'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      radius: integer(config.radius, `${path}.radius`, 2, 2), relationship: oneOf(config.relationship, ['ally'], `${path}.relationship`),
      resetCombatStages: bool(config.resetCombatStages, `${path}.resetCombatStages`), entryReactionAction: oneOf(config.entryReactionAction, ['free'], `${path}.entryReactionAction`),
    }
    case 'aa065.cursed-body': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      damagingOnly: bool(config.damagingOnly, `${path}.damagingOnly`), condition: oneOf(config.condition, ['disabled'], `${path}.condition`),
    }
    case 'aa065.cute-charm': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      relationship: oneOf(config.relationship, ['enemy'], `${path}.relationship`), requiredRange: oneOf(config.requiredRange, ['melee'], `${path}.requiredRange`),
      requiredGenderRelation: oneOf(config.requiredGenderRelation, ['opposite'], `${path}.requiredGenderRelation`), condition: oneOf(config.condition, ['infatuated'], `${path}.condition`),
    }
    case 'aa065.cute-tears': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      damagingOnly: bool(config.damagingOnly, `${path}.damagingOnly`), stageDelta: integer(config.stageDelta, `${path}.stageDelta`, -2, -2),
      statSource: oneOf(config.statSource, ['triggering-move-attack-stat'], `${path}.statSource`),
    }
    case 'aa065.damp': {
      const bonusDice = record(config.bonusDice, `${path}.bonusDice`)
      exact(bonusDice, ['count', 'sides'], `${path}.bonusDice`)
      return {
        radius: integer(config.radius, `${path}.radius`, 10, 10), preventedMoveIds: stringArray(config.preventedMoveIds, ['Self-Destruct', 'Explosion'], `${path}.preventedMoveIds`),
        preventedAbilityId: oneOf(config.preventedAbilityId, ['Aftermath'], `${path}.preventedAbilityId`),
        bonusMoveType: oneOf(config.bonusMoveType, ['water'], `${path}.bonusMoveType`),
        bonusDice: {
          count: integer(bonusDice.count, `${path}.bonusDice.count`, 1, 1),
          sides: integer(bonusDice.sides, `${path}.bonusDice.sides`, 10, 10),
        },
      }
    }
    case 'aa066.dancer': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['scene-x2'], `${path}.frequency`),
      radius: integer(config.radius, `${path}.radius`, 10, 10), moveClass: oneOf(config.moveClass, ['status'], `${path}.moveClass`),
      danceMoveIds: stringArray(config.danceMoveIds, ['Victory Dance', 'Quiver Dance', 'Dragon Dance', 'Feather Dance', 'Swords Dance', 'Teeter Dance', 'Lunar Dance', 'Rain Dance'], `${path}.danceMoveIds`),
      immediateUse: bool(config.immediateUse, `${path}.immediateUse`),
    }
    case 'aa066.danger-syrup': return {
      connectionMoveId: oneOf(config.connectionMoveId, ['Sweet Scent'], `${path}.connectionMoveId`),
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      trigger: oneOf(config.trigger, ['hit-by-attack'], `${path}.trigger`), ignoreMoveFrequency: bool(config.ignoreMoveFrequency, `${path}.ignoreMoveFrequency`),
      blindOnHit: bool(config.blindOnHit, `${path}.blindOnHit`), blindDuration: oneOf(config.blindDuration, ['one-full-round'], `${path}.blindDuration`),
    }
    case 'aa066.dark-art': return {
      moveType: oneOf(config.moveType, ['dark'], `${path}.moveType`), lastChanceThreshold: exactNumber(config.lastChanceThreshold, 1 / 3, `${path}.lastChanceThreshold`),
      damageBonus: integer(config.damageBonus, `${path}.damageBonus`, 5, 5),
    }
    case 'aa066.dark-aura': return {
      moveType: oneOf(config.moveType, ['dark'], `${path}.moveType`), damageBaseBonus: integer(config.damageBaseBonus, `${path}.damageBaseBonus`, 1, 1),
      relationships: stringArray(config.relationships, ['self', 'ally'], `${path}.relationships`),
    }
    case 'aa066.dauntless-shield': return {
      stat: oneOf(config.stat, ['defense'], `${path}.stat`), defaultStageBonus: integer(config.defaultStageBonus, `${path}.defaultStageBonus`, 1, 1),
    }
    case 'aa066.daze': return {
      action: oneOf(config.action, ['standard'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      accuracyCheck: integer(config.accuracyCheck, `${path}.accuracyCheck`, 4, 4), range: integer(config.range, `${path}.range`, 6, 6),
      condition: oneOf(config.condition, ['sleep'], `${path}.condition`),
    }
    case 'aa066.dazzling': return {
      action: oneOf(config.action, ['swift'], `${path}.action`), frequency: oneOf(config.frequency, ['scene-x2'], `${path}.frequency`),
      target: oneOf(config.target, ['adjacent-foe'], `${path}.target`), initiativePenalty: integer(config.initiativePenalty, `${path}.initiativePenalty`, -10, -10),
      preventPriorityMoves: bool(config.preventPriorityMoves, `${path}.preventPriorityMoves`),
      preventInterruptMovesAgainstUser: bool(config.preventInterruptMovesAgainstUser, `${path}.preventInterruptMovesAgainstUser`),
    }
    case 'aa066.deadly-poison': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['daily'], `${path}.frequency`),
      triggerCondition: oneOf(config.triggerCondition, ['poisoned'], `${path}.triggerCondition`),
      replacementCondition: oneOf(config.replacementCondition, ['badly-poisoned'], `${path}.replacementCondition`),
    }
    case 'aa066.decoy': return {
      action: oneOf(config.action, ['full'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      nestedMoveId: oneOf(config.nestedMoveId, ['Follow Me'], `${path}.nestedMoveId`), evasionBonus: integer(config.evasionBonus, `${path}.evasionBonus`, 2, 2),
      duration: oneOf(config.duration, ['end-of-next-turn'], `${path}.duration`),
    }
    case 'aa066.deep-sleep': return {
      requiredCondition: oneOf(config.requiredCondition, ['sleep'], `${path}.requiredCondition`), healing: oneOf(config.healing, ['tick'], `${path}.healing`),
      timing: oneOf(config.timing, ['turn-end'], `${path}.timing`),
    }
    case 'aa066.defeatist': {
      const threshold = record(config.threshold, `${path}.threshold`)
      exact(threshold, ['numerator', 'denominator'], `${path}.threshold`)
      const dice = record(config.highHpBonusDice, `${path}.highHpBonusDice`)
      exact(dice, ['count', 'sides'], `${path}.highHpBonusDice`)
      return {
        threshold: { numerator: integer(threshold.numerator, `${path}.threshold.numerator`, 1, 1), denominator: integer(threshold.denominator, `${path}.threshold.denominator`, 2, 2) },
        highHpBonusDice: { count: integer(dice.count, `${path}.highHpBonusDice.count`, 2, 2), sides: integer(dice.sides, `${path}.highHpBonusDice.sides`, 6, 6) },
        lowHpDamagePenalty: integer(config.lowHpDamagePenalty, `${path}.lowHpDamagePenalty`, -5, -5),
        lowHpInitiativeBonus: integer(config.lowHpInitiativeBonus, `${path}.lowHpInitiativeBonus`, 10, 10),
      }
    }
    case 'aa066.defiant': return {
      trigger: oneOf(config.trigger, ['combat-stage-lowered'], `${path}.trigger`),
      excludedSources: stringArray(config.excludedSources, ['own-move', 'own-ability'], `${path}.excludedSources`),
      resultingStage: oneOf(config.resultingStage, ['attack'], `${path}.resultingStage`),
      resultingDelta: integer(config.resultingDelta, `${path}.resultingDelta`, 2, 2),
    }
    case 'aa067.defy-death': return {
      action: oneOf(config.action, ['swift'], `${path}.action`),
      maximumInjuriesPerUse: integer(config.maximumInjuriesPerUse, `${path}.maximumInjuriesPerUse`, 3, 3),
      dailyInjuryLimit: integer(config.dailyInjuryLimit, `${path}.dailyInjuryLimit`, 3, 3),
      healingPerInjury: oneOf(config.healingPerInjury, ['tick'], `${path}.healingPerInjury`),
      ignoreNormalDailyInjuryLimit: bool(config.ignoreNormalDailyInjuryLimit, `${path}.ignoreNormalDailyInjuryLimit`),
    }
    case 'aa067.delayed-reaction': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      trigger: oneOf(config.trigger, ['hit-by-direct-damaging-attack'], `${path}.trigger`),
      immediateDamageFraction: exactNumber(config.immediateDamageFraction, 0.5, `${path}.immediateDamageFraction`),
      deferredDamageTiming: oneOf(config.deferredDamageTiming, ['end-of-next-turn'], `${path}.deferredDamageTiming`),
      deferredDamageKind: oneOf(config.deferredDamageKind, ['hp-loss'], `${path}.deferredDamageKind`),
    }
    case 'aa067.delivery-bird': return {
      heldItemCapacity: integer(config.heldItemCapacity, `${path}.heldItemCapacity`, 2, 2),
      chooseAffectedItem: bool(config.chooseAffectedItem, `${path}.chooseAffectedItem`),
    }
    case 'aa067.desert-weather': return {
      sandstormImmunity: bool(config.sandstormImmunity, `${path}.sandstormImmunity`),
      sunnyFireResistanceSteps: integer(config.sunnyFireResistanceSteps, `${path}.sunnyFireResistanceSteps`, 1, 1),
      rainyTurnEndTemporaryHealing: oneOf(config.rainyTurnEndTemporaryHealing, ['tick'], `${path}.rainyTurnEndTemporaryHealing`),
    }
    case 'aa067.designer': return {
      action: oneOf(config.action, ['extended'], `${path}.action`), selectedTypeCount: integer(config.selectedTypeCount, `${path}.selectedTypeCount`, 2, 2),
      resistanceSteps: integer(config.resistanceSteps, `${path}.resistanceSteps`, 1, 1), maximumSuits: integer(config.maximumSuits, `${path}.maximumSuits`, 1, 1),
      replacementPolicy: oneOf(config.replacementPolicy, ['destroy-old'], `${path}.replacementPolicy`),
    }
    case 'aa067.diamond-defense': return {
      connectionMoveId: oneOf(config.connectionMoveId, ['Stealth Rock'], `${path}.connectionMoveId`),
      moveFrequency: oneOf(config.moveFrequency, ['scene-x2'], `${path}.moveFrequency`),
      damageTypeOptions: stringArray(config.damageTypeOptions, ['rock', 'fairy'], `${path}.damageTypeOptions`),
      selectionPolicy: oneOf(config.selectionPolicy, ['most-effective'], `${path}.selectionPolicy`),
    }
    case 'aa067.dig-away': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['daily'], `${path}.frequency`),
      connectionMoveId: oneOf(config.connectionMoveId, ['Dig'], `${path}.connectionMoveId`), trigger: oneOf(config.trigger, ['hit-by-move'], `${path}.trigger`),
      avoidAttack: bool(config.avoidAttack, `${path}.avoidAttack`), consumeMoveFrequency: bool(config.consumeMoveFrequency, `${path}.consumeMoveFrequency`),
      requireDiggableTerrain: bool(config.requireDiggableTerrain, `${path}.requireDiggableTerrain`),
    }
    case 'aa067.dire-spore': return {
      connectionMoveId: oneOf(config.connectionMoveId, ['Spore'], `${path}.connectionMoveId`),
      trigger: oneOf(config.trigger, ['spore-hit'], `${path}.trigger`), condition: oneOf(config.condition, ['poisoned'], `${path}.condition`),
    }
    case 'aa067.discipline': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      trigger: oneOf(config.trigger, ['gains-initiative'], `${path}.trigger`),
      curedConditions: stringArray(config.curedConditions, ['confused', 'enraged', 'infatuated', 'flinched'], `${path}.curedConditions`),
    }
    case 'aa067.disguise': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['daily'], `${path}.frequency`),
      trigger: oneOf(config.trigger, ['hit-by-damaging-move'], `${path}.trigger`), avoidAttack: bool(config.avoidAttack, `${path}.avoidAttack`),
      stageDelta: integer(config.stageDelta, `${path}.stageDelta`, 1, 1), selectedStat: bool(config.selectedStat, `${path}.selectedStat`),
    }
    case 'aa067.dodge': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['daily'], `${path}.frequency`),
      trigger: oneOf(config.trigger, ['hit-by-damaging-move'], `${path}.trigger`), avoidAttack: bool(config.avoidAttack, `${path}.avoidAttack`),
    }
    case 'aa067.download': return {
      action: oneOf(config.action, ['swift'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      target: oneOf(config.target, ['trainer-or-pokemon'], `${path}.target`),
      lowerDefenseStage: oneOf(config.lowerDefenseStage, ['attack'], `${path}.lowerDefenseStage`),
      lowerSpecialDefenseStage: oneOf(config.lowerSpecialDefenseStage, ['special-attack'], `${path}.lowerSpecialDefenseStage`),
      tieStage: oneOf(config.tieStage, ['chosen-non-hp-stat'], `${path}.tieStage`),
    }
    case 'aa068.dragons-maw': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['scene-x2'], `${path}.frequency`),
      trigger: oneOf(config.trigger, ['damaging-dragon-hit'], `${path}.trigger`), moveType: oneOf(config.moveType, ['dragon'], `${path}.moveType`),
      target: oneOf(config.target, ['one-hit-target'], `${path}.target`), vulnerabilitySteps: integer(config.vulnerabilitySteps, `${path}.vulnerabilitySteps`, 1, 1),
      immuneBaselineResistanceSteps: integer(config.immuneBaselineResistanceSteps, `${path}.immuneBaselineResistanceSteps`, 2, 2),
    }
    case 'aa068.dream-smoke': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      trigger: oneOf(config.trigger, ['hit-by-melee-attack'], `${path}.trigger`), requiredRange: oneOf(config.requiredRange, ['melee'], `${path}.requiredRange`),
      condition: oneOf(config.condition, ['asleep'], `${path}.condition`),
    }
    case 'aa068.dreamspinner': return {
      action: oneOf(config.action, ['swift'], `${path}.action`), frequency: oneOf(config.frequency, ['scene-x3'], `${path}.frequency`),
      radius: integer(config.radius, `${path}.radius`, 3, 3), relationship: oneOf(config.relationship, ['enemy'], `${path}.relationship`),
      requiredCondition: oneOf(config.requiredCondition, ['asleep'], `${path}.requiredCondition`), foeHpLoss: oneOf(config.foeHpLoss, ['tick'], `${path}.foeHpLoss`),
      temporaryHpGain: oneOf(config.temporaryHpGain, ['tick'], `${path}.temporaryHpGain`),
    }
    case 'aa068.drizzle': return {
      action: oneOf(config.action, ['swift'], `${path}.action`), frequency: oneOf(config.frequency, ['scene-x3'], `${path}.frequency`),
      weather: oneOf(config.weather, ['rainy'], `${path}.weather`), durationRounds: integer(config.durationRounds, `${path}.durationRounds`, 1, 1),
    }
    case 'aa068.drought': return {
      action: oneOf(config.action, ['swift'], `${path}.action`), frequency: oneOf(config.frequency, ['scene-x3'], `${path}.frequency`),
      weather: oneOf(config.weather, ['sunny'], `${path}.weather`), durationRounds: integer(config.durationRounds, `${path}.durationRounds`, 1, 1),
    }
    case 'aa068.drown-out': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['scene-x2'], `${path}.frequency`),
      trigger: oneOf(config.trigger, ['foe-uses-sonic-move'], `${path}.trigger`), keyword: oneOf(config.keyword, ['sonic'], `${path}.keyword`),
      cancelMove: bool(config.cancelMove, `${path}.cancelMove`), retainTriggeringUsage: bool(config.retainTriggeringUsage, `${path}.retainTriggeringUsage`),
    }
    case 'aa068.dry-skin': return {
      fireHitHpLoss: oneOf(config.fireHitHpLoss, ['tick'], `${path}.fireHitHpLoss`), sunnyTurnEndHpLoss: oneOf(config.sunnyTurnEndHpLoss, ['tick'], `${path}.sunnyTurnEndHpLoss`),
      waterMoveImmunity: bool(config.waterMoveImmunity, `${path}.waterMoveImmunity`), waterHitHealing: oneOf(config.waterHitHealing, ['tick'], `${path}.waterHitHealing`),
      rainyTurnEndHealing: oneOf(config.rainyTurnEndHealing, ['tick'], `${path}.rainyTurnEndHealing`),
    }
    case 'aa068.dust-cloud': return {
      connectionMoveId: oneOf(config.connectionMoveId, ['Poison Powder'], `${path}.connectionMoveId`), keyword: oneOf(config.keyword, ['powder'], `${path}.keyword`),
      alternateRange: oneOf(config.alternateRange, ['burst-1'], `${path}.alternateRange`),
    }
    case 'aa068.early-bird': return {
      initiativeSpeedNumerator: integer(config.initiativeSpeedNumerator, `${path}.initiativeSpeedNumerator`, 1, 1),
      initiativeSpeedDenominator: integer(config.initiativeSpeedDenominator, `${path}.initiativeSpeedDenominator`, 2, 2),
      sleepSaveBonus: integer(config.sleepSaveBonus, `${path}.sleepSaveBonus`, 3, 3),
    }
    case 'aa068.effect-spore': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      trigger: oneOf(config.trigger, ['hit-by-melee-attack'], `${path}.trigger`), requiredRange: oneOf(config.requiredRange, ['melee'], `${path}.requiredRange`),
      rollSides: integer(config.rollSides, `${path}.rollSides`, 6, 6),
      conditions: stringArray(config.conditions, ['poisoned', 'poisoned', 'paralyzed', 'paralyzed', 'asleep', 'asleep'], `${path}.conditions`),
    }
    case 'aa068.eggscellence': return {
      connectionMoveId: oneOf(config.connectionMoveId, ['Barrage'], `${path}.connectionMoveId`),
      affectedMoveIds: stringArray(config.affectedMoveIds, ['Barrage', 'Egg Bomb'], `${path}.affectedMoveIds`),
      grantStab: bool(config.grantStab, `${path}.grantStab`), requiredUserType: oneOf(config.requiredUserType, ['normal'], `${path}.requiredUserType`),
      accuracyThreshold: integer(config.accuracyThreshold, `${path}.accuracyThreshold`, 16, 16), effectivenessSteps: integer(config.effectivenessSteps, `${path}.effectivenessSteps`, 1, 1),
    }
    case 'aa068.electric-surge': return {
      action: oneOf(config.action, ['swift'], `${path}.action`), frequency: oneOf(config.frequency, ['scene-x3'], `${path}.frequency`),
      terrain: oneOf(config.terrain, ['electric'], `${path}.terrain`), durationRounds: integer(config.durationRounds, `${path}.durationRounds`, 1, 1),
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
