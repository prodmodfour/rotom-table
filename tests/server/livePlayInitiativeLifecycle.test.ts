import { afterEach, describe, expect, it } from 'vitest'
import {
  parseEncounterEffect,
  type EncounterEffect,
} from '#shared/moveAutomation/encounterEffects'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { MoveDirectHpEffectOperation } from '#shared/moveAutomation/effects'
import type { EncounterLifecycleTriggerHandler } from '~~/server/domain/moveAutomation/reduceLifecycle'
import type { PersistedSheet } from '~~/server/storage/sheetRepository'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { pokemonHpSnapshot } from '~/utils/sheetSpawn'
import { LivePlayIntegrationHarness, assertAccepted } from './livePlayIntegrationHarness'
import {
  applyItemFormChangeCandidate,
  resolveItemFormChangeCandidate,
} from '../../server/domain/itemAutomation/formChanges'
import {
  FORM_CHANGE_POKEMON_PLACEMENT_ID,
  FORM_CHANGE_TRAINER_PLACEMENT_ID,
  createFormChangeMap,
  createFormChangePokemon,
  createFormChangeTrainer,
} from '../fixtures/itemFormChanges'

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
  overrides: Record<string, unknown> = {},
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
    ...overrides,
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
  it('uses an active reviewed Mega form Speed delta when initiative has no explicit override', async () => {
    const pokemon = createFormChangePokemon('mega-mewtwo-y', {
      species: 'Mewtwo', types: ['Psychic'], abilities: [{ name: 'Pressure' }],
      equipmentState: createFormChangePokemon('mega-mewtwo-y', { species: 'Mewtwo' }).equipmentState,
    })
    const trainer = createFormChangeTrainer()
    const base = createFormChangeMap({
      slug: 'integration-arena',
      placements: createFormChangeMap().placements.map((placement) => {
        const copy = { ...placement }
        delete copy.initiative
        return copy
      }),
      initiative: { activeId: FORM_CHANGE_POKEMON_PLACEMENT_ID, round: 2 },
    })
    const candidate = resolveItemFormChangeCandidate({
      map: base,
      actorPlacementId: FORM_CHANGE_POKEMON_PLACEMENT_ID,
      targetPlacementId: FORM_CHANGE_POKEMON_PLACEMENT_ID,
      sheets: {
        pokemon: new Map([[pokemon.slug, pokemon]]),
        trainer: new Map([[trainer.slug, trainer]]),
      },
    })
    const rival = {
      ...pokemon,
      slug: 'mega-rival',
      nickname: 'A Rival',
      equipmentState: undefined,
    }
    const activeMap = applyItemFormChangeCandidate({
      map: base, candidate, operationId: 'operation-mega-initiative', acceptedAt: 5_200,
    })
    activeMap.placements.push({
      id: 'mega-rival-token', sheetKind: 'pokemon', sheetSlug: rival.slug,
      position: { x: 4, y: 0, z: 2 }, sideId: 'heroes',
    })
    const harness = LivePlayIntegrationHarness.create({
      map: activeMap,
      sheets: [{
        kind: 'pokemon', slug: pokemon.slug, revision: pokemon.revision ?? 0,
        updatedAt: 5_100, sheet: pokemon,
      }, {
        kind: 'pokemon', slug: rival.slug, revision: rival.revision ?? 0,
        updatedAt: 5_100, sheet: rival,
      }, {
        kind: 'trainer', slug: trainer.slug, revision: trainer.revision ?? 0,
        updatedAt: 5_100, sheet: trainer,
      }],
    })
    harnesses.push(harness)
    const result = await harness.nextInitiative({
      actor: { role: 'gm', clientId: 'gm-client' },
      command: harness.nextInitiativeCommand({
        opId: 'op_mega_initiative_speed', baseRevision: 7,
        orderIds: [FORM_CHANGE_POKEMON_PLACEMENT_ID, 'mega-rival-token', FORM_CHANGE_TRAINER_PLACEMENT_ID],
        activeId: FORM_CHANGE_POKEMON_PLACEMENT_ID, round: 2,
      }),
    })
    expect(assertAccepted(result.result)).toMatchObject({ previousRevision: 7, revision: 8 })
    expect(result.map.initiative?.activeId).toBe('mega-rival-token')
  })

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

  it('ticks built-in Hail residuals and duration atomically once across duplicate initiative', async () => {
    const map: TabletopMap = {
      ...lifecycleMap(dueEffect()),
      fieldEffects: {
        weather: [{ kind: 'hail', rounds: 1, source: 'Hail' }],
        terrains: [],
        rooms: [],
      },
      initiative: { activeId: 'target-token', round: 1 },
      encounterState: createEmptyEncounterState(),
    }
    const vulnerable = pokemonSheet('actor-mon', 'Pikachu', 30)
    const immune = pokemonSheet('target-mon', 'Eevee', 40, { types: ['Ice'] })
    const tick = Math.floor(
      pokemonHpSnapshot(vulnerable.sheet as unknown as CharacterSheet).fullMaxHp * 0.1,
    )
    const harness = LivePlayIntegrationHarness.create({
      map,
      sheets: [vulnerable, immune],
    })
    harnesses.push(harness)
    const remote = await harness.loadClient('remote-hail-lifecycle-client')
    const command = harness.nextInitiativeCommand({
      opId: 'op_hail_round_boundary',
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
    expect(duplicate.result).toEqual(first.result)
    expect(harness.operationRecordCount()).toBe(1)
    expect((await harness.readMap())?.initiative).toEqual({ activeId: 'actor-token', round: 2 })
    expect((await harness.readMap())?.fieldEffects?.weather).toEqual([])
    expect(((await harness.readSheet('pokemon', 'actor-mon'))?.sheet.combat as {
      currentHp: number
    }).currentHp).toBe(30 - tick)
    expect(((await harness.readSheet('pokemon', 'target-mon'))?.sheet.combat as {
      currentHp: number
    }).currentHp).toBe(40)
    expect((await harness.readSheet('pokemon', 'actor-mon'))?.revision).toBe(1)
    expect((await harness.readSheet('pokemon', 'target-mon'))?.revision).toBe(0)
    const lifecycle = accepted.patches.find(patch => patch.type === 'map.initiative')?.payload as {
      lifecycle?: {
        operationIds?: string[]
        fieldTransitions?: Array<{ kind: string; reasonCode: string }>
      }
    }
    expect(lifecycle.lifecycle?.operationIds).toEqual([
      expect.stringMatching(/^weather\.residual\.hail\.[0-9a-f]{32}$/),
    ])
    expect(lifecycle.lifecycle?.fieldTransitions).toEqual([{
      eventId: expect.any(String),
      zoneId: 'legacy.weather.hail',
      kind: 'expired',
      reasonCode: 'field-duration-expired',
    }])
    expect(remote.patchFailures).toEqual([])
    expect(remote.map?.fieldEffects?.weather).toEqual([])
  })

  it('heals a grounded Grassy Terrain member once across duplicate initiative delivery', async () => {
    const map: TabletopMap = {
      ...lifecycleMap(dueEffect()),
      fieldEffects: {
        weather: [],
        terrains: [{ kind: 'grassy', rounds: 3, scope: 'field', source: 'Grassy Terrain' }],
        rooms: [],
      },
      initiative: { activeId: 'actor-token', round: 1 },
      encounterState: createEmptyEncounterState(),
    }
    const actor = pokemonSheet('actor-mon', 'Pikachu', 30)
    const target = pokemonSheet('target-mon', 'Eevee', 20)
    const tick = Math.floor(
      pokemonHpSnapshot(target.sheet as unknown as CharacterSheet).fullMaxHp * 0.1,
    )
    const harness = LivePlayIntegrationHarness.create({ map, sheets: [actor, target] })
    harnesses.push(harness)
    const remote = await harness.loadClient('remote-grassy-lifecycle-client')
    const command = harness.nextInitiativeCommand({
      opId: 'op_grassy_turn_start',
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

    const accepted = assertAccepted(first.result)
    expect(duplicate.result).toEqual(first.result)
    expect(harness.operationRecordCount()).toBe(1)
    expect((await harness.readMap())?.initiative).toEqual({ activeId: 'target-token', round: 1 })
    expect((await harness.readMap())?.fieldEffects?.terrains).toEqual([
      { kind: 'grassy', rounds: 3, scope: 'field', source: 'Grassy Terrain' },
    ])
    expect(((await harness.readSheet('pokemon', 'target-mon'))?.sheet.combat as {
      currentHp: number
    }).currentHp).toBe(20 + tick)
    expect((await harness.readSheet('pokemon', 'target-mon'))?.revision).toBe(1)
    expect((await harness.readSheet('pokemon', 'actor-mon'))?.revision).toBe(0)
    const lifecycle = accepted.patches.find(patch => patch.type === 'map.initiative')?.payload as {
      lifecycle?: { operationIds?: string[] }
    }
    expect(lifecycle.lifecycle?.operationIds).toEqual([
      expect.stringMatching(/^terrain\.grassy\.healing\.[0-9a-f]{32}$/),
    ])
    expect(remote.patchFailures).toEqual([])
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
