import type {
  MoveBranchEffectOperation,
  MoveConditionEffectOperation,
  MoveDamageEffectOperation,
  MoveEffectOperation,
  MoveFieldEffectOperation,
  MoveHazardEffectOperation,
  MoveTemporaryEffectOperation,
  MoveUsageEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveHazardCellSelectionRules } from '#shared/moveAutomation/hazardCellSelection'
import type { MoveSpec, MoveSpecCostDeclaration, MoveSpecTargetingDeclaration } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'
import { FIELD_HAZARD_226_233_HANDLER_ID } from '../handlers/fieldHazard226_233'
import {
  automaticSetupExecuteCost,
  areaTargeting,
  createReviewedMoveSpec,
  fieldTargeting,
  reviewedCondition,
  reviewedDamage,
  reviewedDirectHp,
  reviewedStage,
  selfTargeting,
  singleTargeting,
  standardAccuracy,
  standardActionCost,
  standardTerminalOperations,
} from './reviewedSpecBuilder'

export const MA_226_233_MOVE_NAMES = Object.freeze([
  'Acid Armor', 'Aurora Veil', 'Blizzard', 'Camouflage', 'Court Change', 'Defog', 'Electric Terrain', 'Floral Healing',
  'Geomancy', 'Grassy Glide', 'Grassy Terrain', 'Gravity', 'Hail', 'Hurricane', 'Inferno', 'Ion Deluge',
  'Magic Room', 'Misty Explosion', 'Misty Terrain', 'Moonlight', 'Morning Sun', 'Rain Dance', 'Sandstorm', 'Shore Up',
  'Smokescreen', 'Solar Beam', 'Solar Blade', 'Steel Roller', 'Sunny Day', 'Tailwind', 'Terrain Pulse', 'Thunder',
  'Trick Room', 'Weather Ball', 'Wonder Room', 'Zap Cannon',
  'Barrier', 'Ceaseless Edge', 'Fire Pledge', 'Grass Pledge', 'Spikes', 'Stealth Rock', 'Sticky Web', 'Stone Axe',
  'Toxic Spikes', 'Water Pledge',
  'Anchor Shot', 'Aqua Ring', 'Astral Barrage', 'Bitter Malice', 'Block', 'Burn Up', 'Charge', 'Clear Smog',
] as const)
export type FieldHazardCohort226233MoveName = (typeof MA_226_233_MOVE_NAMES)[number]

const fieldOperation = (input: {
  readonly slug: string
  readonly category: 'weather' | 'terrain' | 'room'
  readonly fieldId: string
  readonly rounds?: number | null
  readonly action?: 'apply' | 'remove'
  readonly id?: string
}): MoveFieldEffectOperation => ({
  id: `${input.slug}.${input.id ?? `${input.action ?? 'apply'}-${input.fieldId}`}`,
  kind: 'field', source: { kind: 'move', id: `move.${input.slug}` }, recipients: { kind: 'none' },
  phase: 'schedule', reasonCode: `${input.slug}.${input.action ?? 'apply'}-${input.fieldId}`,
  payload: input.action === 'remove'
    ? { action: 'remove', category: input.category, fieldId: input.fieldId }
    : { action: 'apply', category: input.category, fieldId: input.fieldId, rounds: input.rounds ?? 5 },
})

const mutateField = (
  slug: string,
  id: string,
  mutation: Extract<MoveFieldEffectOperation['payload'], { action: 'mutate' }>['mutation'],
): MoveFieldEffectOperation => ({
  id: `${slug}.${id}`, kind: 'field', source: { kind: 'move', id: `move.${slug}` },
  recipients: { kind: 'none' }, phase: 'schedule', reasonCode: `${slug}.${id}`,
  payload: { action: 'mutate', mutation },
})

const fieldSpec = (input: {
  readonly canonicalId: FieldHazardCohort226233MoveName
  readonly slug: string
  readonly operation: MoveFieldEffectOperation
  readonly preconditions?: MoveSpec['preconditions']
  readonly tags: readonly string[]
}): MoveSpec => createReviewedMoveSpec({
  canonicalId: input.canonicalId, targeting: fieldTargeting(), preconditions: input.preconditions,
  operations: [input.operation, ...standardTerminalOperations(input.slug)], tags: input.tags,
})

