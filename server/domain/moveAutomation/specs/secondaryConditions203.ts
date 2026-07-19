import {
  FIERY_WRATH_DARK_BRANCH_ID,
  FIERY_WRATH_FIRE_BRANCH_ID,
  FREEZING_GLARE_ICE_BRANCH_ID,
  FREEZING_GLARE_PSYCHIC_BRANCH_ID,
} from '#shared/moveAutomation/canonicalMoveBranches'
import type { MoveEffectOperation } from '#shared/moveAutomation/effects'
import type { MoveSpec, MoveSpecTargetingDeclaration } from '#shared/moveAutomation/spec'
import { SECONDARY_CONDITIONS_203_HANDLER_ID } from '../handlers/secondaryConditions203'
import type { MoveSpecV2Registration } from '../registry'
import {
  createAccuracyTriggeredConditionOperation,
  createFangSecondaryOperations,
  createReviewedSingleTargetDamageSpec,
  createStandardMoveDamageOperation,
} from '../standardDamageOperations'

const singleTarget = (): MoveSpecTargetingDeclaration => ({
  kind: 'single-target',
  minTargets: 1,
  maxTargets: 1,
  selector: { kind: 'selected-targets' },
})

const alternateSingleTarget = (
  baseBranchId: string,
  alternateBranchId: string,
): MoveSpecTargetingDeclaration => ({
  ...singleTarget(),
  branches: [{ id: baseBranchId, ...singleTarget() }, {
    id: alternateBranchId,
    ...singleTarget(),
  }],
})

const damageOperation = createStandardMoveDamageOperation
const conditionOperation = createAccuracyTriggeredConditionOperation
const fangCoinOperations = createFangSecondaryOperations

const reviewedSpec = (input: {
  readonly canonicalId: string
  readonly slug: string
  readonly targeting?: MoveSpecTargetingDeclaration
  readonly operations: readonly MoveEffectOperation[]
  readonly handler?: boolean
  readonly tags: readonly string[]
}): MoveSpec => createReviewedSingleTargetDamageSpec({
  canonicalId: input.canonicalId,
  slug: input.slug,
  ...(input.targeting ? { targeting: input.targeting } : {}),
  operations: input.operations,
  registeredHandlerId: input.handler ? SECONDARY_CONDITIONS_203_HANDLER_ID : null,
  ...(input.canonicalId === 'Dynamic Punch'
    ? {
        evasionRule: {
          kind: 'ignore-when-flanked' as const,
          sourceId: 'dynamic-punch.flanked-target',
          reasonCode: 'dynamic-punch.ignore-flanked-evasion',
        },
      }
    : {}),
  tags: input.tags,
})

export const CHATTER_MOVE_SPEC = reviewedSpec({
  canonicalId: 'Chatter',
  slug: 'chatter',
  handler: true,
  tags: ['condition', 'damage', 'flying', 'sonic', 'reaction'],
  operations: [
    damageOperation({ slug: 'chatter', damageBase: 7, damageClass: 'special', moveType: 'flying' }),
    conditionOperation({
      slug: 'chatter',
      id: 'confusion',
      conditionId: 'confused',
      trigger: { kind: 'range', minimum: 16 },
    }),
  ],
})

export const DYNAMIC_PUNCH_MOVE_SPEC = reviewedSpec({
  canonicalId: 'Dynamic Punch',
  slug: 'dynamic-punch',
  tags: ['condition', 'damage', 'fighting', 'flanking'],
  operations: [
    damageOperation({
      slug: 'dynamic-punch',
      damageBase: 10,
      damageClass: 'physical',
      moveType: 'fighting',
    }),
    conditionOperation({
      slug: 'dynamic-punch',
      id: 'confusion',
      conditionId: 'confused',
    }),
  ],
})

export const FIERY_WRATH_MOVE_SPEC = reviewedSpec({
  canonicalId: 'Fiery Wrath',
  slug: 'fiery-wrath',
  handler: true,
  targeting: alternateSingleTarget(FIERY_WRATH_DARK_BRANCH_ID, FIERY_WRATH_FIRE_BRANCH_ID),
  tags: ['alternate-type', 'condition', 'damage', 'dark', 'fire'],
  operations: [],
})

