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
export const AA069_ABILITY_MECHANIC_IDS = [
  'aa069.electrodash', 'aa069.emergency-exit', 'aa069.empower',
  'aa069.enduring-rage', 'aa069.enfeebling-lips', 'aa069.exploit',
  'aa069.fabulous-trim', 'aa069.fade-away', 'aa069.fairy-aura',
  'aa069.fashion-designer', 'aa069.fiery-crash', 'aa069.filter',
] as const
export const AA070_ABILITY_MECHANIC_IDS = [
  'aa070.flame-body', 'aa070.flame-tongue', 'aa070.flare-boost',
  'aa070.flash-fire', 'aa070.flavorful-aroma', 'aa070.flower-gift',
  'aa070.flower-power', 'aa070.flower-veil', 'aa070.fluffy',
  'aa070.fluffy-charge', 'aa070.flutter', 'aa070.flying-fly-trap',
] as const
export const AA071_ABILITY_MECHANIC_IDS = [
  'aa071.focus', 'aa071.forecast', 'aa071.forest-lord', 'aa071.forewarn',
  'aa071.fox-fire', 'aa071.freezing-point', 'aa071.friend-guard',
  'aa071.frighten', 'aa071.frisk', 'aa071.frostbite', 'aa071.full-guard',
  'aa071.full-metal-body',
] as const
export const AA072_ABILITY_MECHANIC_IDS = [
  'aa072.fur-coat', 'aa072.gale-wings', 'aa072.galvanize', 'aa072.gardener',
  'aa072.gentle-vibe', 'aa072.giver', 'aa072.glisten', 'aa072.gluttony',
  'aa072.gooey', 'aa072.gore', 'aa072.gorilla-tactics', 'aa072.grass-pelt',
] as const
export const AA073_ABILITY_MECHANIC_IDS = [
  'aa073.grassy-surge', 'aa073.grim-neigh', 'aa073.gulp', 'aa073.gulp-missile',
  'aa073.guts', 'aa073.handyman', 'aa073.harvest', 'aa073.haunt',
  'aa073.hay-fever', 'aa073.healer', 'aa073.heat-mirage', 'aa073.heatproof',
] as const
export const AA074_ABILITY_MECHANIC_IDS = [
  'aa074.heavy-metal', 'aa074.heliovolt', 'aa074.helper', 'aa074.honey-paws',
  'aa074.honey-thief', 'aa074.horde-break', 'aa074.huge-power',
  'aa074.huge-power-pure-power', 'aa074.hunger-switch', 'aa074.hustle',
  'aa074.hydration', 'aa074.hyper-cutter',
] as const
export const AA075_ABILITY_MECHANIC_IDS = [
  'aa075.hypnotic', 'aa075.ice-body', 'aa075.ice-face', 'aa075.ice-scales',
  'aa075.ice-shield', 'aa075.ignition-boost', 'aa075.illuminate',
  'aa075.illusion', 'aa075.immunity', 'aa075.imposter', 'aa075.infiltrator',
  'aa075.innards-out',
] as const
export const AA076_ABILITY_MECHANIC_IDS = [
  'aa076.inner-focus', 'aa076.insomnia', 'aa076.instinct', 'aa076.interference',
  'aa076.intimidate', 'aa076.intrepid-sword', 'aa076.iron-barbs',
  'aa076.iron-fist', 'aa076.juicy-energy', 'aa076.justified',
  'aa076.kampfgeist', 'aa076.keen-eye',
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
  | (typeof AA069_ABILITY_MECHANIC_IDS)[number]
  | (typeof AA070_ABILITY_MECHANIC_IDS)[number]
  | (typeof AA071_ABILITY_MECHANIC_IDS)[number]
  | (typeof AA072_ABILITY_MECHANIC_IDS)[number]
  | (typeof AA073_ABILITY_MECHANIC_IDS)[number]
  | (typeof AA074_ABILITY_MECHANIC_IDS)[number]
  | (typeof AA075_ABILITY_MECHANIC_IDS)[number]
  | (typeof AA076_ABILITY_MECHANIC_IDS)[number]
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
  'aa069.electrodash': ['action', 'frequency', 'sprintAction', 'movementMultiplier', 'duration'],
  'aa069.emergency-exit': ['action', 'frequency', 'trigger', 'recall', 'replacement', 'initiativePolicy'],
  'aa069.empower': ['action', 'frequency', 'grantedMoveAction', 'moveFilter', 'duration'],
  'aa069.enduring-rage': ['condition', 'preventCureRolls', 'damageReduction'],
  'aa069.enfeebling-lips': ['connectionMoveId', 'affectedMoveId', 'statChoice', 'stageDelta', 'trigger'],
  'aa069.exploit': ['trigger', 'damageRollBonus'],
  'aa069.fabulous-trim': ['action', 'persistence', 'parameterId', 'trimIds', 'grantedAbilityIds'],
  'aa069.fade-away': ['branch', 'action', 'frequency', 'invisibleUntil', 'immediateShift', 'trigger', 'avoidDamageAndEffects'],
  'aa069.fairy-aura': ['affectedRelationships', 'moveType', 'damageBaseBonus'],
  'aa069.fashion-designer': ['action', 'frequency', 'craftQuantity', 'itemIds'],
  'aa069.fiery-crash': ['keyword', 'choices', 'fireBurnThreshold', 'existingBurnRangeBonus'],
  'aa069.filter': ['trigger', 'damageReduction'],
  'aa070.flame-body': ['action', 'frequency', 'trigger', 'sourceRelation', 'condition'],
  'aa070.flame-tongue': ['action', 'frequency', 'connectionMoveId', 'trigger', 'injuryDelta', 'condition'],
  'aa070.flare-boost': ['action', 'frequency', 'requiredCondition', 'attackStages', 'specialAttackStages'],
  'aa070.flash-fire': ['immuneMoveType', 'preventDamage', 'preventEffects', 'onHitStatChoices', 'stageDelta'],
  'aa070.flavorful-aroma': ['action', 'frequency', 'connectionMoveId', 'trigger', 'affectedRelationship', 'accuracyBonus', 'damageBonus', 'durationRounds'],
  'aa070.flower-gift': ['action', 'frequency', 'eligibility', 'statSelections', 'selfStageDelta', 'nearbyStageDelta', 'radius'],
  'aa070.flower-power': ['moveType', 'moveFilter', 'damageClassChoices'],
  'aa070.flower-veil': ['protectedType', 'radius', 'protectUserRegardlessOfType', 'preventCombatStageLowering'],
  'aa070.fluffy': ['meleeResistanceSteps', 'fireResistanceSteps', 'damagingOnly'],
  'aa070.fluffy-charge': ['connectionMoveId', 'trigger', 'defenseStages'],
  'aa070.flutter': ['action', 'frequency', 'evasionBonus', 'duration', 'cannotBeFlanked'],
  'aa070.flying-fly-trap': ['damageImmuneMoveTypes', 'effectsRemain'],
  'aa071.focus': ['lastChanceType', 'hpThresholdNumerator', 'hpThresholdDenominator', 'damageBonus'],
  'aa071.forecast': ['weatherKinds', 'weatherTypes', 'normalType', 'multipleWeatherChoice'],
  'aa071.forest-lord': ['action', 'frequency', 'moveTypes', 'maximumTreeDistance', 'accuracyBonus', 'duration'],
  'aa071.forewarn': ['action', 'frequency', 'targetRelationship', 'revealHighestDamageDice', 'revealAllTies', 'accuracyPenalty', 'duration'],
  'aa071.fox-fire': ['action', 'frequency', 'connectionMoveId', 'wispCount', 'trigger', 'triggerRelationship', 'triggerRadius', 'responseAction', 'responseTiming'],
  'aa071.freezing-point': ['lastChanceType', 'hpThresholdNumerator', 'hpThresholdDenominator', 'damageBonus'],
  'aa071.friend-guard': ['action', 'frequency', 'trigger', 'adjacency', 'resistanceSteps'],
  'aa071.frighten': ['action', 'frequency', 'speedStageDelta'],
  'aa071.frisk': ['adjacency', 'accuracyBonus'],
  'aa071.frostbite': ['moveType', 'damagingOnly', 'slowedMinimum', 'freezeRangeIncrease', 'defaultFreezeMinimum'],
  'aa071.full-guard': ['action', 'frequency', 'trigger', 'resistanceSteps'],
  'aa071.full-metal-body': ['preventCombatStageLoweringFrom', 'statusAfflictionStageChangesAllowed'],
  'aa072.fur-coat': ['damageClass', 'resistanceSteps'],
  'aa072.gale-wings': ['connectionMoveId', 'fromType', 'optionalType'],
  'aa072.galvanize': ['action', 'frequency', 'triggerType', 'requiresDamaging', 'toType'],
  'aa072.gardener': ['action', 'frequency', 'uses', 'targetTag', 'soilQualityDelta', 'oncePerTargetPerDay'],
  'aa072.gentle-vibe': ['action', 'frequency', 'burstSize', 'resetCombatStages', 'cureConditionGroup'],
  'aa072.giver': ['action', 'frequency', 'uses', 'connectionMoveId', 'forcedRollValues'],
  'aa072.glisten': ['immuneMoveType'],
  'aa072.gluttony': ['foodBuffCapacity', 'foodBuffUsesPerScene', 'refreshmentsPerHalfHour'],
  'aa072.gooey': ['action', 'frequency', 'triggerRange', 'speedStageDelta'],
  'aa072.gore': ['action', 'frequency', 'uses', 'connectionMoveId', 'grantKeyword', 'pushDistance'],
  'aa072.gorilla-tactics': ['action', 'frequency', 'damageBonus', 'duration', 'restrictToPreviouslyUsedMoves'],
  'aa072.grass-pelt': ['action', 'frequency', 'temporaryHpTicks'],
  'aa073.grassy-surge': ['action', 'frequency', 'uses', 'terrain', 'durationRounds'],
  'aa073.grim-neigh': ['action', 'frequency', 'damagingOnly', 'faintedRelationship', 'specialAttackStages', 'foeRadius', 'accuracyPenalty', 'durationRounds'],
  'aa073.gulp': ['action', 'frequency', 'submergedMinutes', 'healingNumerator', 'healingDenominator', 'injuriesRemoved'],
  'aa073.gulp-missile': ['action', 'frequency', 'uses', 'connectionMoveId', 'triggerMoveIds', 'attackAc', 'attackClass', 'hpLossTicks', 'evenCondition', 'oddDefenseStageDelta'],
  'aa073.guts': ['conditions', 'attackStages'],
  'aa073.handyman': ['heldItemCapacity', 'chooseAffectedItem'],
  'aa073.harvest': ['action', 'frequency', 'itemFamily', 'coinSides', 'retainOnResult', 'sunnyAlwaysRetains', 'tradesPerTurn', 'stopAfterResult'],
  'aa073.haunt': ['lastChanceType', 'hpThresholdNumerator', 'hpThresholdDenominator', 'damageBonus'],
  'aa073.hay-fever': ['action', 'frequency', 'branch', 'triggers', 'excludedWeather', 'immuneTypes', 'hpLossTicks'],
  'aa073.healer': ['action', 'frequency', 'adjacency', 'cureConditionGroup'],
  'aa073.heat-mirage': ['action', 'frequency', 'triggerType', 'evasionBonus', 'duration'],
  'aa073.heatproof': ['moveType', 'resistanceSteps', 'preventBurnHpLoss'],
  'aa074.heavy-metal': ['weightClassBonus', 'defenseBaseStatBonus', 'speedBaseStatPenalty'],
  'aa074.heliovolt': ['action', 'frequency', 'triggerType', 'evasionBonus', 'consideredWeather', 'durationRounds'],
  'aa074.helper': ['connectionMoveId', 'targetRelationship', 'targetCount', 'accuracyBonus', 'skillCheckBonus', 'duration'],
  'aa074.honey-paws': ['consumedItemId', 'equivalentBuffItemId', 'ignoresNormalDigestionCapacity', 'explicitPreparationRequired', 'preparationDuration'],
  'aa074.honey-thief': ['connectionMoveId', 'trigger', 'temporaryHpTicks'],
  'aa074.horde-break': ['action', 'frequency', 'fromForm', 'toForm', 'cureConditionGroup'],
  'aa074.huge-power': ['stat', 'operation', 'includeNature', 'includeVitamins', 'includeTrainerFeatures'],
  'aa074.huge-power-pure-power': ['stat', 'baseBonus', 'bonusPerLevels', 'cannotBeDisabled'],
  'aa074.hunger-switch': ['timing', 'fullBellyMode', 'hangryMode', 'fullBellyAccuracyBonus', 'hangryDamageBonus', 'duration', 'choiceRequired'],
  'aa074.hustle': ['accuracyPenalty', 'damageRollBonus', 'appliesToAllMoves'],
  'aa074.hydration': ['action', 'frequency', 'cureCount', 'rainyWeatherIgnoresFrequency'],
  'aa074.hyper-cutter': ['protectedStat', 'preventStatLowering', 'preventCombatStageLowering'],
  'aa075.hypnotic': ['connectionMoveId', 'automaticHit'],
  'aa075.ice-body': ['action', 'frequency', 'healingTicks', 'hpThresholdNumerator', 'hpThresholdDenominator', 'weatherAlternative'],
  'aa075.ice-face': ['action', 'requiredWeather', 'temporaryHpTicks', 'battleStartTemporaryHpTicks', 'hailDamageImmunity', 'iceForm', 'noiceForm'],
  'aa075.ice-scales': ['damageClass', 'resistanceSteps'],
  'aa075.ice-shield': ['action', 'frequency', 'maximumSegments', 'requiredAdjacentSegments', 'contiguous', 'segmentHeight', 'segmentHitPoints', 'segmentDamageReduction', 'segmentType', 'duration', 'blockingTerrain'],
  'aa075.ignition-boost': ['action', 'frequency', 'triggerRelationship', 'triggerType', 'damagingOnly', 'damageBonus', 'maximumBenefits'],
  'aa075.illuminate': ['incomingAccuracyPenalty', 'bypassCapability'],
  'aa075.illusion': ['operation', 'markAction', 'assumeAction', 'dismissAction', 'markCapacitySource', 'assumeFrequency', 'appearanceOnly', 'breakTrigger'],
  'aa075.immunity': ['blockedConditions'],
  'aa075.imposter': ['connectionMoveId', 'actionOverride', 'requiresUntransformed'],
  'aa075.infiltrator': ['stealthBonus', 'ignoreHazards', 'blockResponsiveBlessings', 'bypassSubstitute'],
  'aa075.innards-out': ['action', 'frequency', 'damagingOnly', 'resistanceSteps', 'foeRange', 'reflectedRealHpMultiplier', 'resolvesAfterAttack', 'resolvesAfterFainting'],
  'aa076.inner-focus': ['blockedConditions', 'preventUnwillingInitiativeLowering'],
  'aa076.insomnia': ['blockedConditions', 'blockedMoveIds'],
  'aa076.instinct': ['defaultEvasionBonus'],
  'aa076.interference': ['action', 'frequency', 'targetRelationship', 'radius', 'accuracyPenalty', 'duration'],
  'aa076.intimidate': ['action', 'frequency', 'targetRelationship', 'range', 'attackStageDelta', 'perTargetFrequency'],
  'aa076.intrepid-sword': ['stat', 'defaultStageBonus'],
  'aa076.iron-barbs': ['action', 'frequency', 'trigger', 'hitPointLossTicks', 'reaction'],
  'aa076.iron-fist': ['moveIds', 'damageBaseBonus'],
  'aa076.juicy-energy': ['action', 'frequency', 'consumedBuffItemId', 'ordinaryHealing', 'replacementHealing'],
  'aa076.justified': ['action', 'frequency', 'triggerMoveType', 'triggerAttackOfOpportunity', 'attackStageDelta', 'interceptCheckBonus'],
  'aa076.kampfgeist': ['action', 'frequency', 'triggerTypes', 'resistanceSteps', 'bonusStabType'],
  'aa076.keen-eye': ['protectAccuracyStage', 'ignoreAccuracyPenalties', 'blockedCondition', 'excludedCondition', 'ignoreNonStatEvasion'],
}
const MECHANIC_SET = new Set<string>([
  ...AA060_ABILITY_MECHANIC_IDS, ...AA061_ABILITY_MECHANIC_IDS,
  ...AA062_ABILITY_MECHANIC_IDS, ...AA063_ABILITY_MECHANIC_IDS,
  ...AA064_ABILITY_MECHANIC_IDS, ...AA065_ABILITY_MECHANIC_IDS,
  ...AA066_ABILITY_MECHANIC_IDS, ...AA067_ABILITY_MECHANIC_IDS,
  ...AA068_ABILITY_MECHANIC_IDS, ...AA069_ABILITY_MECHANIC_IDS,
  ...AA070_ABILITY_MECHANIC_IDS, ...AA071_ABILITY_MECHANIC_IDS,
  ...AA072_ABILITY_MECHANIC_IDS, ...AA073_ABILITY_MECHANIC_IDS,
  ...AA074_ABILITY_MECHANIC_IDS, ...AA075_ABILITY_MECHANIC_IDS,
  ...AA076_ABILITY_MECHANIC_IDS,
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
    case 'aa069.electrodash': return {
      action: oneOf(config.action, ['swift'], `${path}.action`), frequency: oneOf(config.frequency, ['scene-x2'], `${path}.frequency`),
      sprintAction: oneOf(config.sprintAction, ['free'], `${path}.sprintAction`), movementMultiplier: exactNumber(config.movementMultiplier, 1.5, `${path}.movementMultiplier`),
      duration: oneOf(config.duration, ['turn'], `${path}.duration`),
    }
    case 'aa069.emergency-exit': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      trigger: oneOf(config.trigger, ['drops-below-half-hp'], `${path}.trigger`), recall: bool(config.recall, `${path}.recall`),
      replacement: oneOf(config.replacement, ['trainer-choice'], `${path}.replacement`), initiativePolicy: oneOf(config.initiativePolicy, ['inherit-if-unacted'], `${path}.initiativePolicy`),
    }
    case 'aa069.empower': return {
      action: oneOf(config.action, ['swift'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      grantedMoveAction: oneOf(config.grantedMoveAction, ['free'], `${path}.grantedMoveAction`), moveFilter: oneOf(config.moveFilter, ['self-targeting-status'], `${path}.moveFilter`),
      duration: oneOf(config.duration, ['turn-or-use'], `${path}.duration`),
    }
    case 'aa069.enduring-rage': return {
      condition: oneOf(config.condition, ['enraged'], `${path}.condition`), preventCureRolls: bool(config.preventCureRolls, `${path}.preventCureRolls`),
      damageReduction: integer(config.damageReduction, `${path}.damageReduction`, 5, 5),
    }
    case 'aa069.enfeebling-lips': return {
      connectionMoveId: oneOf(config.connectionMoveId, ['Lovely Kiss'], `${path}.connectionMoveId`), affectedMoveId: oneOf(config.affectedMoveId, ['Lovely Kiss'], `${path}.affectedMoveId`),
      statChoice: oneOf(config.statChoice, ['combat-stat'], `${path}.statChoice`), stageDelta: integer(config.stageDelta, `${path}.stageDelta`, -2, -2),
      trigger: oneOf(config.trigger, ['successful-hit'], `${path}.trigger`),
    }
    case 'aa069.exploit': return {
      trigger: oneOf(config.trigger, ['super-effective-damage'], `${path}.trigger`), damageRollBonus: integer(config.damageRollBonus, `${path}.damageRollBonus`, 5, 5),
    }
    case 'aa069.fabulous-trim': return {
      action: oneOf(config.action, ['extended'], `${path}.action`), persistence: oneOf(config.persistence, ['sheet'], `${path}.persistence`), parameterId: oneOf(config.parameterId, ['trim'], `${path}.parameterId`),
      trimIds: stringArray(config.trimIds, ['star', 'diamond', 'heart', 'pharaoh', 'kabuki', 'la-reine', 'matron', 'dandy', 'debutante'], `${path}.trimIds`),
      grantedAbilityIds: stringArray(config.grantedAbilityIds, ['Celebrate', 'Defiant', 'Cute Tears', 'Sand Veil', 'Inner Focus', 'Intimidate', 'Friend Guard', 'Moxie', 'Confidence'], `${path}.grantedAbilityIds`),
    }
    case 'aa069.fade-away': return {
      branch: oneOf(config.branch, ['activate', 'interrupt'], `${path}.branch`), action: oneOf(config.action, ['standard'], `${path}.action`),
      frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`), invisibleUntil: oneOf(config.invisibleUntil, ['next-turn-start'], `${path}.invisibleUntil`),
      immediateShift: bool(config.immediateShift, `${path}.immediateShift`), trigger: oneOf(config.trigger, ['manual', 'hit-by-physical-attack'], `${path}.trigger`),
      avoidDamageAndEffects: bool(config.avoidDamageAndEffects, `${path}.avoidDamageAndEffects`),
    }
    case 'aa069.fairy-aura': return {
      affectedRelationships: stringArray(config.affectedRelationships, ['self', 'ally'], `${path}.affectedRelationships`), moveType: oneOf(config.moveType, ['fairy'], `${path}.moveType`),
      damageBaseBonus: integer(config.damageBaseBonus, `${path}.damageBaseBonus`, 1, 1),
    }
    case 'aa069.fashion-designer': return {
      action: oneOf(config.action, ['extended'], `${path}.action`), frequency: oneOf(config.frequency, ['daily'], `${path}.frequency`),
      craftQuantity: integer(config.craftQuantity, `${path}.craftQuantity`, 1, 1), itemIds: stringArray(config.itemIds, ['lucky-leaf', 'tasty-reeds', 'dew-cup', 'thorn-mantle', 'chewy-cluster', 'decorative-twine'], `${path}.itemIds`),
    }
    case 'aa069.fiery-crash': return {
      keyword: oneOf(config.keyword, ['dash'], `${path}.keyword`), choices: stringArray(config.choices, ['damage-base-plus-2', 'fire-type'], `${path}.choices`),
      fireBurnThreshold: integer(config.fireBurnThreshold, `${path}.fireBurnThreshold`, 19, 19), existingBurnRangeBonus: integer(config.existingBurnRangeBonus, `${path}.existingBurnRangeBonus`, 2, 2),
    }
    case 'aa069.filter': return {
      trigger: oneOf(config.trigger, ['super-effective-damage'], `${path}.trigger`), damageReduction: integer(config.damageReduction, `${path}.damageReduction`, 5, 5),
    }
    case 'aa070.flame-body': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      trigger: oneOf(config.trigger, ['hit-by-melee-attack'], `${path}.trigger`), sourceRelation: oneOf(config.sourceRelation, ['enemy'], `${path}.sourceRelation`),
      condition: oneOf(config.condition, ['burned'], `${path}.condition`),
    }
    case 'aa070.flame-tongue': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      connectionMoveId: oneOf(config.connectionMoveId, ['Lick'], `${path}.connectionMoveId`), trigger: oneOf(config.trigger, ['lick-hit-foe'], `${path}.trigger`),
      injuryDelta: integer(config.injuryDelta, `${path}.injuryDelta`, 1, 1), condition: oneOf(config.condition, ['burned'], `${path}.condition`),
    }
    case 'aa070.flare-boost': return {
      action: oneOf(config.action, ['swift'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      requiredCondition: oneOf(config.requiredCondition, ['burned'], `${path}.requiredCondition`), attackStages: integer(config.attackStages, `${path}.attackStages`, 3, 3),
      specialAttackStages: integer(config.specialAttackStages, `${path}.specialAttackStages`, 3, 3),
    }
    case 'aa070.flash-fire': return {
      immuneMoveType: oneOf(config.immuneMoveType, ['fire'], `${path}.immuneMoveType`), preventDamage: bool(config.preventDamage, `${path}.preventDamage`),
      preventEffects: bool(config.preventEffects, `${path}.preventEffects`), onHitStatChoices: stringArray(config.onHitStatChoices, ['attack', 'special-attack'], `${path}.onHitStatChoices`),
      stageDelta: integer(config.stageDelta, `${path}.stageDelta`, 1, 1),
    }
    case 'aa070.flavorful-aroma': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['at-will'], `${path}.frequency`),
      connectionMoveId: oneOf(config.connectionMoveId, ['Aromatic Mist'], `${path}.connectionMoveId`), trigger: oneOf(config.trigger, ['aromatic-mist-use'], `${path}.trigger`),
      affectedRelationship: oneOf(config.affectedRelationship, ['ally'], `${path}.affectedRelationship`), accuracyBonus: integer(config.accuracyBonus, `${path}.accuracyBonus`, 1, 1),
      damageBonus: integer(config.damageBonus, `${path}.damageBonus`, 5, 5), durationRounds: integer(config.durationRounds, `${path}.durationRounds`, 1, 1),
    }
    case 'aa070.flower-gift': return {
      action: oneOf(config.action, ['swift'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      eligibility: stringArray(config.eligibility, ['sunny-weather', 'below-half-hp'], `${path}.eligibility`), statSelections: integer(config.statSelections, `${path}.statSelections`, 2, 2),
      selfStageDelta: integer(config.selfStageDelta, `${path}.selfStageDelta`, 2, 2), nearbyStageDelta: integer(config.nearbyStageDelta, `${path}.nearbyStageDelta`, 1, 1),
      radius: integer(config.radius, `${path}.radius`, 2, 2),
    }
    case 'aa070.flower-power': return {
      moveType: oneOf(config.moveType, ['grass'], `${path}.moveType`), moveFilter: oneOf(config.moveFilter, ['damaging'], `${path}.moveFilter`),
      damageClassChoices: stringArray(config.damageClassChoices, ['physical', 'special'], `${path}.damageClassChoices`),
    }
    case 'aa070.flower-veil': return {
      protectedType: oneOf(config.protectedType, ['grass'], `${path}.protectedType`), radius: integer(config.radius, `${path}.radius`, 5, 5),
      protectUserRegardlessOfType: bool(config.protectUserRegardlessOfType, `${path}.protectUserRegardlessOfType`),
      preventCombatStageLowering: bool(config.preventCombatStageLowering, `${path}.preventCombatStageLowering`),
    }
    case 'aa070.fluffy': return {
      meleeResistanceSteps: integer(config.meleeResistanceSteps, `${path}.meleeResistanceSteps`, 1, 1), fireResistanceSteps: integer(config.fireResistanceSteps, `${path}.fireResistanceSteps`, -1, -1),
      damagingOnly: bool(config.damagingOnly, `${path}.damagingOnly`),
    }
    case 'aa070.fluffy-charge': return {
      connectionMoveId: oneOf(config.connectionMoveId, ['Charge'], `${path}.connectionMoveId`), trigger: oneOf(config.trigger, ['charge-use'], `${path}.trigger`),
      defenseStages: integer(config.defenseStages, `${path}.defenseStages`, 1, 1),
    }
    case 'aa070.flutter': return {
      action: oneOf(config.action, ['shift'], `${path}.action`), frequency: oneOf(config.frequency, ['at-will'], `${path}.frequency`),
      evasionBonus: integer(config.evasionBonus, `${path}.evasionBonus`, 3, 3), duration: oneOf(config.duration, ['through-next-turn-end'], `${path}.duration`),
      cannotBeFlanked: bool(config.cannotBeFlanked, `${path}.cannotBeFlanked`),
    }
    case 'aa070.flying-fly-trap': return {
      damageImmuneMoveTypes: stringArray(config.damageImmuneMoveTypes, ['ground', 'bug'], `${path}.damageImmuneMoveTypes`), effectsRemain: bool(config.effectsRemain, `${path}.effectsRemain`),
    }
    case 'aa071.focus': return {
      lastChanceType: oneOf(config.lastChanceType, ['fighting'], `${path}.lastChanceType`), hpThresholdNumerator: integer(config.hpThresholdNumerator, `${path}.hpThresholdNumerator`, 1, 1),
      hpThresholdDenominator: integer(config.hpThresholdDenominator, `${path}.hpThresholdDenominator`, 3, 3), damageBonus: integer(config.damageBonus, `${path}.damageBonus`, 5, 5),
    }
    case 'aa071.forecast': return {
      weatherKinds: stringArray(config.weatherKinds, ['sunny', 'hail', 'rainy', 'sandstorm'], `${path}.weatherKinds`),
      weatherTypes: stringArray(config.weatherTypes, ['fire', 'ice', 'water', 'rock'], `${path}.weatherTypes`), normalType: oneOf(config.normalType, ['normal'], `${path}.normalType`),
      multipleWeatherChoice: bool(config.multipleWeatherChoice, `${path}.multipleWeatherChoice`),
    }
    case 'aa071.forest-lord': return {
      action: oneOf(config.action, ['shift'], `${path}.action`), frequency: oneOf(config.frequency, ['scene-x2'], `${path}.frequency`),
      moveTypes: stringArray(config.moveTypes, ['grass', 'ghost'], `${path}.moveTypes`), maximumTreeDistance: integer(config.maximumTreeDistance, `${path}.maximumTreeDistance`, 10, 10),
      accuracyBonus: integer(config.accuracyBonus, `${path}.accuracyBonus`, 2, 2), duration: oneOf(config.duration, ['turn'], `${path}.duration`),
    }
    case 'aa071.forewarn': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      targetRelationship: oneOf(config.targetRelationship, ['enemy'], `${path}.targetRelationship`), revealHighestDamageDice: bool(config.revealHighestDamageDice, `${path}.revealHighestDamageDice`),
      revealAllTies: bool(config.revealAllTies, `${path}.revealAllTies`), accuracyPenalty: integer(config.accuracyPenalty, `${path}.accuracyPenalty`, -2, -2),
      duration: oneOf(config.duration, ['encounter'], `${path}.duration`),
    }
    case 'aa071.fox-fire': return {
      action: oneOf(config.action, ['standard'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      connectionMoveId: oneOf(config.connectionMoveId, ['Ember'], `${path}.connectionMoveId`), wispCount: integer(config.wispCount, `${path}.wispCount`, 3, 3),
      trigger: oneOf(config.trigger, ['targeted'], `${path}.trigger`), triggerRelationship: oneOf(config.triggerRelationship, ['enemy'], `${path}.triggerRelationship`),
      triggerRadius: integer(config.triggerRadius, `${path}.triggerRadius`, 6, 6), responseAction: oneOf(config.responseAction, ['free'], `${path}.responseAction`),
      responseTiming: oneOf(config.responseTiming, ['after-triggering-move'], `${path}.responseTiming`),
    }
    case 'aa071.freezing-point': return {
      lastChanceType: oneOf(config.lastChanceType, ['ice'], `${path}.lastChanceType`), hpThresholdNumerator: integer(config.hpThresholdNumerator, `${path}.hpThresholdNumerator`, 1, 1),
      hpThresholdDenominator: integer(config.hpThresholdDenominator, `${path}.hpThresholdDenominator`, 3, 3), damageBonus: integer(config.damageBonus, `${path}.damageBonus`, 5, 5),
    }
    case 'aa071.friend-guard': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      trigger: oneOf(config.trigger, ['adjacent-ally-damaged'], `${path}.trigger`), adjacency: integer(config.adjacency, `${path}.adjacency`, 1, 1),
      resistanceSteps: integer(config.resistanceSteps, `${path}.resistanceSteps`, 1, 1),
    }
    case 'aa071.frighten': return {
      action: oneOf(config.action, ['swift'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      speedStageDelta: integer(config.speedStageDelta, `${path}.speedStageDelta`, -2, -2),
    }
    case 'aa071.frisk': return {
      adjacency: integer(config.adjacency, `${path}.adjacency`, 1, 1), accuracyBonus: integer(config.accuracyBonus, `${path}.accuracyBonus`, 2, 2),
    }
    case 'aa071.frostbite': return {
      moveType: oneOf(config.moveType, ['ice'], `${path}.moveType`), damagingOnly: bool(config.damagingOnly, `${path}.damagingOnly`),
      slowedMinimum: integer(config.slowedMinimum, `${path}.slowedMinimum`, 18, 18), freezeRangeIncrease: integer(config.freezeRangeIncrease, `${path}.freezeRangeIncrease`, 1, 1),
      defaultFreezeMinimum: integer(config.defaultFreezeMinimum, `${path}.defaultFreezeMinimum`, 20, 20),
    }
    case 'aa071.full-guard': return {
      action: oneOf(config.action, ['swift'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      trigger: oneOf(config.trigger, ['damaged-with-temporary-hp'], `${path}.trigger`), resistanceSteps: integer(config.resistanceSteps, `${path}.resistanceSteps`, 1, 1),
    }
    case 'aa071.full-metal-body': return {
      preventCombatStageLoweringFrom: stringArray(config.preventCombatStageLoweringFrom, ['features', 'abilities', 'moves'], `${path}.preventCombatStageLoweringFrom`),
      statusAfflictionStageChangesAllowed: bool(config.statusAfflictionStageChangesAllowed, `${path}.statusAfflictionStageChangesAllowed`),
    }
    case 'aa072.fur-coat': return {
      damageClass: oneOf(config.damageClass, ['physical'], `${path}.damageClass`),
      resistanceSteps: integer(config.resistanceSteps, `${path}.resistanceSteps`, 1, 1),
    }
    case 'aa072.gale-wings': return {
      connectionMoveId: oneOf(config.connectionMoveId, ['Quick Attack'], `${path}.connectionMoveId`),
      fromType: oneOf(config.fromType, ['normal'], `${path}.fromType`),
      optionalType: oneOf(config.optionalType, ['flying'], `${path}.optionalType`),
    }
    case 'aa072.galvanize': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['at-will'], `${path}.frequency`),
      triggerType: oneOf(config.triggerType, ['normal'], `${path}.triggerType`), requiresDamaging: bool(config.requiresDamaging, `${path}.requiresDamaging`),
      toType: oneOf(config.toType, ['electric'], `${path}.toType`),
    }
    case 'aa072.gardener': return {
      action: oneOf(config.action, ['extended'], `${path}.action`), frequency: oneOf(config.frequency, ['daily'], `${path}.frequency`),
      uses: integer(config.uses, `${path}.uses`, 3, 3), targetTag: oneOf(config.targetTag, ['yielding-plant'], `${path}.targetTag`),
      soilQualityDelta: integer(config.soilQualityDelta, `${path}.soilQualityDelta`, 1, 1), oncePerTargetPerDay: bool(config.oncePerTargetPerDay, `${path}.oncePerTargetPerDay`),
    }
    case 'aa072.gentle-vibe': return {
      action: oneOf(config.action, ['standard'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      burstSize: integer(config.burstSize, `${path}.burstSize`, 2, 2), resetCombatStages: bool(config.resetCombatStages, `${path}.resetCombatStages`),
      cureConditionGroup: oneOf(config.cureConditionGroup, ['volatile'], `${path}.cureConditionGroup`),
    }
    case 'aa072.giver': return {
      action: oneOf(config.action, ['swift'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      uses: integer(config.uses, `${path}.uses`, 2, 2), connectionMoveId: oneOf(config.connectionMoveId, ['Present'], `${path}.connectionMoveId`),
      forcedRollValues: integerArray(config.forcedRollValues, [1, 5], `${path}.forcedRollValues`),
    }
    case 'aa072.glisten': return { immuneMoveType: oneOf(config.immuneMoveType, ['fairy'], `${path}.immuneMoveType`) }
    case 'aa072.gluttony': return {
      foodBuffCapacity: integer(config.foodBuffCapacity, `${path}.foodBuffCapacity`, 3, 3),
      foodBuffUsesPerScene: integer(config.foodBuffUsesPerScene, `${path}.foodBuffUsesPerScene`, 3, 3),
      refreshmentsPerHalfHour: integer(config.refreshmentsPerHalfHour, `${path}.refreshmentsPerHalfHour`, 2, 2),
    }
    case 'aa072.gooey': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['at-will'], `${path}.frequency`),
      triggerRange: oneOf(config.triggerRange, ['melee'], `${path}.triggerRange`), speedStageDelta: integer(config.speedStageDelta, `${path}.speedStageDelta`, -1, -1),
    }
    case 'aa072.gore': return {
      action: oneOf(config.action, ['swift'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      uses: integer(config.uses, `${path}.uses`, 2, 2), connectionMoveId: oneOf(config.connectionMoveId, ['Horn Attack'], `${path}.connectionMoveId`),
      grantKeyword: oneOf(config.grantKeyword, ['double-strike'], `${path}.grantKeyword`), pushDistance: integer(config.pushDistance, `${path}.pushDistance`, 2, 2),
    }
    case 'aa072.gorilla-tactics': return {
      action: oneOf(config.action, ['swift'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      damageBonus: integer(config.damageBonus, `${path}.damageBonus`, 10, 10), duration: oneOf(config.duration, ['scene'], `${path}.duration`),
      restrictToPreviouslyUsedMoves: bool(config.restrictToPreviouslyUsedMoves, `${path}.restrictToPreviouslyUsedMoves`),
    }
    case 'aa072.grass-pelt': return {
      action: oneOf(config.action, ['swift'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      temporaryHpTicks: integer(config.temporaryHpTicks, `${path}.temporaryHpTicks`, 2, 2),
    }
    case 'aa073.grassy-surge': return {
      action: oneOf(config.action, ['swift'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      uses: integer(config.uses, `${path}.uses`, 3, 3), terrain: oneOf(config.terrain, ['grassy'], `${path}.terrain`),
      durationRounds: integer(config.durationRounds, `${path}.durationRounds`, 1, 1),
    }
    case 'aa073.grim-neigh': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['at-will'], `${path}.frequency`),
      damagingOnly: bool(config.damagingOnly, `${path}.damagingOnly`), faintedRelationship: oneOf(config.faintedRelationship, ['enemy'], `${path}.faintedRelationship`),
      specialAttackStages: integer(config.specialAttackStages, `${path}.specialAttackStages`, 1, 1), foeRadius: integer(config.foeRadius, `${path}.foeRadius`, 3, 3),
      accuracyPenalty: integer(config.accuracyPenalty, `${path}.accuracyPenalty`, -2, -2), durationRounds: integer(config.durationRounds, `${path}.durationRounds`, 1, 1),
    }
    case 'aa073.gulp': return {
      action: oneOf(config.action, ['extended'], `${path}.action`), frequency: oneOf(config.frequency, ['daily'], `${path}.frequency`),
      submergedMinutes: integer(config.submergedMinutes, `${path}.submergedMinutes`, 10, 10), healingNumerator: integer(config.healingNumerator, `${path}.healingNumerator`, 1, 1),
      healingDenominator: integer(config.healingDenominator, `${path}.healingDenominator`, 4, 4), injuriesRemoved: integer(config.injuriesRemoved, `${path}.injuriesRemoved`, 1, 1),
    }
    case 'aa073.gulp-missile': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`), uses: integer(config.uses, `${path}.uses`, 2, 2),
      connectionMoveId: oneOf(config.connectionMoveId, ['Stockpile'], `${path}.connectionMoveId`), triggerMoveIds: stringArray(config.triggerMoveIds, ['Stockpile', 'Surf', 'Dive'], `${path}.triggerMoveIds`),
      attackAc: integer(config.attackAc, `${path}.attackAc`, 4, 4), attackClass: oneOf(config.attackClass, ['physical'], `${path}.attackClass`), hpLossTicks: integer(config.hpLossTicks, `${path}.hpLossTicks`, 2, 2),
      evenCondition: oneOf(config.evenCondition, ['paralyzed'], `${path}.evenCondition`), oddDefenseStageDelta: integer(config.oddDefenseStageDelta, `${path}.oddDefenseStageDelta`, -1, -1),
    }
    case 'aa073.guts': return {
      conditions: stringArray(config.conditions, ['burned', 'poisoned', 'paralysis', 'frozen', 'sleep'], `${path}.conditions`),
      attackStages: integer(config.attackStages, `${path}.attackStages`, 2, 2),
    }
    case 'aa073.handyman': return {
      heldItemCapacity: integer(config.heldItemCapacity, `${path}.heldItemCapacity`, 2, 2), chooseAffectedItem: bool(config.chooseAffectedItem, `${path}.chooseAffectedItem`),
    }
    case 'aa073.harvest': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['at-will'], `${path}.frequency`), itemFamily: oneOf(config.itemFamily, ['berry'], `${path}.itemFamily`),
      coinSides: integer(config.coinSides, `${path}.coinSides`, 2, 2), retainOnResult: oneOf(config.retainOnResult, ['heads'], `${path}.retainOnResult`), sunnyAlwaysRetains: bool(config.sunnyAlwaysRetains, `${path}.sunnyAlwaysRetains`),
      tradesPerTurn: integer(config.tradesPerTurn, `${path}.tradesPerTurn`, 1, 1), stopAfterResult: oneOf(config.stopAfterResult, ['tails'], `${path}.stopAfterResult`),
    }
    case 'aa073.haunt': return {
      lastChanceType: oneOf(config.lastChanceType, ['ghost'], `${path}.lastChanceType`), hpThresholdNumerator: integer(config.hpThresholdNumerator, `${path}.hpThresholdNumerator`, 1, 1),
      hpThresholdDenominator: integer(config.hpThresholdDenominator, `${path}.hpThresholdDenominator`, 3, 3), damageBonus: integer(config.damageBonus, `${path}.damageBonus`, 5, 5),
    }
    case 'aa073.hay-fever': return {
      action: oneOf(config.action, ['swift'], `${path}.action`), frequency: oneOf(config.frequency, ['at-will'], `${path}.frequency`), branch: oneOf(config.branch, ['burst-2', 'close-blast-3'], `${path}.branch`),
      triggers: stringArray(config.triggers, ['status-move-used', 'asleep-turn-end'], `${path}.triggers`), excludedWeather: stringArray(config.excludedWeather, ['rainy', 'sandstorm', 'hail'], `${path}.excludedWeather`),
      immuneTypes: stringArray(config.immuneTypes, ['bug', 'grass', 'poison'], `${path}.immuneTypes`), hpLossTicks: integer(config.hpLossTicks, `${path}.hpLossTicks`, 1, 1),
    }
    case 'aa073.healer': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`), adjacency: integer(config.adjacency, `${path}.adjacency`, 1, 1),
      cureConditionGroup: oneOf(config.cureConditionGroup, ['all-status'], `${path}.cureConditionGroup`),
    }
    case 'aa073.heat-mirage': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['at-will'], `${path}.frequency`), triggerType: oneOf(config.triggerType, ['fire'], `${path}.triggerType`),
      evasionBonus: integer(config.evasionBonus, `${path}.evasionBonus`, 3, 3), duration: oneOf(config.duration, ['until-next-turn-start'], `${path}.duration`),
    }
    case 'aa073.heatproof': return {
      moveType: oneOf(config.moveType, ['fire'], `${path}.moveType`), resistanceSteps: integer(config.resistanceSteps, `${path}.resistanceSteps`, 1, 1),
      preventBurnHpLoss: bool(config.preventBurnHpLoss, `${path}.preventBurnHpLoss`),
    }
    case 'aa074.heavy-metal': return {
      weightClassBonus: integer(config.weightClassBonus, `${path}.weightClassBonus`, 2, 2),
      defenseBaseStatBonus: integer(config.defenseBaseStatBonus, `${path}.defenseBaseStatBonus`, 2, 2),
      speedBaseStatPenalty: integer(config.speedBaseStatPenalty, `${path}.speedBaseStatPenalty`, -2, -2),
    }
    case 'aa074.heliovolt': return {
      action: oneOf(config.action, ['swift'], `${path}.action`), frequency: oneOf(config.frequency, ['at-will'], `${path}.frequency`),
      triggerType: oneOf(config.triggerType, ['electric'], `${path}.triggerType`), evasionBonus: integer(config.evasionBonus, `${path}.evasionBonus`, 1, 1),
      consideredWeather: oneOf(config.consideredWeather, ['sunny'], `${path}.consideredWeather`), durationRounds: integer(config.durationRounds, `${path}.durationRounds`, 1, 1),
    }
    case 'aa074.helper': return {
      connectionMoveId: oneOf(config.connectionMoveId, ['Helping Hand'], `${path}.connectionMoveId`), targetRelationship: oneOf(config.targetRelationship, ['ally'], `${path}.targetRelationship`),
      targetCount: integer(config.targetCount, `${path}.targetCount`, 1, 1), accuracyBonus: integer(config.accuracyBonus, `${path}.accuracyBonus`, 1, 1),
      skillCheckBonus: integer(config.skillCheckBonus, `${path}.skillCheckBonus`, 1, 1), duration: oneOf(config.duration, ['until-user-next-turn-end'], `${path}.duration`),
    }
    case 'aa074.honey-paws': return {
      consumedItemId: oneOf(config.consumedItemId, ['honey'], `${path}.consumedItemId`), equivalentBuffItemId: oneOf(config.equivalentBuffItemId, ['leftovers'], `${path}.equivalentBuffItemId`),
      ignoresNormalDigestionCapacity: bool(config.ignoresNormalDigestionCapacity, `${path}.ignoresNormalDigestionCapacity`),
      explicitPreparationRequired: bool(config.explicitPreparationRequired, `${path}.explicitPreparationRequired`),
      preparationDuration: oneOf(config.preparationDuration, ['scene-or-consumed'], `${path}.preparationDuration`),
    }
    case 'aa074.honey-thief': return {
      connectionMoveId: oneOf(config.connectionMoveId, ['Bug Bite'], `${path}.connectionMoveId`), trigger: oneOf(config.trigger, ['digestion-buff-stolen'], `${path}.trigger`),
      temporaryHpTicks: integer(config.temporaryHpTicks, `${path}.temporaryHpTicks`, 1, 1),
    }
    case 'aa074.horde-break': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['at-will'], `${path}.frequency`),
      fromForm: oneOf(config.fromForm, ['school-form'], `${path}.fromForm`), toForm: oneOf(config.toForm, ['solo-form'], `${path}.toForm`),
      cureConditionGroup: oneOf(config.cureConditionGroup, ['all-status'], `${path}.cureConditionGroup`),
    }
    case 'aa074.huge-power': return {
      stat: oneOf(config.stat, ['attack'], `${path}.stat`), operation: oneOf(config.operation, ['double-base'], `${path}.operation`),
      includeNature: bool(config.includeNature, `${path}.includeNature`), includeVitamins: bool(config.includeVitamins, `${path}.includeVitamins`),
      includeTrainerFeatures: bool(config.includeTrainerFeatures, `${path}.includeTrainerFeatures`),
    }
    case 'aa074.huge-power-pure-power': return {
      stat: oneOf(config.stat, ['attack'], `${path}.stat`), baseBonus: integer(config.baseBonus, `${path}.baseBonus`, 5, 5),
      bonusPerLevels: integer(config.bonusPerLevels, `${path}.bonusPerLevels`, 10, 10), cannotBeDisabled: bool(config.cannotBeDisabled, `${path}.cannotBeDisabled`),
    }
    case 'aa074.hunger-switch': return {
      timing: oneOf(config.timing, ['turn-start'], `${path}.timing`), fullBellyMode: oneOf(config.fullBellyMode, ['full-belly'], `${path}.fullBellyMode`),
      hangryMode: oneOf(config.hangryMode, ['hangry'], `${path}.hangryMode`), fullBellyAccuracyBonus: integer(config.fullBellyAccuracyBonus, `${path}.fullBellyAccuracyBonus`, 2, 2),
      hangryDamageBonus: integer(config.hangryDamageBonus, `${path}.hangryDamageBonus`, 5, 5), duration: oneOf(config.duration, ['until-next-turn-start'], `${path}.duration`),
      choiceRequired: bool(config.choiceRequired, `${path}.choiceRequired`),
    }
    case 'aa074.hustle': return {
      accuracyPenalty: integer(config.accuracyPenalty, `${path}.accuracyPenalty`, -2, -2), damageRollBonus: integer(config.damageRollBonus, `${path}.damageRollBonus`, 10, 10),
      appliesToAllMoves: bool(config.appliesToAllMoves, `${path}.appliesToAllMoves`),
    }
    case 'aa074.hydration': return {
      action: oneOf(config.action, ['swift'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      cureCount: integer(config.cureCount, `${path}.cureCount`, 1, 1), rainyWeatherIgnoresFrequency: bool(config.rainyWeatherIgnoresFrequency, `${path}.rainyWeatherIgnoresFrequency`),
    }
    case 'aa074.hyper-cutter': return {
      protectedStat: oneOf(config.protectedStat, ['attack'], `${path}.protectedStat`), preventStatLowering: bool(config.preventStatLowering, `${path}.preventStatLowering`),
      preventCombatStageLowering: bool(config.preventCombatStageLowering, `${path}.preventCombatStageLowering`),
    }
    case 'aa075.hypnotic': return {
      connectionMoveId: oneOf(config.connectionMoveId, ['Hypnosis'], `${path}.connectionMoveId`), automaticHit: bool(config.automaticHit, `${path}.automaticHit`),
    }
    case 'aa075.ice-body': return {
      action: oneOf(config.action, ['swift'], `${path}.action`), frequency: oneOf(config.frequency, ['daily-x5'], `${path}.frequency`),
      healingTicks: integer(config.healingTicks, `${path}.healingTicks`, 1, 1), hpThresholdNumerator: integer(config.hpThresholdNumerator, `${path}.hpThresholdNumerator`, 1, 1),
      hpThresholdDenominator: integer(config.hpThresholdDenominator, `${path}.hpThresholdDenominator`, 2, 2), weatherAlternative: oneOf(config.weatherAlternative, ['hail'], `${path}.weatherAlternative`),
    }
    case 'aa075.ice-face': return {
      action: oneOf(config.action, ['standard'], `${path}.action`), requiredWeather: oneOf(config.requiredWeather, ['hail'], `${path}.requiredWeather`),
      temporaryHpTicks: integer(config.temporaryHpTicks, `${path}.temporaryHpTicks`, 2, 2), battleStartTemporaryHpTicks: integer(config.battleStartTemporaryHpTicks, `${path}.battleStartTemporaryHpTicks`, 2, 2),
      hailDamageImmunity: bool(config.hailDamageImmunity, `${path}.hailDamageImmunity`), iceForm: oneOf(config.iceForm, ['ice-face'], `${path}.iceForm`), noiceForm: oneOf(config.noiceForm, ['noice-face'], `${path}.noiceForm`),
    }
    case 'aa075.ice-scales': return {
      damageClass: oneOf(config.damageClass, ['special'], `${path}.damageClass`), resistanceSteps: integer(config.resistanceSteps, `${path}.resistanceSteps`, 1, 1),
    }
    case 'aa075.ice-shield': return {
      action: oneOf(config.action, ['standard-interrupt'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      maximumSegments: integer(config.maximumSegments, `${path}.maximumSegments`, 3, 3), requiredAdjacentSegments: integer(config.requiredAdjacentSegments, `${path}.requiredAdjacentSegments`, 1, 1),
      contiguous: bool(config.contiguous, `${path}.contiguous`), segmentHeight: integer(config.segmentHeight, `${path}.segmentHeight`, 2, 2),
      segmentHitPoints: integer(config.segmentHitPoints, `${path}.segmentHitPoints`, 10, 10), segmentDamageReduction: integer(config.segmentDamageReduction, `${path}.segmentDamageReduction`, 5, 5),
      segmentType: oneOf(config.segmentType, ['ice'], `${path}.segmentType`), duration: oneOf(config.duration, ['encounter'], `${path}.duration`), blockingTerrain: bool(config.blockingTerrain, `${path}.blockingTerrain`),
    }
    case 'aa075.ignition-boost': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['at-will'], `${path}.frequency`),
      triggerRelationship: oneOf(config.triggerRelationship, ['adjacent-ally'], `${path}.triggerRelationship`), triggerType: oneOf(config.triggerType, ['fire'], `${path}.triggerType`),
      damagingOnly: bool(config.damagingOnly, `${path}.damagingOnly`), damageBonus: integer(config.damageBonus, `${path}.damageBonus`, 5, 5), maximumBenefits: integer(config.maximumBenefits, `${path}.maximumBenefits`, 1, 1),
    }
    case 'aa075.illuminate': return {
      incomingAccuracyPenalty: integer(config.incomingAccuracyPenalty, `${path}.incomingAccuracyPenalty`, -2, -2), bypassCapability: oneOf(config.bypassCapability, ['blindsense'], `${path}.bypassCapability`),
    }
    case 'aa075.illusion': return {
      operation: oneOf(config.operation, ['mark-creature', 'mark-object', 'replace-creature', 'replace-object', 'assume', 'dismiss'], `${path}.operation`),
      markAction: oneOf(config.markAction, ['standard'], `${path}.markAction`), assumeAction: oneOf(config.assumeAction, ['free'], `${path}.assumeAction`), dismissAction: oneOf(config.dismissAction, ['free'], `${path}.dismissAction`),
      markCapacitySource: oneOf(config.markCapacitySource, ['focus-rank'], `${path}.markCapacitySource`), assumeFrequency: oneOf(config.assumeFrequency, ['once-per-round'], `${path}.assumeFrequency`),
      appearanceOnly: bool(config.appearanceOnly, `${path}.appearanceOnly`), breakTrigger: oneOf(config.breakTrigger, ['damaging-move-hit'], `${path}.breakTrigger`),
    }
    case 'aa075.immunity': return {
      blockedConditions: stringArray(config.blockedConditions, ['poisoned', 'badly-poisoned'], `${path}.blockedConditions`),
    }
    case 'aa075.imposter': return {
      connectionMoveId: oneOf(config.connectionMoveId, ['Transform'], `${path}.connectionMoveId`), actionOverride: oneOf(config.actionOverride, ['free-interrupt'], `${path}.actionOverride`),
      requiresUntransformed: bool(config.requiresUntransformed, `${path}.requiresUntransformed`),
    }
    case 'aa075.infiltrator': return {
      stealthBonus: integer(config.stealthBonus, `${path}.stealthBonus`, 2, 2), ignoreHazards: bool(config.ignoreHazards, `${path}.ignoreHazards`),
      blockResponsiveBlessings: bool(config.blockResponsiveBlessings, `${path}.blockResponsiveBlessings`), bypassSubstitute: bool(config.bypassSubstitute, `${path}.bypassSubstitute`),
    }
    case 'aa075.innards-out': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['scene-x2'], `${path}.frequency`), damagingOnly: bool(config.damagingOnly, `${path}.damagingOnly`),
      resistanceSteps: integer(config.resistanceSteps, `${path}.resistanceSteps`, 1, 1), foeRange: integer(config.foeRange, `${path}.foeRange`, 2, 2), reflectedRealHpMultiplier: integer(config.reflectedRealHpMultiplier, `${path}.reflectedRealHpMultiplier`, 2, 2),
      resolvesAfterAttack: bool(config.resolvesAfterAttack, `${path}.resolvesAfterAttack`), resolvesAfterFainting: bool(config.resolvesAfterFainting, `${path}.resolvesAfterFainting`),
    }
    case 'aa076.inner-focus': return {
      blockedConditions: stringArray(config.blockedConditions, ['flinch'], `${path}.blockedConditions`),
      preventUnwillingInitiativeLowering: bool(config.preventUnwillingInitiativeLowering, `${path}.preventUnwillingInitiativeLowering`),
    }
    case 'aa076.insomnia': return {
      blockedConditions: stringArray(config.blockedConditions, ['sleep'], `${path}.blockedConditions`),
      blockedMoveIds: stringArray(config.blockedMoveIds, ['Rest'], `${path}.blockedMoveIds`),
    }
    case 'aa076.instinct': return {
      defaultEvasionBonus: integer(config.defaultEvasionBonus, `${path}.defaultEvasionBonus`, 2, 2),
    }
    case 'aa076.interference': return {
      action: oneOf(config.action, ['swift'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      targetRelationship: oneOf(config.targetRelationship, ['foes'], `${path}.targetRelationship`), radius: integer(config.radius, `${path}.radius`, 3, 3),
      accuracyPenalty: integer(config.accuracyPenalty, `${path}.accuracyPenalty`, -2, -2), duration: oneOf(config.duration, ['one-full-round'], `${path}.duration`),
    }
    case 'aa076.intimidate': return {
      action: oneOf(config.action, ['swift'], `${path}.action`), frequency: oneOf(config.frequency, ['at-will'], `${path}.frequency`),
      targetRelationship: oneOf(config.targetRelationship, ['foe'], `${path}.targetRelationship`), range: integer(config.range, `${path}.range`, 5, 5),
      attackStageDelta: integer(config.attackStageDelta, `${path}.attackStageDelta`, -1, -1), perTargetFrequency: oneOf(config.perTargetFrequency, ['scene'], `${path}.perTargetFrequency`),
    }
    case 'aa076.intrepid-sword': return {
      stat: oneOf(config.stat, ['attack'], `${path}.stat`), defaultStageBonus: integer(config.defaultStageBonus, `${path}.defaultStageBonus`, 1, 1),
    }
    case 'aa076.iron-barbs': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['at-will'], `${path}.frequency`),
      trigger: oneOf(config.trigger, ['damaging-melee-hit'], `${path}.trigger`), hitPointLossTicks: integer(config.hitPointLossTicks, `${path}.hitPointLossTicks`, 1, 1),
      reaction: bool(config.reaction, `${path}.reaction`),
    }
    case 'aa076.iron-fist': return {
      moveIds: stringArray(config.moveIds, ['Bullet Punch', 'Comet Punch', 'Dizzy Punch', 'Double Iron Bash', 'Drain Punch', 'Dynamic Punch', 'Fire Punch', 'Focus Punch', 'Hammer Arm', 'Ice Punch', 'Mach Punch', 'Mega Punch', 'Meteor Mash', 'Power-Up Punch', 'Shadow Punch', 'Sky Uppercut', 'Thunder Punch'], `${path}.moveIds`),
      damageBaseBonus: integer(config.damageBaseBonus, `${path}.damageBaseBonus`, 2, 2),
    }
    case 'aa076.juicy-energy': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['daily'], `${path}.frequency`),
      consumedBuffItemId: oneOf(config.consumedBuffItemId, ['shuckles-berry-juice'], `${path}.consumedBuffItemId`), ordinaryHealing: integer(config.ordinaryHealing, `${path}.ordinaryHealing`, 30, 30),
      replacementHealing: oneOf(config.replacementHealing, ['user-level'], `${path}.replacementHealing`),
    }
    case 'aa076.justified': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['at-will'], `${path}.frequency`),
      triggerMoveType: oneOf(config.triggerMoveType, ['dark'], `${path}.triggerMoveType`), triggerAttackOfOpportunity: bool(config.triggerAttackOfOpportunity, `${path}.triggerAttackOfOpportunity`),
      attackStageDelta: integer(config.attackStageDelta, `${path}.attackStageDelta`, 1, 1), interceptCheckBonus: integer(config.interceptCheckBonus, `${path}.interceptCheckBonus`, 4, 4),
    }
    case 'aa076.kampfgeist': return {
      action: oneOf(config.action, ['free'], `${path}.action`), frequency: oneOf(config.frequency, ['scene'], `${path}.frequency`),
      triggerTypes: stringArray(config.triggerTypes, ['bug', 'dark', 'rock'], `${path}.triggerTypes`), resistanceSteps: integer(config.resistanceSteps, `${path}.resistanceSteps`, 1, 1),
      bonusStabType: oneOf(config.bonusStabType, ['fighting'], `${path}.bonusStabType`),
    }
    case 'aa076.keen-eye': return {
      protectAccuracyStage: bool(config.protectAccuracyStage, `${path}.protectAccuracyStage`), ignoreAccuracyPenalties: bool(config.ignoreAccuracyPenalties, `${path}.ignoreAccuracyPenalties`),
      blockedCondition: oneOf(config.blockedCondition, ['blindness'], `${path}.blockedCondition`), excludedCondition: oneOf(config.excludedCondition, ['total-blindness'], `${path}.excludedCondition`),
      ignoreNonStatEvasion: bool(config.ignoreNonStatEvasion, `${path}.ignoreNonStatEvasion`),
    }
  }
}
export const parseAbilityMechanicOperation = (value: unknown, path = 'abilityMechanic'): AbilityMechanicOperation => {
  const cloned = cloneStrictJson(value, path, {
    limits: { depth: 5, nodes: 160, objectFields: 16, arrayEntries: 32, stringLength: 200, objectKeyLength: 200 },
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
