import {
  AA077_LEAF_GIFT_SUITS,
  AA077_LEAFY_CLOAK_ABILITIES,
} from '#shared/abilityAutomation/aa077'
import type { AbilitySpecV1Registration } from '../registry'
import {
  abilityMechanicOperation,
  noAbilityTarget,
  reviewedAbilitySpec,
  reviewedActivatedAbilitySpec as activatedSpec,
  reviewedStaticAbilitySpec as staticSpec,
} from './reviewedSpecBuilder'

const strikePredicate = {
  kind: 'ability-strike-fact' as const,
  timings: ['accuracy-resolved'] as const,
  accuracyOutcomes: ['hit', 'automatic-hit'] as const,
  rangeContexts: ['melee'] as const,
  directness: [] as const,
  moveTypes: [] as const,
  damageClasses: ['physical', 'special'] as const,
  effectiveness: [] as const,
  contact: 'any' as const,
  critical: 'any' as const,
  ownerRole: 'attacker' as const,
  prevention: 'unprevented' as const,
  strikeIndex: 'any' as const,
  minimumHpLoss: null,
  minimumTotalLoss: null,
}

export const KLUTZ_ABILITY_SPEC = reviewedAbilitySpec({
  canonicalId: 'Klutz',
  modes: [
    { id: 'passive', kind: 'static' },
    { id: 'drop', kind: 'activated' },
    { id: 'trigger', kind: 'triggered' },
  ],
  subscriptions: [{
    id: 'trigger.subscription', modeId: 'trigger', eventKind: 'strike',
    checkpoint: 'post-effect', response: 'optional', priority: 112,
    oncePerCausalChain: true, predicate: strikePredicate,
  }],
  targeting: [
    ...noAbilityTarget('passive'),
    {
      id: 'drop.item', modeId: 'drop', kind: 'branch',
      minSelections: 1, maxSelections: 1, selector: null, predicate: null,
    },
    ...noAbilityTarget('trigger'),
  ],
  phases: [
    {
      modeId: 'passive', phase: 'effect', operations: [abilityMechanicOperation(
        'passive.mechanic', 'aa077.klutz', {
          ignoreHeldItemEffects: true, voluntaryDropAction: 'free',
          voluntaryDropIgnoresActionBlockingConditions: true,
          trigger: 'damaging-melee-hit', action: 'free', frequency: 'scene',
        },
      )],
    },
    {
      modeId: 'drop', phase: 'effect', operations: [abilityMechanicOperation(
        'drop.mechanic', 'aa077.klutz', {
          ignoreHeldItemEffects: true, voluntaryDropAction: 'free',
          voluntaryDropIgnoresActionBlockingConditions: true,
          trigger: 'damaging-melee-hit', action: 'free', frequency: 'scene',
        },
      )],
    },
    {
      modeId: 'trigger', phase: 'effect', operations: [abilityMechanicOperation(
        'trigger.mechanic', 'aa077.klutz', {
          ignoreHeldItemEffects: true, voluntaryDropAction: 'free',
          voluntaryDropIgnoresActionBlockingConditions: true,
          trigger: 'damaging-melee-hit', action: 'free', frequency: 'scene',
        },
      )],
    },
  ],
  tags: ['action', 'item', 'mode.activated', 'mode.static', 'mode.triggered', 'reaction'],
})

export const LANCER_ABILITY_SPEC = staticSpec('Lancer', 'aa077.lancer', {
  shiftedDistance: 3, criticalRangeBonus: 3,
  noShiftOrDisengageDamageReduction: 5, duration: 'until-next-turn-start',
}, ['critical-hit', 'damage-reduction', 'movement', 'static'])

export const LANDSLIDE_ABILITY_SPEC = staticSpec('Landslide', 'aa077.landslide', {
  lastChanceType: 'ground', hpThresholdNumerator: 1,
  hpThresholdDenominator: 3, damageBonus: 5,
}, ['damage', 'last-chance', 'static', 'type'])

export const LAST_CHANCE_ABILITY_SPEC = staticSpec('Last Chance', 'aa077.last-chance', {
  lastChanceType: 'normal', hpThresholdNumerator: 1,
  hpThresholdDenominator: 3, damageBonus: 5,
}, ['damage', 'last-chance', 'static', 'type'])

export const LEAF_GIFT_ABILITY_SPEC = activatedSpec('Leaf Gift', 'aa077.leaf-gift', {
  action: 'extended', frequency: 'daily', replacementPolicy: 'destroy-previous',
  suits: AA077_LEAF_GIFT_SUITS,
}, [{
  id: 'activate.suit', modeId: 'activate', kind: 'branch',
  minSelections: 1, maxSelections: 1, selector: null, predicate: null,
}], ['ability-grant', 'crafting', 'daily', 'mode.activated'])

export const LEAF_GUARD_ABILITY_SPEC = activatedSpec('Leaf Guard', 'aa077.leaf-guard', {
  action: 'swift', frequency: 'scene', cureCount: 1,
  sunnyWeatherIgnoresFrequency: true,
}, [{
  id: 'activate.condition', modeId: 'activate', kind: 'branch',
  minSelections: 1, maxSelections: 1, selector: null, predicate: null,
}], ['action', 'condition', 'mode.activated', 'scene', 'weather'])

