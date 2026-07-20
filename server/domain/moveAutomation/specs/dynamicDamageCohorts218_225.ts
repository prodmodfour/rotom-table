import type {
  MoveBranchEffectOperation,
  MoveEffectOperation,
  MoveMultiHitEffectOperation,
  MoveUsageEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveSpec, MoveSpecCostDeclaration, MoveSpecTargetingDeclaration } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'
import { DYNAMIC_DAMAGE_218_225_HANDLER_ID } from '../handlers/dynamicDamage218_225'
import { FIVE_STRIKE_HIT_COUNT_TABLE } from './fiveStrike'
import {
  areaTargeting,
  createReviewedMoveSpec,
  multiTargeting,
  reviewedCondition,
  reviewedDamage,
  reviewedMultiHit,
  reviewedStage,
  selfTargeting,
  singleTargeting,
  standardAccuracy,
  standardActionCost,
  standardTerminalOperations,
} from './reviewedSpecBuilder'

export const MA_218_225_MOVE_NAMES = Object.freeze([
  'Arm Thrust', 'Autotomize', 'Barb Barrage', 'Barrage', 'Behemoth Bash', 'Behemoth Blade', 'Body Press', 'Bolt Beak',
  'Bone Rush', 'Bonemerang', 'Bullet Seed', 'Comet Punch', 'Double Hit', 'Double Iron Bash', 'Double Slap', 'Dragon Darts',
  'Dual Chop', 'Dual Wingbeat', 'Dynamax Cannon', 'Echoed Voice', 'Electro Ball', 'Façade', 'Fishious Rend', 'Flail',
  'Fusion Bolt', 'Fusion Flare', 'Gear Grind', 'Grass Knot', 'Gyro Ball', 'Heavy Slam', 'Hex', 'Ice Ball',
  'Icicle Spear', 'Infernal Parade', 'Judgment', 'Low Kick', 'Payback', 'Punishment', 'Retaliate', 'Revelation Dance',
  'Reversal', 'Rock Blast', 'Round', 'Scale Shot', 'Secret Power', 'Smelling Salts', 'Spike Cannon', 'Stomping Tantrum',
  'Stored Power', 'Tail Slap', 'Triple Axel', 'Triple Kick', 'Trump Card', 'Twineedle', 'Venoshock', 'Wake-Up Slap',
  'Water Shuriken',
] as const)
export type DynamicDamageCohort218225MoveName = (typeof MA_218_225_MOVE_NAMES)[number]

const fiveStrikeCount: MoveMultiHitEffectOperation['payload']['count'] = {
  kind: 'table', scope: 'sequence', rollId: 'five-strike.hit-count-roll',
  tableId: 'ptu.five-strike-count', drawFormula: { kind: 'dice', count: 1, sides: 8, modifier: 0 },
  entries: FIVE_STRIKE_HIT_COUNT_TABLE,
}
const onceAccuracy = (slug: string): MoveMultiHitEffectOperation['payload']['accuracy'] => ({
  kind: 'once', rollId: `${slug}.accuracy-roll`, formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
})
const perHitAccuracy = (slug: string, stopOnMiss = false): MoveMultiHitEffectOperation['payload']['accuracy'] => ({
  kind: 'per-hit', rollId: `${slug}.accuracy-roll`,
  formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 }, stopOnMiss,
})

const multiHitSpec = (input: {
  readonly canonicalId: DynamicDamageCohort218225MoveName
  readonly slug: string
  readonly damageBase: number
  readonly damageClass?: 'physical' | 'special'
  readonly moveType: string
  readonly count: MoveMultiHitEffectOperation['payload']['count']
  readonly accuracy: MoveMultiHitEffectOperation['payload']['accuracy']
  readonly effects?: MoveMultiHitEffectOperation['payload']['effects']
  readonly costs?: readonly MoveSpecCostDeclaration[]
  readonly tags: readonly string[]
}): MoveSpec => createReviewedMoveSpec({
  canonicalId: input.canonicalId,
  targeting: singleTargeting(),
  costs: input.costs,
  operations: [
    reviewedMultiHit({
      slug: input.slug, damageBase: input.damageBase,
      damageClass: input.damageClass ?? 'physical', moveType: input.moveType,
      count: input.count, accuracy: input.accuracy, effects: input.effects,
    }),
    ...standardTerminalOperations(input.slug),
  ],
  tags: ['damage', 'multi-hit', ...input.tags],
})

