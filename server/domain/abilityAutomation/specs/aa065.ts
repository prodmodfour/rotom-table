import type { AbilitySpecV1Registration } from '../registry'
import {
  noAbilityTarget as noneTarget,
  reviewedAbilitySpec,
  reviewedStaticAbilitySpec as staticSpec,
  reviewedTriggeredAbilitySpec as triggeredSpec,
  abilityMechanicOperation,
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

export const CORROSIVE_TOXINS_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Corrosive Toxins', mechanicId: 'aa065.corrosive-toxins',
  config: {
    connectionMoveId: 'Toxic', action: 'free', frequency: 'scene',
    condition: 'badly-poisoned', bypassConditionImmunity: true,
    bypassBlessings: true, bypassHpLossPrevention: true,
  },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: moveTrigger({ timings: ['accuracy-resolved'], userRelation: 'owner', targetRelation: 'any' }),
  tags: ['action', 'condition', 'connection', 'immunity', 'reaction', 'scene', 'triggered'],
})

export const COTTON_DOWN_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Cotton Down', mechanicId: 'aa065.cotton-down',
  config: {
    action: 'free', frequency: 'scene', burstSize: 1, speedStageDelta: -1,
    condition: 'slowed', duration: 'one-full-round',
  },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: moveTrigger({ timings: ['accuracy-resolved'], userRelation: 'other', targetRelation: 'hit' }),
  tags: ['action', 'area', 'combat-stage', 'condition', 'reaction', 'scene', 'triggered'],
})

export const COURAGE_ABILITY_SPEC = staticSpec('Courage', 'aa065.courage', {
  hpThreshold: { numerator: 1, denominator: 3 }, damageBonus: 5, damageReduction: 5,
}, ['damage', 'defensive', 'hp-threshold', 'static'])

export const COVERT_ABILITY_SPEC = staticSpec('Covert', 'aa065.covert', {
  evasionBonus: 2, terrainSource: 'natural-habitat',
}, ['evasion', 'habitat', 'static', 'terrain'])

export const CRUELTY_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Cruelty', mechanicId: 'aa065.cruelty',
  config: {
    action: 'swift', frequency: 'scene', grantedInjuries: 1, hpLossPerPurchase: 2,
    slowCost: 1, healingBlockCost: 2,
    healingBlockDuration: 'encounter-until-switch-or-breather',
  },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: moveTrigger({ timings: ['effects-resolved'], userRelation: 'owner', targetRelation: 'hit' }),
  tags: ['action', 'choice', 'condition', 'healing', 'hp', 'injury', 'reaction', 'scene', 'triggered'],
})

const crushTrapConfig = {
  connectionMoveId: 'Wrap', action: 'free', frequency: 'scene',
  triggeringManeuverId: 'Grapple', damageSource: 'Struggle', automaticHit: true,
  criticalHit: 'never', effectRanges: 'never',
}
export const CRUSH_TRAP_ABILITY_SPEC = reviewedAbilitySpec({
  canonicalId: 'Crush Trap',
  modes: [{ id: 'trigger', kind: 'triggered' }, { id: 'crush', kind: 'activated' }],
  subscriptions: [{
    id: 'trigger.subscription', modeId: 'trigger', eventKind: 'action', checkpoint: 'post-effect',
    response: 'optional', priority: 0, oncePerCausalChain: true, predicate: null,
  }],
  targeting: [
    ...noneTarget('trigger'),
    {
      id: 'crush.target', modeId: 'crush', kind: 'token', minSelections: 1, maxSelections: 1,
      selector: null,
      predicate: {
        kind: 'ability-targeting', relationship: 'any', willingness: 'any', excludeActor: true,
        minimumRange: 0, maximumRange: 1, visibility: 'required', lineOfSight: 'required',
        geometry: { kind: 'adjacent', cardinalOnly: false },
      },
    },
  ],
  phases: [
    { modeId: 'trigger', phase: 'effect', operations: [abilityMechanicOperation('trigger.mechanic', 'aa065.crush-trap', crushTrapConfig)] },
    { modeId: 'crush', phase: 'effect', operations: [abilityMechanicOperation('crush.mechanic', 'aa065.crush-trap', crushTrapConfig)] },
  ],
  tags: ['action', 'connection', 'damage', 'mode.activated', 'reaction', 'scene', 'triggered'],
})