export const ELECTRIC_TERRAIN_MOVE_SPEC = fieldSpec({ canonicalId: 'Electric Terrain', slug: 'electric-terrain', operation: fieldOperation({ slug: 'electric-terrain', category: 'terrain', fieldId: 'electric' }), tags: ['field', 'terrain'] })
export const GRASSY_TERRAIN_MOVE_SPEC = fieldSpec({ canonicalId: 'Grassy Terrain', slug: 'grassy-terrain', operation: fieldOperation({ slug: 'grassy-terrain', category: 'terrain', fieldId: 'grassy' }), tags: ['field', 'terrain'] })
export const MISTY_TERRAIN_MOVE_SPEC = fieldSpec({ canonicalId: 'Misty Terrain', slug: 'misty-terrain', operation: fieldOperation({ slug: 'misty-terrain', category: 'terrain', fieldId: 'misty' }), tags: ['field', 'terrain'] })
export const GRAVITY_MOVE_SPEC = fieldSpec({ canonicalId: 'Gravity', slug: 'gravity', operation: fieldOperation({ slug: 'gravity', category: 'room', fieldId: 'gravity' }), tags: ['field', 'room'] })
export const MAGIC_ROOM_MOVE_SPEC = fieldSpec({ canonicalId: 'Magic Room', slug: 'magic-room', operation: fieldOperation({ slug: 'magic-room', category: 'room', fieldId: 'magic' }), tags: ['field', 'room'] })
export const TRICK_ROOM_MOVE_SPEC = fieldSpec({ canonicalId: 'Trick Room', slug: 'trick-room', operation: fieldOperation({ slug: 'trick-room', category: 'room', fieldId: 'trick' }), tags: ['field', 'initiative', 'room'] })
export const WONDER_ROOM_MOVE_SPEC = fieldSpec({ canonicalId: 'Wonder Room', slug: 'wonder-room', operation: fieldOperation({ slug: 'wonder-room', category: 'room', fieldId: 'wonder' }), tags: ['field', 'room', 'stats'] })
export const HAIL_MOVE_SPEC = fieldSpec({ canonicalId: 'Hail', slug: 'hail', operation: fieldOperation({ slug: 'hail', category: 'weather', fieldId: 'hail' }), tags: ['field', 'weather'] })
export const RAIN_DANCE_MOVE_SPEC = fieldSpec({ canonicalId: 'Rain Dance', slug: 'rain-dance', operation: fieldOperation({ slug: 'rain-dance', category: 'weather', fieldId: 'rainy' }), tags: ['field', 'weather'] })
export const SANDSTORM_MOVE_SPEC = fieldSpec({ canonicalId: 'Sandstorm', slug: 'sandstorm', operation: fieldOperation({ slug: 'sandstorm', category: 'weather', fieldId: 'sandstorm' }), tags: ['field', 'weather'] })
export const SUNNY_DAY_MOVE_SPEC = fieldSpec({ canonicalId: 'Sunny Day', slug: 'sunny-day', operation: fieldOperation({ slug: 'sunny-day', category: 'weather', fieldId: 'sunny' }), tags: ['field', 'weather'] })

const ALL_ZONE_KINDS = ['hazard','weather','terrain','room','smoke','barrier','pledge','vortex','side-condition'] as const
export const COURT_CHANGE_MOVE_SPEC = fieldSpec({
  canonicalId: 'Court Change', slug: 'court-change',
  operation: mutateField('court-change', 'swap-sides', {
    kind: 'swap-sides', counterpartSide: 'other-side',
    zoneKinds: ['hazard', 'pledge', 'side-condition'], requiredTags: [],
  }),
  tags: ['field', 'side-swap'],
})
export const DEFOG_MOVE_SPEC = fieldSpec({
  canonicalId: 'Defog', slug: 'defog',
  operation: mutateField('defog', 'destroy-zones', {
    kind: 'destroy', target: {
      zoneKinds: ALL_ZONE_KINDS, source: 'any', side: 'any', requiredTags: [], geometry: null,
    },
  }),
  tags: ['cleanup', 'field', 'hazard', 'weather'],
})

const handlerSpec = (input: {
  readonly canonicalId: FieldHazardCohort226233MoveName
  readonly slug: string
  readonly targeting: MoveSpecTargetingDeclaration
  readonly costs?: readonly MoveSpecCostDeclaration[]
  readonly tags: readonly string[]
}): MoveSpec => createReviewedMoveSpec({
  canonicalId: input.canonicalId, targeting: input.targeting, costs: input.costs,
  operations: [], registeredHandlerId: FIELD_HAZARD_226_233_HANDLER_ID, tags: input.tags,
})

