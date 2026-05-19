import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  appendAbilityAutomationLogEntry,
  useAbilityAutomationPanel,
} from '~/composables/map-editor/useAbilityAutomationPanel'
import type { AbilityAutomationTransaction } from '~/types/abilityAutomation'
import type { CharacterSheet } from '~/types/characterSheet'
import type { CombatStageMap } from '~/types/combatStages'
import type { TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'

const stages = (overrides: Partial<CombatStageMap> = {}): CombatStageMap => ({
  atk: 0,
  def: 0,
  satk: 0,
  sdef: 0,
  spd: 0,
  acc: 0,
  ...overrides,
})

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'ability-test',
  name: 'Ability Test',
  dimensions: { x: 5, y: 2, z: 5 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  placements: [
    { id: 'user-token', sheetKind: 'pokemon', sheetSlug: 'bolt', position: { x: 0, y: 0, z: 0 } },
    { id: 'target-token', sheetKind: 'pokemon', sheetSlug: 'target', position: { x: 2, y: 0, z: 0 } },
  ],
})

const spawned = (id: string, overrides: Partial<SpawnedPokemon> = {}): SpawnedPokemon => ({
  species: id,
  slug: id,
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: `/${id}.png`,
  entityKind: 'pokemon',
  id,
  position: { x: 0, y: 0, z: 0 },
  sheetKind: 'pokemon',
  sheetSlug: id,
  level: 5,
  currentHp: 10,
  maxHp: 20,
  atk: 5,
  satk: 5,
  def: 5,
  sdef: 5,
  defenderTypes: [],
  combatStages: stages(),
  conditions: [],
  tokenItems: [],
  ...overrides,
})

const transaction = (): AbilityAutomationTransaction => ({
  userId: 'user-token',
  userName: 'User',
  abilityName: 'Intimidate',
  category: 'map',
  combatStageUpdates: [{ id: 'target-token', stages: stages({ atk: -1 }) }],
  conditionUpdates: [],
  logLines: ['Used Intimidate.'],
})

