import type { AreaStages207MoveName } from '~~/server/domain/moveAutomation/specs/areaStages207'

export interface AreaStages207ScenarioEvidence {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Value extends readonly AreaStages207ScenarioEvidence[]>(
  value: Value,
): Value => Object.freeze(value)

export const GEAR_UP_MA_207_SCENARIOS = scenarios([
  {
    scenarioId: 'gear-up.v2-steel-type-area-filter',
    evidenceClasses: ['area-mixed-outcomes', 'threshold-fail', 'threshold-pass'],
  },
  { scenarioId: 'gear-up.v2-stage-cap-no-op', evidenceClasses: ['threshold-fail'] },
  { scenarioId: 'gear-up.v2-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'gear-up.v2-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const GLACIATE_MA_207_SCENARIOS = scenarios([
  {
    scenarioId: 'glaciate.v2-grounded-even-area-mixed',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'threshold-pass'],
  },
  { scenarioId: 'glaciate.v2-airborne-or-odd-no-slow', evidenceClasses: ['threshold-fail'] },
  { scenarioId: 'glaciate.v2-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'glaciate.v2-condition-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'glaciate.v2-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'glaciate.v2-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const HAZE_MA_207_SCENARIOS = scenarios([
  {
    scenarioId: 'haze.v2-field-wide-stage-reset',
    evidenceClasses: ['self'],
  },
  { scenarioId: 'haze.v2-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'haze.v2-stale-encounter-sheet', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const HEART_SWAP_MA_207_SCENARIOS = scenarios([
  { scenarioId: 'heart-swap.v2-two-target-all-stage-swap', evidenceClasses: ['threshold-pass'] },
  { scenarioId: 'heart-swap.v2-identical-stage-no-op', evidenceClasses: ['threshold-fail'] },
  { scenarioId: 'heart-swap.v2-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'heart-swap.v2-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const HYPER_VOICE_MA_207_SCENARIOS = scenarios([
  {
    scenarioId: 'hyper-voice.v2-smite-and-area-exit-push',
    evidenceClasses: ['alternate-branch', 'area-mixed-outcomes', 'hit', 'miss', 'threshold-pass'],
  },
  { scenarioId: 'hyper-voice.v2-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'hyper-voice.v2-ghost-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'hyper-voice.v2-obstructed-shortened-push', evidenceClasses: ['threshold-fail'] },
  { scenarioId: 'hyper-voice.v2-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'hyper-voice.v2-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const HYPERSPACE_FURY_MA_207_SCENARIOS = scenarios([
  {
    scenarioId: 'hyperspace-fury.v2-area-self-drop-no-interrupt',
    evidenceClasses: ['alternate-branch', 'area-mixed-outcomes', 'hit', 'miss', 'self', 'threshold-pass'],
  },
  { scenarioId: 'hyperspace-fury.v2-empty-area-no-drop', evidenceClasses: ['threshold-fail'] },
  { scenarioId: 'hyperspace-fury.v2-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'hyperspace-fury.v2-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'hyperspace-fury.v2-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const LEAF_STORM_MA_207_SCENARIOS = scenarios([
  {
    scenarioId: 'leaf-storm.v2-smite-and-self-drop',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'self', 'threshold-pass'],
  },
  { scenarioId: 'leaf-storm.v2-sap-sipper-no-drop', evidenceClasses: ['immunity', 'threshold-fail'] },
  { scenarioId: 'leaf-storm.v2-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'leaf-storm.v2-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'leaf-storm.v2-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const LEAF_TORNADO_MA_207_SCENARIOS = scenarios([
  {
    scenarioId: 'leaf-tornado.v2-center-size-and-threshold-filter',
    evidenceClasses: ['alternate-branch', 'area-mixed-outcomes', 'hit', 'threshold-pass'],
  },
  { scenarioId: 'leaf-tornado.v2-miss-or-low-roll', evidenceClasses: ['miss', 'threshold-fail'] },
  { scenarioId: 'leaf-tornado.v2-critical-hit', evidenceClasses: ['crit'] },
  { scenarioId: 'leaf-tornado.v2-sap-sipper-immunity', evidenceClasses: ['immunity'] },
  { scenarioId: 'leaf-tornado.v2-duplicate-replay', evidenceClasses: ['retry'] },
  { scenarioId: 'leaf-tornado.v2-stale-target', evidenceClasses: ['multi-resource-conflict'] },
] as const)

export const MA_207_SCENARIOS_BY_MOVE: Readonly<Record<
  AreaStages207MoveName,
  readonly AreaStages207ScenarioEvidence[]
>> = Object.freeze({
  'Gear Up': GEAR_UP_MA_207_SCENARIOS,
  Glaciate: GLACIATE_MA_207_SCENARIOS,
  Haze: HAZE_MA_207_SCENARIOS,
  'Heart Swap': HEART_SWAP_MA_207_SCENARIOS,
  'Hyper Voice': HYPER_VOICE_MA_207_SCENARIOS,
  'Hyperspace Fury': HYPERSPACE_FURY_MA_207_SCENARIOS,
  'Leaf Storm': LEAF_STORM_MA_207_SCENARIOS,
  'Leaf Tornado': LEAF_TORNADO_MA_207_SCENARIOS,
})