const setupCosts = (slug: string): readonly MoveSpecCostDeclaration[] => [
  standardActionCost(slug), automaticSetupExecuteCost(slug),
]
export const ACID_ARMOR_MOVE_SPEC = handlerSpec({ canonicalId: 'Acid Armor', slug: 'acid-armor', targeting: selfTargeting(), costs: setupCosts('acid-armor'), tags: ['lifecycle', 'setup', 'stage'] })
export const GEOMANCY_MOVE_SPEC = handlerSpec({ canonicalId: 'Geomancy', slug: 'geomancy', targeting: selfTargeting(), costs: setupCosts('geomancy'), tags: ['hazard', 'setup', 'stage'] })
export const SOLAR_BEAM_MOVE_SPEC = handlerSpec({ canonicalId: 'Solar Beam', slug: 'solar-beam', targeting: singleTargeting(), costs: setupCosts('solar-beam'), tags: ['damage', 'setup', 'weather'] })
export const SOLAR_BLADE_MOVE_SPEC = handlerSpec({ canonicalId: 'Solar Blade', slug: 'solar-blade', targeting: singleTargeting(), costs: setupCosts('solar-blade'), tags: ['damage', 'setup', 'stage', 'weather'] })

export const BLIZZARD_MOVE_SPEC = handlerSpec({ canonicalId: 'Blizzard', slug: 'blizzard', targeting: areaTargeting(), tags: ['condition', 'damage', 'weather'] })
export const HURRICANE_MOVE_SPEC = handlerSpec({ canonicalId: 'Hurricane', slug: 'hurricane', targeting: areaTargeting(), tags: ['condition', 'damage', 'weather'] })
export const INFERNO_MOVE_SPEC = handlerSpec({ canonicalId: 'Inferno', slug: 'inferno', targeting: singleTargeting(), tags: ['condition', 'damage', 'evasion'] })
export const THUNDER_MOVE_SPEC = handlerSpec({ canonicalId: 'Thunder', slug: 'thunder', targeting: singleTargeting(), tags: ['condition', 'damage', 'weather'] })
export const ZAP_CANNON_MOVE_SPEC = handlerSpec({ canonicalId: 'Zap Cannon', slug: 'zap-cannon', targeting: singleTargeting(), tags: ['condition', 'damage', 'evasion'] })
export const CAMOUFLAGE_MOVE_SPEC = handlerSpec({ canonicalId: 'Camouflage', slug: 'camouflage', targeting: selfTargeting(), tags: ['choice', 'terrain', 'type'] })
export const FLORAL_HEALING_MOVE_SPEC = handlerSpec({ canonicalId: 'Floral Healing', slug: 'floral-healing', targeting: singleTargeting(), tags: ['heal', 'terrain'] })
export const MOONLIGHT_MOVE_SPEC = handlerSpec({ canonicalId: 'Moonlight', slug: 'moonlight', targeting: selfTargeting(), tags: ['heal', 'weather'] })
export const MORNING_SUN_MOVE_SPEC = handlerSpec({ canonicalId: 'Morning Sun', slug: 'morning-sun', targeting: selfTargeting(), tags: ['heal', 'weather'] })
export const SHORE_UP_MOVE_SPEC = handlerSpec({ canonicalId: 'Shore Up', slug: 'shore-up', targeting: selfTargeting(), tags: ['heal', 'weather'] })
export const TERRAIN_PULSE_MOVE_SPEC = handlerSpec({ canonicalId: 'Terrain Pulse', slug: 'terrain-pulse', targeting: areaTargeting(), tags: ['choice', 'damage', 'terrain'] })
export const WEATHER_BALL_MOVE_SPEC = handlerSpec({ canonicalId: 'Weather Ball', slug: 'weather-ball', targeting: singleTargeting(), tags: ['choice', 'damage', 'weather'] })
export const BITTER_MALICE_MOVE_SPEC = handlerSpec({ canonicalId: 'Bitter Malice', slug: 'bitter-malice', targeting: singleTargeting(), tags: ['choice', 'condition', 'damage'] })
export const BURN_UP_MOVE_SPEC = handlerSpec({ canonicalId: 'Burn Up', slug: 'burn-up', targeting: areaTargeting(), tags: ['damage', 'lifecycle', 'type'] })
export const FIRE_PLEDGE_MOVE_SPEC = handlerSpec({ canonicalId: 'Fire Pledge', slug: 'fire-pledge', targeting: singleTargeting(), tags: ['damage', 'pledge', 'priority'] })
export const GRASS_PLEDGE_MOVE_SPEC = handlerSpec({ canonicalId: 'Grass Pledge', slug: 'grass-pledge', targeting: singleTargeting(), tags: ['damage', 'pledge', 'priority'] })
export const WATER_PLEDGE_MOVE_SPEC = handlerSpec({ canonicalId: 'Water Pledge', slug: 'water-pledge', targeting: singleTargeting(), tags: ['damage', 'pledge', 'priority'] })