const fiveStrikeSpec = (input: {
  readonly canonicalId: DynamicDamageCohort218225MoveName
  readonly slug: string
  readonly damageBase: number
  readonly moveType: string
  readonly damageClass?: 'physical' | 'special'
  readonly effects?: MoveMultiHitEffectOperation['payload']['effects']
  readonly costs?: readonly MoveSpecCostDeclaration[]
}): MoveSpec => multiHitSpec({
  ...input, count: { ...fiveStrikeCount, rollId: `${input.slug}.hit-count-roll`, tableId: `${input.slug}.five-strike-count` },
  accuracy: onceAccuracy(input.slug), tags: ['five-strike'],
})

const doubleStrikeSpec = (input: {
  readonly canonicalId: DynamicDamageCohort218225MoveName
  readonly slug: string
  readonly damageBase: number
  readonly moveType: string
  readonly effects?: MoveMultiHitEffectOperation['payload']['effects']
}): MoveSpec => multiHitSpec({
  ...input, count: { kind: 'fixed', hits: 2 }, accuracy: perHitAccuracy(input.slug),
  tags: ['double-strike'],
})

const dynamicSpec = (input: {
  readonly canonicalId: DynamicDamageCohort218225MoveName
  readonly slug: string
  readonly targeting?: MoveSpecTargetingDeclaration
  readonly operations?: readonly MoveEffectOperation[]
  readonly tags?: readonly string[]
}): MoveSpec => createReviewedMoveSpec({
  canonicalId: input.canonicalId,
  targeting: input.targeting ?? singleTargeting(),
  registeredHandlerId: DYNAMIC_DAMAGE_218_225_HANDLER_ID,
  operations: [standardAccuracy(input.slug), ...(input.operations ?? []), ...standardTerminalOperations(input.slug)],
  tags: ['damage', 'dynamic', ...(input.tags ?? [])],
})

const fixedAttackSpec = (input: {
  readonly canonicalId: DynamicDamageCohort218225MoveName
  readonly slug: string
  readonly damageBase: number
  readonly damageClass: 'physical' | 'special'
  readonly moveType: string
  readonly attackStat?: Parameters<typeof reviewedDamage>[0]['attackStat']
}): MoveSpec => createReviewedMoveSpec({
  canonicalId: input.canonicalId, targeting: singleTargeting(),
  operations: [
    standardAccuracy(input.slug),
    reviewedDamage(input),
    ...standardTerminalOperations(input.slug),
  ],
  tags: ['damage', input.moveType],
})

export const ARM_THRUST_MOVE_SPEC = fiveStrikeSpec({ canonicalId: 'Arm Thrust', slug: 'arm-thrust', damageBase: 2, moveType: 'fighting' })
export const BARRAGE_MOVE_SPEC = fiveStrikeSpec({ canonicalId: 'Barrage', slug: 'barrage', damageBase: 2, moveType: 'normal' })
export const BONE_RUSH_MOVE_SPEC = fiveStrikeSpec({ canonicalId: 'Bone Rush', slug: 'bone-rush', damageBase: 3, moveType: 'ground' })
export const BULLET_SEED_MOVE_SPEC = fiveStrikeSpec({ canonicalId: 'Bullet Seed', slug: 'bullet-seed', damageBase: 3, moveType: 'grass' })
export const COMET_PUNCH_MOVE_SPEC = fiveStrikeSpec({ canonicalId: 'Comet Punch', slug: 'comet-punch', damageBase: 2, moveType: 'normal' })
export const DOUBLE_SLAP_MOVE_SPEC = fiveStrikeSpec({ canonicalId: 'Double Slap', slug: 'double-slap', damageBase: 2, moveType: 'normal' })
export const ICICLE_SPEAR_MOVE_SPEC = fiveStrikeSpec({ canonicalId: 'Icicle Spear', slug: 'icicle-spear', damageBase: 3, moveType: 'ice' })
export const ROCK_BLAST_MOVE_SPEC = fiveStrikeSpec({ canonicalId: 'Rock Blast', slug: 'rock-blast', damageBase: 3, moveType: 'rock' })
export const SPIKE_CANNON_MOVE_SPEC = fiveStrikeSpec({ canonicalId: 'Spike Cannon', slug: 'spike-cannon', damageBase: 3, moveType: 'normal' })
export const TAIL_SLAP_MOVE_SPEC = fiveStrikeSpec({ canonicalId: 'Tail Slap', slug: 'tail-slap', damageBase: 3, moveType: 'normal' })