export const LEAF_RUSH_ABILITY_SPEC = activatedSpec('Leaf Rush', 'aa077.leaf-rush', {
  action: 'free', frequency: 'scene-x2', moveType: 'grass',
  priority: true, damagingSpeedFractionNumerator: 1,
  damagingSpeedFractionDenominator: 2,
}, noAbilityTarget('activate'), ['action', 'damage', 'mode.activated', 'priority', 'scene', 'type'])

export const LEAFY_CLOAK_ABILITY_SPEC = reviewedAbilitySpec({
  canonicalId: 'Leafy Cloak',
  modes: [{ id: 'passive', kind: 'static' }, { id: 'activate', kind: 'activated' }],
  targeting: [
    ...noAbilityTarget('passive'),
    {
      id: 'activate.abilities', modeId: 'activate', kind: 'branch',
      minSelections: 2, maxSelections: 2, selector: null, predicate: null,
    },
  ],
  phases: [
    {
      modeId: 'passive', phase: 'effect', operations: [abilityMechanicOperation(
        'passive.mechanic', 'aa077.leafy-cloak', {
          triggerAbilityId: 'Designer', selections: 2,
          abilityIds: AA077_LEAFY_CLOAK_ABILITIES, duration: 'until-designer-reactivates',
        },
      )],
    },
    {
      modeId: 'activate', phase: 'effect', operations: [abilityMechanicOperation(
        'activate.mechanic', 'aa077.leafy-cloak', {
          triggerAbilityId: 'Designer', selections: 2,
          abilityIds: AA077_LEAFY_CLOAK_ABILITIES, duration: 'until-designer-reactivates',
        },
      )],
    },
  ],
  tags: ['ability-grant', 'mode.activated', 'mode.static', 'triggered'],
})

export const LEEK_MASTERY_ABILITY_SPEC = reviewedAbilitySpec({
  canonicalId: 'Leek Mastery',
  modes: [{ id: 'passive', kind: 'static' }, { id: 'drop', kind: 'activated' }],
  targeting: [
    ...noAbilityTarget('passive'),
    {
      id: 'drop.item', modeId: 'drop', kind: 'branch',
      minSelections: 1, maxSelections: 1, selector: null, predicate: null,
    },
  ],
  phases: [
    {
      modeId: 'passive', phase: 'effect', operations: [abilityMechanicOperation(
        'passive.mechanic', 'aa077.leek-mastery', {
          connectionMoveId: 'Acrobatics', protectedItemId: 'rare-leek',
          acrobaticsTreatAsNoItem: true, forcedRemovalRequiresWilling: true,
        },
      )],
    },
    {
      modeId: 'drop', phase: 'effect', operations: [abilityMechanicOperation(
        'drop.mechanic', 'aa077.leek-mastery', {
          connectionMoveId: 'Acrobatics', protectedItemId: 'rare-leek',
          acrobaticsTreatAsNoItem: true, forcedRemovalRequiresWilling: true,
        },
      )],
    },
  ],
  tags: ['connection', 'item', 'mode.activated', 'mode.static', 'protection'],
})

export const LEVITATE_ABILITY_SPEC = staticSpec('Levitate', 'aa077.levitate', {
  immuneMoveType: 'ground', grantedSpeed: 4,
  existingSpeedBonus: 2, preserveNativeSpeed: true,
}, ['defensive', 'immunity', 'movement', 'static', 'type'])

export const LIFE_FORCE_ABILITY_SPEC = activatedSpec('Life Force', 'aa077.life-force', {
  action: 'swift', frequency: 'daily-x5', healingTicks: 1,
}, noAbilityTarget('activate'), ['action', 'daily', 'healing', 'mode.activated'])

export const LIGHT_METAL_ABILITY_SPEC = staticSpec('Light Metal', 'aa077.light-metal', {
  weightClassDelta: -2, speedBaseStatDelta: 2, defenseBaseStatDelta: -2,
}, ['base-stat', 'static', 'weight'])

export const AA077_ABILITY_SPECS = Object.freeze([
  KLUTZ_ABILITY_SPEC, LANCER_ABILITY_SPEC, LANDSLIDE_ABILITY_SPEC,
  LAST_CHANCE_ABILITY_SPEC, LEAF_GIFT_ABILITY_SPEC, LEAF_GUARD_ABILITY_SPEC,
  LEAF_RUSH_ABILITY_SPEC, LEAFY_CLOAK_ABILITY_SPEC, LEEK_MASTERY_ABILITY_SPEC,
  LEVITATE_ABILITY_SPEC, LIFE_FORCE_ABILITY_SPEC, LIGHT_METAL_ABILITY_SPEC,
])

export const AA077_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = Object.freeze(
  AA077_ABILITY_SPECS.map(spec => ({
    canonicalId: spec.canonicalId,
    version: 1,
    sourceModule: 'server/domain/abilityAutomation/specs/aa077.ts',
    spec,
  })),
)