const auroraEffect: MoveTemporaryEffectOperation = {
  id: 'aurora-veil.blessing', kind: 'temporary-effect', source: { kind: 'move', id: 'move.aurora-veil' },
  recipients: { kind: 'actor' }, phase: 'schedule', reasonCode: 'aurora-veil.blessing',
  payload: {
    action: 'add', effectId: 'aurora-veil.blessing', recipientScope: 'actor-side',
    definition: {
      kind: 'numeric-modifier', duration: { kind: 'scene', remaining: null }, stacks: 1, charges: 2,
      stackPolicy: { kind: 'refresh', maxStacks: null }, chargePolicy: { kind: 'consume-on-trigger', amount: 1 },
      tags: ['aurora-veil', 'blessing', 'damage-resistance'],
      payload: { attribute: 'damage-reduction', operation: 'resist-step', value: 1, rounding: 'none', damageClass: 'any' },
      dispel: { policy: 'matching-tags', tags: ['aurora-veil', 'blessing'] }, transferPolicy: 'retain',
    },
  },
}
export const AURORA_VEIL_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Aurora Veil', targeting: selfTargeting(),
  preconditions: [{
    id: 'aurora-veil.hail-required',
    predicate: {
      kind: 'comparison', operator: 'equal', left: { kind: 'weather' },
      right: { kind: 'constant', value: 'hail' },
    },
    failureReasonCode: 'aurora-veil.hail-required',
  }],
  operations: [auroraEffect, ...standardTerminalOperations('aurora-veil')],
  tags: ['blessing', 'reaction', 'weather'],
})

export const ION_DELUGE_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Ion Deluge', targeting: areaTargeting(),
  operations: [fieldOperation({ slug: 'ion-deluge', category: 'terrain', fieldId: 'electric', rounds: 1 }), ...standardTerminalOperations('ion-deluge')],
  tags: ['area', 'field', 'interrupt', 'type-override'],
})

const mistySelfLoss = reviewedDirectHp({
  slug: 'misty-explosion', id: 'self-ko', recipients: 'actor', mode: 'set',
  calculation: {
    kind: 'formula', expression: {
      kind: 'arithmetic', operator: 'multiply',
      operands: [{ kind: 'stat', subject: { kind: 'actor' }, stat: 'maximum-hp', combatStagePolicy: 'ignore', stageModifierPolicy: 'ignore' }, { kind: 'constant', value: -0.5 }],
    },
  },
  sourceOperationId: 'misty-explosion.damage', hitPointMarkers: 'apply-after-operation',
})
export const MISTY_EXPLOSION_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Misty Explosion', targeting: areaTargeting(),
  operations: [
    standardAccuracy('misty-explosion'),
    reviewedDamage({ slug: 'misty-explosion', damageBase: 10, damageClass: 'special', moveType: 'fairy', recipients: 'attacked-targets' }),
    mistySelfLoss,
    fieldOperation({ slug: 'misty-explosion', category: 'terrain', fieldId: 'misty', rounds: 5 }),
    ...standardTerminalOperations('misty-explosion'),
  ],
  tags: ['area', 'damage', 'self-ko', 'terrain'],
})

const tailwindEffect: MoveTemporaryEffectOperation = {
  id: 'tailwind.initiative', kind: 'temporary-effect', source: { kind: 'move', id: 'move.tailwind' },
  recipients: { kind: 'actor' }, phase: 'schedule', reasonCode: 'tailwind.initiative',
  payload: {
    action: 'add', effectId: 'tailwind.initiative', recipientScope: 'actor-side',
    definition: {
      kind: 'numeric-modifier', duration: { kind: 'scene', remaining: null }, stacks: 1, charges: null,
      stackPolicy: { kind: 'refresh', maxStacks: null }, chargePolicy: { kind: 'none', amount: null },
      tags: ['initiative', 'tailwind'],
      payload: { attribute: 'initiative', operation: 'add', value: 5, rounding: 'none' },
      dispel: { policy: 'matching-tags', tags: ['tailwind'] }, transferPolicy: 'retain',
    },
  },
}
export const TAILWIND_MOVE_SPEC = createReviewedMoveSpec({ canonicalId: 'Tailwind', targeting: selfTargeting(), operations: [tailwindEffect, ...standardTerminalOperations('tailwind')], tags: ['field', 'initiative', 'side'] })

