import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  appendMoveAutomationLogEntry,
  useMoveAutomationPanel,
} from '~/composables/map-editor/useMoveAutomationPanel'
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
    })

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      panel.openMoveAutomation({ id: 'user-token', moveName: 'Will-O-Wisp' })
      await panel.selectMoveAutomationTarget('target-token')
    } finally {
      warn.mockRestore()
    }

    expect(conditionCalls).toEqual([])
    expect(panel.moveAutomationFeedback.value).toBeNull()
    expect(panel.moveAutomationTargeting.value).toMatchObject({ moveName: 'Will-O-Wisp' })
    expect(panel.moveUsageError.value).toBe('No remaining uses')
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
    expect(map.value.metadata?.moveLog).toMatchObject([{ moveName: 'Helping Hand', scriptKind: 'explicit' }])
  })

  it('opens cannot-miss damaging moves with targeting overlay and applies damage directly', async () => {
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
    expect(calls).toEqual(['hp:target-token:18'])
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

    await panel.selectMoveAutomationTarget('user-token')

    expect(calls).toEqual(['stages:foe-token:-1'])
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
