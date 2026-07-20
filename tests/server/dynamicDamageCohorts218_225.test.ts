import { describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import menuStatusJson from '../../data/move-automation/menu-status.json'
import { parseMoveEffectOperation } from '#shared/moveAutomation/effects'
import { nativeMoveAutomationPresentationScriptForMove } from '~/utils/move-automation/nativePresentation'
import {
  DYNAMIC_DAMAGE_218_225_HANDLER_REGISTRATION,
} from '~~/server/domain/moveAutomation/handlers/dynamicDamage218_225'
import { REGISTERED_MOVE_HANDLER_REGISTRY } from '~~/server/domain/moveAutomation/handlers/registry'
import {
  registeredMoveAutomationRuntimeFor,
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
} from '~~/server/domain/moveAutomation/registry'
import {
  AUTOTOMIZE_MOVE_SPEC,
  BARB_BARRAGE_MOVE_SPEC,
  BODY_PRESS_MOVE_SPEC,
  DOUBLE_IRON_BASH_MOVE_SPEC,
  DYNAMIC_DAMAGE_COHORTS_218_225_MOVE_SPEC_REGISTRATIONS,
  JUDGMENT_MOVE_SPEC,
  MA_218_225_MOVE_NAMES,
  SCALE_SHOT_MOVE_SPEC,
  TWINEEDLE_MOVE_SPEC,
  WATER_SHURIKEN_MOVE_SPEC,
  type DynamicDamageCohort218225MoveName,
} from '~~/server/domain/moveAutomation/specs/dynamicDamageCohorts218_225'
import { validateMoveSpec } from '~~/server/domain/moveAutomation/validateSpec'
import { MA_218_225_SCENARIOS_BY_MOVE } from '../fixtures/moveAutomation/dynamicDamageCohorts218_225'

const operations = (spec: typeof BODY_PRESS_MOVE_SPEC) => spec.phases.flatMap(
  block => block.operations.map(operation => parseMoveEffectOperation(operation)),
)
const operation = (spec: typeof BODY_PRESS_MOVE_SPEC, id: string) => (
  operations(spec).find(candidate => candidate.id === id)
)

describe('MA-218 through MA-225 dynamic damage cohorts', () => {
  it('registers exactly 57 reviewed definitions with matching manifest hashes', () => {
    expect(DYNAMIC_DAMAGE_COHORTS_218_225_MOVE_SPEC_REGISTRATIONS.map(value => value.canonicalId))
      .toEqual(MA_218_225_MOVE_NAMES)
    expect(new Set(MA_218_225_MOVE_NAMES).size).toBe(57)
    for (const registration of DYNAMIC_DAMAGE_COHORTS_218_225_MOVE_SPEC_REGISTRATIONS) {
      const moveName = registration.canonicalId as DynamicDamageCohort218225MoveName
      const row = manifestJson.moves.find(value => value.canonicalId === moveName)!
      const definition = validateMoveSpec(registration.spec, {
        capabilityIds: row.capabilityTags,
        rulesetVersion: row.rulesProvenance,
        handlerRegistry: REGISTERED_MOVE_HANDLER_REGISTRY,
      })
      expect(row).toMatchObject({
        baseStatus: 'complete', blockerCodes: [], limitations: [], manualSteps: [],
        runtime: {
          kind: 'movespec-v2', version: 2, definitionHash: definition.definitionHash,
          sourceModule: registration.sourceModule,
        },
      })
      expect(row.scenarioIds).toEqual(
        MA_218_225_SCENARIOS_BY_MOVE[moveName].map(value => value.scenarioId),
      )
      expect(registeredMoveAutomationRuntimeFor(moveName)?.definitionHash)
        .toBe(definition.definitionHash)
      expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS.filter(value => (
        value.canonicalId === moveName
      ))).toHaveLength(1)
    }
  })

  it('publishes complete browser-safe metadata for the whole cohort', () => {
    for (const moveName of MA_218_225_MOVE_NAMES) {
      expect(menuStatusJson.moves.find(value => value.canonicalId === moveName)).toMatchObject({
        baseStatus: 'complete', runtimeKind: 'movespec-v2', blockerCodes: [],
      })
      expect(nativeMoveAutomationPresentationScriptForMove(moveName)).toMatchObject({
        automationNotes: [],
      })
    }
  })

  it('encodes Five Strike, Double Strike, per-hit thresholds, and after-all stages', () => {
    expect(operation(BARB_BARRAGE_MOVE_SPEC, 'barb-barrage.rolled-strikes')).toMatchObject({
      kind: 'multi-hit',
      payload: { count: { kind: 'table' }, accuracy: { kind: 'once' } },
    })
    expect(operation(DOUBLE_IRON_BASH_MOVE_SPEC, 'double-iron-bash.multi-hit')).toMatchObject({
      kind: 'multi-hit',
      payload: {
        count: { kind: 'fixed', hits: 2 },
        accuracy: { kind: 'per-hit' },
        effects: [expect.objectContaining({ naturalAccuracyMinimum: 15 })],
      },
    })
    expect(operation(TWINEEDLE_MOVE_SPEC, 'twineedle.multi-hit')).toMatchObject({
      payload: { effects: [expect.objectContaining({ naturalAccuracyMinimum: 18 })] },
    })
    expect(operation(SCALE_SHOT_MOVE_SPEC, 'scale-shot.multi-hit')).toMatchObject({
      payload: {
        effects: expect.arrayContaining([
          expect.objectContaining({ timing: 'after-all', recipient: 'actor', kind: 'combat-stage' }),
        ]),
      },
    })
    expect(WATER_SHURIKEN_MOVE_SPEC.costs.map(value => value.cost)).toEqual([
      { kind: 'priority', mode: 'standard' },
      { kind: 'action-resource', resource: 'standard', amount: 1 },
    ])
  })

  it('encodes alternate type and alternate-count decisions as durable choices', () => {
    const judgment = operation(JUDGMENT_MOVE_SPEC, 'judgment.choose-type')
    expect(judgment).toMatchObject({
      kind: 'branch', payload: { kind: 'choice', requestId: 'judgment.type' },
    })
    expect(judgment?.kind === 'branch' && judgment.payload.kind === 'choice'
      ? judgment.payload.options
      : []).toHaveLength(18)
    expect(operation(BARB_BARRAGE_MOVE_SPEC, 'barb-barrage.choose-count')).toMatchObject({
      kind: 'branch',
      payload: { kind: 'choice', requestId: 'barb-barrage.count' },
    })
    expect(operation(BODY_PRESS_MOVE_SPEC, 'body-press.damage')).toMatchObject({
      kind: 'damage', payload: { attackStat: { stat: 'defense' } },
    })
    expect(AUTOTOMIZE_MOVE_SPEC.registeredHandlerId).toBe('ma218-225.dynamic-damage')
  })

  it('derives contextual DB, modifiers, alternatives, and weight overlays server-side', () => {
    const completionCounts: Record<string, number> = {
      'Echoed Voice:4': 1,
      'Echoed Voice:3': 1,
    }
    const baseContext = {
      map: { initiative: { round: 5 } },
      actor: {
        placement: { id: 'actor', initiative: 12 },
        token: { injuries: 2, combatStages: { atk: 2, satk: 1 } },
      },
      candidatePlacements: [],
      selectedPlacements: [{ id: 'target', initiative: 5 }],
      resolvedSheets: [], ruleset: {}, reads: { recordPlacement: () => undefined },
      queries: {
        tokens: { get: () => ({ combatStages: { atk: 2, def: 1 } }) },
        targetStates: { resolve: (id: string) => id === 'actor'
          ? { conditionIds: [], typeIds: ['fire'], weightClass: 4 }
          : { conditionIds: ['poisoned'], typeIds: ['grass'], weightClass: 2, actedThisRound: false } },
        stats: { resolve: (_id: string, input: { stat: string }) => ({ value: input.stat === 'speed' ? 8 : 1 }) },
        relationships: { resolve: () => ({ relationship: 'ally' }) },
        terrain: { membership: () => ({ terrains: [] }) },
        history: {
          completedMoveCount: (name: string, round: number) => completionCounts[`${name}:${round}`] ?? 0,
          lastCompletedMove: () => null,
          consecutiveUseCount: () => 0,
          lastDamagingMoveReceived: () => null,
          knockoutsSinceRound: () => [],
          completedMovesThisScene: () => [],
          moveUse: () => null,
        },
      },
    }
    const run = (moveName: string) => DYNAMIC_DAMAGE_218_225_HANDLER_REGISTRATION.run({
      ...baseContext, intent: { moveName },
    } as never) as { readonly operations: readonly ReturnType<typeof parseMoveEffectOperation>[] }

    expect(run('Behemoth Bash').operations[0]).toMatchObject({
      kind: 'damage', payload: { damageBase: 16 },
    })
    expect(run('Echoed Voice').operations[0]).toMatchObject({
      kind: 'damage', payload: { damageBase: 12 },
    })
    expect(run('Hex').operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'hex.choose-alternate', kind: 'branch' }),
      expect.objectContaining({ id: 'hex.damage-boosted', kind: 'damage' }),
      expect.objectContaining({ id: 'hex.alternate-usage', kind: 'usage' }),
    ]))
    expect(run('Autotomize').operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'autotomize.weight-class', kind: 'temporary-effect',
        payload: expect.objectContaining({
          definition: expect.objectContaining({
            payload: { attribute: 'weight-class', operation: 'set', value: 3, rounding: 'floor' },
          }),
        }),
      }),
    ]))
    expect(run('Dragon Darts').operations[0]).toMatchObject({
      kind: 'multi-hit', payload: { count: { kind: 'fixed', hits: 2 } },
    })
  })
})