const smokeHazard = (slug: string): MoveHazardEffectOperation => ({
  id: `${slug}.smoke-zone`, kind: 'hazard', source: { kind: 'move', id: `move.${slug}` },
  recipients: { kind: 'none' }, phase: 'schedule', reasonCode: `${slug}.smoke-zone`,
  payload: {
    action: 'add', familyId: 'hazard.smoke', zoneKind: 'hazard', effectId: 'smoke', ownership: 'neutral',
    geometry: { kind: 'blast', center: 'selected-target', size: 3, count: { kind: 'up-to', minimum: 0, maximum: 32 }, adjacency: 'including-diagonal', connectedness: 'none' },
    layers: 1, maxLayers: 1, charges: null, maxCharges: null,
  },
})
export const SMOKESCREEN_MOVE_SPEC = createReviewedMoveSpec({ canonicalId: 'Smokescreen', targeting: areaTargeting(), operations: [smokeHazard('smokescreen'), ...standardTerminalOperations('smokescreen')], tags: ['area', 'smoke'] })

export const GRASSY_GLIDE_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Grassy Glide', targeting: singleTargeting(),
  operations: [standardAccuracy('grassy-glide'), reviewedDamage({ slug: 'grassy-glide', damageBase: 7, damageClass: 'physical', moveType: 'grass' }), ...standardTerminalOperations('grassy-glide')],
  tags: ['damage', 'movement', 'terrain'],
})

const removePassedZones = mutateField('steel-roller', 'consume-passed-zones', {
  kind: 'remove', target: {
    zoneKinds: ['hazard', 'terrain'], source: 'any', side: 'any', requiredTags: [],
    geometry: { kind: 'line', length: 12, count: { kind: 'up-to', minimum: 0, maximum: 32 }, adjacency: 'including-diagonal', connectedness: 'none' },
  },
})
export const STEEL_ROLLER_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Steel Roller', targeting: singleTargeting(),
  operations: [
    removePassedZones, standardAccuracy('steel-roller'),
    reviewedDamage({ slug: 'steel-roller', damageBase: 13, damageClass: 'physical', moveType: 'steel', recipients: 'attacked-targets' }),
    reviewedCondition({
      slug: 'steel-roller', id: 'trip', recipients: 'hit-targets', conditionId: 'tripped',
      sourceOperationId: 'steel-roller.damage',
      accuracyRollTrigger: { rollId: 'steel-roller.accuracy-roll', trigger: { kind: 'range', minimum: 15 } },
      applyTypeImmunity: true,
    }),
    ...standardTerminalOperations('steel-roller'),
  ],
  tags: ['cleanup', 'condition', 'damage', 'movement'],
})

const hazardRules = (count: number, range = 6): MoveHazardCellSelectionRules => ({
  count: { kind: 'exact', count }, range, adjacency: 'orthogonal', connectedness: 'connected',
  occupancy: 'empty-of-placements', geometry: { kind: 'horizontal-plane' },
})
const hazardTargeting: MoveSpecTargetingDeclaration = { kind: 'hazard', minTargets: 0, maxTargets: 0, selector: null }
const hazardOperation = (input: {
  readonly slug: string
  readonly effectId: string
  readonly count: number
  readonly maxLayers: number
  readonly range?: number
  readonly zoneKind?: 'hazard' | 'barrier'
}): MoveHazardEffectOperation => {
  const rules = hazardRules(input.count, input.range)
  return {
    id: `${input.slug}.place-hazard`, kind: 'hazard', source: { kind: 'move', id: `move.${input.slug}` },
    recipients: { kind: 'none' }, phase: 'schedule', reasonCode: `${input.slug}.place-hazard`,
    payload: {
      action: 'add', familyId: `hazard.${input.effectId}`, zoneKind: input.zoneKind ?? 'hazard', effectId: input.effectId,
      ownership: 'source-side',
      geometry: {
        kind: 'selection', cellSetId: `${input.slug}.cells`, count: rules.count,
        adjacency: rules.adjacency, connectedness: rules.connectedness,
      },
      layers: 1, maxLayers: input.maxLayers, charges: null, maxCharges: null,
      cellSelection: { requestId: `${input.slug}.cells`, promptKey: `move.${input.slug}.choose-cells`, ...rules },
    },
  }
}
const hazardSpec = (
  canonicalId: FieldHazardCohort226233MoveName,
  slug: string,
  effectId: string,
  count: number,
  maxLayers: number,
  zoneKind: 'hazard' | 'barrier' = 'hazard',
): MoveSpec => createReviewedMoveSpec({
  canonicalId, targeting: hazardTargeting,
  operations: [hazardOperation({ slug, effectId, count, maxLayers, zoneKind }), ...standardTerminalOperations(slug)],
  tags: ['hazard', 'hazard-cell-choice'],
})
export const SPIKES_MOVE_SPEC = hazardSpec('Spikes', 'spikes', 'spikes', 8, 3)
export const STEALTH_ROCK_MOVE_SPEC = hazardSpec('Stealth Rock', 'stealth-rock', 'stealth-rock', 4, 1)
export const STICKY_WEB_MOVE_SPEC = hazardSpec('Sticky Web', 'sticky-web', 'sticky-web', 8, 1)
export const TOXIC_SPIKES_MOVE_SPEC = hazardSpec('Toxic Spikes', 'toxic-spikes', 'toxic-spikes', 8, 2)
export const BARRIER_MOVE_SPEC = hazardSpec('Barrier', 'barrier', 'barrier', 4, 1, 'barrier')