export const BONEMERANG_MOVE_SPEC = doubleStrikeSpec({ canonicalId: 'Bonemerang', slug: 'bonemerang', damageBase: 5, moveType: 'ground' })
export const DOUBLE_HIT_MOVE_SPEC = doubleStrikeSpec({ canonicalId: 'Double Hit', slug: 'double-hit', damageBase: 4, moveType: 'normal' })
export const DUAL_CHOP_MOVE_SPEC = doubleStrikeSpec({ canonicalId: 'Dual Chop', slug: 'dual-chop', damageBase: 5, moveType: 'dragon' })
export const DUAL_WINGBEAT_MOVE_SPEC = doubleStrikeSpec({ canonicalId: 'Dual Wingbeat', slug: 'dual-wingbeat', damageBase: 4, moveType: 'flying' })
export const GEAR_GRIND_MOVE_SPEC = doubleStrikeSpec({ canonicalId: 'Gear Grind', slug: 'gear-grind', damageBase: 5, moveType: 'steel' })

const flinchPayload = reviewedCondition({
  slug: 'double-iron-bash', id: 'flinch', recipients: 'hit-targets', conditionId: 'flinched',
}).payload
export const DOUBLE_IRON_BASH_MOVE_SPEC = doubleStrikeSpec({
  canonicalId: 'Double Iron Bash', slug: 'double-iron-bash', damageBase: 6, moveType: 'steel',
  effects: [{
    id: 'double-iron-bash.flinch', timing: 'after-each', trigger: 'hit',
    naturalAccuracyMinimum: 15, recipient: 'target', kind: 'condition',
    reasonCode: 'double-iron-bash.flinch', payload: flinchPayload,
  }],
})
const poisonPayload = reviewedCondition({
  slug: 'twineedle', id: 'poison', recipients: 'hit-targets', conditionId: 'poisoned',
}).payload
export const TWINEEDLE_MOVE_SPEC = doubleStrikeSpec({
  canonicalId: 'Twineedle', slug: 'twineedle', damageBase: 3, moveType: 'bug',
  effects: [{
    id: 'twineedle.poison', timing: 'after-each', trigger: 'hit', naturalAccuracyMinimum: 18,
    recipient: 'target', kind: 'condition', reasonCode: 'twineedle.poison', payload: poisonPayload,
  }],
})

const scaleSpeedPayload = reviewedStage({
  slug: 'scale-shot', id: 'raise-speed', recipients: 'actor', stage: 'spd', value: 1,
}).payload
const scaleDefensePayload = reviewedStage({
  slug: 'scale-shot', id: 'lower-defense', recipients: 'actor', stage: 'def', value: -1,
}).payload
export const SCALE_SHOT_MOVE_SPEC = fiveStrikeSpec({
  canonicalId: 'Scale Shot', slug: 'scale-shot', damageBase: 3, moveType: 'dragon',
  effects: [
    { id: 'scale-shot.raise-speed', timing: 'after-all', trigger: 'always', recipient: 'actor', kind: 'combat-stage', reasonCode: 'scale-shot.raise-speed', payload: scaleSpeedPayload },
    { id: 'scale-shot.lower-defense', timing: 'after-all', trigger: 'always', recipient: 'actor', kind: 'combat-stage', reasonCode: 'scale-shot.lower-defense', payload: scaleDefensePayload },
  ],
})

const priorityCosts = (slug: string): readonly MoveSpecCostDeclaration[] => [
  { id: `${slug}.cost.priority`, phase: 'declare', cost: { kind: 'priority', mode: 'standard' } },
  standardActionCost(slug),
]
export const WATER_SHURIKEN_MOVE_SPEC = fiveStrikeSpec({
  canonicalId: 'Water Shuriken', slug: 'water-shuriken', damageBase: 2,
  damageClass: 'special', moveType: 'water', costs: priorityCosts('water-shuriken'),
})

