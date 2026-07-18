/** Reviewed semantic evidence IDs for Reflect's side ownership and trigger lifecycle. */
export const REFLECT_V2_SEMANTIC_SCENARIOS = Object.freeze([
  {
    scenarioId: 'reflect.v2-duplicate-replay',
    evidenceClasses: ['retry'] as const,
  },
  {
    scenarioId: 'reflect.v2-enemy-unaffected',
    evidenceClasses: ['enemy'] as const,
  },
  {
    scenarioId: 'reflect.v2-physical-activation',
    evidenceClasses: ['lifecycle-trigger', 'threshold-pass'] as const,
  },
  {
    scenarioId: 'reflect.v2-scene-expiry',
    evidenceClasses: ['lifecycle-cleanup'] as const,
  },
  {
    scenarioId: 'reflect.v2-side-application',
    evidenceClasses: ['ally'] as const,
  },
  {
    scenarioId: 'reflect.v2-special-retain',
    evidenceClasses: ['threshold-fail'] as const,
  },
] as const)
