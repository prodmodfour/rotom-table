import type { AbilitySpecV1Registration } from '../registry'
import {
  abilityMechanicOperation as mechanic,
  noAbilityTarget,
  reviewedAbilitySpec,
  reviewedActivatedAbilitySpec as activatedSpec,
  reviewedStaticAbilitySpec as staticSpec,
  reviewedTriggeredAbilitySpec as triggeredSpec,
} from './reviewedSpecBuilder'

const movePredicate = (input: {
  readonly timings: readonly ('declared' | 'accuracy-resolved' | 'effects-resolved')[]
  readonly moveTypes?: readonly string[]
  readonly damageClasses?: readonly ('physical' | 'special' | 'status')[]
  readonly userRelation: 'owner' | 'other'
  readonly targetRelation: 'any' | 'hit' | 'attacked'
}) => ({
  kind: 'ability-move-fact' as const,
  timings: input.timings,
  moveTypes: input.moveTypes ?? [],
  damageClasses: input.damageClasses ?? [],
  keywordsAny: [] as const,
  keywordsAll: [] as const,
  userRelation: input.userRelation,
  targetRelation: input.targetRelation,
})

const anyVisibleToken = {
  kind: 'ability-targeting' as const,
  relationship: 'any' as const,
  willingness: 'any' as const,
  excludeActor: false,
  minimumRange: 0,
  maximumRange: null,
  visibility: 'required' as const,
  lineOfSight: 'ignored' as const,
  geometry: { kind: 'direct' as const },
}

export const HYPNOTIC_ABILITY_SPEC = staticSpec('Hypnotic', 'aa075.hypnotic', {
  connectionMoveId: 'Hypnosis', automaticHit: true,
}, ['accuracy', 'connection', 'move-overlay', 'static'])

export const ICE_BODY_ABILITY_SPEC = activatedSpec('Ice Body', 'aa075.ice-body', {
  action: 'swift', frequency: 'daily-x5', healingTicks: 1,
  hpThresholdNumerator: 1, hpThresholdDenominator: 2, weatherAlternative: 'hail',
}, noAbilityTarget('activate'), ['action', 'healing', 'mode.activated', 'weather'])

export const ICE_FACE_ABILITY_SPEC = reviewedAbilitySpec({
  canonicalId: 'Ice Face',
  modes: [{ id: 'restore-face', kind: 'activated' }],
  targeting: noAbilityTarget('restore-face'),
  phases: [{
    modeId: 'restore-face', phase: 'effect',
    operations: [mechanic('restore-face.mechanic', 'aa075.ice-face', {
      action: 'standard', requiredWeather: 'hail', temporaryHpTicks: 2,
      battleStartTemporaryHpTicks: 2, hailDamageImmunity: true,
      iceForm: 'ice-face', noiceForm: 'noice-face',
    })],
  }],
  tags: ['action', 'form', 'mode.activated', 'static', 'temporary-hp', 'weather'],
})

export const ICE_SCALES_ABILITY_SPEC = staticSpec('Ice Scales', 'aa075.ice-scales', {
  damageClass: 'special', resistanceSteps: 1,
}, ['damage', 'defensive', 'resistance', 'static'])

export const ICE_SHIELD_ABILITY_SPEC = activatedSpec('Ice Shield', 'aa075.ice-shield', {
  action: 'standard-interrupt', frequency: 'scene', maximumSegments: 3,
  requiredAdjacentSegments: 1, contiguous: true, segmentHeight: 2,
  segmentHitPoints: 10, segmentDamageReduction: 5, segmentType: 'ice',
  duration: 'encounter', blockingTerrain: true,
}, [{
  id: 'activate.segments', modeId: 'activate', kind: 'cell',
  minSelections: 1, maxSelections: 3, selector: null, predicate: null,
}], ['action', 'barrier', 'choice', 'geometry', 'mode.activated', 'scene'])

export const IGNITION_BOOST_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Ignition Boost', mechanicId: 'aa075.ignition-boost',
  config: {
    action: 'free', frequency: 'at-will', triggerRelationship: 'adjacent-ally',
    triggerType: 'fire', damagingOnly: true, damageBonus: 5, maximumBenefits: 1,
  },
  eventKind: 'move', checkpoint: 'pre-effect',
  predicate: movePredicate({
    timings: ['declared'], moveTypes: ['fire'], damageClasses: ['physical', 'special'],
    userRelation: 'other', targetRelation: 'any',
  }),
  tags: ['action', 'ally', 'damage', 'reaction', 'triggered', 'type'],
})

export const ILLUMINATE_ABILITY_SPEC = staticSpec('Illuminate', 'aa075.illuminate', {
  incomingAccuracyPenalty: -2, bypassCapability: 'blindsense',
}, ['accuracy', 'capability', 'defensive', 'static'])

const illusionConfig = (operation: 'mark-creature' | 'mark-object' | 'replace-creature' | 'replace-object' | 'assume' | 'dismiss') => ({
  operation,
  markAction: 'standard', assumeAction: 'free', dismissAction: 'free',
  markCapacitySource: 'focus-rank', assumeFrequency: 'once-per-round',
  appearanceOnly: true, breakTrigger: 'damaging-move-hit',
})