export const BODY_PRESS_MOVE_SPEC = fixedAttackSpec({
  canonicalId: 'Body Press', slug: 'body-press', damageBase: 8, damageClass: 'physical', moveType: 'fighting',
  attackStat: {
    kind: 'stat', subject: { kind: 'actor' }, stat: 'defense',
    combatStagePolicy: 'honor', stageModifierPolicy: 'honor',
  },
})

export const AUTOTOMIZE_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Autotomize', targeting: selfTargeting(), registeredHandlerId: DYNAMIC_DAMAGE_218_225_HANDLER_ID,
  operations: [...standardTerminalOperations('autotomize')], tags: ['lifecycle', 'stage', 'weight-class'],
})

const dynamicDefinitions = [
  ['Behemoth Bash', 'behemoth-bash'], ['Behemoth Blade', 'behemoth-blade'], ['Bolt Beak', 'bolt-beak'],
  ['Dynamax Cannon', 'dynamax-cannon'], ['Echoed Voice', 'echoed-voice'], ['Electro Ball', 'electro-ball'],
  ['Façade', 'facade'], ['Fishious Rend', 'fishious-rend'], ['Flail', 'flail'], ['Fusion Bolt', 'fusion-bolt'],
  ['Fusion Flare', 'fusion-flare'], ['Grass Knot', 'grass-knot'], ['Gyro Ball', 'gyro-ball'], ['Heavy Slam', 'heavy-slam'],
  ['Hex', 'hex'], ['Ice Ball', 'ice-ball'], ['Infernal Parade', 'infernal-parade'], ['Low Kick', 'low-kick'],
  ['Payback', 'payback'], ['Punishment', 'punishment'], ['Retaliate', 'retaliate'], ['Revelation Dance', 'revelation-dance'],
  ['Reversal', 'reversal'], ['Round', 'round'], ['Secret Power', 'secret-power'], ['Smelling Salts', 'smelling-salts'],
  ['Stomping Tantrum', 'stomping-tantrum'], ['Stored Power', 'stored-power'], ['Trump Card', 'trump-card'],
  ['Venoshock', 'venoshock'], ['Wake-Up Slap', 'wake-up-slap'],
] as const satisfies readonly (readonly [DynamicDamageCohort218225MoveName, string])[]

const DYNAMIC_SPECS = Object.fromEntries(dynamicDefinitions.map(([canonicalId, slug]) => [
  canonicalId,
  dynamicSpec({
    canonicalId, slug,
    ...(['Round', 'Infernal Parade'].includes(canonicalId)
      ? { targeting: areaTargeting() }
      : {}),
  }),
])) as Record<(typeof dynamicDefinitions)[number][0], MoveSpec>

