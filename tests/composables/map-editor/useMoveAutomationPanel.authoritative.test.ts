import { computed, ref, nextTick, type Ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  useMoveAutomationPanel,
  type MoveAutomationAuthoritativeDispatchHandler,
} from '~/composables/map-editor/useMoveAutomationPanel'
import { LIVE_PLAY_RESOLVED_MOVE_RESULT_SCHEMA_VERSION } from '#shared/livePlayMoveResolution'
import { EXPLICIT_MOVE_AUTOMATION_SCRIPTS } from '~/utils/moveAutomation'
import { moveAutomationAreaTemplateId } from '~/utils/moveAutomationAreaTemplates'
import { MOVE_VFX_KIND, type MoveAnimationEvent } from '~/types/moveAnimation'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GridAnchor, TabletopMap } from '~/types/map'
import type { MoveAutomationAreaTemplate, MoveAutomationFeedbackState, MoveAutomationScript, MoveAutomationTransaction } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { LivePlayResolvedMoveResult } from '#shared/livePlayMoveResolution'

const baseMap = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'authoritative-move-test',
  name: 'Authoritative Move Test',
  dimensions: { x: 8, y: 2, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    { id: 'user-token', sheetKind: 'pokemon', sheetSlug: 'user', position: { x: 1, y: 0, z: 1 } },
    { id: 'target-a', sheetKind: 'pokemon', sheetSlug: 'target-a', position: { x: 2, y: 0, z: 1 } },
    { id: 'target-b', sheetKind: 'pokemon', sheetSlug: 'target-b', position: { x: 3, y: 0, z: 1 } },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
})

const spawned = (overrides: Partial<SpawnedPokemon> = {}): SpawnedPokemon => ({
  species: 'User',
  slug: 'bulbasaur',
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: '/sprites/bulbasaur.png',
  entityKind: 'pokemon',
  id: 'user-token',
  position: { x: 1, y: 0, z: 1 },
  sheetKind: 'pokemon',
  sheetSlug: 'user',
  level: 5,
  currentHp: 20,
  maxHp: 20,
  atk: 5,
  satk: 5,
  def: 5,
  sdef: 5,
  defenderTypes: ['Normal'],
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  conditions: [],
  tokenItems: [],
  ...overrides,
})

const script = (overrides: Partial<MoveAutomationScript> = {}): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: 'Authoritative Tag',
  version: 1,
  targetMode: 'one-target',
  targetCount: 1,
  damaging: false,
  requiresAccuracy: true,
  damageBase: null,
  damageClass: 'Status',
  type: 'Normal',
  ac: 2,
  range: '6, 1 Target',
  effect: 'Authoritative test move.',
  keywords: ['6', '1 Target'],
  criticalRange: null,
  areaTemplates: [],
  conditionSuggestions: [],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
  ...overrides,
})

const reviewedScript = (moveName: string): MoveAutomationScript => {
  const moveScript = EXPLICIT_MOVE_AUTOMATION_SCRIPTS.get(moveName)
  if (!moveScript) throw new Error(`Expected reviewed move script for ${moveName}.`)
  return moveScript
}

const targetCountScript = (): MoveAutomationScript => script({
  moveName: 'Authoritative Multi',
  targetMode: 'multi-target',
  targetCount: 2,
  requiresAccuracy: false,
  range: '6, 2 Targets',
  keywords: ['6', '2 Targets'],
})

const areaScript = (template: MoveAutomationAreaTemplate = { kind: 'burst', size: 1, label: 'Burst 1' }): MoveAutomationScript => script({
  moveName: template.kind === 'pass' ? 'Authoritative Pass' : 'Authoritative Area',
  targetMode: 'multi-target',
  targetCount: null,
  requiresAccuracy: false,
  range: template.label,
  keywords: [template.label],
  areaTemplates: [template],
})

const branchScript = (): MoveAutomationScript => script({
  moveName: 'Authoritative Branch',
  range: 'Melee, 1 Target or Line 3',
  keywords: ['Melee', '1 Target', 'Line 3'],
  targetBranches: [
    { id: 'single-branch', label: 'Melee', targetMode: 'one-target', targetCount: 1, range: 'Melee, 1 Target' },
    {
      id: 'line-branch',
      label: 'Line 3',
      targetMode: 'multi-target',
      targetCount: null,
      range: 'Line 3',
      areaTemplates: [{ kind: 'line', size: 3, label: 'Line 3' }],
    },
  ],
})

