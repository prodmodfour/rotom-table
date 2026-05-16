import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useInitiativeTracker } from '~/composables/map-editor/useInitiativeTracker'
import type { CharacterSheet } from '~/types/characterSheet'
import type { CombatStageMap } from '~/types/combatStages'
import type { TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'

const stages: CombatStageMap = { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 }

const sheet = (slug: string, overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug,
  nickname: slug,
  species: 'Pikachu',
  level: 10,
  combat: { currentHp: 30, conditions: [] },
  stats: {},
  ...overrides,
})

const token = (overrides: Partial<SpawnedPokemon> & Pick<SpawnedPokemon, 'id' | 'sheetSlug' | 'species'>): SpawnedPokemon => ({
  slug: overrides.sheetSlug,
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: '/sprite.png',
  entityKind: 'pokemon',
  position: { x: 0, y: 0, z: 0 },
  sheetKind: 'pokemon',
  level: 10,
  currentHp: 30,
  maxHp: 30,
  atk: 5,
  satk: 5,
  def: 5,
  sdef: 5,
  spd: 30,
  evasion: { physical: 0, special: 0, speed: 0 },
  defenderTypes: ['Electric'],
  combatStages: stages,
  conditions: [],
  tokenItems: [],
  ...overrides,
})

const mapWithPlacements = (placements: TabletopMap['placements']): TabletopMap => ({
  schemaVersion: 2,
  slug: 'test-map',
  name: 'Test Map',
  dimensions: { x: 10, y: 4, z: 10 },
  voxels: [],
  placements,
  initiative: { activeId: null, round: 1 },
})

const inputEvent = (value: string): Event => ({ target: { value } } as unknown as Event)

describe('useInitiativeTracker', () => {
  it('applies Paralysis after manually entered initiative for final ordering', () => {
    const map = ref<TabletopMap | null>(mapWithPlacements([
      { id: 'paralyzed', sheetKind: 'pokemon', sheetSlug: 'paralyzed', position: { x: 0, y: 0, z: 0 }, initiative: 40 },
      { id: 'normal', sheetKind: 'pokemon', sheetSlug: 'normal', position: { x: 1, y: 0, z: 0 }, initiative: 25 },
    ]))
    const spawned = computed(() => [
      token({ id: 'paralyzed', sheetSlug: 'paralyzed', species: 'Paralyzed', conditions: ['Paralysis'] }),
      token({ id: 'normal', sheetSlug: 'normal', species: 'Normal' }),
    ])
    const tracker = useInitiativeTracker({
      map,
      spawnedPokemon: spawned,
      pokemonBySlug: ref(new Map([['paralyzed', sheet('paralyzed')], ['normal', sheet('normal')]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canManageInitiative: computed(() => true),
    })

    expect(tracker.initiativeRows.value.find((row) => row.id === 'paralyzed')).toMatchObject({
      initiative: 40,
      initiativeScore: 20,
    })
    expect(tracker.sortedInitiativeRows.value.map((row) => row.id)).toEqual(['normal', 'paralyzed'])
  })

  it('does not halve paralyzed Quick Feet users in initiative order', () => {
    const map = ref<TabletopMap | null>(mapWithPlacements([
      { id: 'quick-feet', sheetKind: 'pokemon', sheetSlug: 'quick-feet', position: { x: 0, y: 0, z: 0 }, initiative: 40 },
    ]))
    const tracker = useInitiativeTracker({
      map,
      spawnedPokemon: computed(() => [
        token({
          id: 'quick-feet',
          sheetSlug: 'quick-feet',
          species: 'Quick Feet',
          conditions: ['Paralysis'],
          abilityNames: ['Quick Feet'],
        }),
      ]),
      pokemonBySlug: ref(new Map([['quick-feet', sheet('quick-feet')]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canManageInitiative: computed(() => true),
    })

    expect(tracker.initiativeRows.value[0]).toMatchObject({
      initiative: 40,
      initiativeScore: 40,
    })
  })

  it('stores Speed as the base initiative and applies conditions afterward', () => {
    const map = ref<TabletopMap | null>(mapWithPlacements([
      { id: 'paralyzed', sheetKind: 'pokemon', sheetSlug: 'paralyzed', position: { x: 0, y: 0, z: 0 } },
    ]))
    const tracker = useInitiativeTracker({
      map,
      spawnedPokemon: computed(() => [
        token({ id: 'paralyzed', sheetSlug: 'paralyzed', species: 'Paralyzed', conditions: ['Paralysis'] }),
      ]),
      pokemonBySlug: ref(new Map([['paralyzed', sheet('paralyzed')]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canManageInitiative: computed(() => true),
    })

    const speed = tracker.initiativeRows.value[0].speed
    tracker.fillInitiativeFromSpeed()

    expect(map.value?.placements[0].initiative).toBe(speed)
    expect(tracker.initiativeRows.value[0]).toMatchObject({
      initiative: speed,
      initiativeScore: Math.floor(speed / 2),
    })

    tracker.setInitiativeInput('paralyzed', inputEvent('41'))

    expect(map.value?.placements[0].initiative).toBe(41)
    expect(tracker.initiativeRows.value[0].initiativeScore).toBe(20)
  })

  it('includes Quick Claw in default initiative values from sheets', () => {
    const map = ref<TabletopMap | null>(mapWithPlacements([
      { id: 'quick', sheetKind: 'pokemon', sheetSlug: 'quick', position: { x: 0, y: 0, z: 0 } },
    ]))
    const tracker = useInitiativeTracker({
      map,
      spawnedPokemon: computed(() => [
        token({ id: 'quick', sheetSlug: 'quick', species: 'Quick', conditions: ['Paralysis'] }),
      ]),
      pokemonBySlug: ref(new Map([['quick', sheet('quick', { items: { held: 'Quick Claw' } })]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canManageInitiative: computed(() => true),
    })

    const row = tracker.initiativeRows.value[0]

    expect(row.initiativeItemBonus).toBe(10)
    expect(row.baseInitiative).toBe(row.speed + 10)
    expect(row.initiativeScore).toBe(Math.floor((row.speed + 10) / 2))

    tracker.fillInitiativeFromSpeed()

    expect(map.value?.placements[0].initiative).toBe(row.baseInitiative)
  })
})
