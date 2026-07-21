import type { AbilitySpecV1Registration } from '../registry'
import {
  noAbilityTarget as noneTarget,
  reviewedActivatedAbilitySpec as activatedSpec,
  reviewedStaticAbilitySpec as staticSpec,
  reviewedTriggeredAbilitySpec as triggeredSpec,
} from './reviewedSpecBuilder'

const moveTrigger = (input: {
  timings: readonly ('declared' | 'use-started' | 'accuracy-resolved' | 'effects-resolved' | 'completed' | 'cancelled')[]
  userRelation: 'owner' | 'other' | 'any'
  targetRelation: 'hit' | 'attacked' | 'missed' | 'critical' | 'declared' | 'not-targeted' | 'any'
}) => ({
  kind: 'ability-move-fact' as const,
  timings: [...input.timings],
  moveTypes: [], damageClasses: [], keywordsAny: [], keywordsAll: [],
  userRelation: input.userRelation, targetRelation: input.targetRelation,
})

const attackerFaintTrigger = {
  kind: 'ability-hp-fact', changeKinds: ['damage'], faintTransitions: ['fainted'], ownerRole: 'actor',
  massiveDamage: 'any', crossedZero: 'required', injuryChange: 'any', temporaryChange: 'any',
  hpThreshold: 'zero', minimumAppliedAmount: 1,
}

const combatStatTarget = [{
  id: 'activate.stat', modeId: 'activate', kind: 'stat', minSelections: 1, maxSelections: 1,
  selector: null,
  predicate: {
    kind: 'ability-stat-options',
    statIds: ['attack', 'defense', 'special-attack', 'special-defense', 'speed'],
  },
}]

export const CLUSTER_MIND_ABILITY_SPEC = staticSpec('Cluster Mind', 'aa064.cluster-mind', {
  movePoolSlots: 2,
}, ['move-list', 'provider', 'static'])

export const COLOR_CHANGE_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Color Change', mechanicId: 'aa064.color-change',
  config: { action: 'free', frequency: 'at-will', typeSource: 'triggering-move', duration: 'scene' },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: moveTrigger({ timings: ['effects-resolved'], userRelation: 'other', targetRelation: 'hit' }),
  tags: ['action', 'reaction', 'triggered', 'type'],
})

export const COLOR_THEORY_ABILITY_SPEC = staticSpec('Color Theory', 'aa064.color-theory', {
  parameterId: 'color', acquisition: 'server-roll', dieSides: 12,
  pureBonus: 6, mixedBonus: 3,
  statByColor: {
    red: ['attack'], 'red-orange': ['attack', 'defense'], orange: ['defense'],
    'yellow-orange': ['defense', 'special-attack'], yellow: ['special-attack'],
    'yellow-green': ['special-attack', 'special-defense'], green: ['special-defense'],
    'blue-green': ['special-defense', 'speed'], blue: ['speed'],
    'blue-violet': ['speed', 'hp'], violet: ['hp'], 'red-violet': ['hp', 'attack'],
  },
}, ['parameter', 'random', 'stat', 'static'])

export const COMATOSE_ABILITY_SPEC = activatedSpec('Comatose', 'aa064.comatose', {
  action: 'move', frequency: 'at-will', condition: 'asleep', healing: 'tick',
}, noneTarget('activate'), ['action', 'condition', 'healing', 'mode.activated'])

export const COMBO_STRIKER_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Combo Striker', mechanicId: 'aa064.combo-striker',
  config: {
    action: 'free', frequency: 'at-will', damagingOnly: true,
    naturalAccuracyResults: [1, 10, 11], followUpMoveId: 'Struggle', recursive: true,
  },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: moveTrigger({ timings: ['completed'], userRelation: 'owner', targetRelation: 'any' }),
  tags: ['action', 'nested-move', 'reaction', 'roll', 'triggered'],
  // Canonical text explicitly permits each granted Struggle to trigger again.
  oncePerCausalChain: false,
})

export const COMPETITIVE_ABILITY_SPEC = staticSpec('Competitive', 'aa064.competitive', {
  trigger: 'combat-stage-lowered', excludedSources: ['own-move', 'own-ability'],
  resultingStage: 'special-attack', resultingDelta: 2,
}, ['combat-stage', 'reactive', 'static'])

export const COMPOUND_EYES_ABILITY_SPEC = staticSpec('Compound Eyes', 'aa064.compound-eyes', {
  accuracyRollBonus: 3,
}, ['accuracy', 'provider', 'static'])

export const CONFIDENCE_ABILITY_SPEC = activatedSpec('Confidence', 'aa064.confidence', {
  action: 'standard', frequency: 'scene', relationship: 'ally', radius: 5,
  stageDelta: 1,
}, combatStatTarget, ['action', 'area', 'combat-stage', 'mode.activated', 'scene'])

export const CONQUEROR_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Conqueror', mechanicId: 'aa064.conqueror',
  config: {
    action: 'free', frequency: 'scene', damagingOnly: true,
    damageClasses: ['physical', 'special'], faintedRelationship: 'enemy',
    stageDeltas: { attack: 1, 'special-attack': 1, speed: 1 },
  },
  eventKind: 'hp', checkpoint: 'post-effect', predicate: attackerFaintTrigger,
  tags: ['combat-stage', 'reaction', 'scene', 'triggered'],
})

export const CONTRARY_ABILITY_SPEC = staticSpec('Contrary', 'aa064.contrary', {
  invertCombatStageChanges: true,
}, ['combat-stage', 'provider', 'static'])

export const COPY_MASTER_ABILITY_SPEC = staticSpec('Copy Master', 'aa064.copy-master', {
  connectionMoveId: 'Copycat', triggeringMoveIds: ['Copycat', 'Mimic'],
  resultingStageDelta: 1, selectedCombatStat: true,
}, ['combat-stage', 'connection', 'move-overlay', 'static'])

export const CORROSION_ABILITY_SPEC = staticSpec('Corrosion', 'aa064.corrosion', {
  attackType: 'poison', resistanceStepsIgnored: 1, immunityMultiplier: 0.25,
  poisonTypeImmunityBypass: ['poison', 'steel'],
}, ['condition', 'offensive', 'resistance', 'static', 'type'])

export const AA064_ABILITY_SPECS = Object.freeze([
  CLUSTER_MIND_ABILITY_SPEC, COLOR_CHANGE_ABILITY_SPEC, COLOR_THEORY_ABILITY_SPEC,
  COMATOSE_ABILITY_SPEC, COMBO_STRIKER_ABILITY_SPEC, COMPETITIVE_ABILITY_SPEC,
  COMPOUND_EYES_ABILITY_SPEC, CONFIDENCE_ABILITY_SPEC, CONQUEROR_ABILITY_SPEC,
  CONTRARY_ABILITY_SPEC, COPY_MASTER_ABILITY_SPEC, CORROSION_ABILITY_SPEC,
])

export const AA064_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = Object.freeze(
  AA064_ABILITY_SPECS.map(spec => ({
    canonicalId: spec.canonicalId,
    version: 1,
    sourceModule: 'server/domain/abilityAutomation/specs/aa064.ts',
    spec,
  })),
)
