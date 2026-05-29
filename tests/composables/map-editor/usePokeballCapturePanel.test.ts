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
  const map = ref(mapDoc())
  const panel = usePokeballCapturePanel({
    map,
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

  return { panel, applyCaptureOutcome, map }
}

describe('usePokeballCapturePanel', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('visually rolls the hit d20 before reporting a Poké Ball miss', () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const { panel, applyCaptureOutcome, map } = buildPanel()

    panel.openPokeballCapture({ id: 'trainer', pokeballName: 'Basic Ball' })
    expect(panel.pokeballCaptureTargeting.value?.candidateIds).toEqual(['pidgey'])

    panel.selectPokeballCaptureTarget('pidgey')

    expect(panel.pokeballCaptureFeedback.value).toMatchObject({
      phase: 'rolling',
      naturalRoll: 1,
      hit: false,
      moveName: 'Throw Basic Ball',
    })
    expect(panel.pokeballCaptureResult.value).toBeNull()
    expect(panel.pokeballCaptureError.value).toBeNull()
    expect(applyCaptureOutcome).not.toHaveBeenCalled()

    vi.advanceTimersByTime(650)
    expect(panel.pokeballCaptureFeedback.value?.phase).toBe('hit-roll')

    vi.advanceTimersByTime(850)
    expect(panel.pokeballCaptureFeedback.value?.phase).toBe('outcome')

    vi.advanceTimersByTime(600)
    expect(panel.pokeballCaptureFeedback.value).toBeNull()
    expect(panel.pokeballCaptureResult.value).toBeNull()
    expect(panel.pokeballCaptureError.value).toBe('The Poké Ball missed.')
    expect(map.value.metadata?.captureLog).toMatchObject([
      {
        hit: false,
        success: false,
        lines: expect.arrayContaining([
          'Lenora threw Basic Ball at Pidgey.',
          'Result: The Poké Ball missed.',
        ]),
      },
    ])
    expect(applyCaptureOutcome).toHaveBeenCalledWith(expect.objectContaining({
      trainerId: 'trainer',
      targetId: 'pidgey',
      pokeballName: 'Basic Ball',
      result: expect.objectContaining({ hit: false, failureReason: 'The Poké Ball missed.' }),
    }))
  })

  it('exposes the capture result modal once the Poké Ball hit roll finishes', () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0)
    const { panel } = buildPanel()

    panel.openPokeballCapture({ id: 'trainer', pokeballName: 'Basic Ball' })
    panel.selectPokeballCaptureTarget('pidgey')

    expect(panel.pokeballCaptureFeedback.value).toMatchObject({
      phase: 'rolling',
      naturalRoll: 20,
      hit: true,
      moveName: 'Throw Basic Ball',
    })
    expect(panel.pokeballCaptureResult.value).toBeNull()

    vi.advanceTimersByTime(2100)

    expect(panel.pokeballCaptureFeedback.value).toBeNull()
    expect(panel.pokeballCaptureResult.value).toMatchObject({
      hit: true,
      success: true,
      targetName: 'Pidgey',
      pokeballName: 'Basic Ball',
    })
    expect(panel.pokeballCaptureError.value).toBeNull()
  })

  it('appends every resolved capture attempt to map metadata for the combat log', () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0)
    const { panel, map } = buildPanel()

    panel.openPokeballCapture({ id: 'trainer', pokeballName: 'Basic Ball' })
    panel.selectPokeballCaptureTarget('pidgey')

    expect(map.value.metadata?.captureLog).toBeUndefined()

    vi.advanceTimersByTime(2100)

    expect(map.value.metadata?.captureLog).toMatchObject([
      {
        at: 100,
        userId: 'trainer',
        userName: 'Lenora',
        actionName: 'Throw Basic Ball',
        pokeballName: 'Basic Ball',
        targetId: 'pidgey',
        targetName: 'Pidgey',
        success: true,
        hit: true,
        lines: expect.arrayContaining([
          'Lenora threw Basic Ball at Pidgey.',
          'Result: Pidgey was captured!',
        ]),
      },
    ])
  })
})
