import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  appendMoveAutomationLogEntry,
  useMoveAutomationPanel,
} from '~/composables/map-editor/useMoveAutomationPanel'
import { MOVE_VFX_KIND, type MoveAnimationEvent } from '~/types/moveAnimation'
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

const spawned = (overrides: Partial<SpawnedPokemon> = {}): SpawnedPokemon => ({
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
  ...overrides,
})

const MOVE_FEEDBACK_OUTCOME_MS = 1500
const MOVE_FEEDBACK_FINAL_MS = 2100
const MOVE_FEEDBACK_EFFECTIVE_FINAL_MS = 2800

const transaction = (): MoveAutomationTransaction => ({
  userId: 'user-token',
  userName: 'Bolt',
  moveName: 'Tackle',
  scriptKind: 'explicit',
  scriptVersion: 1,
  hpUpdates: [{ id: 'target-token', currentHp: 7 }],
  combatStageUpdates: [{ id: 'target-token', stages: { atk: 1, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 } }],
  conditionUpdates: [{ id: 'target-token', conditions: ['Burned'] }],
  hazardsToAdd: [{ kind: 'spikes', x: 1, y: 0, z: 1 }],
  fieldEffectsToApply: [{ kind: 'weather', value: 'rainy', source: 'Tackle' }],
  logLines: ['Rolled Tackle.'],
})

