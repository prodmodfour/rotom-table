import { describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import menuStatusJson from '../../data/move-automation/menu-status.json'
import { parseMoveEffectOperation } from '#shared/moveAutomation/effects'
import { nativeMoveAutomationPresentationScriptForMove } from '~/utils/move-automation/nativePresentation'
import {
  CONTEXTUAL_COHORTS_208_210_MOVE_SPEC_REGISTRATIONS,
  MA_208_210_MOVE_NAMES,
  MAGNETIC_FLUX_MOVE_SPEC,
  METEOR_BEAM_MOVE_SPEC,
  MOONGEIST_BEAM_MOVE_SPEC,
  OUTRAGE_MOVE_SPEC,
  PHOTON_GEYSER_MOVE_SPEC,
  SNORE_MOVE_SPEC,
  SPARKLING_ARIA_MOVE_SPEC,
  SPRINGTIDE_STORM_MOVE_SPEC,
  STRING_SHOT_MOVE_SPEC,
  SYNCHRONOISE_MOVE_SPEC,
  TEATIME_MOVE_SPEC,
  UPROAR_MOVE_SPEC,
  VENOM_DRENCH_MOVE_SPEC,
  type ContextualCohort208210MoveName,
} from '~~/server/domain/moveAutomation/specs/contextualCohorts208_210'
import {
  registeredMoveAutomationRuntimeFor,
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
} from '~~/server/domain/moveAutomation/registry'
import { validateMoveSpec } from '~~/server/domain/moveAutomation/validateSpec'
import { REGISTERED_MOVE_HANDLER_REGISTRY } from '~~/server/domain/moveAutomation/handlers/registry'
import { MA_208_210_SCENARIOS_BY_MOVE } from '../fixtures/moveAutomation/contextualCohorts208_210'

const operations = (spec: typeof MAGNETIC_FLUX_MOVE_SPEC) => spec.phases.flatMap(
  block => block.operations.map(operation => parseMoveEffectOperation(operation)),
)

const operation = (spec: typeof MAGNETIC_FLUX_MOVE_SPEC, id: string) => (
  operations(spec).find(candidate => candidate.id === id)
)

describe('MA-208 through MA-210 contextual move cohorts', () => {
  it('registers exactly the reviewed cohort with matching immutable hashes', () => {
    expect(CONTEXTUAL_COHORTS_208_210_MOVE_SPEC_REGISTRATIONS.map(value => value.canonicalId))
      .toEqual(MA_208_210_MOVE_NAMES)
    expect(new Set(MA_208_210_MOVE_NAMES).size).toBe(19)

    for (const registration of CONTEXTUAL_COHORTS_208_210_MOVE_SPEC_REGISTRATIONS) {
      const moveName = registration.canonicalId as ContextualCohort208210MoveName
      const row = manifestJson.moves.find(value => value.canonicalId === moveName)!
      const definition = validateMoveSpec(registration.spec, {
        capabilityIds: row.capabilityTags,
        rulesetVersion: row.rulesProvenance,
        handlerRegistry: REGISTERED_MOVE_HANDLER_REGISTRY,
      })
      expect(row).toMatchObject({
        baseStatus: 'complete',
        blockerCodes: [],
        limitations: [],
        manualSteps: [],
        runtime: {
          kind: 'movespec-v2',
          version: 2,
          definitionHash: definition.definitionHash,
          sourceModule: registration.sourceModule,
        },
      })
      expect(row.scenarioIds).toEqual(
        MA_208_210_SCENARIOS_BY_MOVE[moveName].map(value => value.scenarioId),
      )
      expect(registeredMoveAutomationRuntimeFor(registration.canonicalId)?.definitionHash)
        .toBe(definition.definitionHash)
      expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS.filter(
        value => value.canonicalId === registration.canonicalId,
      )).toHaveLength(1)
      expect(Object.isFrozen(definition.spec)).toBe(true)
    }
  })

  it('publishes complete browser-safe intent metadata without mechanics notes', () => {
    for (const moveName of MA_208_210_MOVE_NAMES) {
      const presentation = nativeMoveAutomationPresentationScriptForMove(moveName)
      const status = menuStatusJson.moves.find(value => value.canonicalId === moveName)
      expect(presentation, moveName).not.toBeNull()
      expect(presentation?.automationNotes, moveName).toEqual([])
      expect(status, moveName).toMatchObject({
        canonicalId: moveName,
        baseStatus: 'complete',
        runtimeKind: 'movespec-v2',
      })
    }
  })

  it('encodes setup, ability bypass, alternate stat, and repeated-use clauses structurally', () => {
    expect(METEOR_BEAM_MOVE_SPEC.costs.map(value => value.cost)).toEqual([
      { kind: 'action-resource', resource: 'standard', amount: 1 },
      { kind: 'setup-execute', step: 'auto' },
    ])
    expect(METEOR_BEAM_MOVE_SPEC.registeredHandlerId).toBe('ma208.setup-damage')

    const moongeistDamage = operation(MOONGEIST_BEAM_MOVE_SPEC, 'moongeist-beam.damage')
    expect(moongeistDamage?.kind === 'damage' && moongeistDamage.payload.typeEffectiveness)
      .toMatchObject({ immunity: 'honor', passiveImmunity: 'ignore' })

    const photonDamage = operation(PHOTON_GEYSER_MOVE_SPEC, 'photon-geyser.damage')
    expect(photonDamage?.kind === 'damage' && photonDamage.payload.attackStat).toMatchObject({
      kind: 'max',
      values: expect.arrayContaining([
        expect.objectContaining({ stat: 'attack' }),
        expect.objectContaining({ stat: 'special-attack' }),
      ]),
    })

    for (const conditionId of ['rage', 'confused']) {
      const effect = operations(OUTRAGE_MOVE_SPEC).find(candidate => (
        candidate.kind === 'condition' && candidate.payload.conditionId === conditionId
      ))
      expect(effect?.kind === 'condition' && effect.payload.operationOutcomeTrigger).toEqual({
        operationId: 'outrage.damage',
        outcome: 'applied',
      })
    }
  })

  it('encodes every reviewed filter, threshold, and durable human choice', () => {
    expect(MAGNETIC_FLUX_MOVE_SPEC.targeting.predicate).toMatchObject({
      statePredicates: [{
        kind: 'type-or-capability',
        typeIds: ['electric'],
        capabilityIds: ['capability.magnetic'],
      }],
    })
    expect(SYNCHRONOISE_MOVE_SPEC.targeting.predicate).toMatchObject({
      statePredicates: [{ kind: 'shares-type-with-actor' }],
    })
    expect(VENOM_DRENCH_MOVE_SPEC.targeting.predicate).toMatchObject({
      statePredicates: [{
        kind: 'condition',
        conditionIds: ['poisoned', 'badly-poisoned'],
      }],
    })
    expect(SNORE_MOVE_SPEC.preconditions).toHaveLength(1)
    expect(operation(STRING_SHOT_MOVE_SPEC, 'string-shot.stuck-threshold')?.kind).toBe('branch')
    expect(operation(UPROAR_MOVE_SPEC, 'uproar.sleep-cure-range')).toMatchObject({
      kind: 'branch',
      payload: {
        predicate: {
          left: { kind: 'distance' },
          right: { value: 5 },
        },
      },
    })

    for (const [spec, requestId] of [
      [MAGNETIC_FLUX_MOVE_SPEC, 'magnetic-flux.stage-direction'],
      [SPARKLING_ARIA_MOVE_SPEC, 'sparkling-aria.outcome'],
      [TEATIME_MOVE_SPEC, 'teatime.participation'],
    ] as const) {
      const choice = operations(spec).find(candidate => (
        candidate.kind === 'branch'
        && candidate.payload.kind === 'choice'
        && candidate.payload.requestId === requestId
      ))
      expect(choice, requestId).toBeDefined()
    }
    expect(SPRINGTIDE_STORM_MOVE_SPEC.registeredHandlerId).toBe('ma208.setup-damage')
  })
})