export const ILLUSION_ABILITY_SPEC = reviewedAbilitySpec({
  canonicalId: 'Illusion',
  modes: [
    { id: 'mark-creature', kind: 'activated' },
    { id: 'mark-object', kind: 'activated' },
    { id: 'replace-creature', kind: 'activated' },
    { id: 'replace-object', kind: 'activated' },
    { id: 'assume', kind: 'activated' },
    { id: 'dismiss', kind: 'activated' },
  ],
  targeting: [
    {
      id: 'mark-creature.target', modeId: 'mark-creature', kind: 'token',
      minSelections: 1, maxSelections: 1, selector: { kind: 'candidate-targets' },
      predicate: anyVisibleToken,
    },
    {
      id: 'mark-object.cell', modeId: 'mark-object', kind: 'cell',
      minSelections: 1, maxSelections: 1, selector: null, predicate: null,
    },
    {
      id: 'replace-creature.target', modeId: 'replace-creature', kind: 'token',
      minSelections: 1, maxSelections: 1, selector: { kind: 'candidate-targets' },
      predicate: anyVisibleToken,
    },
    {
      id: 'replace-creature.old-mark', modeId: 'replace-creature', kind: 'branch',
      minSelections: 1, maxSelections: 1, selector: null, predicate: null,
    },
    {
      id: 'replace-object.cell', modeId: 'replace-object', kind: 'cell',
      minSelections: 1, maxSelections: 1, selector: null, predicate: null,
    },
    {
      id: 'replace-object.old-mark', modeId: 'replace-object', kind: 'branch',
      minSelections: 1, maxSelections: 1, selector: null, predicate: null,
    },
    {
      id: 'assume.mark', modeId: 'assume', kind: 'branch',
      minSelections: 1, maxSelections: 1, selector: null, predicate: null,
    },
    ...noAbilityTarget('dismiss'),
  ],
  phases: [
    { modeId: 'mark-creature', phase: 'effect', operations: [mechanic('mark-creature.mechanic', 'aa075.illusion', illusionConfig('mark-creature'))] },
    { modeId: 'mark-object', phase: 'effect', operations: [mechanic('mark-object.mechanic', 'aa075.illusion', illusionConfig('mark-object'))] },
    { modeId: 'replace-creature', phase: 'effect', operations: [mechanic('replace-creature.mechanic', 'aa075.illusion', illusionConfig('replace-creature'))] },
    { modeId: 'replace-object', phase: 'effect', operations: [mechanic('replace-object.mechanic', 'aa075.illusion', illusionConfig('replace-object'))] },
    { modeId: 'assume', phase: 'effect', operations: [mechanic('assume.mechanic', 'aa075.illusion', illusionConfig('assume'))] },
    { modeId: 'dismiss', phase: 'effect', operations: [mechanic('dismiss.mechanic', 'aa075.illusion', illusionConfig('dismiss'))] },
  ],
  tags: ['action', 'appearance', 'choice', 'mode.activated', 'owned-state', 'recovery'],
})

export const IMMUNITY_ABILITY_SPEC = staticSpec('Immunity', 'aa075.immunity', {
  blockedConditions: ['poisoned', 'badly-poisoned'],
}, ['condition', 'defensive', 'immunity', 'static'])

export const IMPOSTER_ABILITY_SPEC = staticSpec('Imposter', 'aa075.imposter', {
  connectionMoveId: 'Transform', actionOverride: 'free-interrupt',
  requiresUntransformed: true,
}, ['action', 'connection', 'interrupt', 'move-overlay', 'static', 'transformation'])

export const INFILTRATOR_ABILITY_SPEC = staticSpec('Infiltrator', 'aa075.infiltrator', {
  stealthBonus: 2, ignoreHazards: true, blockResponsiveBlessings: true,
  bypassSubstitute: true,
}, ['blessing', 'capability', 'hazard', 'skill-check', 'static', 'temporary-hp'])

export const INNARDS_OUT_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Innards Out', mechanicId: 'aa075.innards-out',
  config: {
    action: 'free', frequency: 'scene-x2', damagingOnly: true,
    resistanceSteps: 1, foeRange: 2, reflectedRealHpMultiplier: 2,
    resolvesAfterAttack: true, resolvesAfterFainting: true,
  },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: movePredicate({
    timings: ['effects-resolved'], damageClasses: ['physical', 'special'],
    userRelation: 'other', targetRelation: 'hit',
  }),
  tags: ['action', 'damage', 'hp', 'reaction', 'resistance', 'scene', 'triggered'],
})

export const AA075_ABILITY_SPECS = Object.freeze([
  HYPNOTIC_ABILITY_SPEC, ICE_BODY_ABILITY_SPEC, ICE_FACE_ABILITY_SPEC,
  ICE_SCALES_ABILITY_SPEC, ICE_SHIELD_ABILITY_SPEC, IGNITION_BOOST_ABILITY_SPEC,
  ILLUMINATE_ABILITY_SPEC, ILLUSION_ABILITY_SPEC, IMMUNITY_ABILITY_SPEC,
  IMPOSTER_ABILITY_SPEC, INFILTRATOR_ABILITY_SPEC, INNARDS_OUT_ABILITY_SPEC,
])

export const AA075_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = Object.freeze(
  AA075_ABILITY_SPECS.map(spec => ({
    canonicalId: spec.canonicalId,
    version: 1,
    sourceModule: 'server/domain/abilityAutomation/specs/aa075.ts',
    spec,
  })),
)
