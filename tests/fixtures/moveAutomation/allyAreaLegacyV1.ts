export const AROMATIC_MIST_ALLY_AREA_SCENARIOS = Object.freeze([
  {
    scenarioId: 'aromatic-mist.legacy-v1-mixed-sides',
    evidenceClasses: ['ally', 'area-mixed-outcomes'] as const,
  },
  {
    scenarioId: 'aromatic-mist.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'] as const,
  },
  {
    scenarioId: 'aromatic-mist.legacy-v1-stale-excluded-candidate',
    evidenceClasses: ['multi-resource-conflict'] as const,
  },
] as const)

export const COACHING_ALLY_AREA_SCENARIOS = Object.freeze([
  {
    scenarioId: 'coaching.legacy-v1-mixed-sides',
    evidenceClasses: ['ally', 'area-mixed-outcomes', 'self'] as const,
  },
  {
    scenarioId: 'coaching.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'] as const,
  },
  {
    scenarioId: 'coaching.legacy-v1-stale-excluded-candidate',
    evidenceClasses: ['multi-resource-conflict'] as const,
  },
] as const)

export const HOWL_ALLY_AREA_SCENARIOS = Object.freeze([
  {
    scenarioId: 'howl.legacy-v1-mixed-sides',
    evidenceClasses: ['ally', 'area-mixed-outcomes', 'self'] as const,
  },
  {
    scenarioId: 'howl.legacy-v1-duplicate-replay',
    evidenceClasses: ['retry'] as const,
  },
  {
    scenarioId: 'howl.legacy-v1-stale-excluded-candidate',
    evidenceClasses: ['multi-resource-conflict'] as const,
  },
] as const)

export const ALLY_AREA_SCENARIOS_BY_MOVE = Object.freeze({
  'Aromatic Mist': AROMATIC_MIST_ALLY_AREA_SCENARIOS,
  Coaching: COACHING_ALLY_AREA_SCENARIOS,
  Howl: HOWL_ALLY_AREA_SCENARIOS,
})

export type RegisteredAllyAreaMoveName = keyof typeof ALLY_AREA_SCENARIOS_BY_MOVE