export const BEHEMOTH_BASH_MOVE_SPEC = DYNAMIC_SPECS['Behemoth Bash']
export const BEHEMOTH_BLADE_MOVE_SPEC = DYNAMIC_SPECS['Behemoth Blade']
export const BOLT_BEAK_MOVE_SPEC = DYNAMIC_SPECS['Bolt Beak']
export const DYNAMAX_CANNON_MOVE_SPEC = DYNAMIC_SPECS['Dynamax Cannon']
export const ECHOED_VOICE_MOVE_SPEC = DYNAMIC_SPECS['Echoed Voice']
export const ELECTRO_BALL_MOVE_SPEC = DYNAMIC_SPECS['Electro Ball']
export const FACADE_MOVE_SPEC = DYNAMIC_SPECS['Façade']
export const FISHIOUS_REND_MOVE_SPEC = DYNAMIC_SPECS['Fishious Rend']
export const FLAIL_MOVE_SPEC = DYNAMIC_SPECS.Flail
export const FUSION_BOLT_MOVE_SPEC = DYNAMIC_SPECS['Fusion Bolt']
export const FUSION_FLARE_MOVE_SPEC = DYNAMIC_SPECS['Fusion Flare']
export const GRASS_KNOT_MOVE_SPEC = DYNAMIC_SPECS['Grass Knot']
export const GYRO_BALL_MOVE_SPEC = DYNAMIC_SPECS['Gyro Ball']
export const HEAVY_SLAM_MOVE_SPEC = DYNAMIC_SPECS['Heavy Slam']
export const HEX_MOVE_SPEC = DYNAMIC_SPECS.Hex
export const ICE_BALL_MOVE_SPEC = DYNAMIC_SPECS['Ice Ball']
export const INFERNAL_PARADE_MOVE_SPEC = DYNAMIC_SPECS['Infernal Parade']
export const LOW_KICK_MOVE_SPEC = DYNAMIC_SPECS['Low Kick']
export const PAYBACK_MOVE_SPEC = DYNAMIC_SPECS.Payback
export const PUNISHMENT_MOVE_SPEC = DYNAMIC_SPECS.Punishment
export const RETALIATE_MOVE_SPEC = DYNAMIC_SPECS.Retaliate
export const REVELATION_DANCE_MOVE_SPEC = DYNAMIC_SPECS['Revelation Dance']
export const REVERSAL_MOVE_SPEC = DYNAMIC_SPECS.Reversal
export const ROUND_MOVE_SPEC = DYNAMIC_SPECS.Round
export const SECRET_POWER_MOVE_SPEC = DYNAMIC_SPECS['Secret Power']
export const SMELLING_SALTS_MOVE_SPEC = DYNAMIC_SPECS['Smelling Salts']
export const STOMPING_TANTRUM_MOVE_SPEC = DYNAMIC_SPECS['Stomping Tantrum']
export const STORED_POWER_MOVE_SPEC = DYNAMIC_SPECS['Stored Power']
export const TRUMP_CARD_MOVE_SPEC = DYNAMIC_SPECS['Trump Card']
export const VENOSHOCK_MOVE_SPEC = DYNAMIC_SPECS.Venoshock
export const WAKE_UP_SLAP_MOVE_SPEC = DYNAMIC_SPECS['Wake-Up Slap']

export const DRAGON_DARTS_MOVE_SPEC = dynamicSpec({
  canonicalId: 'Dragon Darts', slug: 'dragon-darts', targeting: multiTargeting(1, 2), tags: ['double-strike'],
})
export const TRIPLE_AXEL_MOVE_SPEC = dynamicSpec({
  canonicalId: 'Triple Axel', slug: 'triple-axel', targeting: multiTargeting(1, 3), tags: ['choice', 'multi-hit', 'movement'],
})
export const TRIPLE_KICK_MOVE_SPEC = dynamicSpec({
  canonicalId: 'Triple Kick', slug: 'triple-kick', targeting: multiTargeting(1, 3), tags: ['choice', 'multi-hit', 'movement'],
})

const judgmentTypes = [
  'bug','dark','dragon','electric','fairy','fighting','fire','flying','ghost',
  'grass','ground','ice','normal','poison','psychic','rock','steel','water',
] as const
const judgmentBranch: MoveBranchEffectOperation = {
  id: 'judgment.choose-type', kind: 'branch', source: { kind: 'move', id: 'move.judgment' },
  recipients: { kind: 'area-targets' }, phase: 'target', reasonCode: 'judgment.choose-type',
  payload: {
    kind: 'choice', selectionId: 'judgment.type', scope: 'resolution', owner: 'actor',
    requestId: 'judgment.type', promptKey: 'move.judgment.choose-type',
    options: judgmentTypes.map(type => ({ id: type, labelKey: `type.${type}`, operationIds: [`judgment.damage-${type}`] })),
    pass: null,
  },
}
export const JUDGMENT_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Judgment', targeting: areaTargeting(),
  operations: [
    judgmentBranch, standardAccuracy('judgment'),
    ...judgmentTypes.map(type => reviewedDamage({
      slug: 'judgment', id: `damage-${type}`, damageBase: 10,
      damageClass: 'special', moveType: type,
    })),
    ...standardTerminalOperations('judgment'),
  ],
  tags: ['choice', 'damage', 'type-choice'],
})

