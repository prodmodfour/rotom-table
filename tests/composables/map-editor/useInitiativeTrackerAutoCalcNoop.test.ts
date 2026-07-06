import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useInitiativeTracker } from '~/composables/map-editor/useInitiativeTracker'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
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

const flushPendingPromises = async (turns = 5) => {
  for (let i = 0; i < turns; i += 1) await Promise.resolve()
}

describe('useInitiativeTracker live-play auto-calc no-op handling', () => {
  it('does not dispatch live-play auto-calc commands when initiatives and manual order are already current', async () => {
    const map = ref<TabletopMap | null>(mapWithPlacements([
      { id: 'a', sheetKind: 'pokemon', sheetSlug: 'a', position: { x: 0, y: 0, z: 0 } },
      { id: 'b', sheetKind: 'pokemon', sheetSlug: 'b', position: { x: 1, y: 0, z: 0 } },
    ]))
    const dispatchSetInitiative = vi.fn(async () => undefined)
    const tracker = useInitiativeTracker({
      map,
      spawnedPokemon: computed(() => [
        token({ id: 'a', sheetSlug: 'a', species: 'A' }),
        token({ id: 'b', sheetSlug: 'b', species: 'B' }),
      ]),
      pokemonBySlug: ref(new Map([['a', sheet('a')], ['b', sheet('b')]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canManageInitiative: computed(() => true),
      interactionMode: computed(() => MAP_INTERACTION_MODES.LIVE_PLAY),
      dispatchSetInitiative,
    })

    for (const row of tracker.initiativeRows.value) {
      const placement = map.value?.placements.find((candidate) => candidate.id === row.id)
      if (placement) placement.initiative = row.baseInitiative
    }

    tracker.fillInitiativeFromSpeed()
    await flushPendingPromises()

    expect(dispatchSetInitiative).not.toHaveBeenCalled()
  })
})
