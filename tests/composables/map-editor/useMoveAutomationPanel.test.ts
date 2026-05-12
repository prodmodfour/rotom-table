import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  appendMoveAutomationLogEntry,
  useMoveAutomationPanel,
} from '~/composables/map-editor/useMoveAutomationPanel'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { MoveAutomationTransaction } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'move-test',
  name: 'Move Test',
  dimensions: { x: 5, y: 2, z: 5 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    { id: 'user-token', sheetKind: 'pokemon', sheetSlug: 'bolt', position: { x: 0, y: 0, z: 0 } },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
})

const spawned = (): SpawnedPokemon => ({
  species: 'Bolt',
  slug: 'bulbasaur',
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: '/sprites/bulbasaur.png',
  entityKind: 'pokemon',
  id: 'user-token',
  position: { x: 0, y: 0, z: 0 },
  sheetKind: 'pokemon',
  sheetSlug: 'bolt',
  level: 5,
  currentHp: 10,
  maxHp: 20,
  atk: 5,
  satk: 5,
  def: 5,
  sdef: 5,
  defenderTypes: ['Grass'],
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  conditions: [],
  tokenItems: [],
})

const transaction = (): MoveAutomationTransaction => ({
  userId: 'user-token',
  userName: 'Bolt',
  moveName: 'Tackle',
  scriptKind: 'manual-fallback',
  scriptVersion: 1,
  hpUpdates: [{ id: 'target-token', currentHp: 7 }],
  combatStageUpdates: [{ id: 'target-token', stages: { atk: 1, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 } }],
  conditionUpdates: [{ id: 'target-token', conditions: ['Burned'] }],
  hazardsToAdd: [{ kind: 'spikes', x: 1, y: 0, z: 1 }],
  fieldEffectsToApply: [{ kind: 'weather', value: 'rainy', source: 'Tackle' }],
  logLines: ['Rolled Tackle.'],
})

describe('useMoveAutomationPanel', () => {
  it('derives the active user and move list from the selected placement', () => {
    const map = ref(mapFixture())
    const pokemonSheet = {
      slug: 'bolt',
      nickname: 'Bolt',
      species: 'Bulbasaur',
      level: 5,
      movelist: [{ name: 'Tackle' }],
    } as CharacterSheet
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [spawned()]),
      pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: () => undefined,
      modifyCombatStages: () => undefined,
      modifyConditions: () => undefined,
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
    })

    panel.openMoveAutomation('blocked-token')
    expect(panel.moveAutomationUser.value).toBeNull()

    panel.openMoveAutomation({ id: 'user-token', moveName: 'Tackle' })
    expect(panel.moveAutomationUser.value?.id).toBe('user-token')
    expect(panel.moveAutomationInitialMoveName.value).toBe('Tackle')
    expect(panel.moveAutomationMoves.value.map((move) => move.name)).toEqual(['Tackle', 'Struggle'])
    expect(panel.tokenMoveOptionsById.value['user-token'].map((move) => move.name)).toEqual(['Tackle', 'Struggle'])
  })

  it('applies sheet updates, gates map effects by GM permission, and appends logs', async () => {
    const map = ref(mapFixture())
    const calls: string[] = []
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [spawned()]),
      pokemonBySlug: ref(new Map<string, CharacterSheet>()),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: (update) => { calls.push(`hp:${update.id}:${update.currentHp}`) },
      modifyCombatStages: (update) => { calls.push(`stages:${update.id}:${update.stages.atk}`) },
      modifyConditions: (update) => { calls.push(`conditions:${update.id}:${update.conditions.join(',')}`) },
      applyMoveFieldEffect: (effect) => { calls.push(`effect:${effect.kind}:${effect.value}`) },
      placeHazard: (hazard) => { calls.push(`hazard:${hazard.kind}`) },
      now: () => 1234,
    })

    await panel.applyMoveAutomation(transaction())

    expect(calls).toEqual([
      'hp:target-token:7',
      'stages:target-token:1',
      'conditions:target-token:Burned',
    ])
    expect(map.value.metadata?.moveLog).toMatchObject([
      { at: 1234, userId: 'user-token', moveName: 'Tackle', lines: ['Rolled Tackle.'] },
    ])
  })

  it('applies map effects when map editing is allowed', async () => {
    const map = ref(mapFixture())
    const calls: string[] = []
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [spawned()]),
      pokemonBySlug: ref(new Map<string, CharacterSheet>()),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => true),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: () => undefined,
      modifyCombatStages: () => undefined,
      modifyConditions: () => undefined,
      applyMoveFieldEffect: (effect) => { calls.push(`effect:${effect.kind}:${effect.value}`) },
      placeHazard: (hazard) => { calls.push(`hazard:${hazard.kind}`) },
    })

    await panel.applyMoveAutomation(transaction())

    expect(calls).toEqual(['effect:weather:rainy', 'hazard:spikes'])
  })

  it('keeps only the configured number of move log entries', () => {
    const previous = { moveLog: [{ moveName: 'Old 1' }, { moveName: 'Old 2' }] }
    const next = appendMoveAutomationLogEntry(previous, transaction(), {
      now: () => 1,
      maxLogEntries: 2,
    })

    expect(next.moveLog).toMatchObject([
      { moveName: 'Old 2' },
      { moveName: 'Tackle' },
    ])
  })
})