const altUsage = (slug: string): MoveUsageEffectOperation => ({
  id: `${slug}.alternate-usage`, kind: 'usage', source: { kind: 'move', id: `move.${slug}` },
  recipients: { kind: 'actor' }, phase: 'usage', reasonCode: `${slug}.alternate-once-per-scene`,
  payload: {
    action: 'spend', resourceId: `${slug}.alternate-use`, amount: 1,
    resource: { moveName: `${slug} alternate`, moveKey: `${slug}-alternate`, frequency: 'Scene' },
  },
})

const barbBranch: MoveBranchEffectOperation = {
  id: 'barb-barrage.choose-count', kind: 'branch', source: { kind: 'move', id: 'move.barb-barrage' },
  recipients: { kind: 'selected-targets' }, phase: 'target', reasonCode: 'barb-barrage.choose-count',
  payload: {
    kind: 'choice', selectionId: 'barb-barrage.count', scope: 'resolution', owner: 'actor',
    requestId: 'barb-barrage.count', promptKey: 'move.barb-barrage.choose-count',
    options: [
      { id: 'roll', labelKey: 'move.five-strike.roll', operationIds: ['barb-barrage.rolled-strikes'] },
      {
        id: 'automatic-eight', labelKey: 'move.five-strike.automatic-eight',
        predicate: {
          kind: 'any',
          predicates: ['burned', 'frozen', 'paralyzed', 'poisoned', 'badly-poisoned', 'sleep'].map(
            conditionId => ({
              kind: 'comparison' as const,
              operator: 'equal' as const,
              left: {
                kind: 'condition' as const,
                subject: { kind: 'current-target' as const },
                conditionId,
              },
              right: { kind: 'constant' as const, value: true },
            }),
          ),
        },
        operationIds: ['barb-barrage.automatic-strikes', 'barb-barrage.alternate-usage'],
      },
    ], pass: null,
  },
}
const barbPoison = reviewedCondition({ slug: 'barb-barrage', id: 'poison', recipients: 'hit-targets', conditionId: 'poisoned' }).payload
export const BARB_BARRAGE_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Barb Barrage', targeting: singleTargeting(),
  operations: [
    barbBranch,
    reviewedMultiHit({
      slug: 'barb-barrage', id: 'rolled-strikes', damageBase: 2, damageClass: 'physical', moveType: 'poison',
      count: { ...fiveStrikeCount, rollId: 'barb-barrage.hit-count-roll', tableId: 'barb-barrage.five-strike-count' },
      accuracy: onceAccuracy('barb-barrage'),
      critical: {
        kind: 'per-hit', rollId: 'barb-barrage.rolled-critical-roll',
        formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
      },
      effects: [{
        id: 'barb-barrage.poison', timing: 'after-all', trigger: 'hit', naturalAccuracyMinimum: 17,
        recipient: 'target', kind: 'condition', reasonCode: 'barb-barrage.poison', payload: barbPoison,
      }],
    }),
    reviewedMultiHit({
      slug: 'barb-barrage', id: 'automatic-strikes', damageBase: 2, damageClass: 'physical', moveType: 'poison',
      count: { kind: 'fixed', hits: 5 }, accuracy: onceAccuracy('barb-barrage-automatic'),
      critical: {
        kind: 'per-hit', rollId: 'barb-barrage.automatic-critical-roll',
        formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
      },
      effects: [{
        id: 'barb-barrage.poison', timing: 'after-all', trigger: 'hit', naturalAccuracyMinimum: 17,
        recipient: 'target', kind: 'condition', reasonCode: 'barb-barrage.poison', payload: barbPoison,
      }],
    }),
    altUsage('barb-barrage'), ...standardTerminalOperations('barb-barrage'),
  ],
  tags: ['choice', 'condition', 'damage', 'five-strike', 'multi-hit'],
})

