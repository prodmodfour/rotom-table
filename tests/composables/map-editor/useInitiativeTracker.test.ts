import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useInitiativeTracker } from '~/composables/map-editor/useInitiativeTracker'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import { applyCombatStageToStat } from '~/utils/combatStageStats'
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

  it('uses current Speed Combat Stages for default initiative values', () => {
    const map = ref<TabletopMap | null>(mapWithPlacements([
      { id: 'boosted', sheetKind: 'pokemon', sheetSlug: 'boosted', position: { x: 0, y: 0, z: 0 } },
    ]))
    const tracker = useInitiativeTracker({
      map,
      spawnedPokemon: computed(() => [
        token({
          id: 'boosted',
          sheetSlug: 'boosted',
          species: 'Boosted',
          combatStages: { ...stages, spd: 2 },
        }),
      ]),
      pokemonBySlug: ref(new Map([['boosted', sheet('boosted', { stats: { spd: { stage: 2 } } })]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canManageInitiative: computed(() => true),
    })

    const row = tracker.initiativeRows.value[0]
    expect(row.speedCombatStage).toBe(2)
    expect(row.speed).toBe(applyCombatStageToStat(row.baseSpeed, 2))
    expect(row.baseInitiative).toBe(row.speed)

    tracker.fillInitiativeFromSpeed()

    expect(map.value?.placements[0].initiative).toBe(row.speed)
  })

  it('preserves negative current HP in initiative rows while flooring HP bar display', () => {
    const map = ref<TabletopMap | null>(mapWithPlacements([
      { id: 'overkill', sheetKind: 'pokemon', sheetSlug: 'overkill', position: { x: 0, y: 0, z: 0 } },
    ]))
    const tracker = useInitiativeTracker({
      map,
      spawnedPokemon: computed(() => [
        token({ id: 'overkill', sheetSlug: 'overkill', species: 'Overkill', currentHp: -4, maxHp: 30 }),
      ]),
      pokemonBySlug: ref(new Map([['overkill', sheet('overkill')]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canManageInitiative: computed(() => true),
    })
    const row = tracker.initiativeRows.value[0]

    expect(row.currentHp).toBe(-4)
    expect(tracker.hpPercent(row)).toBe('0%')
    expect(tracker.hpTier(row)).toBe('critical')
  })

  it('reports injury-blocked HP bar width from full Max HP in initiative rows', () => {
    const map = ref<TabletopMap | null>(mapWithPlacements([
      { id: 'injured', sheetKind: 'pokemon', sheetSlug: 'injured', position: { x: 0, y: 0, z: 0 } },
    ]))
    const tracker = useInitiativeTracker({
      map,
      spawnedPokemon: computed(() => [
        token({ id: 'injured', sheetSlug: 'injured', species: 'Injured', currentHp: 50, maxHp: 70, fullMaxHp: 100 }),
      ]),
      pokemonBySlug: ref(new Map([['injured', sheet('injured')]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canManageInitiative: computed(() => true),
    })
    const row = tracker.initiativeRows.value[0]

    expect(tracker.hpPercent(row)).toBe('50%')
    expect(tracker.hpBlockedPercent(row)).toBe('30%')
    expect(tracker.hasHpBlocked(row)).toBe(true)
    expect(tracker.hpTier(row)).toBe('wounded')
  })

  it('includes Quick Claw and active Agility Training in default initiative values from sheets', () => {
    const map = ref<TabletopMap | null>(mapWithPlacements([
      { id: 'quick', sheetKind: 'pokemon', sheetSlug: 'quick', position: { x: 0, y: 0, z: 0 } },
    ]))
    const tracker = useInitiativeTracker({
      map,
      spawnedPokemon: computed(() => [
        token({ id: 'quick', sheetSlug: 'quick', species: 'Quick', conditions: ['Paralysis'] }),
      ]),
      pokemonBySlug: ref(new Map([['quick', sheet('quick', {
        activeTrainingFeature: 'Agility Training',
        items: { held: 'Quick Claw' },
      })]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canManageInitiative: computed(() => true),
    })

    const row = tracker.initiativeRows.value[0]

    expect(row.initiativeItemBonus).toBe(10)
    expect(row.initiativeTrainingBonus).toBe(4)
    expect(row.baseInitiative).toBe(row.speed + 14)
    expect(row.initiativeScore).toBe(Math.floor((row.speed + 14) / 2))

    tracker.fillInitiativeFromSpeed()

    expect(map.value?.placements[0].initiative).toBe(row.baseInitiative)
  })

  it('appends combat log entries when characters gain initiative', () => {
    const map = ref<TabletopMap | null>(mapWithPlacements([
      { id: 'fast', sheetKind: 'pokemon', sheetSlug: 'fast', position: { x: 0, y: 0, z: 0 }, initiative: 30 },
      { id: 'slow', sheetKind: 'pokemon', sheetSlug: 'slow', position: { x: 1, y: 0, z: 0 }, initiative: 10 },
    ]))
    let currentTime = 100
    const tracker = useInitiativeTracker({
      map,
      spawnedPokemon: computed(() => [
        token({ id: 'fast', sheetSlug: 'fast', species: 'Fast' }),
        token({ id: 'slow', sheetSlug: 'slow', species: 'Slow' }),
      ]),
      pokemonBySlug: ref(new Map([['fast', sheet('fast')], ['slow', sheet('slow')]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canManageInitiative: computed(() => true),
      now: () => currentTime,
    })

    tracker.setActiveInitiative('fast')
    tracker.setActiveInitiative('fast')
    currentTime = 200
    tracker.nextInitiative()

    expect(map.value?.metadata?.initiativeLog).toEqual([
      {
        at: 100,
        userId: 'fast',
        userName: 'Fast',
        actionName: 'Initiative',
        lines: ['Fast has gained initiative!'],
      },
      {
        at: 200,
        userId: 'slow',
        userName: 'Slow',
        actionName: 'Initiative',
        lines: ['Slow has gained initiative!'],
      },
    ])
  })

  it('dispatches live-play initiative commands instead of mutating local map initiative', () => {
    const map = ref<TabletopMap | null>(mapWithPlacements([
      { id: 'live-token', sheetKind: 'pokemon', sheetSlug: 'live-token', position: { x: 0, y: 0, z: 0 }, initiative: 12 },
      { id: 'other-token', sheetKind: 'pokemon', sheetSlug: 'other-token', position: { x: 1, y: 0, z: 0 }, initiative: 8 },
    ]))
    map.value!.initiative = { activeId: null, round: 1 }
    const dispatchSetInitiative = vi.fn(async () => undefined)
    const dispatchNextInitiative = vi.fn(async () => undefined)
    const dispatchPreviousInitiative = vi.fn(async () => undefined)
    const tracker = useInitiativeTracker({
      map,
      spawnedPokemon: computed(() => [
        token({ id: 'live-token', sheetSlug: 'live-token', species: 'Live Token' }),
        token({ id: 'other-token', sheetSlug: 'other-token', species: 'Other Token' }),
      ]),
      pokemonBySlug: ref(new Map([['live-token', sheet('live-token')], ['other-token', sheet('other-token')]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canManageInitiative: computed(() => true),
      interactionMode: computed(() => MAP_INTERACTION_MODES.LIVE_PLAY),
      dispatchSetInitiative,
      dispatchNextInitiative,
      dispatchPreviousInitiative,
    })

    tracker.setInitiativeInput('live-token', inputEvent('99'))
    tracker.setInitiativeFromSpeed('other-token', 20)
    tracker.setActiveInitiative('live-token')
    tracker.setInitiativeRound(inputEvent('3'))
    tracker.clearActiveInitiative()
    tracker.nextInitiative()
    tracker.previousInitiative()

    expect(dispatchSetInitiative).toHaveBeenCalledWith({ tokenId: 'live-token', initiative: 99 })
    expect(dispatchSetInitiative).toHaveBeenCalledWith({ tokenId: 'other-token', initiative: 20 })
    expect(dispatchSetInitiative).toHaveBeenCalledWith({ activeId: 'live-token' })
    expect(dispatchSetInitiative).toHaveBeenCalledWith({ round: 3 })
    expect(dispatchSetInitiative).toHaveBeenCalledWith({ activeId: null })
    expect(dispatchNextInitiative).toHaveBeenCalledTimes(1)
    expect(dispatchPreviousInitiative).toHaveBeenCalledTimes(1)
    expect(map.value?.placements[0].initiative).toBe(12)
    expect(map.value?.placements[1].initiative).toBe(8)
    expect(map.value?.initiative).toEqual({ activeId: null, round: 1 })
  })

  it('does not mutate initiative state without manage permission', () => {
    const map = ref<TabletopMap | null>(mapWithPlacements([
      { id: 'player-token', sheetKind: 'pokemon', sheetSlug: 'player-token', position: { x: 0, y: 0, z: 0 }, initiative: 12 },
    ]))
    map.value!.initiative = { activeId: null, round: 1 }
    const tracker = useInitiativeTracker({
      map,
      spawnedPokemon: computed(() => [
        token({ id: 'player-token', sheetSlug: 'player-token', species: 'Player Token' }),
      ]),
      pokemonBySlug: ref(new Map([['player-token', sheet('player-token')]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canManageInitiative: computed(() => false),
    })

    tracker.setActiveInitiative('player-token')
    tracker.setInitiativeInput('player-token', inputEvent('99'))
    tracker.setInitiativeFromSpeed('player-token', 30)
    tracker.setInitiativeRound(inputEvent('5'))
    tracker.fillInitiativeFromSpeed()
    tracker.clearInitiativeValues()
    tracker.clearActiveInitiative()
    tracker.nextInitiative()
    tracker.previousInitiative()

    expect(map.value?.placements[0].initiative).toBe(12)
    expect(map.value?.initiative).toEqual({ activeId: null, round: 1 })
    expect(map.value?.metadata).toBeUndefined()
  })
})
