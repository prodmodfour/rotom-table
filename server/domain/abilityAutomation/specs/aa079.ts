import {
  AA079_MARVEL_SCALE_CONDITIONS,
  AA079_MEGA_LAUNCHER_MOVE_IDS,
} from '#shared/abilityAutomation/aa079'
import type { AbilitySpecV1Registration } from '../registry'
import {
  abilityMechanicOperation as mechanic,
  noAbilityTarget,
  reviewedAbilitySpec,
  reviewedActivatedAbilitySpec as activatedSpec,
  reviewedStaticAbilitySpec as staticSpec,
  reviewedTriggeredAbilitySpec as triggeredSpec,
} from './reviewedSpecBuilder'

const strikePredicate = (input: {
  readonly ownerRole: 'attacker' | 'defender'
  readonly rangeContexts: readonly ('melee' | 'ranged' | 'area' | 'other')[]
  readonly directness?: readonly ('direct' | 'indirect')[]
}) => ({
  kind: 'ability-strike-fact' as const,
  timings: ['accuracy-resolved'] as const,
  accuracyOutcomes: ['hit', 'automatic-hit'] as const,
  rangeContexts: input.rangeContexts,
  directness: input.directness ?? [],
  moveTypes: [] as const,
  damageClasses: ['physical', 'special'] as const,
  effectiveness: [] as const,
  contact: 'any' as const,
  critical: 'any' as const,
  ownerRole: input.ownerRole,
  prevention: 'unprevented' as const,
  strikeIndex: 'any' as const,
  minimumHpLoss: null,
  minimumTotalLoss: null,
})

const movePredicate = (input: {
  readonly timings: readonly ('declared' | 'accuracy-resolved' | 'effects-resolved')[]
  readonly userRelation: 'owner' | 'other'
  readonly targetRelation: 'any' | 'hit' | 'attacked'
}) => ({
  kind: 'ability-move-fact' as const,
  timings: input.timings,
  moveTypes: [] as const,
  damageClasses: [] as const,
  keywordsAny: [] as const,
  keywordsAll: [] as const,
  userRelation: input.userRelation,
  targetRelation: input.targetRelation,
})

const tokenTarget = (modeId: string, id: string) => ({
  id,
  modeId,
  kind: 'token' as const,
  minSelections: 1,
  maxSelections: 1,
  selector: null,
  predicate: {
    kind: 'ability-targeting',
    relationship: 'any',
    willingness: 'any',
    excludeActor: true,
    minimumRange: 0,
    maximumRange: null,
    visibility: 'required',
    lineOfSight: 'ignored',
    geometry: { kind: 'direct' },
  },
})

export const MAGIC_GUARD_ABILITY_SPEC = staticSpec('Magic Guard', 'aa079.magic-guard', {
  preventedSources: [
    'hazard', 'weather', 'status-affliction', 'vortex', 'recoil',
    'hay-fever', 'iron-barbs', 'rough-skin', 'leech-seed',
  ],
}, ['defensive', 'hp', 'immunity', 'lifecycle', 'static'])

export const MAGICIAN_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Magician',
  mechanicId: 'aa079.magician',
  config: {
    action: 'free', frequency: 'scene', trigger: 'damaging-single-target-hit',
    targetRelationship: 'foe', requiresEmptyHeldItem: true, itemAction: 'steal-held',
  },
  eventKind: 'strike',
  checkpoint: 'post-effect',
  predicate: strikePredicate({
    ownerRole: 'attacker',
    rangeContexts: ['melee', 'ranged', 'other'],
    directness: ['direct'],
  }),
  tags: ['action', 'choice', 'item', 'reaction', 'scene', 'triggered'],
})