const vortexDefinition = (sourceType: string) => ({
  kind: 'vortex' as const, duration: { kind: 'scene' as const, remaining: null }, stacks: 1, charges: 4,
  stackPolicy: { kind: 'replace' as const, maxStacks: null }, chargePolicy: { kind: 'consume-on-trigger' as const, amount: 1 },
  tags: ['condition', 'vortex'], payload: { sourceType, tickPercent: 10, escapeDcs: [20, 14, 8, 2] },
  dispel: { policy: 'matching-tags' as const, tags: ['vortex'] }, transferPolicy: 'retain' as const,
})
const vortexEffect = (slug: string, sourceType: string): MoveTemporaryEffectOperation => ({
  id: `${slug}.vortex`, kind: 'temporary-effect', source: { kind: 'operation', id: `${slug}.damage` },
  recipients: { kind: 'hit-targets' }, phase: 'after-damage', reasonCode: `${slug}.vortex`,
  payload: { action: 'add', effectId: 'vortex.target', recipientScope: 'placements', definition: vortexDefinition(sourceType) },
})
export const CEASELESS_EDGE_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Ceaseless Edge', targeting: singleTargeting(),
  operations: [standardAccuracy('ceaseless-edge'), reviewedDamage({ slug: 'ceaseless-edge', damageBase: 7, damageClass: 'physical', moveType: 'dark', criticalHit: { trigger: { kind: 'range', minimum: 19 }, prevention: 'honor' } }), vortexEffect('ceaseless-edge', 'dark'), ...standardTerminalOperations('ceaseless-edge')],
  tags: ['critical-hit', 'damage', 'vortex'],
})

const stoneChoice: MoveBranchEffectOperation = {
  id: 'stone-axe.choose-vortex', kind: 'branch', source: { kind: 'operation', id: 'stone-axe.damage' },
  recipients: { kind: 'hit-targets' }, phase: 'after-damage', reasonCode: 'stone-axe.choose-vortex',
  payload: {
    kind: 'choice', selectionId: 'stone-axe.vortex', scope: 'resolution', owner: 'actor',
    requestId: 'stone-axe.vortex', promptKey: 'move.stone-axe.choose-vortex',
    options: [{ id: 'apply', labelKey: 'move.stone-axe.apply-vortex', operationIds: ['stone-axe.vortex', 'stone-axe.vortex-usage'] }],
    pass: { id: 'pass', operationIds: [] },
  },
}
const stoneUsage: MoveUsageEffectOperation = {
  id: 'stone-axe.vortex-usage', kind: 'usage', source: { kind: 'move', id: 'move.stone-axe' }, recipients: { kind: 'actor' },
  phase: 'usage', reasonCode: 'stone-axe.vortex-once-per-scene',
  payload: { action: 'spend', resourceId: 'stone-axe.vortex-use', amount: 1, resource: { moveName: 'Stone Axe (Vortex)', moveKey: 'stone-axe-vortex', frequency: 'Scene' } },
}
export const STONE_AXE_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Stone Axe', targeting: singleTargeting(),
  operations: [standardAccuracy('stone-axe'), reviewedDamage({ slug: 'stone-axe', damageBase: 7, damageClass: 'physical', moveType: 'rock', criticalHit: { trigger: { kind: 'range', minimum: 18 }, prevention: 'honor' } }), stoneChoice, vortexEffect('stone-axe', 'rock'), stoneUsage, ...standardTerminalOperations('stone-axe')],
  tags: ['choice', 'critical-hit', 'damage', 'vortex'],
})

const conditionDuration = (
  effectId: string,
  duration: NonNullable<MoveConditionEffectOperation['payload']['duration']>['duration'],
): NonNullable<MoveConditionEffectOperation['payload']['duration']> => ({ effectId, duration })

