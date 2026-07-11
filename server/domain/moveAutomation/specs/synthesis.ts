import type {
  MoveBranchEffectOperation,
  MoveHealEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MovePredicate } from '#shared/moveAutomation/predicates'
import type { MoveSpec } from '#shared/moveAutomation/spec'
import type { MapWeatherKind } from '~/types/map'
import type { MoveSpecV2Registration } from '../registry'

const SYNTHESIS_WEATHER_KINDS = [
  'sunny',
  'rainy',
  'sandstorm',
  'hail',
] as const satisfies readonly MapWeatherKind[]

const weatherEquals = (weather: MapWeatherKind) => ({
  kind: 'comparison',
  operator: 'equal',
  left: { kind: 'weather' },
  right: { kind: 'constant', value: weather },
} as const satisfies MovePredicate)

/** Build plain reviewed branch data; no callback enters the validated spec. */
const weatherBranch = <Predicate extends MovePredicate>(options: {
  readonly id: string
  readonly selectionId: string
  readonly reasonCode: string
  readonly predicate: Predicate
  readonly activeBranchId: string
  readonly inactiveBranchId: string
  readonly healOperationId: string
}) => {
  const operation = {
    id: options.id,
    kind: 'branch',
    source: { kind: 'move', id: 'move.synthesis' },
    recipients: { kind: 'none' },
    phase: 'hit',
    reasonCode: options.reasonCode,
    payload: {
      kind: 'predicate',
      selectionId: options.selectionId,
      scope: 'resolution',
      predicate: options.predicate,
      whenTrue: {
        id: options.activeBranchId,
        operationIds: [options.healOperationId],
      },
      whenFalse: {
        id: options.inactiveBranchId,
        operationIds: [],
      },
    },
  } as const
  operation satisfies MoveBranchEffectOperation
  return operation
}

const healOperation = (
  weather: 'sunny' | 'adverse' | 'normal',
  percent: number,
) => ({
  id: `synthesis.heal-${weather}`,
  kind: 'heal',
  source: { kind: 'move', id: 'move.synthesis' },
  recipients: { kind: 'actor' },
  phase: 'hit',
  reasonCode: `synthesis.heal-${weather}`,
  payload: {
    mode: 'gain',
    pool: 'hit-points',
    calculation: { kind: 'percent-max', percent },
    bounds: { minimum: null, maximum: null },
    rounding: 'floor',
    injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
  },
} as const satisfies MoveHealEffectOperation)

/**
 * Reviewed native-v2 definition for canonical PTU Synthesis.
 *
 * Server-owned map weather selects exactly one real-Max-HP healing operation:
 * one half normally, two thirds in sun, or one quarter in rain, sand, or hail.
 * The HP reducer owns floor rounding, the injury-adjusted healing cap, and the
 * full-HP no-op result.
 */
export const SYNTHESIS_MOVE_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'Synthesis',
  version: 2,
  targeting: {
    kind: 'self',
    minTargets: 1,
    maxTargets: 1,
    selector: { kind: 'actor' },
  },
  preconditions: [],
  costs: [],
  phases: [
    {
      phase: 'hit',
      operations: [
        weatherBranch({
          id: 'synthesis.select-sunny',
          selectionId: 'synthesis.weather.sunny',
          reasonCode: 'synthesis.select-sunny-weather',
          predicate: weatherEquals('sunny'),
          activeBranchId: 'synthesis.weather.sunny-active',
          inactiveBranchId: 'synthesis.weather.sunny-inactive',
          healOperationId: 'synthesis.heal-sunny',
        }),
        weatherBranch({
          id: 'synthesis.select-adverse',
          selectionId: 'synthesis.weather.adverse',
          reasonCode: 'synthesis.select-adverse-weather',
          predicate: {
            kind: 'any',
            predicates: (['rainy', 'sandstorm', 'hail'] as const).map(weatherEquals),
          },
          activeBranchId: 'synthesis.weather.adverse-active',
          inactiveBranchId: 'synthesis.weather.adverse-inactive',
          healOperationId: 'synthesis.heal-adverse',
        }),
        weatherBranch({
          id: 'synthesis.select-normal',
          selectionId: 'synthesis.weather.normal',
          reasonCode: 'synthesis.select-normal-weather',
          predicate: {
            kind: 'all',
            predicates: SYNTHESIS_WEATHER_KINDS.map(weather => ({
              kind: 'not' as const,
              predicate: weatherEquals(weather),
            })),
          },
          activeBranchId: 'synthesis.weather.normal-active',
          inactiveBranchId: 'synthesis.weather.normal-inactive',
          healOperationId: 'synthesis.heal-normal',
        }),
        healOperation('sunny', 200 / 3),
        healOperation('adverse', 25),
        healOperation('normal', 50),
      ],
    },
    {
      phase: 'usage',
      operations: [{
        id: 'synthesis.usage',
        kind: 'usage',
        source: { kind: 'move', id: 'move.synthesis' },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'synthesis.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'synthesis.frequency-use',
          amount: 1,
        },
      }],
    },
    {
      phase: 'cleanup',
      operations: [{
        id: 'synthesis.log-completed',
        kind: 'log',
        source: { kind: 'move', id: 'move.synthesis' },
        recipients: { kind: 'none' },
        phase: 'cleanup',
        reasonCode: 'synthesis.completed',
        payload: {
          messageKey: 'move.synthesis.completed',
          arguments: [],
        },
      }],
    },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Synthesis',
    vfxKey: 'move.synthesis',
    tags: ['healing', 'self', 'weather'],
  },
} as const satisfies MoveSpec)

export const SYNTHESIS_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Synthesis',
  sourceModule: 'server/domain/moveAutomation/specs/synthesis.ts',
  spec: SYNTHESIS_MOVE_SPEC,
})