export const MAGMA_ARMOR_ABILITY_SPEC = reviewedAbilitySpec({
  canonicalId: 'Magma Armor',
  modes: [{ id: 'trigger', kind: 'triggered' }, { id: 'passive', kind: 'static' }],
  subscriptions: [{
    id: 'trigger.melee-hit', modeId: 'trigger', eventKind: 'strike',
    checkpoint: 'post-effect', response: 'mandatory', priority: 114,
    oncePerCausalChain: false,
    predicate: strikePredicate({ ownerRole: 'defender', rangeContexts: ['melee'] }),
  }],
  targeting: [...noAbilityTarget('trigger'), ...noAbilityTarget('passive')],
  phases: [
    { modeId: 'trigger', phase: 'effect', operations: [mechanic('trigger.effect', 'aa079.magma-armor', {
      triggers: ['melee-hit', 'grapple-turn-end'], hitPointLossTicks: 1, burnImmunityPrevents: true,
    })] },
    { modeId: 'passive', phase: 'effect', operations: [mechanic('passive.effect', 'aa079.magma-armor', {
      triggers: ['melee-hit', 'grapple-turn-end'], hitPointLossTicks: 1, burnImmunityPrevents: true,
    })] },
  ],
  tags: ['hp', 'lifecycle', 'mode.static', 'mode.triggered', 'triggered'],
})

export const MAGNET_PULL_ABILITY_SPEC = activatedSpec('Magnet Pull', 'aa079.magnet-pull', {
  action: 'swift', frequency: 'scene-x3', effectsSelected: 2,
  maximumDisplacementBase: 6, subtractWeightClass: true,
  maximumRange: 6, minimumRange: 3, duration: 'until-end-next-turn',
}, [
  tokenTarget('activate', 'activate.target'),
  {
    id: 'activate.plan', modeId: 'activate', kind: 'branch' as const,
    minSelections: 1, maxSelections: 1, selector: null, predicate: null,
  },
], ['action', 'choice', 'forced-movement', 'lifecycle', 'mode.activated', 'scene', 'target'])

export const MARVEL_SCALE_ABILITY_SPEC = staticSpec('Marvel Scale', 'aa079.marvel-scale', {
  conditions: AA079_MARVEL_SCALE_CONDITIONS,
  defenseStageDelta: 2,
}, ['combat-stage', 'condition', 'defensive', 'static'])

export const MEGA_LAUNCHER_ABILITY_SPEC = staticSpec('Mega Launcher', 'aa079.mega-launcher', {
  moveIds: AA079_MEGA_LAUNCHER_MOVE_IDS,
  damageBaseBonus: 3,
}, ['damage-base', 'static'])

const memoryConfig = {
  frequency: 'scene',
  swiftEffect: 'disable-last-move',
  standardConditions: ['Flinch', 'Paralysis'],
  extendedMaximumMinutes: 10,
  lookbackMinutes: 30,
} as const

export const MEMORY_WIPE_ABILITY_SPEC = reviewedAbilitySpec({
  canonicalId: 'Memory Wipe',
  modes: [
    { id: 'swift', kind: 'activated' },
    { id: 'standard', kind: 'activated' },
    { id: 'extended', kind: 'activated' },
  ],
  targeting: [
    tokenTarget('swift', 'swift.target'),
    tokenTarget('standard', 'standard.target'),
    tokenTarget('extended', 'extended.target'),
    {
      id: 'extended.minutes', modeId: 'extended', kind: 'branch',
      minSelections: 1, maxSelections: 1, selector: null, predicate: null,
    },
  ],
  phases: [
    { modeId: 'swift', phase: 'effect', operations: [mechanic('swift.effect', 'aa079.memory-wipe', memoryConfig)] },
    { modeId: 'standard', phase: 'effect', operations: [mechanic('standard.effect', 'aa079.memory-wipe', memoryConfig)] },
    { modeId: 'extended', phase: 'effect', operations: [mechanic('extended.effect', 'aa079.memory-wipe', memoryConfig)] },
  ],
  tags: ['action', 'choice', 'condition', 'history', 'mode.activated', 'scene', 'target'],
})

export const MERCILESS_ABILITY_SPEC = staticSpec('Merciless', 'aa079.merciless', {
  requiredConditions: ['Poisoned', 'Badly Poisoned'],
  damagingOnly: true,
  automaticCritical: true,
  honorCriticalPrevention: true,
}, ['condition', 'critical-hit', 'damage', 'static'])

