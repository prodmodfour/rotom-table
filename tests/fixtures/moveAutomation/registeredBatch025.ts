export interface RegisteredMoveConformanceScenario {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

const scenarios = <const Scenarios extends readonly RegisteredMoveConformanceScenario[]>(
  value: Scenarios,
): Scenarios => Object.freeze(value)

export const SHADOW_PUNCH_REG_025_SCENARIOS = scenarios([
  {
    scenarioId: 'shadow-punch.legacy-v1-automatic-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'shadow-punch.legacy-v1-normal-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'shadow-punch.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'shadow-punch.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const SHADOW_SNEAK_REG_025_SCENARIOS = scenarios([
  {
    scenarioId: 'shadow-sneak.legacy-v1-priority-hit',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'shadow-sneak.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'shadow-sneak.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'shadow-sneak.legacy-v1-normal-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'shadow-sneak.legacy-v1-priority-rejected',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'shadow-sneak.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'shadow-sneak.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const SHOCK_WAVE_REG_025_SCENARIOS = scenarios([
  {
    scenarioId: 'shock-wave.legacy-v1-automatic-hit-zapper-capability',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'shock-wave.legacy-v1-ground-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'shock-wave.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'shock-wave.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const SIGNAL_BEAM_REG_025_SCENARIOS = scenarios([
  {
    scenarioId: 'signal-beam.legacy-v1-confusion-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'signal-beam.legacy-v1-confusion-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'signal-beam.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'signal-beam.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'signal-beam.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'signal-beam.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'signal-beam.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const SLASH_REG_025_SCENARIOS = scenarios([
  {
    scenarioId: 'slash.legacy-v1-pass-mixed',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss'],
  },
  {
    scenarioId: 'slash.legacy-v1-expanded-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'slash.legacy-v1-ghost-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'slash.legacy-v1-pass-no-targets',
    evidenceClasses: ['alternate-branch'],
  },
  {
    scenarioId: 'slash.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'slash.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const SLEEP_POWDER_REG_025_SCENARIOS = scenarios([
  {
    scenarioId: 'sleep-powder.legacy-v1-sleep-hit',
    evidenceClasses: ['hit'],
  },
  {
    scenarioId: 'sleep-powder.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'sleep-powder.legacy-v1-powder-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'sleep-powder.legacy-v1-sweet-veil-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'sleep-powder.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'sleep-powder.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const SLUDGE_REG_025_SCENARIOS = scenarios([
  {
    scenarioId: 'sludge.legacy-v1-poison-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'sludge.legacy-v1-poison-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'sludge.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'sludge.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'sludge.legacy-v1-steel-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'sludge.legacy-v1-poison-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'sludge.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'sludge.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'sludge.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const SLUDGE_BOMB_REG_025_SCENARIOS = scenarios([
  {
    scenarioId: 'sludge-bomb.legacy-v1-poison-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'],
  },
  {
    scenarioId: 'sludge-bomb.legacy-v1-poison-threshold-fail',
    evidenceClasses: ['threshold-fail'],
  },
  {
    scenarioId: 'sludge-bomb.legacy-v1-miss',
    evidenceClasses: ['miss'],
  },
  {
    scenarioId: 'sludge-bomb.legacy-v1-critical-hit',
    evidenceClasses: ['crit'],
  },
  {
    scenarioId: 'sludge-bomb.legacy-v1-steel-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'sludge-bomb.legacy-v1-poison-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'sludge-bomb.legacy-v1-secondary-immunity',
    evidenceClasses: ['immunity'],
  },
  {
    scenarioId: 'sludge-bomb.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'],
  },
  {
    scenarioId: 'sludge-bomb.legacy-v1-stale-target',
    evidenceClasses: ['multi-resource-conflict'],
  },
] as const)

export const REG_025_MOVE_NAMES = Object.freeze([
  'Shadow Punch',
  'Shadow Sneak',
  'Shock Wave',
  'Signal Beam',
  'Slash',
  'Sleep Powder',
  'Sludge',
  'Sludge Bomb',
] as const)

export type RegisteredBatch025MoveName = (typeof REG_025_MOVE_NAMES)[number]

export const REG_025_SCENARIOS_BY_MOVE: Readonly<Record<
  RegisteredBatch025MoveName,
  readonly RegisteredMoveConformanceScenario[]
>> = Object.freeze({
  'Shadow Punch': SHADOW_PUNCH_REG_025_SCENARIOS,
  'Shadow Sneak': SHADOW_SNEAK_REG_025_SCENARIOS,
  'Shock Wave': SHOCK_WAVE_REG_025_SCENARIOS,
  'Signal Beam': SIGNAL_BEAM_REG_025_SCENARIOS,
  Slash: SLASH_REG_025_SCENARIOS,
  'Sleep Powder': SLEEP_POWDER_REG_025_SCENARIOS,
  Sludge: SLUDGE_REG_025_SCENARIOS,
  'Sludge Bomb': SLUDGE_BOMB_REG_025_SCENARIOS,
})
