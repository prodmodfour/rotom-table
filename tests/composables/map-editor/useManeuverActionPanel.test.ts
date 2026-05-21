import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useManeuverActionPanel } from '~/composables/map-editor/useManeuverActionPanel'
import type { TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'

const token = (overrides: Partial<SpawnedPokemon>): SpawnedPokemon => ({
  id: 'token',
  species: 'Token',
  slug: 'token',
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: '/token.png',
  entityKind: 'pokemon',
  sheetKind: 'pokemon',
  sheetSlug: 'token',
  position: { x: 0, y: 0, z: 0 },
  level: 1,
  currentHp: 10,
  maxHp: 10,
  atk: 1,
  satk: 1,
  def: 1,
  sdef: 1,
  defenderTypes: [],
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  conditions: [],
  tokenItems: [],
  ...overrides,
} as SpawnedPokemon)

const mapDoc = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'map',
  name: 'Map',
  dimensions: { x: 10, y: 3, z: 10 },
  voxels: [],
  placements: [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', position: { x: 0, y: 0, z: 0 } },
    { id: 'adjacent', sheetKind: 'pokemon', sheetSlug: 'adjacent', position: { x: 1, y: 0, z: 0 } },
    { id: 'far', sheetKind: 'pokemon', sheetSlug: 'far', position: { x: 4, y: 0, z: 0 } },
  ],
})

describe('useManeuverActionPanel', () => {
  it('targets in-range maneuver recipients and logs the selected target', () => {
    const map = ref(mapDoc())
    const events: string[] = []
    const panel = useManeuverActionPanel({
      map,
      spawnedPokemon: computed(() => [
        token({ id: 'actor', species: 'Pike', sheetSlug: 'actor' }),
        token({ id: 'adjacent', species: 'Doug', sheetSlug: 'adjacent', position: { x: 1, y: 0, z: 0 } }),
        token({ id: 'far', species: 'Farfetch', sheetSlug: 'far', position: { x: 4, y: 0, z: 0 } }),
      ]),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canControlPlacement: (id) => id === 'actor',
      onBeforeManeuverAction: ({ maneuverName }) => events.push(maneuverName),
      now: () => 100,
    })

    expect(panel.tokenManeuverOptionsById.value.actor?.map((maneuver) => maneuver.name)).toContain('Trip')
    expect(panel.useManeuver({ id: 'actor', maneuverName: 'Trip' })).toBe(true)
    expect(panel.maneuverActionTargeting.value).toMatchObject({
      moveName: 'Trip',
      rangeLabel: 'Melee, 1 Target',
      candidateIds: ['adjacent'],
      targetPrompt: 'Choose a target for Trip (Melee, 1 Target).',
    })

    expect(panel.selectManeuverActionTarget('adjacent')).toBe(true)
    expect(events).toEqual(['Trip'])
    expect(map.value.metadata?.maneuverLog).toMatchObject([
      {
        maneuverName: 'Trip',
        lines: expect.arrayContaining([
          'Pike used Trip.',
          'Target: Doug',
          'Action: Standard',
          'AC: 6',
        ]),
      },
    ])
  })

  it('logs untargeted maneuvers immediately', () => {
    const map = ref(mapDoc())
    const panel = useManeuverActionPanel({
      map,
      spawnedPokemon: computed(() => [token({ id: 'actor', species: 'Pike', sheetSlug: 'actor' })]),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canControlPlacement: () => true,
      now: () => 100,
    })

    expect(panel.useManeuver({ id: 'actor', maneuverName: 'Sprint' })).toBe(true)
    expect(panel.maneuverActionTargeting.value).toBeNull()
    expect(map.value.metadata?.maneuverLog).toMatchObject([
      { maneuverName: 'Sprint', lines: expect.arrayContaining(['Pike used Sprint.']) },
    ])
  })
})
