import { computed, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePokeballCapturePanel } from '~/composables/map-editor/usePokeballCapturePanel'
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
  spd: 1,
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
    { id: 'trainer', sheetKind: 'trainer', sheetSlug: 'lenora', position: { x: 0, y: 0, z: 0 } },
    { id: 'pidgey', sheetKind: 'pokemon', sheetSlug: 'pidgey', position: { x: 1, y: 0, z: 0 } },
  ],
  initiative: { activeId: 'trainer', round: 1 },
})

const trainerSheet = (): TrainerSheet => ({
  slug: 'lenora',
  name: 'Lenora',
  level: 1,
  currentTeam: [],
  boxedPokemon: [],
  inventory: {
    pokeBalls: [{ name: 'Basic Ball', qty: 2 }],
  },
})

const buildPanel = (applyCaptureOutcome = vi.fn()) => {
  const trainer = trainerSheet()
  const panel = usePokeballCapturePanel({
    map: ref(mapDoc()),
    spawnedPokemon: computed(() => [
      token({ id: 'trainer', species: 'Lenora', entityKind: 'trainer', sheetKind: 'trainer', sheetSlug: 'lenora' }),
      token({ id: 'pidgey', species: 'Pidgey', sheetSlug: 'pidgey', position: { x: 1, y: 0, z: 0 } }),
    ]),
    pokemonBySlug: ref(new Map()),
    trainerBySlug: ref(new Map([[trainer.slug, trainer]])),
    canControlPlacement: (id) => id === 'trainer',
    applyCaptureOutcome,
    now: () => 100,
  })

  return { panel, applyCaptureOutcome }
}

describe('usePokeballCapturePanel', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not expose a capture portrait result modal when the Poké Ball misses', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const { panel, applyCaptureOutcome } = buildPanel()

    panel.openPokeballCapture({ id: 'trainer', pokeballName: 'Basic Ball' })
    expect(panel.pokeballCaptureTargeting.value?.candidateIds).toEqual(['pidgey'])

    panel.selectPokeballCaptureTarget('pidgey')

    expect(panel.pokeballCaptureResult.value).toBeNull()
    expect(panel.pokeballCaptureError.value).toBe('The Poké Ball missed.')
    expect(applyCaptureOutcome).toHaveBeenCalledWith(expect.objectContaining({
      trainerId: 'trainer',
      targetId: 'pidgey',
      pokeballName: 'Basic Ball',
      result: expect.objectContaining({ hit: false, failureReason: 'The Poké Ball missed.' }),
    }))
  })

  it('exposes the capture result modal once the Poké Ball hits', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0)
    const { panel } = buildPanel()

    panel.openPokeballCapture({ id: 'trainer', pokeballName: 'Basic Ball' })
    panel.selectPokeballCaptureTarget('pidgey')

    expect(panel.pokeballCaptureResult.value).toMatchObject({
      hit: true,
      success: true,
      targetName: 'Pidgey',
      pokeballName: 'Basic Ball',
    })
    expect(panel.pokeballCaptureError.value).toBeNull()
  })
})
