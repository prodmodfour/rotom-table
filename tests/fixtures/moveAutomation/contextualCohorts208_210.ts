import type { ContextualCohort208210MoveName } from '~~/server/domain/moveAutomation/specs/contextualCohorts208_210'

export interface ContextualCohortScenarioEvidence {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

export const MA_208_210_SCENARIOS_BY_MOVE: Readonly<Record<
  ContextualCohort208210MoveName,
  readonly ContextualCohortScenarioEvidence[]
>> = Object.freeze({
  'Magnetic Flux': [{
    scenarioId: 'magnetic-flux.v2-reviewed-conformance',
    evidenceClasses: ['area-mixed-outcomes', 'choice', 'pass', 'reconnect', 'retry', 'multi-resource-conflict', 'threshold-pass', 'threshold-fail'],
  }],
  'Meteor Beam': [{
    scenarioId: 'meteor-beam.v2-reviewed-conformance',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'crit', 'immunity', 'retry', 'multi-resource-conflict', 'alternate-branch', 'lifecycle-trigger', 'lifecycle-cleanup'],
  }],
  'Moongeist Beam': [{
    scenarioId: 'moongeist-beam.v2-reviewed-conformance',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'crit', 'immunity', 'retry', 'multi-resource-conflict'],
  }],
  Outrage: [{
    scenarioId: 'outrage.v2-reviewed-conformance',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'crit', 'immunity', 'retry', 'multi-resource-conflict', 'self'],
  }],
  Overheat: [{
    scenarioId: 'overheat.v2-reviewed-conformance',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'crit', 'immunity', 'retry', 'multi-resource-conflict', 'self'],
  }],
  'Petal Dance': [{
    scenarioId: 'petal-dance.v2-reviewed-conformance',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'crit', 'immunity', 'retry', 'multi-resource-conflict', 'self'],
  }],
  'Photon Geyser': [{
    scenarioId: 'photon-geyser.v2-reviewed-conformance',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'crit', 'immunity', 'retry', 'multi-resource-conflict'],
  }],
  'Psycho Boost': [{
    scenarioId: 'psycho-boost.v2-reviewed-conformance',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'crit', 'immunity', 'retry', 'multi-resource-conflict', 'self'],
  }],
  Rototiller: [{
    scenarioId: 'rototiller.v2-reviewed-conformance',
    evidenceClasses: ['area-mixed-outcomes', 'threshold-pass', 'threshold-fail', 'retry', 'multi-resource-conflict'],
  }],
  Snore: [{
    scenarioId: 'snore.v2-reviewed-conformance',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'crit', 'immunity', 'retry', 'multi-resource-conflict', 'threshold-pass', 'threshold-fail'],
  }],
  'Sparkling Aria': [{
    scenarioId: 'sparkling-aria.v2-reviewed-conformance',
    evidenceClasses: ['hit', 'miss', 'crit', 'immunity', 'choice', 'pass', 'reconnect', 'retry', 'multi-resource-conflict'],
  }],
  'Springtide Storm': [{
    scenarioId: 'springtide-storm.v2-reviewed-conformance',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'crit', 'immunity', 'retry', 'multi-resource-conflict', 'threshold-pass', 'threshold-fail', 'alternate-branch', 'self'],
  }],
  'String Shot': [{
    scenarioId: 'string-shot.v2-reviewed-conformance',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'immunity', 'threshold-pass', 'threshold-fail', 'retry', 'multi-resource-conflict'],
  }],
  'Sunsteel Strike': [{
    scenarioId: 'sunsteel-strike.v2-reviewed-conformance',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'crit', 'immunity', 'retry', 'multi-resource-conflict'],
  }],
  Synchronoise: [{
    scenarioId: 'synchronoise.v2-reviewed-conformance',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'crit', 'immunity', 'retry', 'multi-resource-conflict', 'threshold-pass', 'threshold-fail'],
  }],
  Teatime: [{
    scenarioId: 'teatime.v2-reviewed-conformance',
    evidenceClasses: ['choice', 'pass', 'reconnect', 'retry', 'multi-resource-conflict'],
  }],
  Thrash: [{
    scenarioId: 'thrash.v2-reviewed-conformance',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'crit', 'immunity', 'retry', 'multi-resource-conflict', 'self'],
  }],
  Uproar: [{
    scenarioId: 'uproar.v2-reviewed-conformance',
    evidenceClasses: ['area-mixed-outcomes', 'hit', 'miss', 'crit', 'immunity', 'retry', 'multi-resource-conflict', 'threshold-pass', 'threshold-fail'],
  }],
  'Venom Drench': [{
    scenarioId: 'venom-drench.v2-reviewed-conformance',
    evidenceClasses: ['area-mixed-outcomes', 'threshold-pass', 'threshold-fail', 'retry', 'multi-resource-conflict'],
  }],
})
