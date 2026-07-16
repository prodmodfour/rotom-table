import { afterEach, describe, expect, it } from 'vitest'
import {
  parseEncounterEffect,
  type EncounterEffect,
} from '#shared/moveAutomation/encounterEffects'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { MoveDirectHpEffectOperation } from '#shared/moveAutomation/effects'
import type { EncounterLifecycleTriggerHandler } from '~~/server/domain/moveAutomation/reduceLifecycle'
import type { PersistedSheet } from '~~/server/storage/sheetRepository'
import type { TabletopMap } from '~/types/map'
import { LivePlayIntegrationHarness, assertAccepted } from './livePlayIntegrationHarness'

const harnesses: LivePlayIntegrationHarness[] = []

afterEach(() => {
  while (harnesses.length > 0) harnesses.pop()?.dispose()
})

const dueEffect = (): EncounterEffect => parseEncounterEffect({
  id: 'effect.integration-residual',
  kind: 'numeric-modifier',
  source: {
    operationId: 'operation.integration-residual-source',
    moveId: 'move.integration-residual',
    placementId: 'actor-token',
  },
  affected: {
    placementIds: ['target-token'],
    sideIds: [],
    cells: [],
  },
  createdRound: 1,
  createdTurn: 0,
  duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 },
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'replace', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  tags: ['integration-residual'],
  payload: {
    attribute: 'damage',
    operation: 'add',
    value: 1,
    rounding: 'none',
  },
  dispel: { policy: 'none', tags: [] },
  suppression: { sources: [] },
})

const lifecycleMap = (effect: EncounterEffect): TabletopMap => ({
  schemaVersion: 2,
  revision: 0,
  slug: 'integration-arena',
  name: 'Initiative Lifecycle Arena',
  folder: '',
  dimensions: { x: 6, y: 3, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    {
      id: 'actor-token',
      sheetKind: 'pokemon',
      sheetSlug: 'actor-mon',
      position: { x: 1, y: 0, z: 1 },
      initiative: 20,
    },
    {
      id: 'target-token',
      sheetKind: 'pokemon',
      sheetSlug: 'target-mon',
      position: { x: 2, y: 0, z: 1 },
      initiative: 10,
    },
  ],
  lights: [],
  initiative: { activeId: 'actor-token', round: 1 },
  encounterState: {
    ...createEmptyEncounterState(),
    effects: [effect],
  },
  metadata: {},
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
})

const pokemonSheet = (
  slug: string,
  species: string,
  currentHp: number,
): PersistedSheet => ({
  kind: 'pokemon',
  slug,
  revision: 0,
  updatedAt: 1_700_000_000_000,
  sheet: {
    slug,
    nickname: species,
    species,
    level: 20,
    revision: 0,
    updatedAt: 1_700_000_000_000,
    combat: { currentHp, injuries: 0, conditions: [] },
    movelist: [],
  },
})

const residualHandler = (effectId: string): EncounterLifecycleTriggerHandler => ({
  id: 'handler.integration-residual',
  resolve: ({ event }) => {
    if (event.kind !== 'turn-end' || event.placementId !== 'actor-token') return []
    const operation: MoveDirectHpEffectOperation = {
      id: 'operation.integration-residual',
      kind: 'direct-hp',
      source: { kind: 'encounter-effect', id: effectId },
      recipients: { kind: 'selected-targets' },
      phase: 'cleanup',
      reasonCode: 'lifecycle.integration-residual',
      payload: {
        mode: 'lose',
        pool: 'hit-points',
        calculation: { kind: 'fixed', value: 7 },
        copySource: null,
        bounds: { minimum: null, maximum: null },
        rounding: 'floor',
        applyTypeImmunity: false,
        cost: null,
        injury: {
          hitPointMarkers: 'apply-after-operation',
          massiveDamage: 'never',
        },
      },
    }
    return [{
      effectId,
      reasonCode: 'lifecycle.integration-residual-trigger',
      operations: [operation],
      emittedEvents: [],
    }]
  },
})

