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

const buildPanel = (
  applyCaptureOutcome = vi.fn(),
  onBeforePokeballThrow?: (event: { userId: string; pokeballName: string }) => unknown,
  callbacks: Partial<Pick<Parameters<typeof usePokeballCapturePanel>[0], 'onPokeballThrow' | 'onPokeballFeedback' | 'onPokeballResult' | 'dispatchCaptureAttempt'>> = {},
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
    canControlPlacement: (id) => id === 'trainer',
    applyCaptureOutcome,
    onBeforePokeballThrow,
    ...callbacks,
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

  it('waits for the throw splash hook before starting capture feedback', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const onBeforePokeballThrow = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 100)))
    const { panel } = buildPanel(vi.fn(), onBeforePokeballThrow)

    panel.openPokeballCapture({ id: 'trainer', pokeballName: 'Basic Ball' })
    const capture = panel.selectPokeballCaptureTarget('pidgey')

    expect(onBeforePokeballThrow).toHaveBeenCalledWith({ userId: 'trainer', pokeballName: 'Basic Ball' })
    expect(panel.pokeballCaptureFeedback.value).toBeNull()
    expect(panel.pokeballCaptureResult.value).toBeNull()

    await vi.advanceTimersByTimeAsync(100)
    await capture

    expect(panel.pokeballCaptureFeedback.value).toMatchObject({
      phase: 'rolling',
      moveName: 'Throw Basic Ball',
    })
  })

  it('notifies visual sync callbacks for throw, feedback, and result UI without waiting for mechanics', () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0)
    const applyCaptureOutcome = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 250)))
    const onPokeballThrow = vi.fn()
    const onPokeballFeedback = vi.fn()
    const onPokeballResult = vi.fn()
    const { panel } = buildPanel(applyCaptureOutcome, undefined, {
      onPokeballThrow,
      onPokeballFeedback,
      onPokeballResult,
    })

    panel.openPokeballCapture({ id: 'trainer', pokeballName: 'Basic Ball' })
    panel.selectPokeballCaptureTarget('pidgey')

    expect(onPokeballThrow).toHaveBeenCalledWith({
      userId: 'trainer',
      targetId: 'pidgey',
      pokeballName: 'Basic Ball',
      resultId: 'capture-trainer-pidgey-100',
    })
    expect(onPokeballFeedback).toHaveBeenCalledWith({
      feedback: expect.objectContaining({
        id: 'capture-trainer-pidgey-100',
        userId: 'trainer',
        targetId: 'pidgey',
        moveName: 'Throw Basic Ball',
        phase: 'rolling',
      }),
    })
    expect(onPokeballResult).not.toHaveBeenCalled()

    vi.advanceTimersByTime(2100)

    expect(onPokeballResult).toHaveBeenCalledWith({
      trainerId: 'trainer',
      result: expect.objectContaining({
        id: 'capture-trainer-pidgey-100',
        hit: true,
        success: true,
      }),
      error: null,
    })
    expect(applyCaptureOutcome).toHaveBeenCalledTimes(1)
  })

  it('notifies result UI callbacks for a missed Poké Ball without exposing a modal result', () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const onPokeballResult = vi.fn()
    const { panel } = buildPanel(vi.fn(), undefined, { onPokeballResult })

    panel.openPokeballCapture({ id: 'trainer', pokeballName: 'Basic Ball' })
    panel.selectPokeballCaptureTarget('pidgey')
    vi.advanceTimersByTime(2100)

    expect(onPokeballResult).toHaveBeenCalledWith({
      trainerId: 'trainer',
      result: null,
      error: 'The Poké Ball missed.',
    })
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

  it('uses authoritative dispatcher results without local rolls, local metadata, or local sheet mutation fallback', async () => {
    vi.useFakeTimers()
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const applyCaptureOutcome = vi.fn()
    const dispatchCaptureAttempt = vi.fn().mockResolvedValue(serverOutcome())
    const onPokeballThrow = vi.fn()
    const { panel, map } = buildPanel(applyCaptureOutcome, undefined, {
      dispatchCaptureAttempt,
      onPokeballThrow,
    })

    panel.openPokeballCapture({ id: 'trainer', pokeballName: 'Basic Ball' })
    await panel.selectPokeballCaptureTarget('pidgey')

    expect(dispatchCaptureAttempt).toHaveBeenCalledWith({
      trainerId: 'trainer',
      targetId: 'pidgey',
      pokeballName: 'Basic Ball',
    })
    expect(random).not.toHaveBeenCalled()
    expect(onPokeballThrow).toHaveBeenCalledWith({
      userId: 'trainer',
      targetId: 'pidgey',
      pokeballName: 'Basic Ball',
      resultId: 'capture-server-result',
    })
    vi.advanceTimersByTime(2100)
    expect(map.value.metadata?.captureLog).toBeUndefined()
    expect(applyCaptureOutcome).not.toHaveBeenCalled()
    expect(panel.pokeballCaptureError.value).toBe('The server says the Poké Ball missed.')
  })

  it('does not locally fall back or submit twice while an authoritative throw is pending', async () => {
    vi.useFakeTimers()
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const applyCaptureOutcome = vi.fn()
    let resolveDispatch: (value: false) => void = () => undefined
    const dispatchCaptureAttempt = vi.fn(() => new Promise<false>((resolve) => {
      resolveDispatch = resolve
    }))
    const { panel, map } = buildPanel(applyCaptureOutcome, undefined, { dispatchCaptureAttempt })

    panel.openPokeballCapture({ id: 'trainer', pokeballName: 'Basic Ball' })
    const first = panel.selectPokeballCaptureTarget('pidgey')
    const second = panel.selectPokeballCaptureTarget('pidgey')

    expect(panel.pokeballCapturePending.value).toBe(true)
    expect(dispatchCaptureAttempt).toHaveBeenCalledTimes(1)
    resolveDispatch(false)
    await first
    await second

    expect(panel.pokeballCapturePending.value).toBe(false)
    expect(random).not.toHaveBeenCalled()
    expect(applyCaptureOutcome).not.toHaveBeenCalled()
    expect(map.value.metadata?.captureLog).toBeUndefined()
    expect(panel.pokeballCaptureError.value).toBe('Poké Ball throw was rejected.')
  })
})
