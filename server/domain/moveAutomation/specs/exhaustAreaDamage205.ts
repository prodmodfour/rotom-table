import type { MoveDamageClass, MoveEffectOperation } from '#shared/moveAutomation/effects'
import type {
  MoveSpec,
  MoveSpecEffectOperation,
  MoveSpecTargetingDeclaration,
} from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'
import {
  createStandardMoveAccuracyOperation,
  createStandardMoveCompletionLogOperation,
  createStandardMoveUsageOperation,
} from '../standardDamageOperations'

export const MA_205_MOVE_NAMES = Object.freeze([
  'Blast Burn',
  'Eternabeam',
  'Frenzy Plant',
  'Hydro Cannon',
  'Meteor Assault',
  'Prismatic Laser',
] as const)

export type ExhaustAreaDamage205MoveName = (typeof MA_205_MOVE_NAMES)[number]

interface ExhaustDamageDefinition {
  readonly canonicalId: ExhaustAreaDamage205MoveName
  readonly slug: string
  readonly damageBase: 15 | 16
  readonly damageClass: Extract<MoveDamageClass, 'physical' | 'special'>
  readonly moveType: 'dragon' | 'fighting' | 'fire' | 'grass' | 'psychic' | 'water'
  readonly targeting: MoveSpecTargetingDeclaration
}

const anyAreaTargets = (): MoveSpecTargetingDeclaration => ({
  kind: 'area',
  minTargets: 0,
  maxTargets: 32,
  selector: { kind: 'area-targets' },
  predicate: {
    relationship: 'any',
    willingness: 'any',
    excludeActor: true,
  },
})

const upToFiveSelectedTargets = (): MoveSpecTargetingDeclaration => ({
  kind: 'multi-target',
  minTargets: 1,
  maxTargets: 5,
  selector: { kind: 'selected-targets' },
})

const smiteDamageOperation = (definition: ExhaustDamageDefinition): MoveEffectOperation => ({
  id: `${definition.slug}.damage`,
  kind: 'damage',
  source: { kind: 'operation', id: `${definition.slug}.accuracy` },
  // Smite applies damage to every attacked recipient. A miss remains absent
  // from hit identity and receives the canonical extra resistance step.
  recipients: { kind: 'attacked-targets' },
  phase: 'damage',
  reasonCode: `${definition.slug}.damage`,
  payload: {
    damageClass: definition.damageClass,
    damageBase: definition.damageBase,
    moveType: definition.moveType,
    accuracyRollId: `${definition.slug}.accuracy-roll`,
    criticalRollId: `${definition.slug}.accuracy-roll`,
  },
})

const asMoveSpecOperations = (
  operations: readonly MoveEffectOperation[],
): readonly MoveSpecEffectOperation[] => operations as unknown as readonly MoveSpecEffectOperation[]

/** Build the common authoritative Standard + Smite + Exhaust damage envelope. */
const exhaustDamageSpec = (definition: ExhaustDamageDefinition): MoveSpec => {
  const spec: MoveSpec = {
    schemaVersion: 2,
    canonicalId: definition.canonicalId,
    version: 2,
    targeting: definition.targeting,
    preconditions: [],
    costs: [{
      id: `${definition.slug}.cost.standard-action`,
      phase: 'pay',
      cost: { kind: 'action-resource', resource: 'standard', amount: 1 },
    }, {
      id: `${definition.slug}.cost.exhaust`,
      phase: 'cleanup',
      cost: { kind: 'exhaust', timing: 'next-turn', forfeitCommand: true },
    }],
    phases: [{
      phase: 'accuracy',
      operations: asMoveSpecOperations([
        createStandardMoveAccuracyOperation({ slug: definition.slug }),
      ]),
    }, {
      phase: 'damage',
      operations: asMoveSpecOperations([smiteDamageOperation(definition)]),
    }, {
      phase: 'usage',
      operations: asMoveSpecOperations([createStandardMoveUsageOperation(definition.slug)]),
    }, {
      phase: 'cleanup',
      operations: asMoveSpecOperations([
        createStandardMoveCompletionLogOperation(definition.slug),
      ]),
    }],
    registeredHandlerId: null,
    presentation: {
      displayName: definition.canonicalId,
      vfxKey: `move.${definition.slug}`,
      tags: [
        definition.targeting.kind === 'area' ? 'area' : 'multi-target',
        'damage',
        'exhaust',
        'smite',
        definition.damageClass,
        definition.moveType,
      ],
    },
  }
  return Object.freeze(spec)
}

export const BLAST_BURN_MOVE_SPEC = exhaustDamageSpec({
  canonicalId: 'Blast Burn',
  slug: 'blast-burn',
  damageBase: 15,
  damageClass: 'special',
  moveType: 'fire',
  targeting: anyAreaTargets(),
})

export const ETERNABEAM_MOVE_SPEC = exhaustDamageSpec({
  canonicalId: 'Eternabeam',
  slug: 'eternabeam',
  damageBase: 16,
  damageClass: 'special',
  moveType: 'dragon',
  targeting: anyAreaTargets(),
})

export const FRENZY_PLANT_MOVE_SPEC = exhaustDamageSpec({
  canonicalId: 'Frenzy Plant',
  slug: 'frenzy-plant',
  damageBase: 15,
  damageClass: 'special',
  moveType: 'grass',
  targeting: upToFiveSelectedTargets(),
})

export const HYDRO_CANNON_MOVE_SPEC = exhaustDamageSpec({
  canonicalId: 'Hydro Cannon',
  slug: 'hydro-cannon',
  damageBase: 15,
  damageClass: 'special',
  moveType: 'water',
  targeting: anyAreaTargets(),
})

export const METEOR_ASSAULT_MOVE_SPEC = exhaustDamageSpec({
  canonicalId: 'Meteor Assault',
  slug: 'meteor-assault',
  damageBase: 15,
  damageClass: 'physical',
  moveType: 'fighting',
  targeting: anyAreaTargets(),
})

export const PRISMATIC_LASER_MOVE_SPEC = exhaustDamageSpec({
  canonicalId: 'Prismatic Laser',
  slug: 'prismatic-laser',
  damageBase: 16,
  damageClass: 'special',
  moveType: 'psychic',
  targeting: anyAreaTargets(),
})

const registration = (
  canonicalId: ExhaustAreaDamage205MoveName,
  spec: MoveSpec,
): MoveSpecV2Registration => Object.freeze({
  canonicalId,
  sourceModule: 'server/domain/moveAutomation/specs/exhaustAreaDamage205.ts',
  spec,
})

export const EXHAUST_AREA_DAMAGE_205_MOVE_SPEC_REGISTRATIONS = Object.freeze([
  registration('Blast Burn', BLAST_BURN_MOVE_SPEC),
  registration('Eternabeam', ETERNABEAM_MOVE_SPEC),
  registration('Frenzy Plant', FRENZY_PLANT_MOVE_SPEC),
  registration('Hydro Cannon', HYDRO_CANNON_MOVE_SPEC),
  registration('Meteor Assault', METEOR_ASSAULT_MOVE_SPEC),
  registration('Prismatic Laser', PRISMATIC_LASER_MOVE_SPEC),
])
