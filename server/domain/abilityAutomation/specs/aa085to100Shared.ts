import { createHash } from 'node:crypto'
import abilityRules from '../../../../data/reference/abilities.json'
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
  readonly willingness?: 'any' | 'willing' | 'unwilling'
}

export interface RemainingSimpleTarget {
  readonly kind: 'ability' | 'branch' | 'item' | 'move' | 'stat' | 'type'
}

export type RemainingAbilityTarget = RemainingTokenTarget | RemainingSimpleTarget

interface CanonicalAbilityRuleRecord {
  readonly name: string
  readonly frequency: string
  readonly trigger?: string
  readonly effect: string
}

/** Bind every remaining runtime to the exact app-owned canonical rule row. */
const mechanicConfig = (canonicalId: string): Readonly<Record<string, unknown>> => {
  const record = (abilityRules as Readonly<Record<string, CanonicalAbilityRuleRecord>>)[canonicalId]
  if (!record || record.name !== canonicalId || !record.frequency || !record.effect) {
    throw new Error(`Missing canonical ability rule row for ${canonicalId}.`)
  }
  return Object.freeze({
    ruleVersion: 1,
    sourceRuleSha256: createHash('sha256').update(JSON.stringify(record)).digest('hex'),
    frequency: record.frequency,
    triggered: typeof record.trigger === 'string' && record.trigger.trim().length > 0,
  })
}

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
          willingness: target.willingness ?? 'any',
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
  mechanicConfig(canonicalId),
  ['mode.static', 'reviewed', 'server-authoritative'],
)

export const remainingActivatedAbilitySpec = (
  canonicalId: string,
  mechanicId: string,
  targets: readonly RemainingAbilityTarget[] = [],
) => reviewedActivatedAbilitySpec(
  canonicalId,
  mechanicId,
  mechanicConfig(canonicalId),
  targetingFor('activate', targets),
  ['mode.activated', 'reviewed', 'server-authoritative'],
)

export const remainingStaticActivatedAbilitySpec = (
  canonicalId: string,
  mechanicId: string,
) => reviewedAbilitySpec({
  canonicalId,
  modes: [
    { id: 'passive', kind: 'static' },
    { id: 'activate', kind: 'activated' },
  ],
  targeting: [
    ...noAbilityTarget('passive'),
    ...noAbilityTarget('activate'),
  ],
  phases: [
    {
      modeId: 'passive',
      phase: 'effect',
      operations: [abilityMechanicOperation('passive.mechanic', mechanicId, mechanicConfig(canonicalId))],
    },
    {
      modeId: 'activate',
      phase: 'effect',
      operations: [abilityMechanicOperation('activate.mechanic', mechanicId, mechanicConfig(canonicalId))],
    },
  ],
  tags: ['mode.static', 'mode.activated', 'reviewed', 'server-authoritative'],
})

export const remainingActivatedTriggeredAbilitySpec = (
  canonicalId: string,
  mechanicId: string,
  eventKind: RemainingAbilityEventKind,
) => reviewedAbilitySpec({
  canonicalId,
  modes: [
    { id: 'activate', kind: 'activated' },
    { id: 'trigger', kind: 'triggered' },
  ],
  subscriptions: [{
    id: 'trigger.subscription',
    modeId: 'trigger',
    eventKind,
    checkpoint: eventKind === 'lifecycle' ? 'lifecycle' : 'post-effect',
    response: 'optional',
    priority: 0,
    oncePerCausalChain: true,
    predicate: null,
  }],
  targeting: [
    ...noAbilityTarget('activate'),
    ...noAbilityTarget('trigger'),
  ],
  phases: [
    {
      modeId: 'activate',
      phase: 'effect',
      operations: [abilityMechanicOperation('activate.mechanic', mechanicId, mechanicConfig(canonicalId))],
    },
    {
      modeId: 'trigger',
      phase: 'effect',
      operations: [abilityMechanicOperation('trigger.mechanic', mechanicId, mechanicConfig(canonicalId))],
    },
  ],
  tags: ['mode.activated', 'mode.triggered', 'reviewed', 'server-authoritative'],
})

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
    operations: [abilityMechanicOperation('trigger.mechanic', mechanicId, mechanicConfig(canonicalId))],
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