export const MIGRAINE_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Migraine',
  mechanicId: 'aa079.migraine',
  config: {
    connectionMoveId: 'Confusion', action: 'free', frequency: 'scene-x2',
    hpThresholdNumerator: 1, hpThresholdDenominator: 2,
    condition: 'Confused', automaticCritical: true,
  },
  eventKind: 'move',
  checkpoint: 'pre-effect',
  predicate: movePredicate({ timings: ['accuracy-resolved'], userRelation: 'owner', targetRelation: 'hit' }),
  tags: ['action', 'condition', 'connection', 'critical-hit', 'reaction', 'scene', 'triggered'],
})

export const MIMICRY_ABILITY_SPEC = activatedSpec('Mimicry', 'aa079.mimicry', {
  action: 'free', frequency: 'scene',
  fieldTypePairs: [
    'beach:ground,water', 'cave:rock,dark', 'desert:ground,rock', 'forest:grass',
    'freshwater:water', 'ocean:water', 'grassland:normal,grass', 'marsh:water,poison',
    'mountain:rock,ground', 'rainforest:grass,poison', 'taiga:ice,grass', 'tundra:ice',
    'urban:normal,steel',
  ],
  weatherTypePairs: ['sunny:fire', 'rainy:water', 'hail:ice', 'sandstorm:rock'],
  duration: 'scene',
}, [{
  id: 'activate.type', modeId: 'activate', kind: 'type',
  minSelections: 1, maxSelections: 1, selector: null, predicate: null,
}], ['action', 'choice', 'field', 'mode.activated', 'scene', 'type', 'weather'])

const mimitreeConfig = {
  connectionMoveId: 'Mimic', trigger: 'use-mimic-copied-move',
  replacementMoveId: 'Mimic', ignoreReplacementFrequency: true,
} as const

export const MIMITREE_ABILITY_SPEC = reviewedAbilitySpec({
  canonicalId: 'Mimitree',
  modes: [{ id: 'trigger', kind: 'triggered' }, { id: 'passive', kind: 'static' }],
  subscriptions: [{
    id: 'trigger.copied-move', modeId: 'trigger', eventKind: 'move',
    checkpoint: 'post-effect', response: 'optional', priority: 120,
    oncePerCausalChain: false,
    predicate: movePredicate({ timings: ['effects-resolved'], userRelation: 'owner', targetRelation: 'any' }),
  }],
  targeting: [...noAbilityTarget('trigger'), ...noAbilityTarget('passive')],
  phases: [
    { modeId: 'trigger', phase: 'effect', operations: [mechanic('trigger.effect', 'aa079.mimitree', mimitreeConfig)] },
    { modeId: 'passive', phase: 'effect', operations: [mechanic('passive.effect', 'aa079.mimitree', mimitreeConfig)] },
  ],
  tags: ['choice', 'connection', 'mode.static', 'mode.triggered', 'move-overlay'],
})

export const MIND_MOLD_ABILITY_SPEC = staticSpec('Mind Mold', 'aa079.mind-mold', {
  lastChanceType: 'psychic', hpThresholdNumerator: 1,
  hpThresholdDenominator: 3, damageBonus: 5,
}, ['damage', 'last-chance', 'static', 'type'])

export const AA079_ABILITY_SPECS = Object.freeze([
  MAGIC_GUARD_ABILITY_SPEC,
  MAGICIAN_ABILITY_SPEC,
  MAGMA_ARMOR_ABILITY_SPEC,
  MAGNET_PULL_ABILITY_SPEC,
  MARVEL_SCALE_ABILITY_SPEC,
  MEGA_LAUNCHER_ABILITY_SPEC,
  MEMORY_WIPE_ABILITY_SPEC,
  MERCILESS_ABILITY_SPEC,
  MIGRAINE_ABILITY_SPEC,
  MIMICRY_ABILITY_SPEC,
  MIMITREE_ABILITY_SPEC,
  MIND_MOLD_ABILITY_SPEC,
])

export const AA079_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = Object.freeze(
  AA079_ABILITY_SPECS.map(spec => ({
    canonicalId: spec.canonicalId,
    version: 1,
    sourceModule: 'server/domain/abilityAutomation/specs/aa079.ts',
    spec,
  })),
)