describe('useAbilityAutomationPanel', () => {
  it('builds token ability menu options and activates sheet abilities', async () => {
    const map = ref(mapFixture())
    const calls: string[] = []
    const pokemonSheet = {
      slug: 'bolt',
      nickname: 'Bolt',
      species: 'Sandile',
      level: 5,
      abilities: [{ name: 'Sand Veil' }, { name: 'Intimidate' }],
    } as CharacterSheet
    const panel = useAbilityAutomationPanel({
      map,
      spawnedPokemon: computed(() => [spawned('user-token'), spawned('target-token')]),
      pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canControlPlacement: (id) => id === 'user-token',
      modifyCombatStages: (update) => { calls.push(`stages:${update.id}:${update.stages.atk}`) },
      modifyConditions: () => undefined,
      modifyAbilityActivation: (update) => { calls.push(`ability:${update.id}:${update.abilityName}:${update.activated}`) },
      now: () => 123,
    })

    expect(panel.tokenAbilityOptionsById.value['user-token'].map((ability) => [ability.name, ability.automation?.category])).toEqual([
      ['Sand Veil', 'sheet'],
      ['Intimidate', 'map'],
    ])

    await panel.openAbilityAutomation({ id: 'user-token', abilityName: 'Sand Veil' })

    expect(calls).toEqual(['ability:user-token:Sand Veil:true'])
    expect(map.value.metadata?.abilityLog).toMatchObject([
      { at: 123, userId: 'user-token', abilityName: 'Sand Veil', category: 'sheet' },
    ])
  })

  it('does not treat passive ability automation as a manual use action', async () => {
    const map = ref(mapFixture())
    const calls: string[] = []
    const pokemonSheet = {
      slug: 'bolt',
      nickname: 'Bolt',
      species: 'Jolteon',
      level: 5,
      abilities: [{ name: 'Quick Feet' }],
    } as CharacterSheet
    const panel = useAbilityAutomationPanel({
      map,
      spawnedPokemon: computed(() => [spawned('user-token', { conditions: ['Paralysis'] })]),
      pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canControlPlacement: (id) => id === 'user-token',
      modifyCombatStages: (update) => { calls.push(`stages:${update.id}:${update.stages.spd}`) },
      modifyConditions: () => undefined,
      modifyAbilityActivation: (update) => { calls.push(`ability:${update.id}:${update.abilityName}:${update.activated}`) },
      now: () => 111,
    })

    expect(panel.tokenAbilityOptionsById.value['user-token']).toMatchObject([
      { name: 'Quick Feet', automation: { category: 'passive', label: 'Auto' } },
    ])

    await panel.openAbilityAutomation({ id: 'user-token', abilityName: 'Quick Feet' })

    expect(calls).toEqual([])
    expect(map.value.metadata?.abilityLog).toBeUndefined()
  })

  it('applies self map abilities immediately', async () => {
    const map = ref(mapFixture())
    const calls: string[] = []
    const pokemonSheet = {
      slug: 'bolt',
      nickname: 'Bolt',
      species: 'Sandile',
      level: 5,
      abilities: [{ name: 'Moxie' }],
    } as CharacterSheet
    const panel = useAbilityAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned('user-token', { species: 'Sandile', combatStages: stages({ atk: 2 }) }),
        spawned('target-token'),
      ]),
      pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canControlPlacement: (id) => id === 'user-token',
      modifyCombatStages: (update) => { calls.push(`stages:${update.id}:${update.stages.atk}`) },
      modifyConditions: () => undefined,
      modifyAbilityActivation: () => undefined,
      now: () => 321,
    })

    await panel.openAbilityAutomation({ id: 'user-token', abilityName: 'Moxie' })

    expect(panel.abilityAutomationTargeting.value).toBeNull()
    expect(calls).toEqual(['stages:user-token:3'])
    expect(map.value.metadata?.abilityLog).toMatchObject([
      { at: 321, userId: 'user-token', abilityName: 'Moxie', category: 'map' },
    ])
  })

  it('targets map abilities and applies their sheet updates to targets', async () => {
    const map = ref(mapFixture())
    const calls: string[] = []
    const pokemonSheet = {
      slug: 'bolt',
      nickname: 'Bolt',
      species: 'Sandile',
      level: 5,
      abilities: [{ name: 'Intimidate' }],
    } as CharacterSheet
    const panel = useAbilityAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned('user-token'),
        spawned('target-token', { combatStages: stages({ atk: 2 }) }),
      ]),
      pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canControlPlacement: (id) => id === 'user-token',
      modifyCombatStages: (update) => { calls.push(`stages:${update.id}:${update.stages.atk}`) },
      modifyConditions: () => undefined,
      modifyAbilityActivation: () => undefined,
      now: () => 456,
    })

    await panel.openAbilityAutomation({ id: 'user-token', abilityName: 'Intimidate' })
    expect(panel.abilityAutomationTargeting.value).toMatchObject({
      userId: 'user-token',
      moveName: 'Intimidate',
      candidateIds: ['target-token'],
    })

    await panel.selectAbilityAutomationTarget('target-token')

    expect(calls).toEqual(['stages:target-token:1'])
    expect(panel.abilityAutomationTargeting.value).toBeNull()
    expect(map.value.metadata?.abilityLog).toMatchObject([
      { at: 456, userId: 'user-token', abilityName: 'Intimidate', category: 'map' },
    ])
  })

  it('applies target condition updates from map abilities', async () => {
    const map = ref(mapFixture())
    const calls: string[] = []
    const pokemonSheet = {
      slug: 'bolt',
      nickname: 'Bolt',
      species: 'Audino',
      level: 5,
      abilities: [{ name: 'Healer' }],
    } as CharacterSheet
    const panel = useAbilityAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned('user-token', { species: 'Audino' }),
        spawned('target-token', { conditions: ['Burned', 'Confused', 'Vulnerable'] }),
      ]),
      pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canControlPlacement: (id) => id === 'user-token',
      modifyCombatStages: () => undefined,
      modifyConditions: (update) => { calls.push(`conditions:${update.id}:${update.conditions.join(',')}`) },
      modifyAbilityActivation: () => undefined,
      now: () => 789,
    })

    await panel.openAbilityAutomation({ id: 'user-token', abilityName: 'Healer' })
    await panel.selectAbilityAutomationTarget('target-token')

    expect(calls).toEqual(['conditions:target-token:Vulnerable'])
    expect(map.value.metadata?.abilityLog).toMatchObject([
      { at: 789, userId: 'user-token', abilityName: 'Healer', category: 'map' },
    ])
  })

  it('keeps only the configured number of ability log entries', () => {
    const previous = { abilityLog: [{ abilityName: 'Old 1' }, { abilityName: 'Old 2' }] }
    const next = appendAbilityAutomationLogEntry(previous, transaction(), {
      now: () => 1,
      maxLogEntries: 2,
    })

    expect(next.abilityLog).toMatchObject([
      { abilityName: 'Old 2' },
      { abilityName: 'Intimidate' },
    ])
  })
})