const simpleAttack = (input: {
  canonicalId: FieldHazardCohort226233MoveName; slug: string; damageBase: number; damageClass: 'physical' | 'special'; moveType: string; area?: boolean; operations?: readonly MoveEffectOperation[]
}): MoveSpec => createReviewedMoveSpec({
  canonicalId: input.canonicalId, targeting: input.area ? areaTargeting() : singleTargeting(),
  operations: [standardAccuracy(input.slug), reviewedDamage({ slug: input.slug, damageBase: input.damageBase, damageClass: input.damageClass, moveType: input.moveType }), ...(input.operations ?? []), ...standardTerminalOperations(input.slug)],
  tags: ['damage', ...(input.area ? ['area'] : [])],
})
export const ANCHOR_SHOT_MOVE_SPEC = simpleAttack({ canonicalId: 'Anchor Shot', slug: 'anchor-shot', damageBase: 8, damageClass: 'physical', moveType: 'steel', operations: [reviewedCondition({ slug: 'anchor-shot', id: 'trapped', recipients: 'hit-targets', conditionId: 'trapped', sourceOperationId: 'anchor-shot.damage', duration: conditionDuration('anchor-shot.trapped', { kind: 'rounds', boundary: 'end', remaining: 2 }), applyTypeImmunity: true })] })
export const ASTRAL_BARRAGE_MOVE_SPEC = simpleAttack({ canonicalId: 'Astral Barrage', slug: 'astral-barrage', damageBase: 12, damageClass: 'special', moveType: 'ghost', area: true, operations: [reviewedCondition({ slug: 'astral-barrage', id: 'slowed', recipients: 'hit-targets', conditionId: 'slowed', sourceOperationId: 'astral-barrage.damage', duration: conditionDuration('astral-barrage.slowed', { kind: 'rounds', boundary: 'end', remaining: 1 }), applyTypeImmunity: true })] })

const blockConditions = ['stuck', 'trapped'].map(conditionId => reviewedCondition({
  slug: 'block', id: conditionId, recipients: 'hit-targets', conditionId,
  sourceOperationId: 'block.accuracy', phase: 'hit',
  duration: conditionDuration(`block.${conditionId}`, { kind: 'turns', subject: 'source', boundary: 'start', remaining: 1 }), applyTypeImmunity: true,
}))
export const BLOCK_MOVE_SPEC = createReviewedMoveSpec({ canonicalId: 'Block', targeting: singleTargeting(), operations: [standardAccuracy('block'), ...blockConditions, ...standardTerminalOperations('block')], tags: ['condition'] })

const aquaRing = reviewedCondition({ slug: 'aqua-ring', id: 'coat', recipients: 'actor', conditionId: 'aqua-ring', phase: 'hit', duration: conditionDuration('aqua-ring.coat', { kind: 'scene', remaining: null }) })
export const AQUA_RING_MOVE_SPEC = createReviewedMoveSpec({ canonicalId: 'Aqua Ring', targeting: selfTargeting(), operations: [aquaRing, ...standardTerminalOperations('aqua-ring')], tags: ['coat', 'heal', 'lifecycle'] })

const chargeEffect: MoveTemporaryEffectOperation = {
  id: 'charge.next-electric-damage', kind: 'temporary-effect', source: { kind: 'move', id: 'move.charge' },
  recipients: { kind: 'actor' }, phase: 'schedule', reasonCode: 'charge.next-electric-damage',
  payload: {
    action: 'add', effectId: 'charge.next-electric-damage', recipientScope: 'placements',
    definition: {
      kind: 'numeric-modifier', duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 },
      stacks: 1, charges: 1, stackPolicy: { kind: 'refresh', maxStacks: null },
      chargePolicy: { kind: 'consume-on-trigger', amount: 1 }, tags: ['charge', 'electric', 'damage'],
      payload: { attribute: 'damage', operation: 'multiply', value: 2, rounding: 'floor' },
      dispel: { policy: 'matching-tags', tags: ['charge'] }, transferPolicy: 'expire',
    },
  },
}
export const CHARGE_MOVE_SPEC = createReviewedMoveSpec({ canonicalId: 'Charge', targeting: selfTargeting(), operations: [reviewedStage({ slug: 'charge', id: 'raise-special-defense', recipients: 'actor', stage: 'sdef', value: 1, phase: 'hit' }), chargeEffect, ...standardTerminalOperations('charge')], tags: ['damage-modifier', 'lifecycle', 'stage'] })

const clearSmogDamage: MoveDamageEffectOperation = {
  ...reviewedDamage({
    slug: 'clear-smog', damageBase: 5, damageClass: 'special', moveType: 'poison',
    accuracyRollId: null, criticalRollId: null,
  }),
  source: { kind: 'move', id: 'move.clear-smog' },
}
export const CLEAR_SMOG_MOVE_SPEC = createReviewedMoveSpec({ canonicalId: 'Clear Smog', targeting: singleTargeting(), operations: [clearSmogDamage, reviewedStage({ slug: 'clear-smog', id: 'reset-stages', recipients: 'selected-targets', stage: 'all', value: null, action: 'reset', sourceOperationId: 'clear-smog.damage' }), ...standardTerminalOperations('clear-smog')], tags: ['coat-cleanse', 'damage', 'stage-reset'] })