const transaction = (overrides: Partial<MoveAutomationTransaction> = {}): MoveAutomationTransaction => ({
  userId: 'user-token',
  userName: 'User',
  moveName: 'Authoritative Tag',
  scriptKind: 'explicit',
  scriptVersion: 1,
  attackedTargetIds: ['target-a'],
  hitTargetIds: ['target-a'],
  hpUpdates: [{ id: 'target-a', currentHp: 0 }],
  combatStageUpdates: [],
  conditionUpdates: [],
  hazardsToAdd: [],
  fieldEffectsToApply: [],
  logLines: ['Server resolved the move.'],
  ...overrides,
})

const feedback = (): MoveAutomationFeedbackState => ({
  id: 'server-feedback',
  userId: 'user-token',
  targetId: 'target-a',
  moveName: 'Authoritative Tag',
  phase: 'rolling',
  naturalRoll: 12,
  modifiedRoll: 12,
  accuracyCheck: 2,
  userAccuracy: 0,
  targetEvasion: 0,
  targetEvasionLabel: '0',
  hit: true,
  crit: false,
  effectiveness: null,
  damageResolved: true,
  damageLoss: 20,
  conditions: [],
})

const resolvedMove = (overrides: Partial<LivePlayResolvedMoveResult> = {}): LivePlayResolvedMoveResult => {
  const moveScript = overrides.script ?? script()
  return {
    schemaVersion: LIVE_PLAY_RESOLVED_MOVE_RESULT_SCHEMA_VERSION,
    actorPlacementId: 'user-token',
    moveName: moveScript.moveName,
    canonicalMoveName: moveScript.moveName,
    moveKey: moveScript.moveName.toLowerCase().replace(/\s+/g, '-'),
    frequency: 'Scene',
    damageFormula: null,
    selectedTargetIds: ['target-a'],
    script: moveScript,
    transaction: transaction({ moveName: moveScript.moveName }),
    ...overrides,
  }
}

const withRegisteredScripts = async <T>(scripts: readonly MoveAutomationScript[], run: () => T | Promise<T>): Promise<T> => {
  const registry = EXPLICIT_MOVE_AUTOMATION_SCRIPTS as Map<string, MoveAutomationScript>
  const previous = new Map(scripts.map((item) => [item.moveName, registry.get(item.moveName)]))
  for (const item of scripts) registry.set(item.moveName, item)
  try {
    return await run()
  } finally {
    for (const item of scripts) {
      const old = previous.get(item.moveName)
      if (old) registry.set(item.moveName, old)
      else registry.delete(item.moveName)
    }
  }
}

type TestCallback = (...args: any[]) => any

const panelFixture = (options: {
  moveName?: string
  scripts?: readonly MoveAutomationScript[]
  dispatchAuthoritativeMove?: MoveAutomationAuthoritativeDispatchHandler
  tokens?: Ref<SpawnedPokemon[]>
  recordMoveUsage?: TestCallback
  modifyHp?: TestCallback
  modifyCombatStages?: TestCallback
  modifyConditions?: TestCallback
  placeHazard?: TestCallback
  applyMoveFieldEffect?: TestCallback
  moveToken?: TestCallback
  enqueueMoveAnimations?: TestCallback
  onMoveFeedback?: TestCallback
  onMoveUse?: TestCallback
  onBeforeNonImmediateAction?: TestCallback
  onRangedAttackOfOpportunity?: TestCallback
} = {}) => {
  const map = ref(baseMap())
  const tokens: Ref<SpawnedPokemon[]> = options.tokens ?? ref([
    spawned(),
    spawned({ id: 'target-a', species: 'Target A', sheetSlug: 'target-a', currentHp: 20, maxHp: 20, position: { x: 2, y: 0, z: 1 } }),
    spawned({ id: 'target-b', species: 'Target B', sheetSlug: 'target-b', currentHp: 20, maxHp: 20, position: { x: 3, y: 0, z: 1 } }),
  ])
  const moveName = options.moveName ?? options.scripts?.[0]?.moveName ?? 'Authoritative Tag'
  const pokemonSheet = {
    slug: 'user',
    nickname: 'User',
    species: 'Bulbasaur',
    level: 5,
    movelist: [{ name: moveName, frequency: 'Scene' }],
  } as CharacterSheet
  const panel = useMoveAutomationPanel({
    map,
    spawnedPokemon: computed(() => tokens.value),
    pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
    trainerBySlug: ref(new Map<string, TrainerSheet>()),
    canEditMap: computed(() => true),
    canControlPlacement: (id) => id === 'user-token',
    modifyHp: options.modifyHp ?? vi.fn(),
    modifyCombatStages: options.modifyCombatStages ?? vi.fn(),
    modifyConditions: options.modifyConditions ?? vi.fn(),
    applyMoveFieldEffect: options.applyMoveFieldEffect ?? vi.fn(),
    placeHazard: options.placeHazard ?? vi.fn(),
    moveToken: options.moveToken,
    recordMoveUsage: options.recordMoveUsage,
    dispatchAuthoritativeMove: options.dispatchAuthoritativeMove,
    enqueueMoveAnimations: options.enqueueMoveAnimations,
    onMoveFeedback: options.onMoveFeedback,
    onMoveUse: options.onMoveUse,
    onBeforeNonImmediateAction: options.onBeforeNonImmediateAction,
    onRangedAttackOfOpportunity: options.onRangedAttackOfOpportunity,
    now: () => 1000,
  })

  return { map, panel, tokens }
}

