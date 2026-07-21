import type { AbilitySpecV1Registration } from '../registry'
import {
  abilityMechanicOperation as mechanic,
  noAbilityTarget as noneTarget,
  moveAbilityTarget as moveTarget,
  reviewedAbilitySpec as base,
  reviewedActivatedAbilitySpec as activatedSpec,
  reviewedStaticAbilitySpec as staticSpec,
  reviewedTriggeredAbilitySpec as triggeredSpec,
} from './reviewedSpecBuilder'

const strikePredicate = (overrides: Record<string, unknown>) => ({
  kind: 'ability-strike-fact', timings: ['damage-resolved'], accuracyOutcomes: [],
  rangeContexts: [], directness: [], moveTypes: [], damageClasses: [], effectiveness: [],
  contact: 'any', critical: 'any', ownerRole: 'defender', prevention: 'any',
  strikeIndex: 'any', minimumHpLoss: null, minimumTotalLoss: null,
  ...overrides,
})
export const ABOMINABLE_ABILITY_SPEC = staticSpec('Abominable', 'aa060.abominable', {
  baseHpBonus: 5, ignoreRecoil: true,
}, ['hp', 'recoil', 'static'])
export const ABSORB_FORCE_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Absorb Force', mechanicId: 'aa060.absorb-force',
  config: { damageClass: 'physical', resistanceSteps: 1 },
  eventKind: 'strike', checkpoint: 'pre-effect',
  predicate: strikePredicate({ damageClasses: ['physical'], minimumHpLoss: 1 }),
  tags: ['damage', 'resistance', 'triggered'],
})
export const ACCELERATE_ABILITY_SPEC = activatedSpec('Accelerate', 'aa060.accelerate', {
  requiresDamaging: true, requiresStab: true, speedNumerator: 1, speedDenominator: 2,
  existingPriorityAccuracyBonus: 4,
}, moveTarget('activate'), ['accuracy', 'damage', 'priority'])
export const ADAPTABILITY_ABILITY_SPEC = staticSpec('Adaptability', 'aa060.adaptability', {
  requiresStab: true, bonusDiceCount: 1, bonusDiceSides: 10,
}, ['damage', 'random', 'stab', 'static'])
export const AERILATE_ABILITY_SPEC = activatedSpec('Aerilate', 'aa060.aerilate', {
  fromType: 'normal', toType: 'flying', requiresDamaging: true,
}, moveTarget('activate'), ['move-type', 'triggered-response'])
export const AFTERMATH_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Aftermath', mechanicId: 'aa060.aftermath',
  config: { burstSize: 1, tickLoss: 3 }, eventKind: 'hp', checkpoint: 'post-effect',
  predicate: {
    kind: 'ability-hp-fact', changeKinds: [], faintTransitions: ['fainted'], ownerRole: 'subject',
    massiveDamage: 'any', crossedZero: 'required', injuryChange: 'any', temporaryChange: 'any',
    hpThreshold: 'zero', minimumAppliedAmount: null,
  },
  tags: ['area', 'fainted', 'hp', 'triggered'],
})
export const AIR_LOCK_ABILITY_SPEC = base({
  canonicalId: 'Air Lock',
  modes: [{ id: 'activate', kind: 'activated' }, { id: 'sustain', kind: 'activated' }],
  targeting: [...noneTarget('activate'), ...noneTarget('sustain')],
  phases: [
    { modeId: 'activate', phase: 'effect', operations: [mechanic('activate.mechanic', 'aa060.air-lock', {
      weatherKind: 'normal', sustainAction: 'swift',
    })] },
    { modeId: 'sustain', phase: 'effect', operations: [mechanic('sustain.mechanic', 'aa060.air-lock', {
      weatherKind: 'normal', sustainAction: 'swift',
    })] },
  ],
  tags: ['field', 'lifecycle', 'weather'],
})
export const AMBUSH_ABILITY_SPEC = activatedSpec('Ambush', 'aa060.ambush', {
  maximumDamageBase: 6, accuracyPenalty: -2, durationRounds: 1, conditionId: 'flinched',
}, moveTarget('activate'), ['accuracy', 'condition', 'priority'])
export const ANALYTIC_ABILITY_SPEC = staticSpec('Analytic', 'aa060.analytic', {
  damageBonus: 5, requiresTargetActedEarlier: true,
}, ['damage', 'initiative', 'static'])
export const ANCHORED_ABILITY_SPEC = base({
  canonicalId: 'Anchored',
  modes: [{ id: 'passive', kind: 'static' }, { id: 'shift-anchor', kind: 'activated' }],
  targeting: [
    ...noneTarget('passive'),
    { id: 'shift-anchor.cell', modeId: 'shift-anchor', kind: 'cell', minSelections: 1, maxSelections: 1, selector: null, predicate: null },
    { id: 'shift-anchor.move', modeId: 'shift-anchor', kind: 'move', minSelections: 0, maxSelections: 1, selector: null, predicate: null },
  ],
  phases: [
    { modeId: 'passive', phase: 'effect', operations: [mechanic('passive.mechanic', 'aa060.anchored', {
      maximumDistance: 3, anchorShiftAction: 'swift', attackRangeId: 'melee-1-target', bonusDiceCount: 2, bonusDiceSides: 6, forcePhysical: true,
    })] },
    { modeId: 'shift-anchor', phase: 'effect', operations: [mechanic('shift-anchor.mechanic', 'aa060.anchored', {
      maximumDistance: 3, anchorShiftAction: 'swift', attackRangeId: 'melee-1-target', bonusDiceCount: 2, bonusDiceSides: 6, forcePhysical: true,
    })] },
  ],
  tags: ['entity', 'movement', 'nested-move', 'static'],
})
export const ANGER_POINT_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Anger Point', mechanicId: 'aa060.anger-point',
  config: { attackStages: 6, conditionId: 'enraged' }, eventKind: 'strike', checkpoint: 'post-effect',
  predicate: strikePredicate({ critical: 'required' }),
  tags: ['condition', 'critical', 'stage', 'triggered'],
})
export const ANTICIPATION_ABILITY_SPEC = activatedSpec('Anticipation', 'aa060.anticipation', {
  usesPerTargetPerEncounter: 1, revealSpecificMoves: false,
}, [{
  id: 'activate.target', modeId: 'activate', kind: 'token', minSelections: 1, maxSelections: 1,
  selector: { kind: 'candidate-targets' },
  predicate: {
    kind: 'ability-targeting', relationship: 'other', willingness: 'any', excludeActor: true,
    minimumRange: 0, maximumRange: null, visibility: 'required', lineOfSight: 'ignored',
    geometry: { kind: 'direct' },
  },
}], ['hidden-information', 'target-history'])

export const AA060_ABILITY_SPECS = Object.freeze([
  ABOMINABLE_ABILITY_SPEC, ABSORB_FORCE_ABILITY_SPEC, ACCELERATE_ABILITY_SPEC,
  ADAPTABILITY_ABILITY_SPEC, AERILATE_ABILITY_SPEC, AFTERMATH_ABILITY_SPEC,
  AIR_LOCK_ABILITY_SPEC, AMBUSH_ABILITY_SPEC, ANALYTIC_ABILITY_SPEC,
  ANCHORED_ABILITY_SPEC, ANGER_POINT_ABILITY_SPEC, ANTICIPATION_ABILITY_SPEC,
])
export const AA060_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = Object.freeze(
  AA060_ABILITY_SPECS.map(spec => ({
    canonicalId: spec.canonicalId,
    sourceModule: 'server/domain/abilityAutomation/specs/aa060.ts',
    spec,
  })),
)
