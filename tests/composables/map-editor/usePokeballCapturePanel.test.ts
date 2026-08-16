import { computed, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePokeballCapturePanel } from '~/composables/map-editor/usePokeballCapturePanel'
import type { PokeballCaptureOutcomeEvent } from '~/utils/pokeballCapture'
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

const BASIC_BALL_SOURCE_ID = 'item-instance:trainer:lenora:pokeBalls:basic-ball-row'

const trainerSheet = (): TrainerSheet => ({
  slug: 'lenora',
  name: 'Lenora',
  revision: 1,
  level: 1,
  currentTeam: [],
  boxedPokemon: [],
  inventory: {
    pokeBalls: [{ id: 'basic-ball-row', name: 'Basic Ball', qty: 2 }],
  },
})

const serverOutcome = (overrides: Partial<PokeballCaptureOutcomeEvent['result']> = {}): PokeballCaptureOutcomeEvent => ({
  trainerId: 'trainer',
  targetId: 'pidgey',
  targetSlug: 'pidgey',
  pokeballName: 'Basic Ball',
  result: {
    id: 'capture-server-result',
    trainerId: 'trainer',
    trainerName: 'Lenora',
    targetId: 'pidgey',
    targetName: 'Pidgey',
    targetSpecies: 'Pidgey',
    targetSpriteUrl: null,
    pokeballName: 'Basic Ball',
    success: false,
    hit: false,
    shakeCount: 0,
    accuracyRoll: 1,
    modifiedAccuracyRoll: 1,
    accuracyCheck: 6,
    userAccuracy: 0,
    targetEvasion: 0,
    targetEvasionLabel: '0',
    captureRoll: null,
    adjustedCaptureRoll: null,
    captureRate: 100,
    naturalTwentyCaptureBonus: 0,
    naturalCaptureSuccess: false,
    failureReason: 'The server says the Poké Ball missed.',
    breakdown: {
      captureRate: 100,
      captureRateLines: [{ label: 'Base', value: 100 }],
      rollModifier: 0,
      rollModifierLines: [],
      hitChance: { targetId: 'pidgey', percent: 50, label: '50%', tone: 'medium', title: '50%' },
      captureChance: 50,
      captureChanceLabel: '50%',
      naturalTwentyCaptureChance: 50,
      naturalTwentyCaptureChanceLabel: '50%',
      combinedChance: 25,
      combinedChanceLabel: '25%',
      capturable: true,
      uncatchableReason: null,
      notes: [],
    },
    ...overrides,
  },
})

type PanelCallbacks = Partial<Pick<
  Parameters<typeof usePokeballCapturePanel>[0],
  'onPokeballThrow' | 'onPokeballFeedback' | 'onPokeballResult' | 'dispatchCaptureAttempt'
>>

const buildPanel = (
  callbacks: PanelCallbacks = {},
  onBeforePokeballThrow?: (event: { userId: string; pokeballName: string }) => unknown,
) => {
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
    canControlPlacement: id => id === 'trainer',
    onBeforePokeballThrow,
    ...callbacks,
  })

  return { panel, map }
}