export const FIRE_FANG_MOVE_SPEC = reviewedSpec({
  canonicalId: 'Fire Fang',
  slug: 'fire-fang',
  tags: ['condition', 'damage', 'fire', 'random'],
  operations: [
    damageOperation({ slug: 'fire-fang', damageBase: 7, damageClass: 'physical', moveType: 'fire' }),
    ...fangCoinOperations('fire-fang', 'burned'),
  ],
})

export const FREEZE_DRY_MOVE_SPEC = reviewedSpec({
  canonicalId: 'Freeze-Dry',
  slug: 'freeze-dry',
  tags: ['damage', 'ice', 'type-override'],
  operations: [damageOperation({
    slug: 'freeze-dry',
    damageBase: 7,
    damageClass: 'special',
    moveType: 'ice',
    typeEffectiveness: {
      immunity: 'honor',
      resistance: 'honor',
      weakness: 'honor',
      effectivenessOverride: null,
      defenderTypeOverrides: [{ defenderType: 'water', relation: 'weak' }],
    },
  })],
})

export const FREEZING_GLARE_MOVE_SPEC = reviewedSpec({
  canonicalId: 'Freezing Glare',
  slug: 'freezing-glare',
  handler: true,
  targeting: alternateSingleTarget(
    FREEZING_GLARE_PSYCHIC_BRANCH_ID,
    FREEZING_GLARE_ICE_BRANCH_ID,
  ),
  tags: ['alternate-type', 'condition', 'damage', 'ice', 'psychic'],
  operations: [],
})

export const ICE_FANG_MOVE_SPEC = reviewedSpec({
  canonicalId: 'Ice Fang',
  slug: 'ice-fang',
  tags: ['condition', 'damage', 'ice', 'random'],
  operations: [
    damageOperation({ slug: 'ice-fang', damageBase: 7, damageClass: 'physical', moveType: 'ice' }),
    ...fangCoinOperations('ice-fang', 'frozen'),
  ],
})

const actorStat = (stat: 'attack' | 'special-attack') => ({
  kind: 'stat' as const,
  subject: { kind: 'actor' as const },
  stat,
  combatStagePolicy: 'honor' as const,
  stageModifierPolicy: 'honor' as const,
})

const targetDefense = (stat: 'defense' | 'special-defense') => ({
  kind: 'stat' as const,
  subject: { kind: 'current-target' as const },
  stat,
  combatStagePolicy: 'honor' as const,
  stageModifierPolicy: 'honor' as const,
})

export const SHELL_SIDE_ARM_MOVE_SPEC = reviewedSpec({
  canonicalId: 'Shell Side Arm',
  slug: 'shell-side-arm',
  tags: ['alternate-damage-class', 'condition', 'damage', 'poison', 'stat-selection'],
  operations: [
    damageOperation({
      slug: 'shell-side-arm',
      damageBase: 9,
      moveType: 'poison',
      damageClass: {
        kind: 'compare-stats',
        operator: 'less-than',
        left: targetDefense('defense'),
        right: targetDefense('special-defense'),
        whenTrue: 'physical',
        whenFalse: 'special',
      },
      attackStat: {
        kind: 'max',
        values: [actorStat('attack'), actorStat('special-attack')],
      },
    }),
    conditionOperation({
      slug: 'shell-side-arm',
      id: 'poison',
      conditionId: 'poisoned',
      trigger: { kind: 'range', minimum: 17 },
    }),
  ],
})

const registration = (
  canonicalId: string,
  spec: MoveSpec,
): MoveSpecV2Registration => Object.freeze({
  canonicalId,
  sourceModule: 'server/domain/moveAutomation/specs/secondaryConditions203.ts',
  spec,
})

export const SECONDARY_CONDITIONS_203_MOVE_SPEC_REGISTRATIONS = Object.freeze([
  registration('Chatter', CHATTER_MOVE_SPEC),
  registration('Dynamic Punch', DYNAMIC_PUNCH_MOVE_SPEC),
  registration('Fiery Wrath', FIERY_WRATH_MOVE_SPEC),
  registration('Fire Fang', FIRE_FANG_MOVE_SPEC),
  registration('Freeze-Dry', FREEZE_DRY_MOVE_SPEC),
  registration('Freezing Glare', FREEZING_GLARE_MOVE_SPEC),
  registration('Ice Fang', ICE_FANG_MOVE_SPEC),
  registration('Shell Side Arm', SHELL_SIDE_ARM_MOVE_SPEC),
])
