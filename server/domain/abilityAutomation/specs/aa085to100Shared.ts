import type { AbilitySpecV1Registration } from '../registry'
import {
  abilityMechanicOperation,
  noAbilityTarget,
  reviewedAbilitySpec,
  reviewedActivatedAbilitySpec,
  reviewedStaticAbilitySpec,
} from './reviewedSpecBuilder'

export type RemainingAbilityEventKind =
  | 'action'
  | 'combat-stage'
  | 'condition'
  | 'hp'
  | 'item'
  | 'lifecycle'
  | 'move'
  | 'presence'
  | 'strike'

export interface RemainingTokenTarget {
  readonly kind: 'token'
  readonly relationship?: 'self' | 'ally' | 'enemy' | 'other' | 'any'
  readonly minimumRange?: number
  readonly maximumRange?: number | null
  readonly adjacent?: boolean
}

export interface RemainingSimpleTarget {
  readonly kind: 'ability' | 'branch' | 'item' | 'move' | 'stat' | 'type'
}

export type RemainingAbilityTarget = RemainingTokenTarget | RemainingSimpleTarget

const mechanicConfig = Object.freeze({ ruleVersion: 1 })

const targetingFor = (
  modeId: string,
  targets: readonly RemainingAbilityTarget[],
): Record<string, unknown>[] => targets.length === 0
  ? [...noAbilityTarget(modeId)]
  : targets.map((target): Record<string, unknown> => {
      if (target.kind !== 'token') return {
        id: `${modeId}.${target.kind}`,
        modeId,
        kind: target.kind,
        minSelections: 1,
        maxSelections: 1,
        selector: null,
        predicate: null,
      }
      return {
        id: `${modeId}.target`,
        modeId,
        kind: 'token',
        minSelections: 1,
        maxSelections: 1,
        selector: { kind: 'candidate-targets' },
        predicate: {
          kind: 'ability-targeting',
          relationship: target.relationship ?? 'any',
          willingness: 'any',
          excludeActor: (target.relationship ?? 'any') !== 'self',
          minimumRange: target.minimumRange ?? 0,
          maximumRange: target.maximumRange ?? null,
          visibility: 'required',
          lineOfSight: 'required',
          geometry: target.adjacent
            ? { kind: 'adjacent', cardinalOnly: false }
            : { kind: 'direct' },
        },
      }
    })

export const remainingStaticAbilitySpec = (
  canonicalId: string,
  mechanicId: string,
) => reviewedStaticAbilitySpec(
  canonicalId,
  mechanicId,
  mechanicConfig,
  ['mode.static', 'reviewed', 'server-authoritative'],
)

export const remainingActivatedAbilitySpec = (
  canonicalId: string,
  mechanicId: string,
  targets: readonly RemainingAbilityTarget[] = [],
) => reviewedActivatedAbilitySpec(
  canonicalId,
  mechanicId,
  mechanicConfig,
  targetingFor('activate', targets),
  ['mode.activated', 'reviewed', 'server-authoritative'],
)

export const remainingTriggeredAbilitySpec = (
  canonicalId: string,
  mechanicId: string,
  eventKind: RemainingAbilityEventKind,
  response: 'mandatory' | 'optional' = 'optional',
) => reviewedAbilitySpec({
  canonicalId,
  modes: [{ id: 'trigger', kind: 'triggered' }],
  subscriptions: [{
    id: 'trigger.subscription',
    modeId: 'trigger',
    eventKind,
    checkpoint: eventKind === 'lifecycle' ? 'lifecycle' : 'post-effect',
    response,
    priority: 0,
    oncePerCausalChain: true,
    predicate: null,
  }],
  targeting: noAbilityTarget('trigger'),
  phases: [{
    modeId: 'trigger',
    phase: 'effect',
    operations: [abilityMechanicOperation('trigger.mechanic', mechanicId, mechanicConfig)],
  }],
  tags: ['mode.triggered', 'reviewed', 'server-authoritative'],
})

export const remainingAbilityRegistrations = (
  sourceModule: string,
  specs: readonly ReturnType<typeof remainingStaticAbilitySpec>[],
): readonly AbilitySpecV1Registration[] => Object.freeze(specs.map(spec => ({
  canonicalId: spec.canonicalId,
  version: 1,
  sourceModule,
  spec,
})))