const cudChewTarget = [{
  id: 'activate.item', modeId: 'activate', kind: 'item', minSelections: 1, maxSelections: 1,
  selector: null, predicate: null,
}]
export const CUD_CHEW_ABILITY_SPEC = reviewedAbilitySpec({
  canonicalId: 'Cud Chew', modes: [{ id: 'activate', kind: 'activated' }],
  targeting: cudChewTarget,
  phases: [{
    modeId: 'activate', phase: 'effect', operations: [abilityMechanicOperation('activate.mechanic', 'aa065.cud-chew', {
      action: 'swift', frequency: 'scene', consumptionPeriod: 'current-encounter', restoreItem: false,
    })],
  }],
  tags: ['action', 'choice', 'item', 'mode.activated', 'scene'],
})

const curiousConfig = {
  action: 'swift', frequency: 'scene', radius: 2, relationship: 'ally',
  resetCombatStages: true, entryReactionAction: 'free',
}
export const CURIOUS_MEDICINE_ABILITY_SPEC = reviewedAbilitySpec({
  canonicalId: 'Curious Medicine',
  modes: [{ id: 'activate', kind: 'activated' }, { id: 'enter-field', kind: 'activated' }],
  targeting: [...noneTarget('activate'), ...noneTarget('enter-field')],
  phases: [
    { modeId: 'activate', phase: 'effect', operations: [abilityMechanicOperation('activate.mechanic', 'aa065.curious-medicine', curiousConfig)] },
    { modeId: 'enter-field', phase: 'effect', operations: [abilityMechanicOperation('enter-field.mechanic', 'aa065.curious-medicine', curiousConfig)] },
  ],
  tags: ['action', 'area', 'combat-stage', 'mode.activated', 'reaction', 'scene'],
})

export const CURSED_BODY_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Cursed Body', mechanicId: 'aa065.cursed-body',
  config: { action: 'free', frequency: 'scene', damagingOnly: true, condition: 'disabled' },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: moveTrigger({ timings: ['accuracy-resolved'], userRelation: 'other', targetRelation: 'hit' }),
  tags: ['action', 'condition', 'reaction', 'scene', 'triggered'],
})

export const CUTE_CHARM_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Cute Charm', mechanicId: 'aa065.cute-charm',
  config: {
    action: 'free', frequency: 'scene', relationship: 'enemy', requiredRange: 'melee',
    requiredGenderRelation: 'opposite', condition: 'infatuated',
  },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: moveTrigger({ timings: ['accuracy-resolved'], userRelation: 'other', targetRelation: 'attacked' }),
  tags: ['action', 'condition', 'reaction', 'relationship', 'scene', 'triggered'],
})

export const CUTE_TEARS_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Cute Tears', mechanicId: 'aa065.cute-tears',
  config: {
    action: 'free', frequency: 'scene', damagingOnly: true, stageDelta: -2,
    statSource: 'triggering-move-attack-stat',
  },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: moveTrigger({ timings: ['accuracy-resolved'], userRelation: 'other', targetRelation: 'hit' }),
  tags: ['action', 'combat-stage', 'reaction', 'scene', 'triggered'],
})

export const DAMP_ABILITY_SPEC = staticSpec('Damp', 'aa065.damp', {
  radius: 10, preventedMoveIds: ['Self-Destruct', 'Explosion'], preventedAbilityId: 'Aftermath',
}, ['area', 'prevention', 'static'])

export const AA065_ABILITY_SPECS = Object.freeze([
  CORROSIVE_TOXINS_ABILITY_SPEC, COTTON_DOWN_ABILITY_SPEC, COURAGE_ABILITY_SPEC,
  COVERT_ABILITY_SPEC, CRUELTY_ABILITY_SPEC, CRUSH_TRAP_ABILITY_SPEC,
  CUD_CHEW_ABILITY_SPEC, CURIOUS_MEDICINE_ABILITY_SPEC, CURSED_BODY_ABILITY_SPEC,
  CUTE_CHARM_ABILITY_SPEC, CUTE_TEARS_ABILITY_SPEC, DAMP_ABILITY_SPEC,
])

export const AA065_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = Object.freeze(
  AA065_ABILITY_SPECS.map(spec => ({
    canonicalId: spec.canonicalId,
    version: 1,
    sourceModule: 'server/domain/abilityAutomation/specs/aa065.ts',
    spec,
  })),
)