describe('useMoveAutomationPanel', () => {
  it('does not open the removed wizard for unautomated moves', () => {
    const map = ref(mapFixture())
    const pokemonSheet = {
      slug: 'bolt',
      nickname: 'Bolt',
      species: 'Bulbasaur',
      level: 5,
      movelist: [{ name: 'Teleport' }],
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
    expect(panel.moveAutomationTargeting.value).toBeNull()

    panel.openMoveAutomation({ id: 'user-token', moveName: 'Teleport' })
    expect(panel.moveAutomationTargeting.value).toBeNull()
    expect(panel.tokenMoveOptionsById.value['user-token'].map((move) => move.name)).toEqual(['Struggle', 'Teleport'])
    expect(panel.tokenMoveOptionsById.value['user-token'].find((move) => move.name === 'Teleport')?.hasAutomationScript).toBe(false)
  })

  it('accepts a renderer-agnostic move animation enqueue callback without changing existing no-op flows', () => {
    const map = ref(mapFixture())
    const enqueueMoveAnimations = vi.fn()
    const pokemonSheet = {
      slug: 'bolt',
      nickname: 'Bolt',
      species: 'Bulbasaur',
      level: 5,
      movelist: [{ name: 'Teleport' }],
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
      enqueueMoveAnimations,
    })

    panel.openMoveAutomation('blocked-token')
    panel.openMoveAutomation({ id: 'user-token', moveName: 'Teleport' })

    expect(panel.moveAutomationTargeting.value).toBeNull()
    expect(enqueueMoveAnimations).not.toHaveBeenCalled()
  })

  it('omits Disabled moves from automation while leaving them visible in the token menu', () => {
    const map = ref(mapFixture())
    const pokemonSheet = {
      slug: 'bolt',
      nickname: 'Bolt',
      species: 'Bulbasaur',
      level: 5,
      movelist: [{ name: 'Tackle' }, { name: 'Ember' }],
    } as CharacterSheet
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [spawned({ conditions: ['Disabled: Tackle'] })]),
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

    panel.openMoveAutomation({ id: 'user-token', moveName: 'Tackle' })

    expect(panel.moveAutomationTargeting.value).toBeNull()
    expect(panel.tokenMoveOptionsById.value['user-token'].find((move) => move.name === 'Tackle')?.disabledByCondition).toBe(true)
  })

  it('omits non-damaging non-Struggle moves from automation while Enraged', () => {
    const map = ref(mapFixture())
    const pokemonSheet = {
      slug: 'bolt',
      nickname: 'Bolt',
      species: 'Bulbasaur',
      level: 5,
      movelist: [{ name: 'Swords Dance' }, { name: 'Tackle' }],
    } as CharacterSheet
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [spawned({ conditions: ['Enraged'] })]),
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

    panel.openMoveAutomation({ id: 'user-token', moveName: 'Swords Dance' })
    expect(panel.moveAutomationTargeting.value).toBeNull()
    expect(panel.tokenMoveOptionsById.value['user-token'].find((move) => move.name === 'Swords Dance')?.conditionUseBlock?.label).toBe('Enraged')

    panel.openMoveAutomation({ id: 'user-token', moveName: 'Tackle' })
    expect(panel.moveAutomationTargeting.value?.moveName).toBe('Tackle')
  })

  it('opens Psywave with the same on-map single-target flow as Ember', async () => {
    vi.useFakeTimers()
    const map = ref({
      ...mapFixture(),
      placements: [
        { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'bolt', position: { x: 0, y: 0, z: 0 } },
        { id: 'target-token', sheetKind: 'pokemon' as const, sheetSlug: 'target', position: { x: 2, y: 0, z: 0 } },
      ],
    })
    const pokemonSheet = {
      slug: 'bolt',
      nickname: 'Bolt',
      species: 'Bulbasaur',
      level: 10,
      movelist: [{ name: 'Psywave' }],
    } as CharacterSheet
    const calls: string[] = []
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned({ id: 'user-token', sheetSlug: 'bolt', level: 10, position: { x: 0, y: 0, z: 0 } }),
        spawned({ id: 'target-token', species: 'Target', sheetSlug: 'target', currentHp: 40, maxHp: 40, position: { x: 2, y: 0, z: 0 } }),
      ]),
      pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: (update) => { calls.push(`hp:${update.id}:${update.currentHp}`) },
      modifyCombatStages: () => undefined,
      modifyConditions: () => undefined,
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
    })
    const random = vi.spyOn(Math, 'random')
    random.mockReturnValue(0.1)
    random.mockReturnValueOnce(0.5).mockReturnValueOnce(0.75)

    try {
      panel.openMoveAutomation({ id: 'user-token', moveName: 'Psywave' })

        expect(panel.moveAutomationTargeting.value).toMatchObject({
        mode: 'target',
        moveName: 'Psywave',
        rangeLabel: '6m',
        candidateIds: ['target-token'],
      })

      await panel.selectMoveAutomationTarget('target-token')

      expect(panel.moveAutomationTargeting.value).toBeNull()
      expect(panel.moveAutomationFeedback.value).toMatchObject({
        moveName: 'Psywave',
        naturalRoll: 11,
        hit: true,
        crit: false,
        damageLoss: 20,
      })

      await vi.advanceTimersByTimeAsync(MOVE_FEEDBACK_FINAL_MS)

      expect(calls).toEqual(['hp:target-token:20'])
      expect(map.value.metadata?.moveLog).toMatchObject([{ moveName: 'Psywave', scriptKind: 'explicit' }])
    } finally {
      random.mockRestore()
      vi.useRealTimers()
    }
  })

  it('opens condition-only moves with on-map targeting instead of the wizard', async () => {
    vi.useFakeTimers()
    const map = ref({
      ...mapFixture(),
      placements: [
        { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'caster', position: { x: 0, y: 0, z: 0 } },
        { id: 'target-token', sheetKind: 'pokemon' as const, sheetSlug: 'target', position: { x: 2, y: 0, z: 0 } },
      ],
    })
    const pokemonSheet = {
      slug: 'caster',
      nickname: 'Caster',
      species: 'Charmander',
      level: 5,
      movelist: [{ name: 'Will-O-Wisp' }],
    } as CharacterSheet
    const conditionCalls: MoveAutomationTransaction['conditionUpdates'] = []
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned({ id: 'user-token', species: 'Caster', sheetSlug: 'caster', position: { x: 0, y: 0, z: 0 } }),
        spawned({ id: 'target-token', species: 'Target', sheetSlug: 'target', currentHp: 40, maxHp: 40, defenderTypes: ['Grass'], position: { x: 2, y: 0, z: 0 } }),
      ]),
      pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: () => undefined,
      modifyCombatStages: () => undefined,
      modifyConditions: (update) => { conditionCalls.push(update) },
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
    })
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5)

    try {
      panel.openMoveAutomation({ id: 'user-token', moveName: 'Will-O-Wisp' })

        expect(panel.moveAutomationTargeting.value).toMatchObject({
        mode: 'target',
        moveName: 'Will-O-Wisp',
        rangeLabel: '6m',
        candidateIds: ['target-token'],
      })

      await panel.selectMoveAutomationTarget('target-token')

      expect(panel.moveAutomationFeedback.value).toMatchObject({
        moveName: 'Will-O-Wisp',
        naturalRoll: 11,
        hit: true,
        damageLoss: 0,
        conditions: [{ condition: 'Burned', applied: true }],
      })

      await vi.advanceTimersByTimeAsync(MOVE_FEEDBACK_FINAL_MS)

      expect(conditionCalls).toEqual([{ id: 'target-token', conditions: ['Burned'] }])
      expect(map.value.metadata?.moveLog).toMatchObject([{ moveName: 'Will-O-Wisp', scriptKind: 'explicit' }])
    } finally {
      random.mockRestore()
      vi.useRealTimers()
    }
  })

  it('queues and applies an ignorable Spite prompt after a hit', async () => {
    vi.useFakeTimers()
    const map = ref({
      ...mapFixture(),
      placements: [
        { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'attacker', position: { x: 0, y: 0, z: 0 } },
        { id: 'target-token', sheetKind: 'pokemon' as const, sheetSlug: 'defender', position: { x: 2, y: 0, z: 0 } },
      ],
    })
    const attackerSheet = {
      slug: 'attacker',
      nickname: 'Attacker',
      species: 'Charmander',
      level: 5,
      movelist: [{ name: 'Ember' }],
    } as CharacterSheet
    const defenderSheet = {
      slug: 'defender',
      nickname: 'Defender',
      species: 'Dusclops',
      level: 5,
      movelist: [{ name: 'Spite' }],
    } as CharacterSheet
    const conditionCalls: MoveAutomationTransaction['conditionUpdates'] = []
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned({ id: 'user-token', species: 'Attacker', sheetSlug: 'attacker', position: { x: 0, y: 0, z: 0 } }),
        spawned({ id: 'target-token', species: 'Defender', sheetSlug: 'defender', currentHp: 40, maxHp: 40, position: { x: 2, y: 0, z: 0 } }),
      ]),
      pokemonBySlug: ref(new Map([
        [attackerSheet.slug, attackerSheet],
        [defenderSheet.slug, defenderSheet],
      ])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: () => undefined,
      modifyCombatStages: () => undefined,
      modifyConditions: (update) => { conditionCalls.push(update) },
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
    })
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5)

    try {
      panel.openMoveAutomation({ id: 'user-token', moveName: 'Ember' })
      await panel.selectMoveAutomationTarget('target-token')
      expect(panel.spiteReactionPrompts.value).toEqual([])

      await vi.advanceTimersByTimeAsync(MOVE_FEEDBACK_FINAL_MS)

      expect(panel.moveAutomationFeedback.value).toMatchObject({
        phase: 'effectiveness',
        effectiveness: 'super-effective',
      })
      expect(panel.spiteReactionPrompts.value).toEqual([])

      await vi.advanceTimersByTimeAsync(MOVE_FEEDBACK_EFFECTIVE_FINAL_MS - MOVE_FEEDBACK_FINAL_MS)

      expect(panel.spiteReactionPrompts.value).toMatchObject([{
        defenderId: 'target-token',
        defenderName: 'Defender',
        attackerId: 'user-token',
        attackerName: 'Attacker',
        moveName: 'Ember',
      }])

      await panel.applySpiteReactionPrompt(panel.spiteReactionPrompts.value[0]!.id)

      expect(conditionCalls).toEqual([{ id: 'user-token', conditions: ['Disabled: Ember'] }])
      expect(panel.spiteReactionPrompts.value).toEqual([])
    } finally {
      random.mockRestore()
      vi.useRealTimers()
    }
  })

  it('queues and applies an ignorable Cute Charm prompt after an opposite-gender attack, even on a miss', async () => {
    vi.useFakeTimers()
    const map = ref({
      ...mapFixture(),
      placements: [
        { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'attacker', position: { x: 0, y: 0, z: 0 } },
        { id: 'target-token', sheetKind: 'pokemon' as const, sheetSlug: 'defender', position: { x: 2, y: 0, z: 0 } },
      ],
    })
    const attackerSheet = {
      slug: 'attacker',
      nickname: 'Attacker',
      species: 'Charmander',
      level: 5,
      movelist: [{ name: 'Ember' }],
    } as CharacterSheet
    const defenderSheet = {
      slug: 'defender',
      nickname: 'Defender',
      species: 'Vulpix Alola',
      level: 5,
      abilities: [{ name: 'Cute Charm' }],
    } as CharacterSheet
    const conditionCalls: MoveAutomationTransaction['conditionUpdates'] = []
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned({ id: 'user-token', species: 'Attacker', sheetSlug: 'attacker', gender: 'Male', position: { x: 0, y: 0, z: 0 } }),
        spawned({ id: 'target-token', species: 'Defender', sheetSlug: 'defender', gender: 'Female', abilityNames: ['Cute Charm'], currentHp: 40, maxHp: 40, position: { x: 2, y: 0, z: 0 } }),
      ]),
      pokemonBySlug: ref(new Map([
        [attackerSheet.slug, attackerSheet],
        [defenderSheet.slug, defenderSheet],
      ])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: () => undefined,
      modifyCombatStages: () => undefined,
      modifyConditions: (update) => { conditionCalls.push(update) },
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
    })
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)

    try {
      panel.openMoveAutomation({ id: 'user-token', moveName: 'Ember' })
      await panel.selectMoveAutomationTarget('target-token')
      expect(panel.cuteCharmReactionPrompts.value).toEqual([])

      await vi.advanceTimersByTimeAsync(MOVE_FEEDBACK_OUTCOME_MS)

      expect(panel.moveAutomationFeedback.value).toMatchObject({ hit: false })
      expect(panel.cuteCharmReactionPrompts.value).toMatchObject([{
        defenderId: 'target-token',
        defenderName: 'Defender',
        attackerId: 'user-token',
        attackerName: 'Attacker',
        moveName: 'Ember',
      }])
      expect(panel.spiteReactionPrompts.value).toEqual([])

      await panel.applyCuteCharmReactionPrompt(panel.cuteCharmReactionPrompts.value[0]!.id)

      expect(conditionCalls).toEqual([{ id: 'user-token', conditions: ['Infatuation: Defender'] }])
      expect(panel.cuteCharmReactionPrompts.value).toEqual([])
    } finally {
      random.mockRestore()
      vi.useRealTimers()
    }
  })

  it('queues and applies an ignorable Poison Point prompt after a melee hit', async () => {
    vi.useFakeTimers()
    const map = ref({
      ...mapFixture(),
      placements: [
        { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'attacker', position: { x: 0, y: 0, z: 0 } },
        { id: 'target-token', sheetKind: 'pokemon' as const, sheetSlug: 'defender', position: { x: 1, y: 0, z: 0 } },
      ],
    })
    const attackerSheet = {
      slug: 'attacker',
      nickname: 'Attacker',
      species: 'Charmander',
      level: 5,
      movelist: [{ name: 'Tackle' }],
    } as CharacterSheet
    const defenderSheet = {
      slug: 'defender',
      nickname: 'Defender',
      species: 'Nidoran♀',
      level: 5,
      abilities: [{ name: 'Poison Point' }],
    } as CharacterSheet
    const conditionCalls: MoveAutomationTransaction['conditionUpdates'] = []
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned({ id: 'user-token', species: 'Attacker', sheetSlug: 'attacker', position: { x: 0, y: 0, z: 0 } }),
        spawned({ id: 'target-token', species: 'Defender', sheetSlug: 'defender', abilityNames: ['Poison Point'], currentHp: 40, maxHp: 40, position: { x: 1, y: 0, z: 0 } }),
      ]),
      pokemonBySlug: ref(new Map([
        [attackerSheet.slug, attackerSheet],
        [defenderSheet.slug, defenderSheet],
      ])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: () => undefined,
      modifyCombatStages: () => undefined,
      modifyConditions: (update) => { conditionCalls.push(update) },
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
    })
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5)

    try {
      panel.openMoveAutomation({ id: 'user-token', moveName: 'Tackle' })
      await panel.selectMoveAutomationTarget('target-token')
      expect(panel.poisonPointReactionPrompts.value).toEqual([])

      await vi.advanceTimersByTimeAsync(MOVE_FEEDBACK_FINAL_MS)

      expect(panel.poisonPointReactionPrompts.value).toMatchObject([{
        defenderId: 'target-token',
        defenderName: 'Defender',
        attackerId: 'user-token',
        attackerName: 'Attacker',
        moveName: 'Tackle',
      }])

      await panel.applyPoisonPointReactionPrompt(panel.poisonPointReactionPrompts.value[0]!.id)

      expect(conditionCalls).toEqual([{ id: 'user-token', conditions: ['Poisoned'] }])
      expect(panel.poisonPointReactionPrompts.value).toEqual([])
    } finally {
      random.mockRestore()
      vi.useRealTimers()
    }
  })

  it('infers Poison Point melee triggers when applying canonical transactions directly', async () => {
    const map = ref({
      ...mapFixture(),
      placements: [
        { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'attacker', position: { x: 0, y: 0, z: 0 } },
        { id: 'target-token', sheetKind: 'pokemon' as const, sheetSlug: 'defender', position: { x: 1, y: 0, z: 0 } },
      ],
    })
    const conditionCalls: MoveAutomationTransaction['conditionUpdates'] = []
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned({ id: 'user-token', species: 'Attacker', sheetSlug: 'attacker' }),
        spawned({ id: 'target-token', species: 'Defender', sheetSlug: 'defender', abilityNames: ['Poison Point'], position: { x: 1, y: 0, z: 0 } }),
      ]),
      pokemonBySlug: ref(new Map<string, CharacterSheet>()),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: () => undefined,
      modifyCombatStages: () => undefined,
      modifyConditions: (update) => { conditionCalls.push(update) },
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
    })

    await panel.applyMoveAutomation({
      userId: 'user-token',
      userName: 'Attacker',
      moveName: 'Tackle',
      scriptKind: 'explicit',
      scriptVersion: 1,
      hitTargetIds: ['target-token'],
      hpUpdates: [],
      combatStageUpdates: [],
      conditionUpdates: [],
      hazardsToAdd: [],
      fieldEffectsToApply: [],
      logLines: ['Attacker used Tackle.'],
    })

    expect(panel.poisonPointReactionPrompts.value).toMatchObject([{
      defenderId: 'target-token',
      attackerId: 'user-token',
      moveName: 'Tackle',
    }])

    await panel.applyPoisonPointReactionPrompt(panel.poisonPointReactionPrompts.value[0]!.id)

    expect(conditionCalls).toEqual([{ id: 'user-token', conditions: ['Poisoned'] }])
  })

  it('queues and applies an optional Moxie prompt after a target faints', async () => {
    const map = ref({
      ...mapFixture(),
      placements: [
        { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'attacker', position: { x: 0, y: 0, z: 0 } },
        { id: 'target-token', sheetKind: 'pokemon' as const, sheetSlug: 'target', position: { x: 2, y: 0, z: 0 } },
      ],
    })
    const calls: string[] = []
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned({ id: 'user-token', species: 'Attacker', sheetSlug: 'attacker', abilityNames: ['Moxie'], combatStages: { atk: 2, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 } }),
        spawned({ id: 'target-token', species: 'Target', sheetSlug: 'target', currentHp: 3, maxHp: 10, position: { x: 2, y: 0, z: 0 } }),
      ]),
      pokemonBySlug: ref(new Map<string, CharacterSheet>()),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: (update) => { calls.push(`hp:${update.id}:${update.currentHp}`) },
      modifyCombatStages: (update) => { calls.push(`stages:${update.id}:${update.stages.atk}`) },
      modifyConditions: () => undefined,
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
    })

    await panel.applyMoveAutomation({
      userId: 'user-token',
      userName: 'Attacker',
      moveName: 'Bite',
      scriptKind: 'explicit',
      scriptVersion: 1,
      hitTargetIds: ['target-token'],
      hpUpdates: [{ id: 'target-token', currentHp: 0 }],
      combatStageUpdates: [],
      conditionUpdates: [],
      hazardsToAdd: [],
      fieldEffectsToApply: [],
      logLines: ['Attacker used Bite.'],
    })

    expect(calls).toEqual(['hp:target-token:0'])
    expect(panel.moxieTriggerPrompts.value).toMatchObject([{
      attackerId: 'user-token',
      attackerName: 'Attacker',
      moveName: 'Bite',
      faintedTargetNames: ['Target'],
    }])

    await panel.applyMoxieTriggerPrompt(panel.moxieTriggerPrompts.value[0]!.id)

    expect(calls).toEqual(['hp:target-token:0', 'stages:user-token:3'])
    expect(panel.moxieTriggerPrompts.value).toEqual([])
  })

  it('queues and logs an optional Celebrate prompt after a damaging hit', async () => {
    vi.useFakeTimers()
    const map = ref({
      ...mapFixture(),
      placements: [
        { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'attacker', position: { x: 0, y: 0, z: 0 } },
        { id: 'target-token', sheetKind: 'pokemon' as const, sheetSlug: 'target', position: { x: 2, y: 0, z: 0 } },
      ],
    })
    const attackerSheet = {
      slug: 'attacker',
      nickname: 'Attacker',
      species: 'Charmander',
      level: 5,
      movelist: [{ name: 'Ember' }],
    } as CharacterSheet
    const hpCalls: MoveAutomationTransaction['hpUpdates'] = []
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned({ id: 'user-token', species: 'Attacker', sheetSlug: 'attacker', abilityNames: ['Celebrate'], position: { x: 0, y: 0, z: 0 } }),
        spawned({ id: 'target-token', species: 'Target', sheetSlug: 'target', currentHp: 40, maxHp: 40, defenderTypes: ['Grass'], position: { x: 2, y: 0, z: 0 } }),
      ]),
      pokemonBySlug: ref(new Map([[attackerSheet.slug, attackerSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: (update) => { hpCalls.push(update) },
      modifyCombatStages: () => undefined,
      modifyConditions: () => undefined,
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
      now: () => 222,
    })
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5)

    try {
      panel.openMoveAutomation({ id: 'user-token', moveName: 'Ember' })
      await panel.selectMoveAutomationTarget('target-token')

      await vi.advanceTimersByTimeAsync(MOVE_FEEDBACK_EFFECTIVE_FINAL_MS)

      expect(hpCalls.length).toBeGreaterThan(0)
      expect(panel.celebrateTriggerPrompts.value).toMatchObject([{
        attackerId: 'user-token',
        attackerName: 'Attacker',
        moveName: 'Ember',
        hitTargetNames: ['Target'],
      }])

      panel.applyCelebrateTriggerPrompt(panel.celebrateTriggerPrompts.value[0]!.id)

      expect(panel.celebrateTriggerPrompts.value).toEqual([])
      expect(map.value.metadata?.abilityLog).toMatchObject([{
        at: 222,
        userId: 'user-token',
        abilityName: 'Celebrate',
        category: 'map',
        lines: [
          'Attacker triggered Celebrate after hitting Target.',
          'Attacker may immediately Disengage 1 meter as a Free Action without provoking an Attack of Opportunity.',
        ],
      }])
    } finally {
      random.mockRestore()
      vi.useRealTimers()
    }
  })

  it('applies sheet updates, gates map effects by GM permission, appends logs, and faces targets', async () => {
    const map = ref({
      ...mapFixture(),
      placements: [
        { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'bolt', position: { x: 0, y: 0, z: 0 } },
        { id: 'target-token', sheetKind: 'pokemon' as const, sheetSlug: 'target', position: { x: -1, y: 0, z: -1 } },
      ],
    })
    const calls: string[] = []
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned(),
        spawned({ id: 'target-token', species: 'Target', sheetSlug: 'target', position: { x: -1, y: 0, z: -1 } }),
      ]),
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
    expect(map.value.placements[0]).toMatchObject({ facing: 'north-west', turned: true })
    expect(map.value.metadata?.moveLog).toMatchObject([
      { at: 1234, userId: 'user-token', moveName: 'Tackle', lines: ['Rolled Tackle.'] },
    ])
  })

  it('records tracked move usage before applying self-only reviewed moves', async () => {
    const map = ref(mapFixture())
    const pokemonSheet = {
      slug: 'bolt',
      nickname: 'Bolt',
      species: 'Bulbasaur',
      level: 5,
      movelist: [{ name: 'Swords Dance' }],
    } as CharacterSheet
    const calls: string[] = []
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [spawned({ combatStages: { atk: 1, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 } })]),
      pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: () => undefined,
      modifyCombatStages: (update) => { calls.push(`stages:${update.id}:${update.stages.atk}`) },
      modifyConditions: () => undefined,
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
      recordMoveUsage: async (request) => { calls.push(`usage:${request.placementId}:${request.moveName}`) },
    })

    panel.openMoveAutomation({ id: 'user-token', moveName: 'Swords Dance' })
    await Promise.resolve()
    await Promise.resolve()

    expect(calls).toEqual(['usage:user-token:Swords Dance', 'stages:user-token:3'])
    expect(panel.moveUsageError.value).toBeNull()
  })

  it('does not enqueue self-resolving VFX when tracked usage recording fails', async () => {
    const map = ref(mapFixture())
    const pokemonSheet = {
      slug: 'bolt',
      nickname: 'Bolt',
      species: 'Bulbasaur',
      level: 5,
      movelist: [{ name: 'Swords Dance' }],
    } as CharacterSheet
    const calls: string[] = []
    const enqueueMoveAnimations = vi.fn((_events: readonly MoveAnimationEvent[]) => undefined)
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [spawned({ combatStages: { atk: 1, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 } })]),
      pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: () => undefined,
      modifyCombatStages: (update) => { calls.push(`stages:${update.id}:${update.stages.atk}`) },
      modifyConditions: () => undefined,
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
      recordMoveUsage: async () => { throw new Error('No remaining uses') },
      enqueueMoveAnimations,
    })

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      panel.openMoveAutomation({ id: 'user-token', moveName: 'Swords Dance' })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    } finally {
      warn.mockRestore()
    }

    expect(calls).toEqual([])
    expect(enqueueMoveAnimations).not.toHaveBeenCalled()
    expect(panel.moveAutomationFeedback.value).toBeNull()
    expect(panel.moveAutomationTargeting.value).toBeNull()
    expect(panel.moveUsageError.value).toBe('No remaining uses')
    expect(map.value.metadata?.moveLog).toBeUndefined()
  })

  it('does not enqueue self-resolving VFX when token control is revoked during usage recording', async () => {
    const map = ref(mapFixture())
    const canControlUser = ref(true)
    const pokemonSheet = {
      slug: 'bolt',
      nickname: 'Bolt',
      species: 'Bulbasaur',
      level: 5,
      movelist: [{ name: 'Swords Dance' }],
    } as CharacterSheet
    const calls: string[] = []
    const enqueueMoveAnimations = vi.fn((_events: readonly MoveAnimationEvent[]) => undefined)
    let resolveUsage!: () => void
    const recordMoveUsage = vi.fn(() => new Promise<void>((resolve) => {
      resolveUsage = resolve
    }))
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [spawned({ combatStages: { atk: 1, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 } })]),
      pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token' && canControlUser.value,
      modifyHp: () => undefined,
      modifyCombatStages: (update) => { calls.push(`stages:${update.id}:${update.stages.atk}`) },
      modifyConditions: () => undefined,
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
      recordMoveUsage,
      enqueueMoveAnimations,
    })

    panel.openMoveAutomation({ id: 'user-token', moveName: 'Swords Dance' })
    expect(recordMoveUsage).toHaveBeenCalledTimes(1)

    canControlUser.value = false
    resolveUsage()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(calls).toEqual([])
    expect(enqueueMoveAnimations).not.toHaveBeenCalled()
    expect(panel.moveAutomationTargeting.value).toBeNull()
    expect(panel.moveAutomationFeedback.value).toBeNull()
    expect(map.value.metadata?.moveLog).toBeUndefined()
  })

  it('does not confirm area VFX when token control is revoked before confirmation', async () => {
    const map = ref({
      ...mapFixture(),
      dimensions: { x: 8, y: 2, z: 8 },
      placements: [
        { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'bolt', position: { x: 3, y: 0, z: 3 } },
        { id: 'target-token', sheetKind: 'pokemon' as const, sheetSlug: 'target', position: { x: 3, y: 0, z: 4 } },
      ],
    })
    const canControlUser = ref(true)
    const pokemonSheet = {
      slug: 'bolt',
      nickname: 'Bolt',
      species: 'Bulbasaur',
      level: 5,
      movelist: [{ name: 'Growl' }],
    } as CharacterSheet
    const calls: string[] = []
    const enqueueMoveAnimations = vi.fn((_events: readonly MoveAnimationEvent[]) => undefined)
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned({ id: 'user-token', sheetSlug: 'bolt', position: { x: 3, y: 0, z: 3 } }),
        spawned({ id: 'target-token', species: 'Target', sheetSlug: 'target', position: { x: 3, y: 0, z: 4 } }),
      ]),
      pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token' && canControlUser.value,
      modifyHp: () => undefined,
      modifyCombatStages: (update) => { calls.push(`stages:${update.id}:${update.stages.atk}`) },
      modifyConditions: () => undefined,
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
      enqueueMoveAnimations,
    })

    panel.openMoveAutomation({ id: 'user-token', moveName: 'Growl' })
    expect(panel.moveAutomationTargeting.value).toMatchObject({ mode: 'area-confirmation', moveName: 'Growl' })

    canControlUser.value = false
    await panel.selectMoveAutomationTarget('user-token')

    expect(calls).toEqual([])
    expect(enqueueMoveAnimations).not.toHaveBeenCalled()
    expect(panel.moveAutomationTargeting.value).toBeNull()
    expect(panel.moveAutomationFeedback.value).toBeNull()
    expect(map.value.metadata?.moveLog).toBeUndefined()
  })

  it('enqueues generic self-centered VFX for self-resolving moves before applying mechanics', async () => {
    const map = ref(mapFixture())
    const pokemonSheet = {
      slug: 'bolt',
      nickname: 'Bolt',
      species: 'Bulbasaur',
      level: 5,
      movelist: [{ name: 'Swords Dance' }],
    } as CharacterSheet
    const calls: string[] = []
    const enqueueMoveAnimations = vi.fn((events: readonly MoveAnimationEvent[]) => {
      calls.push(`vfx:${events[0]?.kind}`)
    })
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [spawned({ combatStages: { atk: 1, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 } })]),
      pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: () => undefined,
      modifyCombatStages: (update) => { calls.push(`stages:${update.id}:${update.stages.atk}`) },
      modifyConditions: () => undefined,
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
      recordMoveUsage: async (request) => { calls.push(`usage:${request.placementId}:${request.moveName}`) },
      enqueueMoveAnimations,
      now: () => 5000,
    })

    panel.openMoveAutomation({ id: 'user-token', moveName: 'Swords Dance' })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(calls).toEqual(['usage:user-token:Swords Dance', 'vfx:buff-debuff', 'stages:user-token:3'])
    expect(enqueueMoveAnimations).toHaveBeenCalledTimes(1)
    const events = enqueueMoveAnimations.mock.calls[0]?.[0] ?? []
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      id: expect.stringContaining('swords-dance'),
      kind: MOVE_VFX_KIND.buffDebuff,
      moveName: 'Swords Dance',
      userId: 'user-token',
      createdAtMs: 5000,
      targetId: 'user-token',
      targetCell: { x: 0, y: 0, z: 0 },
      tone: 'buff',
      direction: 'buff',
    })
    expect(panel.moveAutomationTargeting.value).toBeNull()
    expect(map.value.metadata?.moveLog).toMatchObject([{ moveName: 'Swords Dance', scriptKind: 'explicit' }])
  })

  it('enqueues hit, miss, and crit VFX for accuracy-based single-target roll feedback', async () => {
    vi.useFakeTimers()
    const scenarios: Array<{
      label: string
      random: number
      expectedFollowUps: Array<MoveAnimationEvent['kind']>
      rejectedFollowUps: Array<MoveAnimationEvent['kind']>
    }> = [
      {
        label: 'hit',
        random: 0.5,
        expectedFollowUps: [MOVE_VFX_KIND.targetFlash],
        rejectedFollowUps: [MOVE_VFX_KIND.miss, MOVE_VFX_KIND.crit],
      },
      {
        label: 'miss',
        random: 0,
        expectedFollowUps: [MOVE_VFX_KIND.miss],
        rejectedFollowUps: [MOVE_VFX_KIND.targetFlash, MOVE_VFX_KIND.crit],
      },
      {
        label: 'crit',
        random: 0.99,
        expectedFollowUps: [MOVE_VFX_KIND.targetFlash, MOVE_VFX_KIND.crit],
        rejectedFollowUps: [MOVE_VFX_KIND.miss],
      },
    ]

    try {
      for (const scenario of scenarios) {
        const map = ref({
          ...mapFixture(),
          placements: [
            { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'attacker', position: { x: 0, y: 0, z: 0 } },
            { id: 'target-token', sheetKind: 'pokemon' as const, sheetSlug: 'target', position: { x: 2, y: 0, z: 0 } },
          ],
        })
        const pokemonSheet = {
          slug: 'attacker',
          nickname: 'Attacker',
          species: 'Charmander',
          level: 5,
          movelist: [{ name: 'Ember' }],
        } as CharacterSheet
        const hpCalls: MoveAutomationTransaction['hpUpdates'] = []
        const enqueueMoveAnimations = vi.fn((_events: readonly MoveAnimationEvent[]) => undefined)
        const panel = useMoveAutomationPanel({
          map,
          spawnedPokemon: computed(() => [
            spawned({ id: 'user-token', species: 'Attacker', sheetSlug: 'attacker', position: { x: 0, y: 0, z: 0 } }),
            spawned({ id: 'target-token', species: 'Target', sheetSlug: 'target', currentHp: 40, maxHp: 40, defenderTypes: ['Grass'], position: { x: 2, y: 0, z: 0 } }),
          ]),
          pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
          trainerBySlug: ref(new Map<string, TrainerSheet>()),
          canEditMap: computed(() => false),
          canControlPlacement: (id) => id === 'user-token',
          modifyHp: (update) => { hpCalls.push(update) },
          modifyCombatStages: () => undefined,
          modifyConditions: () => undefined,
          applyMoveFieldEffect: () => undefined,
          placeHazard: () => undefined,
          enqueueMoveAnimations,
          now: () => 9000,
        })
        const random = vi.spyOn(Math, 'random').mockReturnValue(scenario.random)

        try {
          panel.openMoveAutomation({ id: 'user-token', moveName: 'Ember' })
          await panel.selectMoveAutomationTarget('target-token')
        } finally {
          random.mockRestore()
        }

        expect(enqueueMoveAnimations, scenario.label).toHaveBeenCalledTimes(1)
        const events = enqueueMoveAnimations.mock.calls[0]?.[0] ?? []
        const eventKinds = events.map((event) => event.kind)
        expect([
          MOVE_VFX_KIND.projectile,
          MOVE_VFX_KIND.beam,
          MOVE_VFX_KIND.arc,
          MOVE_VFX_KIND.meleeLunge,
        ], scenario.label).toContain(events[0]?.kind)
        for (const expectedKind of scenario.expectedFollowUps) {
          expect(eventKinds, scenario.label).toContain(expectedKind)
        }
        for (const rejectedKind of scenario.rejectedFollowUps) {
          expect(eventKinds, scenario.label).not.toContain(rejectedKind)
        }
        expect(events[0], scenario.label).toMatchObject({
          moveName: 'Ember',
          userId: 'user-token',
          createdAtMs: 9000,
          targetId: 'target-token',
          originCell: { x: 0, y: 0, z: 0 },
          targetCell: { x: 2, y: 0, z: 0 },
        })
        expect(events[0]?.startOffsetMs, scenario.label).toBeUndefined()
        const semanticFollowUpKinds = new Set<MoveAnimationEvent['kind']>([
          MOVE_VFX_KIND.healing,
          MOVE_VFX_KIND.buffDebuff,
          MOVE_VFX_KIND.status,
        ])
        for (const event of events.slice(1)) {
          const expectedStartOffset = semanticFollowUpKinds.has(event.kind)
            ? MOVE_FEEDBACK_EFFECTIVE_FINAL_MS
            : MOVE_FEEDBACK_OUTCOME_MS
          expect(event.startOffsetMs, `${scenario.label}:${event.kind}`).toBe(expectedStartOffset)
        }

        if (scenario.label === 'hit') {
          expect(hpCalls).toEqual([])
          await vi.advanceTimersByTimeAsync(MOVE_FEEDBACK_EFFECTIVE_FINAL_MS)
          expect(hpCalls.length).toBeGreaterThan(0)
        }

        vi.clearAllTimers()
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('delays accuracy-roll semantic VFX until the feedback damage phase', async () => {
    vi.useFakeTimers()
    const map = ref({
      ...mapFixture(),
      placements: [
        { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'attacker', position: { x: 0, y: 0, z: 0 } },
        { id: 'target-token', sheetKind: 'pokemon' as const, sheetSlug: 'target', position: { x: 1, y: 0, z: 0 } },
      ],
    })
    const pokemonSheet = {
      slug: 'attacker',
      nickname: 'Attacker',
      species: 'Pikachu',
      level: 5,
      movelist: [{ name: 'Nuzzle' }],
    } as CharacterSheet
    const calls: string[] = []
    const enqueueMoveAnimations = vi.fn((_events: readonly MoveAnimationEvent[]) => undefined)
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned({ id: 'user-token', species: 'Attacker', sheetSlug: 'attacker', position: { x: 0, y: 0, z: 0 } }),
        spawned({ id: 'target-token', species: 'Target', sheetSlug: 'target', currentHp: 40, maxHp: 40, defenderTypes: ['Normal'], position: { x: 1, y: 0, z: 0 } }),
      ]),
      pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: (update) => { calls.push(`hp:${update.id}:${update.currentHp}`) },
      modifyCombatStages: () => undefined,
      modifyConditions: (update) => { calls.push(`conditions:${update.id}:${update.conditions.join(',')}`) },
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
      enqueueMoveAnimations,
      now: () => 9100,
    })
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5)

    try {
      panel.openMoveAutomation({ id: 'user-token', moveName: 'Nuzzle' })
      await panel.selectMoveAutomationTarget('target-token')
    } finally {
      random.mockRestore()
    }

    expect(enqueueMoveAnimations).toHaveBeenCalledTimes(1)
    const events = enqueueMoveAnimations.mock.calls[0]?.[0] ?? []
    const launchEvent = events[0]
    const impactEvent = events.find((event) => event.kind === MOVE_VFX_KIND.targetFlash)
    const statusEvent = events.find((event) => event.kind === MOVE_VFX_KIND.status)
    expect([
      MOVE_VFX_KIND.projectile,
      MOVE_VFX_KIND.beam,
      MOVE_VFX_KIND.arc,
      MOVE_VFX_KIND.meleeLunge,
    ]).toContain(launchEvent?.kind)
    expect(launchEvent?.startOffsetMs).toBeUndefined()
    expect(impactEvent?.startOffsetMs).toBe(MOVE_FEEDBACK_OUTCOME_MS)
    expect(statusEvent).toMatchObject({
      targetId: 'target-token',
      startOffsetMs: MOVE_FEEDBACK_FINAL_MS,
      conditionNames: ['Paralysis'],
    })

    expect(calls).toEqual([])
    await vi.advanceTimersByTimeAsync(MOVE_FEEDBACK_OUTCOME_MS)
    expect(calls).toEqual([])
    await vi.advanceTimersByTimeAsync(MOVE_FEEDBACK_FINAL_MS - MOVE_FEEDBACK_OUTCOME_MS)
    expect(calls).toEqual(expect.arrayContaining(['conditions:target-token:Paralysis']))
    vi.useRealTimers()
  })

  it('still applies self-resolving move mechanics when VFX enqueue fails', async () => {
    const map = ref(mapFixture())
    const pokemonSheet = {
      slug: 'bolt',
      nickname: 'Bolt',
      species: 'Bulbasaur',
      level: 5,
      movelist: [{ name: 'Swords Dance' }],
    } as CharacterSheet
    const calls: string[] = []
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [spawned({ combatStages: { atk: 1, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 } })]),
      pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: () => undefined,
      modifyCombatStages: (update) => { calls.push(`stages:${update.id}:${update.stages.atk}`) },
      modifyConditions: () => undefined,
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
      enqueueMoveAnimations: () => { throw new Error('VFX queue unavailable') },
      now: () => 5000,
    })

    try {
      panel.openMoveAutomation({ id: 'user-token', moveName: 'Swords Dance' })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    } finally {
      warn.mockRestore()
    }

    expect(calls).toEqual(['stages:user-token:3'])
    expect(map.value.metadata?.moveLog).toMatchObject([{ moveName: 'Swords Dance', scriptKind: 'explicit' }])
  })

  it('does not apply a move when tracked usage recording fails', async () => {
    const map = ref({
      ...mapFixture(),
      placements: [
        { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'caster', position: { x: 0, y: 0, z: 0 } },
        { id: 'target-token', sheetKind: 'pokemon' as const, sheetSlug: 'target', position: { x: 2, y: 0, z: 0 } },
      ],
    })
    const pokemonSheet = {
      slug: 'caster',
      nickname: 'Caster',
      species: 'Charmander',
      level: 5,
      movelist: [{ name: 'Will-O-Wisp' }],
    } as CharacterSheet
    const conditionCalls: MoveAutomationTransaction['conditionUpdates'] = []
    const enqueueMoveAnimations = vi.fn((_events: readonly MoveAnimationEvent[]) => undefined)
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned({ id: 'user-token', species: 'Caster', sheetSlug: 'caster', position: { x: 0, y: 0, z: 0 } }),
        spawned({ id: 'target-token', species: 'Target', sheetSlug: 'target', currentHp: 40, maxHp: 40, defenderTypes: ['Grass'], position: { x: 2, y: 0, z: 0 } }),
      ]),
      pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: () => undefined,
      modifyCombatStages: () => undefined,
      modifyConditions: (update) => { conditionCalls.push(update) },
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
      recordMoveUsage: async () => { throw new Error('No remaining uses') },
      enqueueMoveAnimations,
    })

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      panel.openMoveAutomation({ id: 'user-token', moveName: 'Will-O-Wisp' })
      await panel.selectMoveAutomationTarget('target-token')
    } finally {
      warn.mockRestore()
    }

    expect(conditionCalls).toEqual([])
    expect(enqueueMoveAnimations).not.toHaveBeenCalled()
    expect(panel.moveAutomationFeedback.value).toBeNull()
    expect(panel.moveAutomationTargeting.value).toMatchObject({ moveName: 'Will-O-Wisp' })
    expect(panel.moveUsageError.value).toBe('No remaining uses')
  })

  it('does not enqueue VFX or apply mechanics when targeting is cancelled before selecting a target', async () => {
    const map = ref({
      ...mapFixture(),
      placements: [
        { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'caster', position: { x: 0, y: 0, z: 0 } },
        { id: 'target-token', sheetKind: 'pokemon' as const, sheetSlug: 'target', position: { x: 2, y: 0, z: 0 } },
      ],
    })
    const pokemonSheet = {
      slug: 'caster',
      nickname: 'Caster',
      species: 'Charmander',
      level: 5,
      movelist: [{ name: 'Ember' }],
    } as CharacterSheet
    const hpCalls: MoveAutomationTransaction['hpUpdates'] = []
    const enqueueMoveAnimations = vi.fn((_events: readonly MoveAnimationEvent[]) => undefined)
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned({ id: 'user-token', species: 'Caster', sheetSlug: 'caster', position: { x: 0, y: 0, z: 0 } }),
        spawned({ id: 'target-token', species: 'Target', sheetSlug: 'target', currentHp: 40, maxHp: 40, defenderTypes: ['Grass'], position: { x: 2, y: 0, z: 0 } }),
      ]),
      pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: (update) => { hpCalls.push(update) },
      modifyCombatStages: () => undefined,
      modifyConditions: () => undefined,
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
      enqueueMoveAnimations,
    })

    panel.openMoveAutomation({ id: 'user-token', moveName: 'Ember' })
    expect(panel.moveAutomationTargeting.value).toMatchObject({
      mode: 'target',
      moveName: 'Ember',
      candidateIds: ['target-token'],
    })

    panel.cancelMoveAutomationTargeting()
    await panel.selectMoveAutomationTarget('target-token')

    expect(panel.moveAutomationTargeting.value).toBeNull()
    expect(panel.moveAutomationFeedback.value).toBeNull()
    expect(hpCalls).toEqual([])
    expect(enqueueMoveAnimations).not.toHaveBeenCalled()
    expect(map.value.metadata?.moveLog).toBeUndefined()
  })

  it('drops in-flight single-target VFX and mechanics when targeting is cancelled during usage recording', async () => {
    const map = ref({
      ...mapFixture(),
      placements: [
        { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'caster', position: { x: 0, y: 0, z: 0 } },
        { id: 'target-token', sheetKind: 'pokemon' as const, sheetSlug: 'target', position: { x: 2, y: 0, z: 0 } },
      ],
    })
    const pokemonSheet = {
      slug: 'caster',
      nickname: 'Caster',
      species: 'Charmander',
      level: 5,
      movelist: [{ name: 'Will-O-Wisp' }],
    } as CharacterSheet
    const conditionCalls: MoveAutomationTransaction['conditionUpdates'] = []
    const enqueueMoveAnimations = vi.fn((_events: readonly MoveAnimationEvent[]) => undefined)
    let resolveUsage!: () => void
    const recordMoveUsage = vi.fn(() => new Promise<void>((resolve) => {
      resolveUsage = resolve
    }))
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned({ id: 'user-token', species: 'Caster', sheetSlug: 'caster', position: { x: 0, y: 0, z: 0 } }),
        spawned({ id: 'target-token', species: 'Target', sheetSlug: 'target', currentHp: 40, maxHp: 40, defenderTypes: ['Grass'], position: { x: 2, y: 0, z: 0 } }),
      ]),
      pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: () => undefined,
      modifyCombatStages: () => undefined,
      modifyConditions: (update) => { conditionCalls.push(update) },
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
      recordMoveUsage,
      enqueueMoveAnimations,
    })

    panel.openMoveAutomation({ id: 'user-token', moveName: 'Will-O-Wisp' })

    expect(panel.moveAutomationTargeting.value).toMatchObject({ moveName: 'Will-O-Wisp' })
    expect(enqueueMoveAnimations).not.toHaveBeenCalled()

    const selection = panel.selectMoveAutomationTarget('target-token')
    expect(recordMoveUsage).toHaveBeenCalledTimes(1)

    panel.cancelMoveAutomationTargeting()
    resolveUsage()
    await selection

    expect(panel.moveAutomationTargeting.value).toBeNull()
    expect(panel.moveAutomationFeedback.value).toBeNull()
    expect(conditionCalls).toEqual([])
    expect(enqueueMoveAnimations).not.toHaveBeenCalled()
    expect(map.value.metadata?.moveLog).toBeUndefined()
  })

  it('applies self-only reviewed moves immediately without opening the wizard', async () => {
    const map = ref(mapFixture())
    const pokemonSheet = {
      slug: 'bolt',
      nickname: 'Bolt',
      species: 'Bulbasaur',
      level: 5,
      movelist: [{ name: 'Swords Dance' }],
    } as CharacterSheet
    const calls: string[] = []
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [spawned({ combatStages: { atk: 1, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 } })]),
      pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: () => undefined,
      modifyCombatStages: (update) => { calls.push(`stages:${update.id}:${update.stages.atk}`) },
      modifyConditions: () => undefined,
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
    })

    panel.openMoveAutomation({ id: 'user-token', moveName: 'Swords Dance' })
    await Promise.resolve()
    await Promise.resolve()

    expect(panel.moveAutomationTargeting.value).toBeNull()
    expect(calls).toEqual(['stages:user-token:3'])
    expect(map.value.metadata?.moveLog).toMatchObject([{ moveName: 'Swords Dance', scriptKind: 'explicit' }])
  })

  it('opens no-accuracy target buffs with targeting overlay and applies them directly', async () => {
    const map = ref({
      ...mapFixture(),
      placements: [
        { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'helper', position: { x: 0, y: 0, z: 0 } },
        { id: 'target-token', sheetKind: 'pokemon' as const, sheetSlug: 'target', position: { x: 2, y: 0, z: 0 } },
      ],
    })
    const pokemonSheet = {
      slug: 'helper',
      nickname: 'Helper',
      species: 'Plusle',
      level: 5,
      movelist: [{ name: 'Helping Hand' }],
    } as CharacterSheet
    const conditionCalls: MoveAutomationTransaction['conditionUpdates'] = []
    const enqueueMoveAnimations = vi.fn((_events: readonly MoveAnimationEvent[]) => undefined)
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned({ id: 'user-token', species: 'Helper', sheetSlug: 'helper', position: { x: 0, y: 0, z: 0 } }),
        spawned({ id: 'target-token', species: 'Target', sheetSlug: 'target', position: { x: 2, y: 0, z: 0 } }),
      ]),
      pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: () => undefined,
      modifyCombatStages: () => undefined,
      modifyConditions: (update) => { conditionCalls.push(update) },
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
      enqueueMoveAnimations,
      now: () => 11000,
    })

    panel.openMoveAutomation({ id: 'user-token', moveName: 'Helping Hand' })

    expect(panel.moveAutomationTargeting.value).toMatchObject({
      mode: 'target',
      moveName: 'Helping Hand',
      rangeLabel: '4m',
      candidateIds: ['target-token'],
    })

    await panel.selectMoveAutomationTarget('target-token')

    expect(panel.moveAutomationFeedback.value).toBeNull()
    expect(conditionCalls).toEqual([{ id: 'target-token', conditions: ['Helping Hand'] }])
    expect(enqueueMoveAnimations).toHaveBeenCalledTimes(1)
    const events = enqueueMoveAnimations.mock.calls[0]?.[0] ?? []
    expect(events).toEqual([
      expect.objectContaining({
        id: expect.stringContaining('helping-hand'),
        kind: MOVE_VFX_KIND.status,
        moveName: 'Helping Hand',
        userId: 'user-token',
        createdAtMs: 11000,
        targetId: 'target-token',
        targetCell: { x: 2, y: 0, z: 0 },
        conditionNames: ['Helping Hand'],
      }),
    ])
    expect(events.every((event) => event.startOffsetMs == null)).toBe(true)
    expect(map.value.metadata?.moveLog).toMatchObject([{ moveName: 'Helping Hand', scriptKind: 'explicit' }])
  })

  it('opens cannot-miss damaging moves with targeting overlay, enqueues hit VFX, and applies damage directly', async () => {
    const map = ref({
      ...mapFixture(),
      placements: [
        { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'caster', position: { x: 0, y: 0, z: 0 } },
        { id: 'target-token', sheetKind: 'pokemon' as const, sheetSlug: 'target', position: { x: 2, y: 0, z: 0 } },
      ],
    })
    const pokemonSheet = {
      slug: 'caster',
      nickname: 'Caster',
      species: 'Chikorita',
      level: 5,
      movelist: [{ name: 'Magical Leaf' }],
    } as CharacterSheet
    const calls: string[] = []
    const enqueueMoveAnimations = vi.fn((events: readonly MoveAnimationEvent[]) => {
      calls.push(`vfx:${events.length}`)
    })
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned({ id: 'user-token', species: 'Caster', sheetSlug: 'caster', position: { x: 0, y: 0, z: 0 } }),
        spawned({ id: 'target-token', species: 'Target', sheetSlug: 'target', currentHp: 30, maxHp: 30, defenderTypes: [], position: { x: 2, y: 0, z: 0 } }),
      ]),
      pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: (update) => { calls.push(`hp:${update.id}:${update.currentHp}`) },
      modifyCombatStages: () => undefined,
      modifyConditions: () => undefined,
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
      enqueueMoveAnimations,
      now: () => 12000,
    })

    panel.openMoveAutomation({ id: 'user-token', moveName: 'Magical Leaf' })

    expect(panel.moveAutomationTargeting.value).toMatchObject({
      mode: 'target',
      moveName: 'Magical Leaf',
      rangeLabel: '8m',
      candidateIds: ['target-token'],
    })

    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      await panel.selectMoveAutomationTarget('target-token')
    } finally {
      random.mockRestore()
    }

    expect(panel.moveAutomationFeedback.value).toBeNull()
    expect(calls).toEqual(['vfx:2', 'hp:target-token:18'])
    expect(enqueueMoveAnimations).toHaveBeenCalledTimes(1)
    const events = enqueueMoveAnimations.mock.calls[0]?.[0] ?? []
    expect(events.map((event) => event.kind)).toEqual(expect.arrayContaining([
      MOVE_VFX_KIND.targetFlash,
    ]))
    expect([
      MOVE_VFX_KIND.projectile,
      MOVE_VFX_KIND.beam,
      MOVE_VFX_KIND.arc,
      MOVE_VFX_KIND.meleeLunge,
    ]).toContain(events[0]?.kind)
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: expect.stringContaining('magical-leaf'),
        kind: MOVE_VFX_KIND.targetFlash,
        moveName: 'Magical Leaf',
        userId: 'user-token',
        createdAtMs: 12000,
        targetId: 'target-token',
        targetCell: { x: 2, y: 0, z: 0 },
        shake: true,
      }),
    ]))
    expect(events.every((event) => event.startOffsetMs == null)).toBe(true)
    expect(map.value.metadata?.moveLog).toMatchObject([{ moveName: 'Magical Leaf', scriptKind: 'explicit' }])
  })

  it('opens Acupressure as a self-or-target overlay and applies the rolled boost', async () => {
    vi.useFakeTimers()
    const map = ref({
      ...mapFixture(),
      placements: [
        { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'helper', position: { x: 0, y: 0, z: 0 } },
        { id: 'target-token', sheetKind: 'pokemon' as const, sheetSlug: 'target', position: { x: 1, y: 0, z: 0 } },
      ],
    })
    const pokemonSheet = {
      slug: 'helper',
      nickname: 'Helper',
      species: 'Scab',
      level: 5,
      movelist: [{ name: 'Acupressure' }],
    } as CharacterSheet
    const calls: string[] = []
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned({ id: 'user-token', species: 'Helper', sheetSlug: 'helper', position: { x: 0, y: 0, z: 0 } }),
        spawned({ id: 'target-token', species: 'Target', sheetSlug: 'target', position: { x: 1, y: 0, z: 0 } }),
      ]),
      pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: () => undefined,
      modifyCombatStages: (update) => { calls.push(`stages:${update.id}:${update.stages.sdef}`) },
      modifyConditions: () => undefined,
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
    })
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5)

    try {
      panel.openMoveAutomation({ id: 'user-token', moveName: 'Acupressure' })

        expect(panel.moveAutomationTargeting.value).toMatchObject({
        mode: 'target',
        moveName: 'Acupressure',
        rangeLabel: '1m',
        candidateIds: ['user-token', 'target-token'],
      })

      await panel.selectMoveAutomationTarget('user-token')

      expect(panel.moveAutomationFeedback.value).toMatchObject({
        moveName: 'Acupressure',
        naturalRoll: 11,
        hit: true,
        damageLoss: 0,
      })

      await vi.advanceTimersByTimeAsync(MOVE_FEEDBACK_OUTCOME_MS)

      expect(calls).toEqual(['stages:user-token:2'])
      expect(map.value.metadata?.moveLog).toMatchObject([{ moveName: 'Acupressure', scriptKind: 'explicit' }])
    } finally {
      random.mockRestore()
      vi.useRealTimers()
    }
  })

  it('opens Growl as an on-map AoE confirmation and applies it on target selection/confirmation', async () => {
    const map = ref({
      ...mapFixture(),
      dimensions: { x: 8, y: 2, z: 8 },
      placements: [
        { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'bolt', position: { x: 3, y: 0, z: 3 } },
        { id: 'target-token', sheetKind: 'pokemon' as const, sheetSlug: 'target', position: { x: 3, y: 0, z: 4 } },
      ],
    })
    const pokemonSheet = {
      slug: 'bolt',
      nickname: 'Bolt',
      species: 'Bulbasaur',
      level: 5,
      movelist: [{ name: 'Growl' }],
    } as CharacterSheet
    const calls: string[] = []
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned({ id: 'user-token', sheetSlug: 'bolt', position: { x: 3, y: 0, z: 3 } }),
        spawned({ id: 'target-token', species: 'Target', sheetSlug: 'target', position: { x: 3, y: 0, z: 4 } }),
      ]),
      pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: () => undefined,
      modifyCombatStages: (update) => { calls.push(`stages:${update.id}:${update.stages.atk}`) },
      modifyConditions: () => undefined,
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
    })

    panel.openMoveAutomation({ id: 'user-token', moveName: 'Growl' })

    expect(panel.moveAutomationTargeting.value).toMatchObject({
      mode: 'area-confirmation',
      moveName: 'Growl',
      rangeLabel: 'Burst 1',
      candidateIds: ['target-token'],
      affectedIds: ['target-token'],
    })
    expect(panel.moveAutomationTargeting.value?.areaCells?.length).toBe(17)

    const random = vi.spyOn(Math, 'random')
    random.mockReturnValue(0.5)
    try {
      await panel.selectMoveAutomationTarget('user-token')
    } finally {
      random.mockRestore()
    }

    expect(calls).toEqual(['stages:target-token:-1'])
    expect(panel.moveAutomationTargeting.value).toBeNull()
    expect(map.value.metadata?.moveLog).toMatchObject([
      { moveName: 'Growl', scriptKind: 'explicit' },
    ])
  })

  it('clears area targeting overlays before enqueueing confirmed area VFX', async () => {
    const map = ref({
      ...mapFixture(),
      dimensions: { x: 8, y: 2, z: 8 },
      placements: [
        { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'bolt', position: { x: 3, y: 0, z: 3 } },
        { id: 'target-token', sheetKind: 'pokemon' as const, sheetSlug: 'target', position: { x: 3, y: 0, z: 4 } },
      ],
    })
    const pokemonSheet = {
      slug: 'bolt',
      nickname: 'Bolt',
      species: 'Bulbasaur',
      level: 5,
      movelist: [{ name: 'Growl' }],
    } as CharacterSheet
    let targetingDuringVfxEnqueue: unknown = 'not-called'
    let panel!: ReturnType<typeof useMoveAutomationPanel>
    const enqueueMoveAnimations = vi.fn((_events: readonly MoveAnimationEvent[]) => {
      targetingDuringVfxEnqueue = panel.moveAutomationTargeting.value
    })
    panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned({ id: 'user-token', sheetSlug: 'bolt', position: { x: 3, y: 0, z: 3 } }),
        spawned({ id: 'target-token', species: 'Target', sheetSlug: 'target', position: { x: 3, y: 0, z: 4 } }),
      ]),
      pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: () => undefined,
      modifyCombatStages: () => undefined,
      modifyConditions: () => undefined,
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
      enqueueMoveAnimations,
      now: () => 14500,
    })

    panel.openMoveAutomation({ id: 'user-token', moveName: 'Growl' })
    expect(panel.moveAutomationTargeting.value).toMatchObject({ mode: 'area-confirmation', moveName: 'Growl' })

    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    try {
      await panel.selectMoveAutomationTarget('user-token')
    } finally {
      random.mockRestore()
    }

    expect(enqueueMoveAnimations).toHaveBeenCalledTimes(1)
    expect(targetingDuringVfxEnqueue).toBeNull()
    expect(panel.moveAutomationTargeting.value).toBeNull()
  })

  it('opens Scratch as a Pass confirmation, hits crossed targets, and moves to the end square', async () => {
    const map = ref({
      ...mapFixture(),
      dimensions: { x: 7, y: 2, z: 3 },
      placements: [
        { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'scratcher', position: { x: 1, y: 0, z: 1 } },
        { id: 'first-token', sheetKind: 'pokemon' as const, sheetSlug: 'first', position: { x: 2, y: 0, z: 1 } },
        { id: 'second-token', sheetKind: 'pokemon' as const, sheetSlug: 'second', position: { x: 3, y: 0, z: 1 } },
        { id: 'beyond-token', sheetKind: 'pokemon' as const, sheetSlug: 'beyond', position: { x: 5, y: 0, z: 1 } },
      ],
    })
    const pokemonSheet = {
      slug: 'scratcher',
      nickname: 'Scratcher',
      species: 'Meowth',
      level: 5,
      movelist: [{ name: 'Scratch' }],
    } as CharacterSheet
    const calls: string[] = []
    const enqueueMoveAnimations = vi.fn((events: readonly MoveAnimationEvent[]) => {
      calls.push(`vfx:${events.map((event) => event.kind).join(',')}`)
    })
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned({ id: 'user-token', species: 'Scratcher', sheetSlug: 'scratcher', position: { x: 1, y: 0, z: 1 } }),
        spawned({ id: 'first-token', species: 'First', sheetSlug: 'first', currentHp: 40, maxHp: 40, position: { x: 2, y: 0, z: 1 } }),
        spawned({ id: 'second-token', species: 'Second', sheetSlug: 'second', currentHp: 40, maxHp: 40, position: { x: 3, y: 0, z: 1 } }),
        spawned({ id: 'beyond-token', species: 'Beyond', sheetSlug: 'beyond', currentHp: 40, maxHp: 40, position: { x: 5, y: 0, z: 1 } }),
      ]),
      pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: (update) => { calls.push(`hp:${update.id}`) },
      modifyCombatStages: () => undefined,
      modifyConditions: () => undefined,
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
      enqueueMoveAnimations,
      now: () => 15000,
    })

    panel.openMoveAutomation({ id: 'user-token', moveName: 'Scratch' })
    panel.selectMoveAutomationAreaDirection('east')

    expect(panel.moveAutomationTargeting.value).toMatchObject({
      mode: 'area-confirmation',
      moveName: 'Scratch',
      rangeLabel: 'Pass 4 east',
      candidateIds: ['first-token', 'second-token'],
      affectedIds: ['first-token', 'second-token'],
      areaDirection: 'east',
    })
    expect(panel.moveAutomationTargeting.value?.areaCells).toEqual([
      { x: 2, y: 0, z: 1 },
      { x: 3, y: 0, z: 1 },
      { x: 4, y: 0, z: 1 },
    ])

    const random = vi.spyOn(Math, 'random').mockReturnValue(0.9)
    try {
      await panel.selectMoveAutomationTarget('user-token')
    } finally {
      random.mockRestore()
    }

    expect(calls).toEqual(['vfx:dash,area-pulse,target-flash,target-flash', 'hp:first-token', 'hp:second-token'])
    expect(enqueueMoveAnimations).toHaveBeenCalledTimes(1)
    const events = enqueueMoveAnimations.mock.calls[0]?.[0] ?? []
    expect(events.map((event) => event.kind)).toEqual([
      MOVE_VFX_KIND.dash,
      MOVE_VFX_KIND.areaPulse,
      MOVE_VFX_KIND.targetFlash,
      MOVE_VFX_KIND.targetFlash,
    ])
    expect(events[0]).toMatchObject({
      kind: MOVE_VFX_KIND.dash,
      moveName: 'Scratch',
      userId: 'user-token',
      createdAtMs: 15000,
      originCell: { x: 1, y: 0, z: 1 },
      destinationCell: { x: 4, y: 0, z: 1 },
      pathCells: [
        { x: 2, y: 0, z: 1 },
        { x: 3, y: 0, z: 1 },
        { x: 4, y: 0, z: 1 },
      ],
    })
    expect(events[1]).toMatchObject({
      kind: MOVE_VFX_KIND.areaPulse,
      startOffsetMs: 100,
    })
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: MOVE_VFX_KIND.targetFlash,
        targetId: 'first-token',
        startOffsetMs: 220,
      }),
      expect.objectContaining({
        kind: MOVE_VFX_KIND.targetFlash,
        targetId: 'second-token',
        startOffsetMs: 280,
      }),
    ]))
    expect(map.value.placements.find((placement) => placement.id === 'user-token')?.position).toEqual({ x: 4, y: 0, z: 1 })
    expect(map.value.metadata?.moveLog).toMatchObject([
      { moveName: 'Scratch', scriptKind: 'explicit' },
    ])
    expect((map.value.metadata?.moveLog as Array<{ lines: string[] }>)[0].lines).toEqual(expect.arrayContaining([
      'Scratcher ends the Pass dash at (4, 0, 1).',
    ]))
  })

  it('lets Friendly area move targets be unselected before confirmation', async () => {
    const map = ref({
      ...mapFixture(),
      dimensions: { x: 8, y: 2, z: 8 },
      placements: [
        { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'growler', position: { x: 3, y: 0, z: 3 } },
        { id: 'ally-token', sheetKind: 'pokemon' as const, sheetSlug: 'ally', position: { x: 3, y: 0, z: 4 } },
        { id: 'foe-token', sheetKind: 'pokemon' as const, sheetSlug: 'foe', position: { x: 4, y: 0, z: 3 } },
      ],
    })
    const pokemonSheet = {
      slug: 'growler',
      nickname: 'Growler',
      species: 'Bulbasaur',
      level: 5,
      movelist: [{ name: 'Growl' }],
    } as CharacterSheet
    const calls: string[] = []
    const enqueueMoveAnimations = vi.fn((events: readonly MoveAnimationEvent[]) => {
      calls.push(`vfx:${events.length}`)
    })
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned({ id: 'user-token', species: 'Growler', sheetSlug: 'growler', position: { x: 3, y: 0, z: 3 } }),
        spawned({ id: 'ally-token', species: 'Ally', sheetSlug: 'ally', position: { x: 3, y: 0, z: 4 } }),
        spawned({ id: 'foe-token', species: 'Foe', sheetSlug: 'foe', position: { x: 4, y: 0, z: 3 } }),
      ]),
      pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: () => undefined,
      modifyCombatStages: (update) => { calls.push(`stages:${update.id}:${update.stages.atk}`) },
      modifyConditions: () => undefined,
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
      enqueueMoveAnimations,
      now: () => 14000,
    })

    panel.openMoveAutomation({ id: 'user-token', moveName: 'Growl' })

    expect(panel.moveAutomationTargeting.value).toMatchObject({
      mode: 'area-confirmation',
      moveName: 'Growl',
      rangeLabel: 'Burst 1',
      candidateIds: ['ally-token', 'foe-token'],
      affectedIds: ['ally-token', 'foe-token'],
      canToggleTargets: true,
    })

    await panel.selectMoveAutomationTarget('ally-token')

    expect(panel.moveAutomationTargeting.value).toMatchObject({
      candidateIds: ['ally-token', 'foe-token'],
      affectedIds: ['foe-token'],
      canToggleTargets: true,
    })

    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    try {
      await panel.selectMoveAutomationTarget('user-token')
    } finally {
      random.mockRestore()
    }

    expect(calls).toEqual(['vfx:3', 'stages:foe-token:-1'])
    expect(enqueueMoveAnimations).toHaveBeenCalledTimes(1)
    const events = enqueueMoveAnimations.mock.calls[0]?.[0] ?? []
    expect(events.map((event) => event.kind)).toEqual([
      MOVE_VFX_KIND.areaPulse,
      MOVE_VFX_KIND.radialBurst,
      MOVE_VFX_KIND.buffDebuff,
    ])
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: MOVE_VFX_KIND.areaPulse,
        moveName: 'Growl',
        userId: 'user-token',
        createdAtMs: 14000,
        areaCells: expect.any(Array),
      }),
      expect.objectContaining({
        kind: MOVE_VFX_KIND.buffDebuff,
        targetId: 'foe-token',
        targetCell: { x: 4, y: 0, z: 3 },
        tone: 'debuff',
        direction: 'debuff',
        startOffsetMs: 140,
      }),
    ]))
    expect(events.some((event) => 'targetId' in event && event.targetId === 'ally-token')).toBe(false)
    expect(panel.moveAutomationTargeting.value).toBeNull()
    expect(map.value.metadata?.moveLog).toMatchObject([
      { moveName: 'Growl', scriptKind: 'explicit' },
    ])
  })

  it('opens Leer as a cone AoE confirmation and lets the user select direction', async () => {
    const map = ref({
      ...mapFixture(),
      dimensions: { x: 8, y: 4, z: 8 },
      placements: [
        { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'bolt', position: { x: 3, y: 1, z: 3 } },
        { id: 'target-token', sheetKind: 'pokemon' as const, sheetSlug: 'target', position: { x: 4, y: 1, z: 4 } },
        { id: 'nw-token', sheetKind: 'pokemon' as const, sheetSlug: 'nw', position: { x: 2, y: 1, z: 2 } },
        { id: 'up-token', sheetKind: 'pokemon' as const, sheetSlug: 'up', position: { x: 3, y: 2, z: 3 } },
        { id: 'down-token', sheetKind: 'pokemon' as const, sheetSlug: 'down', position: { x: 3, y: 0, z: 3 } },
      ],
    })
    const pokemonSheet = {
      slug: 'bolt',
      nickname: 'Bolt',
      species: 'Bulbasaur',
      level: 5,
      movelist: [{ name: 'Leer' }],
    } as CharacterSheet
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned({ id: 'user-token', sheetSlug: 'bolt', position: { x: 3, y: 1, z: 3 } }),
        spawned({ id: 'target-token', species: 'Target', sheetSlug: 'target', position: { x: 4, y: 1, z: 4 } }),
        spawned({ id: 'nw-token', species: 'Northwest', sheetSlug: 'nw', position: { x: 2, y: 1, z: 2 } }),
        spawned({ id: 'up-token', species: 'Up', sheetSlug: 'up', position: { x: 3, y: 2, z: 3 } }),
        spawned({ id: 'down-token', species: 'Down', sheetSlug: 'down', position: { x: 3, y: 0, z: 3 } }),
      ]),
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

    panel.openMoveAutomation({ id: 'user-token', moveName: 'Leer' })

    expect(panel.moveAutomationTargeting.value).toMatchObject({
      mode: 'area-confirmation',
      moveName: 'Leer',
      rangeLabel: 'Cone 2 south-east',
      candidateIds: ['target-token'],
      areaDirection: 'south-east',
    })
    expect(panel.moveAutomationTargeting.value?.areaDirectionOptions).toHaveLength(10)

    panel.selectMoveAutomationAreaDirection('up')

    expect(panel.moveAutomationTargeting.value).toMatchObject({
      rangeLabel: 'Cone 2 up',
      candidateIds: ['up-token'],
      areaDirection: 'up',
    })

    panel.selectMoveAutomationAreaDirection('down')

    expect(panel.moveAutomationTargeting.value).toMatchObject({
      rangeLabel: 'Cone 2 down',
      candidateIds: ['down-token'],
      areaDirection: 'down',
    })

    panel.selectMoveAutomationAreaDirection('north-west')

    expect(panel.moveAutomationTargeting.value).toMatchObject({
      rangeLabel: 'Cone 2 north-west',
      candidateIds: ['nw-token'],
      areaDirection: 'north-west',
    })

    await panel.selectMoveAutomationTarget('user-token')

    expect(map.value.placements[0]).toMatchObject({ facing: 'north-west', turned: true })
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

  it('notifies map-level AoO hooks when a normal ranged attack is taken', async () => {
    const map = ref({
      ...mapFixture(),
      placements: [
        { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'caster', position: { x: 0, y: 0, z: 0 } },
        { id: 'target-token', sheetKind: 'pokemon' as const, sheetSlug: 'target', position: { x: 3, y: 0, z: 0 } },
      ],
    })
    const pokemonSheet = {
      slug: 'caster',
      nickname: 'Caster',
      species: 'Charmander',
      level: 5,
      movelist: [{ name: 'Ember' }],
    } as CharacterSheet
    const beforeAction = vi.fn()
    const rangedAoO = vi.fn()
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned({ id: 'user-token', species: 'Caster', sheetSlug: 'caster', position: { x: 0, y: 0, z: 0 } }),
        spawned({ id: 'target-token', species: 'Target', sheetSlug: 'target', currentHp: 40, maxHp: 40, defenderTypes: ['Grass'], position: { x: 3, y: 0, z: 0 } }),
      ]),
      pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: () => undefined,
      modifyCombatStages: () => undefined,
      modifyConditions: () => undefined,
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
      onBeforeNonImmediateAction: beforeAction,
      onRangedAttackOfOpportunity: rangedAoO,
    })

    panel.openMoveAutomation({ id: 'user-token', moveName: 'Ember' })
    await panel.selectMoveAutomationTarget('target-token')

    expect(beforeAction).toHaveBeenCalledWith({ userId: 'user-token', moveName: 'Ember' })
    expect(rangedAoO).toHaveBeenCalledWith({
      provokerId: 'user-token',
      targetIds: ['target-token'],
      moveName: 'Ember',
    })
  })

  it('flushes a pending animated move transaction before starting another move', async () => {
    const map = ref({
      ...mapFixture(),
      placements: [
        { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'caster', position: { x: 0, y: 0, z: 0 } },
        { id: 'target-token', sheetKind: 'pokemon' as const, sheetSlug: 'target', position: { x: 3, y: 0, z: 0 } },
      ],
    })
    const pokemonSheet = {
      slug: 'caster',
      nickname: 'Caster',
      species: 'Charmander',
      level: 5,
      movelist: [{ name: 'Ember' }],
    } as CharacterSheet
    const hpCalls: string[] = []
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned({ id: 'user-token', species: 'Caster', sheetSlug: 'caster', position: { x: 0, y: 0, z: 0 } }),
        spawned({ id: 'target-token', species: 'Target', sheetSlug: 'target', currentHp: 40, maxHp: 40, defenderTypes: ['Grass'], position: { x: 3, y: 0, z: 0 } }),
      ]),
      pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: (update) => { hpCalls.push(`${update.id}:${update.currentHp}`) },
      modifyCombatStages: () => undefined,
      modifyConditions: () => undefined,
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
    })
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.99)
    try {
      panel.openMoveAutomation({ id: 'user-token', moveName: 'Ember' })
      await panel.selectMoveAutomationTarget('target-token')
      expect(hpCalls).toEqual([])

      await panel.useMoveAgainstTarget({
        id: 'user-token',
        targetId: 'target-token',
        moveName: 'Struggle',
        skipActionNotifications: true,
      })

      expect(hpCalls.length).toBeGreaterThan(0)
    } finally {
      random.mockRestore()
    }
  })

  it('can execute a direct interrupt Struggle target without expiring pending AoOs', async () => {
    const map = ref({
      ...mapFixture(),
      placements: [
        { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'attacker', position: { x: 0, y: 0, z: 0 } },
        { id: 'target-token', sheetKind: 'pokemon' as const, sheetSlug: 'target', position: { x: 3, y: 0, z: 0 } },
      ],
    })
    const pokemonSheet = {
      slug: 'attacker',
      nickname: 'Attacker',
      species: 'Bulbasaur',
      level: 5,
      movelist: [],
    } as CharacterSheet
    const beforeAction = vi.fn()
    const rangedAoO = vi.fn()
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned({ id: 'user-token', species: 'Attacker', sheetSlug: 'attacker', position: { x: 0, y: 0, z: 0 } }),
        spawned({ id: 'target-token', species: 'Target', sheetSlug: 'target', currentHp: 40, maxHp: 40, position: { x: 3, y: 0, z: 0 } }),
      ]),
      pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
      trainerBySlug: ref(new Map<string, TrainerSheet>()),
      canEditMap: computed(() => false),
      canControlPlacement: (id) => id === 'user-token',
      modifyHp: () => undefined,
      modifyCombatStages: () => undefined,
      modifyConditions: () => undefined,
      applyMoveFieldEffect: () => undefined,
      placeHazard: () => undefined,
      onBeforeNonImmediateAction: beforeAction,
      onRangedAttackOfOpportunity: rangedAoO,
    })

    await expect(panel.useMoveAgainstTarget({
      id: 'user-token',
      targetId: 'target-token',
      moveName: 'Struggle',
      skipActionNotifications: true,
      logLine: 'Attacker makes an Attack of Opportunity against Target.',
    })).resolves.toBe(true)

    expect(beforeAction).not.toHaveBeenCalled()
    expect(rangedAoO).not.toHaveBeenCalled()
    expect(panel.moveAutomationFeedback.value?.moveName).toBe('Struggle')
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