const SPECS: Record<FieldHazardCohort226233MoveName, MoveSpec> = {
  'Acid Armor': ACID_ARMOR_MOVE_SPEC, 'Aurora Veil': AURORA_VEIL_MOVE_SPEC, Blizzard: BLIZZARD_MOVE_SPEC, Camouflage: CAMOUFLAGE_MOVE_SPEC,
  'Court Change': COURT_CHANGE_MOVE_SPEC, Defog: DEFOG_MOVE_SPEC, 'Electric Terrain': ELECTRIC_TERRAIN_MOVE_SPEC, 'Floral Healing': FLORAL_HEALING_MOVE_SPEC,
  Geomancy: GEOMANCY_MOVE_SPEC, 'Grassy Glide': GRASSY_GLIDE_MOVE_SPEC, 'Grassy Terrain': GRASSY_TERRAIN_MOVE_SPEC, Gravity: GRAVITY_MOVE_SPEC,
  Hail: HAIL_MOVE_SPEC, Hurricane: HURRICANE_MOVE_SPEC, Inferno: INFERNO_MOVE_SPEC, 'Ion Deluge': ION_DELUGE_MOVE_SPEC,
  'Magic Room': MAGIC_ROOM_MOVE_SPEC, 'Misty Explosion': MISTY_EXPLOSION_MOVE_SPEC, 'Misty Terrain': MISTY_TERRAIN_MOVE_SPEC,
  Moonlight: MOONLIGHT_MOVE_SPEC, 'Morning Sun': MORNING_SUN_MOVE_SPEC, 'Rain Dance': RAIN_DANCE_MOVE_SPEC, Sandstorm: SANDSTORM_MOVE_SPEC,
  'Shore Up': SHORE_UP_MOVE_SPEC, Smokescreen: SMOKESCREEN_MOVE_SPEC, 'Solar Beam': SOLAR_BEAM_MOVE_SPEC, 'Solar Blade': SOLAR_BLADE_MOVE_SPEC,
  'Steel Roller': STEEL_ROLLER_MOVE_SPEC, 'Sunny Day': SUNNY_DAY_MOVE_SPEC, Tailwind: TAILWIND_MOVE_SPEC,
  'Terrain Pulse': TERRAIN_PULSE_MOVE_SPEC, Thunder: THUNDER_MOVE_SPEC, 'Trick Room': TRICK_ROOM_MOVE_SPEC,
  'Weather Ball': WEATHER_BALL_MOVE_SPEC, 'Wonder Room': WONDER_ROOM_MOVE_SPEC, 'Zap Cannon': ZAP_CANNON_MOVE_SPEC,
  Barrier: BARRIER_MOVE_SPEC, 'Ceaseless Edge': CEASELESS_EDGE_MOVE_SPEC, 'Fire Pledge': FIRE_PLEDGE_MOVE_SPEC,
  'Grass Pledge': GRASS_PLEDGE_MOVE_SPEC, Spikes: SPIKES_MOVE_SPEC, 'Stealth Rock': STEALTH_ROCK_MOVE_SPEC,
  'Sticky Web': STICKY_WEB_MOVE_SPEC, 'Stone Axe': STONE_AXE_MOVE_SPEC, 'Toxic Spikes': TOXIC_SPIKES_MOVE_SPEC,
  'Water Pledge': WATER_PLEDGE_MOVE_SPEC, 'Anchor Shot': ANCHOR_SHOT_MOVE_SPEC, 'Aqua Ring': AQUA_RING_MOVE_SPEC,
  'Astral Barrage': ASTRAL_BARRAGE_MOVE_SPEC, 'Bitter Malice': BITTER_MALICE_MOVE_SPEC, Block: BLOCK_MOVE_SPEC,
  'Burn Up': BURN_UP_MOVE_SPEC, Charge: CHARGE_MOVE_SPEC, 'Clear Smog': CLEAR_SMOG_MOVE_SPEC,
}
export const FIELD_HAZARD_COHORTS_226_233_MOVE_SPEC_REGISTRATIONS: readonly MoveSpecV2Registration[] = Object.freeze(
  MA_226_233_MOVE_NAMES.map(canonicalId => Object.freeze({
    canonicalId, sourceModule: 'server/domain/moveAutomation/specs/fieldHazardCohorts226_233.ts', spec: SPECS[canonicalId],
  })),
)