describe('usePokeballCapturePanel liveplay authority', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders the authoritative result without local rolls, metadata, or sheet mutation', async () => {
    vi.useFakeTimers()
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const dispatchCaptureAttempt = vi.fn().mockResolvedValue(serverOutcome())
    const onPokeballThrow = vi.fn()
    const onPokeballResult = vi.fn()
    const { panel, map } = buildPanel({ dispatchCaptureAttempt, onPokeballThrow, onPokeballResult })

    panel.openPokeballCapture({ id: 'trainer', sourceInstanceId: BASIC_BALL_SOURCE_ID })
    expect(panel.pokeballCaptureTargeting.value?.candidateIds).toEqual(['pidgey'])
    await panel.selectPokeballCaptureTarget('pidgey')

    expect(dispatchCaptureAttempt).toHaveBeenCalledWith({
      trainerId: 'trainer',
      targetId: 'pidgey',
      pokeball: expect.objectContaining({
        sourceInstanceId: BASIC_BALL_SOURCE_ID,
        name: 'Basic Ball',
      }),
    })
    expect(random).not.toHaveBeenCalled()
    expect(onPokeballThrow).toHaveBeenCalledWith({
      userId: 'trainer',
      targetId: 'pidgey',
      pokeballName: 'Basic Ball',
      resultId: 'capture-server-result',
    })
    expect(panel.pokeballCaptureFeedback.value).toMatchObject({
      phase: 'rolling',
      naturalRoll: 1,
      hit: false,
    })

    vi.advanceTimersByTime(2100)

    expect(map.value.metadata?.captureLog).toBeUndefined()
    expect(panel.pokeballCaptureResult.value).toBeNull()
    expect(panel.pokeballCaptureError.value).toBe('The server says the Poké Ball missed.')
    expect(onPokeballResult).toHaveBeenCalledWith({
      trainerId: 'trainer',
      result: null,
      error: 'The server says the Poké Ball missed.',
    })
  })

  it('waits for the throw splash hook before dispatching to authority', async () => {
    vi.useFakeTimers()
    const dispatchCaptureAttempt = vi.fn().mockResolvedValue(serverOutcome())
    const onBeforePokeballThrow = vi.fn(() => new Promise((resolve) => {
      setTimeout(resolve, 100)
    }))
    const { panel } = buildPanel({ dispatchCaptureAttempt }, onBeforePokeballThrow)

    panel.openPokeballCapture({ id: 'trainer', sourceInstanceId: BASIC_BALL_SOURCE_ID })
    const capture = panel.selectPokeballCaptureTarget('pidgey')

    expect(onBeforePokeballThrow).toHaveBeenCalledWith({ userId: 'trainer', pokeballName: 'Basic Ball' })
    expect(dispatchCaptureAttempt).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(100)
    await capture

    expect(dispatchCaptureAttempt).toHaveBeenCalledTimes(1)
    expect(panel.pokeballCaptureFeedback.value?.phase).toBe('rolling')
  })

  it('uses the server success receipt for feedback and result callbacks', async () => {
    vi.useFakeTimers()
    const outcome = serverOutcome({
      success: true,
      hit: true,
      failureReason: null,
      accuracyRoll: 20,
      modifiedAccuracyRoll: 20,
      captureRoll: 1,
      adjustedCaptureRoll: 1,
      shakeCount: 4,
    })
    const onPokeballFeedback = vi.fn()
    const onPokeballResult = vi.fn()
    const { panel } = buildPanel({
      dispatchCaptureAttempt: vi.fn().mockResolvedValue(outcome),
      onPokeballFeedback,
      onPokeballResult,
    })

    panel.openPokeballCapture({ id: 'trainer', sourceInstanceId: BASIC_BALL_SOURCE_ID })
    await panel.selectPokeballCaptureTarget('pidgey')

    expect(onPokeballFeedback).toHaveBeenCalledWith({
      feedback: expect.objectContaining({
        id: 'capture-server-result',
        phase: 'rolling',
        naturalRoll: 20,
        hit: true,
      }),
    })
    vi.advanceTimersByTime(2100)
    expect(onPokeballResult).toHaveBeenCalledWith({
      trainerId: 'trainer',
      result: expect.objectContaining({ id: 'capture-server-result', success: true }),
      error: null,
    })
  })

  it('fails closed when liveplay authority is unavailable', async () => {
    const onPokeballResult = vi.fn()
    const { panel, map } = buildPanel({ onPokeballResult })

    panel.openPokeballCapture({ id: 'trainer', sourceInstanceId: BASIC_BALL_SOURCE_ID })
    await panel.selectPokeballCaptureTarget('pidgey')

    expect(panel.pokeballCaptureError.value).toBe('Liveplay Poké Ball authority is unavailable.')
    expect(panel.pokeballCaptureFeedback.value).toBeNull()
    expect(map.value.metadata?.captureLog).toBeUndefined()
    expect(onPokeballResult).toHaveBeenCalledWith({
      trainerId: 'trainer',
      result: null,
      error: 'Liveplay Poké Ball authority is unavailable.',
    })
  })

  it('does not submit twice while an authoritative throw is pending', async () => {
    let resolveDispatch: (value: false) => void = () => undefined
    const dispatchCaptureAttempt = vi.fn(() => new Promise<false>((resolve) => {
      resolveDispatch = resolve
    }))
    const { panel } = buildPanel({ dispatchCaptureAttempt })

    panel.openPokeballCapture({ id: 'trainer', sourceInstanceId: BASIC_BALL_SOURCE_ID })
    const first = panel.selectPokeballCaptureTarget('pidgey')
    const second = panel.selectPokeballCaptureTarget('pidgey')

    expect(panel.pokeballCapturePending.value).toBe(true)
    expect(dispatchCaptureAttempt).toHaveBeenCalledTimes(1)
    resolveDispatch(false)
    await first
    await second

    expect(panel.pokeballCapturePending.value).toBe(false)
    expect(dispatchCaptureAttempt).toHaveBeenCalledTimes(1)
    expect(panel.pokeballCaptureError.value).toBe('Poké Ball throw was rejected.')
  })
})