describe('live-play initiative lifecycle integration', () => {
  it('commits map expiry, due sheet loss, terminal idempotency, and remote map state together', async () => {
    const effect = dueEffect()
    const harness = LivePlayIntegrationHarness.create({
      map: lifecycleMap(effect),
      sheets: [
        pokemonSheet('actor-mon', 'Pikachu', 30),
        pokemonSheet('target-mon', 'Eevee', 40),
      ],
      lifecycleHandlers: [residualHandler(effect.id)],
    })
    harnesses.push(harness)
    const remote = await harness.loadClient('remote-lifecycle-client')
    const command = harness.nextInitiativeCommand({
      opId: 'op_lifecycle_sqlite',
      baseRevision: 0,
      orderIds: ['actor-token', 'target-token'],
      activeId: 'actor-token',
      round: 1,
    })

    const first = await harness.nextInitiative({
      actor: { role: 'gm', clientId: 'gm-client' },
      command,
    })
    const duplicate = await harness.nextInitiative({
      actor: { role: 'gm', clientId: 'gm-client' },
      command,
    })

    expect(assertAccepted(first.result)).toMatchObject({ previousRevision: 0, revision: 1 })
    expect(duplicate.result).toEqual(first.result)
    expect(harness.operationRecordCount()).toBe(1)
    expect((await harness.readMap())?.encounterState?.effects).toEqual([])
    expect((await harness.readMap())?.initiative).toEqual({ activeId: 'target-token', round: 1 })
    expect(((await harness.readSheet('pokemon', 'target-mon'))?.sheet.combat as { currentHp: number }).currentHp).toBe(33)
    expect((await harness.readSheet('pokemon', 'target-mon'))?.revision).toBe(1)
    expect(remote.patchFailures).toEqual([])
    expect(remote.map?.encounterState?.effects).toEqual([])
    expect(remote.map?.initiative).toEqual({ activeId: 'target-token', round: 1 })
  })

  it('advances legacy global fields at a round boundary and never expires them twice on retry', async () => {
    const map: TabletopMap = {
      ...lifecycleMap(dueEffect()),
      fieldEffects: {
        weather: [{ kind: 'rainy', rounds: 1, source: 'Rain Dance' }],
        terrains: [],
        rooms: [],
      },
      initiative: { activeId: 'target-token', round: 1 },
      encounterState: createEmptyEncounterState(),
    }
    const harness = LivePlayIntegrationHarness.create({
      map,
      sheets: [
        pokemonSheet('actor-mon', 'Pikachu', 30),
        pokemonSheet('target-mon', 'Eevee', 40),
      ],
    })
    harnesses.push(harness)
    const remote = await harness.loadClient('remote-field-lifecycle-client')
    const command = harness.nextInitiativeCommand({
      opId: 'op_field_round_boundary',
      baseRevision: 0,
      orderIds: ['actor-token', 'target-token'],
      activeId: 'target-token',
      round: 1,
    })

    const first = await harness.nextInitiative({
      actor: { role: 'gm', clientId: 'gm-client' },
      command,
    })
    const duplicate = await harness.nextInitiative({
      actor: { role: 'gm', clientId: 'gm-client' },
      command,
    })

    const accepted = assertAccepted(first.result)
    expect(accepted).toMatchObject({ previousRevision: 0, revision: 1 })
    expect(duplicate.result).toEqual(first.result)
    expect(harness.operationRecordCount()).toBe(1)
    expect((await harness.readMap())?.initiative).toEqual({ activeId: 'actor-token', round: 2 })
    expect((await harness.readMap())?.fieldEffects).toEqual({
      weather: [],
      terrains: [],
      rooms: [],
    })
    expect((await harness.readMap())?.encounterState?.zones).toEqual([])
    const lifecycle = accepted.patches.find(patch => patch.type === 'map.initiative')?.payload as {
      lifecycle?: { fieldTransitions?: Array<{ kind: string; reasonCode: string }> }
    }
    expect(lifecycle.lifecycle?.fieldTransitions).toEqual([{
      eventId: expect.any(String),
      zoneId: 'legacy.weather.rainy',
      kind: 'expired',
      reasonCode: 'field-duration-expired',
    }])
    expect(remote.patchFailures).toEqual([])
    expect(remote.map?.fieldEffects).toEqual({ weather: [], terrains: [], rooms: [] })
    expect(remote.map?.encounterState?.zones).toEqual([])
  })
})
