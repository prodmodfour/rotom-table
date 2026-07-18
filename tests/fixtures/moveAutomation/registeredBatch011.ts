import { FURY_CUTTER_V2_SEMANTIC_SCENARIOS } from './furyCutterV2'
import {
  FURY_ATTACK_V2_SEMANTIC_SCENARIOS,
  FURY_SWIPES_V2_SEMANTIC_SCENARIOS,
} from './strikeCanariesV2'

export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const FLATTER_REG_011_SCENARIOS = scenarios([
  {
    scenarioId: 'flatter.legacy-v1-stage-and-confusion',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'flatter.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'flatter.legacy-v1-stage-cap',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'flatter.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'flatter.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const FOCUS_BLAST_REG_011_SCENARIOS = scenarios([
  {
    scenarioId: 'focus-blast.legacy-v1-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'focus-blast.legacy-v1-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'focus-blast.legacy-v1-smite-miss',
    evidenceClasses: ['alternate-branch', 'miss'],
  },
  {
    scenarioId: 'focus-blast.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'focus-blast.legacy-v1-ghost-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'focus-blast.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'focus-blast.legacy-v1-stage-cap',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'focus-blast.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'focus-blast.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const FORCE_PALM_REG_011_SCENARIOS = scenarios([
  {
    scenarioId: 'force-palm.legacy-v1-paralysis-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'force-palm.legacy-v1-paralysis-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'force-palm.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'force-palm.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'force-palm.legacy-v1-ghost-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'force-palm.legacy-v1-paralysis-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'force-palm.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'force-palm.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'force-palm.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const FRUSTRATION_REG_011_SCENARIOS = scenarios([
  {
    scenarioId: 'frustration.legacy-v1-loyalty-zero-hit',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'frustration.legacy-v1-loyalty-six-hit',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'frustration.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'frustration.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'frustration.legacy-v1-ghost-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'frustration.legacy-v1-missing-loyalty-rejected',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'frustration.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'frustration.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const FURY_ATTACK_REG_011_SCENARIOS = scenarios([
  ...FURY_ATTACK_V2_SEMANTIC_SCENARIOS,
  {
    scenarioId: 'fury-attack.v2-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const FURY_CUTTER_REG_011_SCENARIOS = scenarios([
  ...FURY_CUTTER_V2_SEMANTIC_SCENARIOS,
  {
    scenarioId: 'fury-cutter.v2-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const FURY_SWIPES_REG_011_SCENARIOS = scenarios([
  ...FURY_SWIPES_V2_SEMANTIC_SCENARIOS,
  {
    scenarioId: 'fury-swipes.v2-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const GLARE_REG_011_SCENARIOS = scenarios([
  {
    scenarioId: 'glare.legacy-v1-paralysis',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'glare.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'glare.legacy-v1-paralysis-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'glare.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'glare.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const REG_011_MOVE_NAMES = Object.freeze([
  'Flatter',
  'Focus Blast',
  'Force Palm',
  'Frustration',
  'Fury Attack',
  'Fury Cutter',
  'Fury Swipes',
  'Glare',
] as const)

export type RegisteredBatch011MoveName = (typeof REG_011_MOVE_NAMES)[number]

export const REG_011_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch011MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  Flatter: FLATTER_REG_011_SCENARIOS,
  'Focus Blast': FOCUS_BLAST_REG_011_SCENARIOS,
  'Force Palm': FORCE_PALM_REG_011_SCENARIOS,
  Frustration: FRUSTRATION_REG_011_SCENARIOS,
  'Fury Attack': FURY_ATTACK_REG_011_SCENARIOS,
  'Fury Cutter': FURY_CUTTER_REG_011_SCENARIOS,
  'Fury Swipes': FURY_SWIPES_REG_011_SCENARIOS,
  Glare: GLARE_REG_011_SCENARIOS,
})