const SPECS: Record<DynamicDamageCohort218225MoveName, MoveSpec> = {
  'Arm Thrust': ARM_THRUST_MOVE_SPEC, Autotomize: AUTOTOMIZE_MOVE_SPEC, 'Barb Barrage': BARB_BARRAGE_MOVE_SPEC,
  Barrage: BARRAGE_MOVE_SPEC, 'Behemoth Bash': BEHEMOTH_BASH_MOVE_SPEC, 'Behemoth Blade': BEHEMOTH_BLADE_MOVE_SPEC,
  'Body Press': BODY_PRESS_MOVE_SPEC, 'Bolt Beak': BOLT_BEAK_MOVE_SPEC, 'Bone Rush': BONE_RUSH_MOVE_SPEC,
  Bonemerang: BONEMERANG_MOVE_SPEC, 'Bullet Seed': BULLET_SEED_MOVE_SPEC, 'Comet Punch': COMET_PUNCH_MOVE_SPEC,
  'Double Hit': DOUBLE_HIT_MOVE_SPEC, 'Double Iron Bash': DOUBLE_IRON_BASH_MOVE_SPEC, 'Double Slap': DOUBLE_SLAP_MOVE_SPEC,
  'Dragon Darts': DRAGON_DARTS_MOVE_SPEC, 'Dual Chop': DUAL_CHOP_MOVE_SPEC, 'Dual Wingbeat': DUAL_WINGBEAT_MOVE_SPEC,
  'Dynamax Cannon': DYNAMAX_CANNON_MOVE_SPEC, 'Echoed Voice': ECHOED_VOICE_MOVE_SPEC, 'Electro Ball': ELECTRO_BALL_MOVE_SPEC,
  'Façade': FACADE_MOVE_SPEC, 'Fishious Rend': FISHIOUS_REND_MOVE_SPEC, Flail: FLAIL_MOVE_SPEC,
  'Fusion Bolt': FUSION_BOLT_MOVE_SPEC, 'Fusion Flare': FUSION_FLARE_MOVE_SPEC, 'Gear Grind': GEAR_GRIND_MOVE_SPEC,
  'Grass Knot': GRASS_KNOT_MOVE_SPEC, 'Gyro Ball': GYRO_BALL_MOVE_SPEC, 'Heavy Slam': HEAVY_SLAM_MOVE_SPEC,
  Hex: HEX_MOVE_SPEC, 'Ice Ball': ICE_BALL_MOVE_SPEC, 'Icicle Spear': ICICLE_SPEAR_MOVE_SPEC,
  'Infernal Parade': INFERNAL_PARADE_MOVE_SPEC, Judgment: JUDGMENT_MOVE_SPEC, 'Low Kick': LOW_KICK_MOVE_SPEC,
  Payback: PAYBACK_MOVE_SPEC, Punishment: PUNISHMENT_MOVE_SPEC, Retaliate: RETALIATE_MOVE_SPEC,
  'Revelation Dance': REVELATION_DANCE_MOVE_SPEC, Reversal: REVERSAL_MOVE_SPEC, 'Rock Blast': ROCK_BLAST_MOVE_SPEC,
  Round: ROUND_MOVE_SPEC, 'Scale Shot': SCALE_SHOT_MOVE_SPEC, 'Secret Power': SECRET_POWER_MOVE_SPEC,
  'Smelling Salts': SMELLING_SALTS_MOVE_SPEC,
  'Spike Cannon': SPIKE_CANNON_MOVE_SPEC, 'Stomping Tantrum': STOMPING_TANTRUM_MOVE_SPEC,
  'Stored Power': STORED_POWER_MOVE_SPEC, 'Tail Slap': TAIL_SLAP_MOVE_SPEC, 'Triple Axel': TRIPLE_AXEL_MOVE_SPEC,
  'Triple Kick': TRIPLE_KICK_MOVE_SPEC, 'Trump Card': TRUMP_CARD_MOVE_SPEC, Twineedle: TWINEEDLE_MOVE_SPEC,
  Venoshock: VENOSHOCK_MOVE_SPEC,
  'Wake-Up Slap': WAKE_UP_SLAP_MOVE_SPEC,
  'Water Shuriken': WATER_SHURIKEN_MOVE_SPEC,
}

export const DYNAMIC_DAMAGE_COHORTS_218_225_MOVE_SPEC_REGISTRATIONS: readonly MoveSpecV2Registration[] =
  Object.freeze(MA_218_225_MOVE_NAMES.map(canonicalId => Object.freeze({
    canonicalId,
    sourceModule: 'server/domain/moveAutomation/specs/dynamicDamageCohorts218_225.ts',
    spec: SPECS[canonicalId],
  })))
