import { HOWL_ALLY_AREA_SCENARIOS } from './allyAreaLegacyV1'
import { HELPING_HAND_V2_SEMANTIC_SCENARIOS } from './helpingHandV2'

export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const HELPING_HAND_REG_013_SCENARIOS = scenarios([
  ...HELPING_HAND_V2_SEMANTIC_SCENARIOS,
] as const)

export const HONE_CLAWS_REG_013_SCENARIOS = scenarios([
  {
    scenarioId: 'hone-claws.legacy-v1-self-increase',
    evidenceClasses: ['self'],
  },
  {
    scenarioId: 'hone-claws.legacy-v1-stage-caps',
    evidenceClasses: ['self'],
  },
  {
    scenarioId: 'hone-claws.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'hone-claws.legacy-v1-stale-actor',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const HORN_ATTACK_REG_013_SCENARIOS = scenarios([
  {
    scenarioId: 'horn-attack.legacy-v1-hit-dash',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'horn-attack.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'horn-attack.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'horn-attack.legacy-v1-ghost-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'horn-attack.legacy-v1-stuck-dash-rejected',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'horn-attack.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'horn-attack.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const HOWL_REG_013_SCENARIOS = scenarios([
  ...HOWL_ALLY_AREA_SCENARIOS,
] as const)

export const HYPER_FANG_REG_013_SCENARIOS = scenarios([
  {
    scenarioId: 'hyper-fang.legacy-v1-flinch-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'hyper-fang.legacy-v1-flinch-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'hyper-fang.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'hyper-fang.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'hyper-fang.legacy-v1-ghost-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'hyper-fang.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'hyper-fang.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'hyper-fang.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const HYPNOSIS_REG_013_SCENARIOS = scenarios([
  {
    scenarioId: 'hypnosis.legacy-v1-sleep-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'hypnosis.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'hypnosis.legacy-v1-sweet-veil-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'hypnosis.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'hypnosis.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const ICE_BEAM_REG_013_SCENARIOS = scenarios([
  {
    scenarioId: 'ice-beam.legacy-v1-freeze-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'ice-beam.legacy-v1-freeze-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'ice-beam.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'ice-beam.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'ice-beam.legacy-v1-freeze-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'ice-beam.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'ice-beam.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'ice-beam.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const ICE_PUNCH_REG_013_SCENARIOS = scenarios([
  {
    scenarioId: 'ice-punch.legacy-v1-freeze-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'ice-punch.legacy-v1-freeze-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'ice-punch.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'ice-punch.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'ice-punch.legacy-v1-freeze-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'ice-punch.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'ice-punch.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'ice-punch.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const REG_013_MOVE_NAMES = Object.freeze([
  'Helping Hand',
  'Hone Claws',
  'Horn Attack',
  'Howl',
  'Hyper Fang',
  'Hypnosis',
  'Ice Beam',
  'Ice Punch',
] as const)

export type RegisteredBatch013MoveName = (typeof REG_013_MOVE_NAMES)[number]

export const REG_013_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch013MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  'Helping Hand': HELPING_HAND_REG_013_SCENARIOS,
  'Hone Claws': HONE_CLAWS_REG_013_SCENARIOS,
  'Horn Attack': HORN_ATTACK_REG_013_SCENARIOS,
  Howl: HOWL_REG_013_SCENARIOS,
  'Hyper Fang': HYPER_FANG_REG_013_SCENARIOS,
  Hypnosis: HYPNOSIS_REG_013_SCENARIOS,
  'Ice Beam': ICE_BEAM_REG_013_SCENARIOS,
  'Ice Punch': ICE_PUNCH_REG_013_SCENARIOS,
})
