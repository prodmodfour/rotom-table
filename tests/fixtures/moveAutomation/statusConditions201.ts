export const MA_201_SCENARIOS = Object.freeze({
  darkVoidSingleHit: {
    scenarioId: 'ma201-dark-void-single-hit',
    evidenceClasses: ['hit'],
  },
  darkVoidSingleMiss: {
    scenarioId: 'ma201-dark-void-single-miss',
    evidenceClasses: ['miss'],
  },
  darkVoidImmunity: {
    scenarioId: 'ma201-dark-void-sweet-veil-immunity',
    evidenceClasses: ['immunity'],
  },
  darkVoidBurstMixed: {
    scenarioId: 'ma201-dark-void-burst-mixed-friendly',
    evidenceClasses: ['alternate-branch', 'area-mixed-outcomes'],
  },
  darkVoidRetry: {
    scenarioId: 'ma201-dark-void-retry',
    evidenceClasses: ['retry'],
  },
  darkVoidStale: {
    scenarioId: 'ma201-dark-void-stale-resource',
    evidenceClasses: ['multi-resource-conflict'],
  },
  thunderWaveHit: {
    scenarioId: 'ma201-thunder-wave-hit',
    evidenceClasses: ['hit'],
  },
  thunderWaveMiss: {
    scenarioId: 'ma201-thunder-wave-miss',
    evidenceClasses: ['miss'],
  },
  thunderWaveImmunity: {
    scenarioId: 'ma201-thunder-wave-typed-immunity',
    evidenceClasses: ['immunity'],
  },
  thunderWaveRetry: {
    scenarioId: 'ma201-thunder-wave-retry',
    evidenceClasses: ['retry'],
  },
  thunderWaveStale: {
    scenarioId: 'ma201-thunder-wave-stale-resource',
    evidenceClasses: ['multi-resource-conflict'],
  },
  toxicHit: {
    scenarioId: 'ma201-toxic-hit',
    evidenceClasses: ['hit'],
  },
  toxicMiss: {
    scenarioId: 'ma201-toxic-miss',
    evidenceClasses: ['miss'],
  },
  toxicPoisonUser: {
    scenarioId: 'ma201-toxic-poison-user-automatic-hit',
    evidenceClasses: ['alternate-branch'],
  },
  toxicImmunity: {
    scenarioId: 'ma201-toxic-poison-immunity',
    evidenceClasses: ['immunity'],
  },
  toxicRetry: {
    scenarioId: 'ma201-toxic-retry',
    evidenceClasses: ['retry'],
  },
  toxicStale: {
    scenarioId: 'ma201-toxic-stale-resource',
    evidenceClasses: ['multi-resource-conflict'],
  },
} as const)
