import { afterEach, describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  TACKLE_V2_SEMANTIC_SCENARIOS,
  allTackleV2SemanticScenarios,
  tackleV2SemanticScenario,
} from '../fixtures/moveAutomation/tackleFamilyV2'
import {
  runAndAssertMoveAutomationSemanticScenario,
} from '../fixtures/moveAutomation/scenario'
import {
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
  registeredMoveAutomationRuntimeFor,
} from '~~/server/domain/moveAutomation/registry'
import { TACKLE_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/tackle'
import type { PersistedSheet } from '~~/server/storage/sheetRepository'
import {
  LivePlayIntegrationHarness,
  assertAccepted,
} from './livePlayIntegrationHarness'

const tackleRow = manifestJson.moves.find(row => row.canonicalId === 'Tackle')!
const harnesses: LivePlayIntegrationHarness[] = []
const gm = { role: 'gm' as const, clientId: 'gm-tackle-client' }

const persistedSheets = (
  pokemon: ReadonlyMap<string, CharacterSheet>,
  trainer: ReadonlyMap<string, TrainerSheet> = new Map(),
): readonly PersistedSheet[] => [
  ...[...pokemon].map(([slug, sheet]) => ({
    kind: 'pokemon' as const,
    slug,
    revision: sheet.revision ?? 0,
    updatedAt: 1_700_000_000_000,
    sheet: {
      ...structuredClone(sheet),
      slug,
      updatedAt: 1_700_000_000_000,
    },
  })),
  ...[...trainer].map(([slug, sheet]) => ({
    kind: 'trainer' as const,
    slug,
    revision: sheet.revision ?? 0,
    updatedAt: 1_700_000_000_000,
    sheet: {
      ...structuredClone(sheet),
      slug,
      updatedAt: 1_700_000_000_000,
    },
  })),
]

afterEach(() => {
  while (harnesses.length > 0) harnesses.pop()?.dispose()
})

describe('Tackle native automation', () => {
  it('selects its complete reviewed runtime and links semantic evidence', () => {
    expect(tackleRow).toMatchObject({
      baseStatus: 'complete',
      runtime: {
        kind: 'movespec-v2',
        version: 2,
        definitionHash: '04f6d11d74d260f0d446d3b4e8820eb2c021853d82cb742adf92b1dcfe0f474c',
        sourceModule: 'server/domain/moveAutomation/specs/tackle.ts',
      },
      blockerCodes: [],
      limitations: [],
      manualSteps: [],
    })
    expect(tackleRow.scenarioIds).toEqual(expect.arrayContaining(
      TACKLE_V2_SEMANTIC_SCENARIOS.map(({ scenarioId }) => scenarioId),
    ))
    expect(tackleRow.scenarioIds).toContain('tackle.v2-stale-target')
    expect(registeredMoveAutomationRuntimeFor('Tackle')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: TACKLE_MOVE_SPEC },
      definitionHash: tackleRow.runtime.definitionHash,
    })
    expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS).toContainEqual(
      expect.objectContaining({ canonicalId: 'Tackle' }),
    )
  })

  it.each(allTackleV2SemanticScenarios())(
    'proves $scenarioId through interpreter, planner, and accepted command',
    async (scenario) => {
      const result = await runAndAssertMoveAutomationSemanticScenario(scenario)
      const statuses = [
        result.interpreter.status,
        result.plan.status,
        result.command.status,
      ]
      if (scenario.scenarioId === 'tackle.v2-stuck-rejected') {
        expect(statuses).toEqual(['rejected', 'rejected', 'rejected'])
        expect(result.committedDocuments.operationResult).toMatchObject({
          ok: false,
          reason: 'conflict',
        })
        expect(result.committedDocuments.map).toMatchObject({ revision: 7 })
        expect(result.committedDocuments.sheets.pokemon.actor).toMatchObject({
          revision: 3,
          combat: { currentHp: 100, conditions: ['Stuck'] },
        })
        expect(result.committedDocuments.sheets.pokemon.target).toMatchObject({
          revision: 3,
          combat: { currentHp: 100 },
        })
        return
      }
      expect(statuses).toEqual(['completed', 'completed', 'completed'])
      if (result.plan.status !== 'completed' || result.command.status !== 'completed') return

      const operations = result.plan.value.resolution.auditTrace.events.filter(event => (
        event.kind === 'operation'
      ))
      expect(operations.map(event => event.kind === 'operation' ? event.operationId : null)).toEqual([
        'tackle.accuracy',
        'tackle.damage',
        'tackle.push',
        'tackle.usage',
        'tackle.log-completed',
      ])

      const push = operations.find(event => (
        event.kind === 'operation' && event.operationId === 'tackle.push'
      ))
      const shouldPush = scenario.scenarioId !== 'tackle.v2-miss'
        && scenario.scenarioId !== 'tackle.v2-immunity'
      const shortened = scenario.scenarioId === 'tackle.v2-shortened-push'
      expect(push).toMatchObject({
        kind: 'operation',
        phase: 'movement',
        recipientIds: shouldPush ? ['target-token'] : [],
        outcome: shouldPush ? 'applied' : 'no-op',
        result: {
          status: shouldPush ? 'applied' : 'no-op',
          details: {
            movedCount: shouldPush ? 1 : 0,
            shortenedCount: shortened ? 1 : 0,
          },
          movements: shouldPush
            ? [{
                recipientPlacementId: 'target-token',
                mode: 'forced',
                origin: { x: 2, y: 0, z: 1 },
                destination: { x: shortened ? 3 : 4, y: 0, z: 1 },
                path: shortened
                  ? [{ x: 2, y: 0, z: 1 }, { x: 3, y: 0, z: 1 }]
                  : [
                      { x: 2, y: 0, z: 1 },
                      { x: 3, y: 0, z: 1 },
                      { x: 4, y: 0, z: 1 },
                    ],
                requestedDistance: 2,
                resolvedDistance: shortened ? 1 : 2,
                shortened,
                shorteningReason: shortened ? 'occupied-footprint' : 'none',
                vector: {
                  kind: 'away',
                  x: 1,
                  y: 0,
                  z: 0,
                  sourcePlacementId: 'actor-token',
                  direction: null,
                },
              }]
            : [],
        },
      })
      if (shortened) {
        expect(push).toMatchObject({
          result: {
            movements: [{
              obstruction: {
                reason: 'occupied-footprint',
                at: { x: 4, y: 0, z: 1 },
                collision: {
                  kind: 'placement',
                  placementIds: ['blocker-token'],
                },
              },
            }],
          },
        })
        expect(result.plan.value.sheetReads).toContainEqual({
          kind: 'pokemon',
          slug: 'blocker',
          revision: 3,
        })
      }

      const damage = operations.find(event => (
        event.kind === 'operation' && event.operationId === 'tackle.damage'
      ))
      if (scenario.scenarioId === 'tackle.v2-critical-hit') {
        expect(damage).toMatchObject({
          outcome: 'applied',
          result: {
            recipients: [{
              details: {
                calculation: {
                  criticalHit: { critical: true, naturalRoll: 20 },
                },
              },
            }],
          },
        })
      }
      if (scenario.scenarioId === 'tackle.v2-immunity') {
        expect(damage).toMatchObject({ outcome: 'prevented' })
      }
      if (scenario.scenarioId === 'tackle.v2-miss') {
        expect(damage).toMatchObject({ outcome: 'no-op', recipientIds: [] })
      }

      const patch = assertAccepted(result.command.value.result).patches[0]
      if (shouldPush) {
        expect(patch?.scopes).toContainEqual({
          kind: 'token',
          placementId: 'target-token',
          field: 'position',
        })
      }
    },
  )

  it('commits damage and one push atomically and replays duplicate delivery without rerolling', async () => {
    const scenario = tackleV2SemanticScenario('tackle.v2-duplicate-retry')
    let drawCount = 0
    const draws = [0.45, 0] as const
    const map: TabletopMap = {
      ...structuredClone(scenario.initialState.map),
      slug: 'integration-arena',
      revision: 0,
      updatedAt: 1_700_000_000_000,
      encounterState: structuredClone(scenario.initialState.encounterState),
    }
    const harness = LivePlayIntegrationHarness.create({
      map,
      sheets: persistedSheets(
        scenario.initialState.pokemonSheets,
        scenario.initialState.trainerSheets,
      ),
      random: () => {
        const value = draws[drawCount]
        if (value === undefined) throw new Error('Tackle requested an unexpected random draw.')
        drawCount += 1
        return value
      },
    })
    harnesses.push(harness)
    const command = harness.resolveMoveCommand({
      opId: 'op_tackle_duplicate_commit',
      baseRevision: 0,
      intent: scenario.intent,
      candidateScopePlacementIds: ['target-token'],
    })

    const first = await harness.resolveMove({ actor: gm, command })
    const duplicate = await harness.resolveMove({ actor: gm, command })
    const accepted = assertAccepted(first.result)
    const committedMap = await harness.readMap()
    const committedTarget = await harness.readSheet('pokemon', 'target')

    expect(accepted).toMatchObject({ previousRevision: 0, revision: 1 })
    expect(duplicate.result).toEqual(first.result)
    expect(duplicate.move).toEqual(first.move)
    expect(committedMap?.placements.find(({ id }) => id === 'target-token')?.position).toEqual({
      x: 4,
      y: 0,
      z: 1,
    })
    expect(committedTarget?.sheet).toMatchObject({
      revision: 4,
      combat: { currentHp: 92 },
    })
    expect(first.move?.rollLedger).toHaveLength(2)
    expect(drawCount).toBe(2)
    expect(harness.operationRecordCount()).toBe(1)
    expect(harness.publishedEvents.filter(event => (
      event.type === 'live-play-command-accepted'
    ))).toHaveLength(1)
  })
})