describe('useMoveAutomationPanel authoritative dispatcher', () => {
  it('falls back to the existing local path when the dispatcher returns undefined', async () => {
    const moveScript = reviewedScript('Ember')
    await withRegisteredScripts([moveScript], async () => {
      const dispatch = vi.fn<MoveAutomationAuthoritativeDispatchHandler>().mockResolvedValue(undefined)
      const recordMoveUsage = vi.fn()
      const modifyHp = vi.fn()
      const { map, panel } = panelFixture({
        scripts: [moveScript],
        dispatchAuthoritativeMove: dispatch,
        recordMoveUsage,
        modifyHp,
      })

      panel.openMoveAutomation({ id: 'user-token', moveName: moveScript.moveName })
      await panel.selectMoveAutomationTarget('target-a')

      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(panel.moveAutomationFeedback.value?.moveName).toBe(moveScript.moveName)
      expect(panel.moveUsageError.value).toBeNull()
    })
  })

  it('keeps targeting and does not run local fallback when authoritative dispatch is rejected', async () => {
    const moveScript = reviewedScript('Ember')
    await withRegisteredScripts([moveScript], async () => {
      const recordMoveUsage = vi.fn()
      const modifyHp = vi.fn()
      const dispatch = vi.fn<MoveAutomationAuthoritativeDispatchHandler>().mockResolvedValue({
        accepted: false,
        message: 'Server rejected the move.',
      })
      const { panel } = panelFixture({
        scripts: [moveScript],
        dispatchAuthoritativeMove: dispatch,
        recordMoveUsage,
        modifyHp,
      })

      panel.openMoveAutomation({ id: 'user-token', moveName: moveScript.moveName })
      await panel.selectMoveAutomationTarget('target-a')

      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(recordMoveUsage).not.toHaveBeenCalled()
      expect(modifyHp).not.toHaveBeenCalled()
      expect(panel.moveAutomationTargeting.value).toMatchObject({ mode: 'target', moveName: moveScript.moveName })
      expect(panel.moveUsageError.value).toBe('Server rejected the move.')
    })
  })

  it('dispatches accepted single-target moves once, clears targeting, and bypasses local persistent mutations', async () => {
    const moveScript = reviewedScript('Ember')
    await withRegisteredScripts([moveScript], async () => {
      let release!: (value: unknown) => void
      const pending = new Promise((resolve) => { release = resolve })
      const dispatch = vi.fn<MoveAutomationAuthoritativeDispatchHandler>(async () => {
        await pending
        return { accepted: true, move: resolvedMove({ script: moveScript }) }
      })
      const recordMoveUsage = vi.fn()
      const modifyHp = vi.fn()
      const enqueueMoveAnimations = vi.fn()
      const { map, panel } = panelFixture({
        scripts: [moveScript],
        dispatchAuthoritativeMove: dispatch,
        recordMoveUsage,
        modifyHp,
        enqueueMoveAnimations,
      })

      panel.openMoveAutomation({ id: 'user-token', moveName: moveScript.moveName })
      const first = panel.selectMoveAutomationTarget('target-a')
      const second = panel.selectMoveAutomationTarget('target-a')
      await nextTick()

      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(panel.moveDispatchPending.value).toBe(true)

      release(undefined)
      await Promise.all([first, second])

      expect(panel.moveDispatchPending.value).toBe(false)
      expect(panel.moveAutomationTargeting.value).toBeNull()
      expect(recordMoveUsage).not.toHaveBeenCalled()
      expect(modifyHp).not.toHaveBeenCalled()
      expect(map.value.metadata?.moveLog).toBeUndefined()
      expect(enqueueMoveAnimations).toHaveBeenCalledTimes(1)
      expect(dispatch.mock.calls[0]?.[0].intent.selection).toEqual({ kind: 'single-target', targetPlacementId: 'target-a' })
    })
  })

  it('preserves selected branch ids through single-target and area authoritative intents', async () => {
    const moveScript = branchScript()
    await withRegisteredScripts([moveScript], async () => {
      const dispatch = vi.fn<MoveAutomationAuthoritativeDispatchHandler>()
        .mockResolvedValueOnce({ accepted: false, message: 'stay open' })
        .mockResolvedValueOnce({
          accepted: false,
          message: 'stay open',
        })
      const { panel } = panelFixture({
        moveName: moveScript.moveName,
        scripts: [moveScript],
        dispatchAuthoritativeMove: dispatch,
      })

      panel.openMoveAutomation({ id: 'user-token', moveName: moveScript.moveName })
      panel.selectMoveAutomationTargetBranch('single-branch')
      await panel.selectMoveAutomationTarget('target-a')

      panel.openMoveAutomation({ id: 'user-token', moveName: moveScript.moveName })
      panel.selectMoveAutomationTargetBranch('line-branch')
      panel.selectMoveAutomationAreaDirection('east')
      await panel.selectMoveAutomationTarget('user-token')

      expect(dispatch.mock.calls[0]?.[0].intent.targetBranchId).toBe('single-branch')
      expect(dispatch.mock.calls[1]?.[0].intent.targetBranchId).toBe('line-branch')
      expect(dispatch.mock.calls[1]?.[0].intent.selection).toMatchObject({
        kind: 'area',
        areaTemplateId: 'line:any:3',
      })
    })
  })

  it('uses server feedback for presentation-only phases without applying the authoritative transaction', async () => {
    vi.useFakeTimers()
    const moveScript = reviewedScript('Ember')
    try {
      await withRegisteredScripts([moveScript], async () => {
        const modifyHp = vi.fn()
        const onMoveFeedback = vi.fn()
        const dispatch = vi.fn<MoveAutomationAuthoritativeDispatchHandler>().mockResolvedValue({
          accepted: true,
          move: resolvedMove({ script: moveScript, feedback: feedback() }),
        })
        const { panel } = panelFixture({
          scripts: [moveScript],
          dispatchAuthoritativeMove: dispatch,
          modifyHp,
          onMoveFeedback,
        })

        panel.openMoveAutomation({ id: 'user-token', moveName: moveScript.moveName })
        await panel.selectMoveAutomationTarget('target-a')

        expect(panel.moveAutomationFeedback.value).toMatchObject({
          id: 'server-feedback',
          phase: 'rolling',
          damageLoss: 20,
        })
        expect(onMoveFeedback).toHaveBeenCalledWith({ feedback: expect.objectContaining({ id: 'server-feedback' }) })

        await vi.advanceTimersByTimeAsync(5000)
        expect(modifyHp).not.toHaveBeenCalled()
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses server area cells for authoritative area VFX and does not place local hazards or field effects', async () => {
    const moveScript = branchScript()
    const lineTemplate = moveScript.targetBranches?.find((branch) => branch.id === 'line-branch')?.areaTemplates?.[0]!
    const serverCells: GridAnchor[] = [{ x: 7, y: 0, z: 7 }]
    await withRegisteredScripts([moveScript], async () => {
      const placeHazard = vi.fn()
      const applyMoveFieldEffect = vi.fn()
      const enqueueMoveAnimations = vi.fn()
      const dispatch = vi.fn<MoveAutomationAuthoritativeDispatchHandler>().mockResolvedValue({
        accepted: true,
        move: resolvedMove({
          script: moveScript,
          moveName: moveScript.moveName,
          canonicalMoveName: moveScript.moveName,
          targetBranchId: 'line-branch',
          selectedTargetIds: ['target-a'],
          transaction: transaction({
            moveName: moveScript.moveName,
            hazardsToAdd: [{ kind: 'spikes', x: 2, y: 0, z: 2 }],
            fieldEffectsToApply: [{ kind: 'weather', value: 'rainy', source: moveScript.moveName }],
          }),
          area: {
            areaTemplateId: moveAutomationAreaTemplateId(lineTemplate),
            template: lineTemplate,
            cells: serverCells,
            candidateTargetIds: ['target-a'],
            direction: 'south-east',
            excludedTargetIds: [],
          },
        }),
      })
      const { panel } = panelFixture({
        moveName: moveScript.moveName,
        scripts: [moveScript],
        dispatchAuthoritativeMove: dispatch,
        placeHazard,
        applyMoveFieldEffect,
        enqueueMoveAnimations,
      })

      panel.openMoveAutomation({ id: 'user-token', moveName: moveScript.moveName })
      panel.selectMoveAutomationTargetBranch('line-branch')
      expect(panel.moveAutomationTargeting.value?.areaCells).not.toEqual(serverCells)
      await panel.selectMoveAutomationTarget('user-token')

      expect(placeHazard).not.toHaveBeenCalled()
      expect(applyMoveFieldEffect).not.toHaveBeenCalled()
      const events = enqueueMoveAnimations.mock.calls[0]?.[0] as readonly MoveAnimationEvent[]
      expect(events.some((event) => JSON.stringify((event as { areaCells?: readonly GridAnchor[] }).areaCells) === JSON.stringify(serverCells))).toBe(true)
    })
  })

  it('uses authoritative Pass movement for VFX without moving or turning the token locally', async () => {
    const passTemplate: MoveAutomationAreaTemplate = { kind: 'pass', size: 4, label: 'Pass 4' }
    const moveScript = reviewedScript('Scratch')
    const destination = { x: 5, y: 0, z: 1 }
    const pathCells = [{ x: 2, y: 0, z: 1 }, { x: 3, y: 0, z: 1 }, destination]
    await withRegisteredScripts([moveScript], async () => {
      const moveToken = vi.fn()
      const enqueueMoveAnimations = vi.fn()
      const dispatch = vi.fn<MoveAutomationAuthoritativeDispatchHandler>().mockResolvedValue({
        accepted: true,
        move: resolvedMove({
          script: moveScript,
          moveName: moveScript.moveName,
          canonicalMoveName: moveScript.moveName,
          selectedTargetIds: ['target-a'],
          transaction: transaction({ moveName: moveScript.moveName }),
          area: {
            areaTemplateId: moveAutomationAreaTemplateId(passTemplate),
            template: passTemplate,
            cells: pathCells,
            candidateTargetIds: ['target-a'],
            excludedTargetIds: [],
            direction: 'east',
          },
          movement: {
            kind: 'pass',
            from: { x: 1, y: 0, z: 1 },
            destination,
            direction: 'east',
            pathCells,
          },
        }),
      })
      const { map, panel } = panelFixture({
        moveName: moveScript.moveName,
        scripts: [moveScript],
        dispatchAuthoritativeMove: dispatch,
        moveToken,
        enqueueMoveAnimations,
      })

      panel.openMoveAutomation({ id: 'user-token', moveName: moveScript.moveName })
      await panel.selectMoveAutomationAreaDirection('east')
      await panel.selectMoveAutomationTarget('user-token')

      expect(moveToken).not.toHaveBeenCalled()
      expect(map.value.placements.find((placement) => placement.id === 'user-token')?.position).toEqual({ x: 1, y: 0, z: 1 })
      const events = enqueueMoveAnimations.mock.calls[0]?.[0] as readonly MoveAnimationEvent[]
      const dash = events.find((event) => event.kind === MOVE_VFX_KIND.dash) as MoveAnimationEvent & { destinationCell?: GridAnchor; pathCells?: readonly GridAnchor[] }
      expect(dash.destinationCell).toEqual(destination)
      expect(dash.pathCells).toEqual(pathCells)
    })
  })

  it('treats missing or mismatched presentation data as accepted-with-error and does not queue reaction prompts', async () => {
    const moveScript = reviewedScript('Ember')
    await withRegisteredScripts([moveScript], async () => {
      const dispatch = vi.fn<MoveAutomationAuthoritativeDispatchHandler>().mockResolvedValue({
        accepted: true,
        move: resolvedMove({
          script: moveScript,
          actorPlacementId: 'other-actor',
        }),
      })
      const modifyHp = vi.fn()
      const { panel } = panelFixture({
        scripts: [moveScript],
        dispatchAuthoritativeMove: dispatch,
        modifyHp,
      })

      panel.openMoveAutomation({ id: 'user-token', moveName: moveScript.moveName })
      await panel.selectMoveAutomationTarget('target-a')

      expect(modifyHp).not.toHaveBeenCalled()
      expect(panel.moveUsageError.value).toContain('Move was accepted, but')
      expect(panel.moveUsageError.value).toContain('did not match requested actor')
      expect(panel.moxieTriggerPrompts.value).toEqual([])
      expect(panel.cuteCharmReactionPrompts.value).toEqual([])
      expect(panel.poisonPointReactionPrompts.value).toEqual([])
      expect(panel.spiteReactionPrompts.value).toEqual([])
    })
  })

  it('queues Moxie from the pre-dispatch HP snapshot after server adoption changes token HP', async () => {
    const moveScript = reviewedScript('Ember')
    await withRegisteredScripts([moveScript], async () => {
      const tokens = ref([
        spawned({ abilityNames: ['Moxie'] }),
        spawned({ id: 'target-a', species: 'Target A', sheetSlug: 'target-a', currentHp: 20, maxHp: 20, position: { x: 2, y: 0, z: 1 } }),
      ])
      const dispatch = vi.fn<MoveAutomationAuthoritativeDispatchHandler>(async () => {
        tokens.value = tokens.value.map((token) => token.id === 'target-a' ? { ...token, currentHp: 0 } : token)
        return {
          accepted: true,
          move: resolvedMove({
            script: moveScript,
            transaction: transaction({
              moveName: moveScript.moveName,
              hitTargetIds: ['target-a'],
              hpUpdates: [{ id: 'target-a', currentHp: 0 }],
            }),
          }),
        }
      })
      const { panel } = panelFixture({
        scripts: [moveScript],
        tokens,
        dispatchAuthoritativeMove: dispatch,
      })

      panel.openMoveAutomation({ id: 'user-token', moveName: moveScript.moveName })
      await panel.selectMoveAutomationTarget('target-a')

      expect(tokens.value.find((token) => token.id === 'target-a')?.currentHp).toBe(0)
      expect(panel.moxieTriggerPrompts.value).toMatchObject([
        {
          attackerId: 'user-token',
          moveName: moveScript.moveName,
          faintedTargetIds: ['target-a'],
          faintedTargetNames: ['Target A'],
        },
      ])
    })
  })

  it('uses authoritative dispatch for useMoveAgainstTarget without local usage, custom logging, or AoO callbacks before acceptance', async () => {
    const moveScript = reviewedScript('Ember')
    await withRegisteredScripts([moveScript], async () => {
      const onBeforeNonImmediateAction = vi.fn()
      const onRangedAttackOfOpportunity = vi.fn()
      const recordMoveUsage = vi.fn()
      const dispatch = vi.fn<MoveAutomationAuthoritativeDispatchHandler>().mockResolvedValue({
        accepted: false,
        message: 'not yet',
      })
      const { map, panel } = panelFixture({
        scripts: [moveScript],
        dispatchAuthoritativeMove: dispatch,
        recordMoveUsage,
        onBeforeNonImmediateAction,
        onRangedAttackOfOpportunity,
      })

      await expect(panel.useMoveAgainstTarget({
        id: 'user-token',
        targetId: 'target-a',
        moveName: moveScript.moveName,
        skipActionNotifications: true,
        logLine: 'Client-authored AoO text.',
      })).resolves.toBe(false)

      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(recordMoveUsage).not.toHaveBeenCalled()
      expect(onBeforeNonImmediateAction).not.toHaveBeenCalled()
      expect(onRangedAttackOfOpportunity).not.toHaveBeenCalled()
      expect(map.value.metadata?.moveLog).toBeUndefined()
      expect(JSON.stringify(dispatch.mock.calls[0]?.[0].intent)).not.toContain('Client-authored AoO text')
    })
  })
})
