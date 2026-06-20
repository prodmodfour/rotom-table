import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  appendMoveAutomationLogEntry,
  useMoveAutomationPanel,
} from '~/composables/map-editor/useMoveAutomationPanel'
import { EXPLICIT_MOVE_AUTOMATION_SCRIPTS } from '~/utils/moveAutomation'
import { moveAutomationAreaTemplateId } from '~/utils/moveAutomationAreaTemplates'
import { MOVE_VFX_KIND, type MoveAnimationEvent } from '~/types/moveAnimation'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { MoveAutomationScript, MoveAutomationTransaction } from '~/types/moveAutomation'
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
const MOVE_FEEDBACK_ANIMATION_LAUNCH_MS = 2100
const MOVE_FEEDBACK_ANIMATION_IMPACT_MS = 2600
const MOVE_FEEDBACK_DAMAGE_FINAL_MS = 2820
const MOVE_FEEDBACK_EFFECTIVE_DAMAGE_FINAL_MS = 2820

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

const branchSelectionScript = (): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: 'Branch Selection Test',
  version: 1,
  targetMode: 'one-target',
  targetCount: 1,
  damaging: false,
  requiresAccuracy: false,
  damageBase: null,
  damageClass: 'Status',
  type: 'Normal',
  ac: null,
  range: 'Melee, 1 Target or Line 3',
  effect: 'Test branch selection.',
  keywords: ['Melee', '1 Target', 'Line 3'],
  criticalRange: null,
  areaTemplates: [],
  targetBranches: [
    {
      id: 'single',
      label: 'Melee — 1 Target',
      targetMode: 'one-target',
      targetCount: 1,
      range: 'Melee, 1 Target',
    },
    {
      id: 'line-3',
      label: 'Line 3',
      targetMode: 'multi-target',
      targetCount: null,
      range: 'Line 3',
      areaTemplates: [{ kind: 'line', size: 3, label: 'Line 3' }],
    },
  ],
  conditionSuggestions: [],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
})

const targetCountBranchSelectionScript = (): MoveAutomationScript => ({
  ...branchSelectionScript(),
  moveName: 'Target Count Branch Test',
  range: 'Melee, 1 Target or 6, 2 Targets',
  keywords: ['Melee', '1 Target', '6', '2 Targets'],
  targetBranches: [
    {
      id: 'single',
      label: 'Melee — 1 Target',
      targetMode: 'one-target',
      targetCount: 1,
      range: 'Melee, 1 Target',
    },
    {
      id: 'two-targets',
      label: '6m — 2 Targets',
      targetMode: 'multi-target',
      targetCount: 2,
      range: '6, 2 Targets',
    },
  ],
})

const withRegisteredMoveAutomationScript = async <T>(
  script: MoveAutomationScript,
  run: () => T | Promise<T>,
): Promise<T> => {
  const scripts = EXPLICIT_MOVE_AUTOMATION_SCRIPTS as Map<string, MoveAutomationScript>
  const previous = scripts.get(script.moveName)
  scripts.set(script.moveName, script)
  try {
    return await run()
  } finally {
    if (previous) scripts.set(script.moveName, previous)
    else scripts.delete(script.moveName)
  }
}

const targetCountScript = (): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: 'Fake 6, 2 Targets',
  version: 1,
  targetMode: 'multi-target',
  targetCount: 2,
  damaging: true,
  requiresAccuracy: false,
  damageBase: null,
  damageClass: 'Static',
  type: 'Normal',
  ac: null,
  range: '6, 2 Targets',
  effect: 'Fake explicit target-count test script.',
  keywords: ['6', '2 Targets'],
  criticalRange: null,
  directHpLoss: {
    kind: 'fixed',
    amount: 3,
    applyTypeImmunity: false,
    ignoreWeaknessResistance: true,
    ignoreStats: true,
    label: 'fixed 3 HP loss',
  },
  areaTemplates: [],
  conditionSuggestions: [],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
})

const branchSelectionPanel = (options: {
  moveName?: string
  recordMoveUsage?: (request: { placementId: string; moveName: string }) => void | Promise<void>
  onMoveUse?: (event: { userId: string; moveName: string }) => void | Promise<void>
  onBeforeNonImmediateAction?: (event: { userId: string; moveName: string }) => void
} = {}) => {
  const map = ref({
    ...mapFixture(),
    dimensions: { x: 6, y: 2, z: 6 },
    placements: [
      { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'brancher', position: { x: 1, y: 0, z: 1 } },
      { id: 'target-token', sheetKind: 'pokemon' as const, sheetSlug: 'target', position: { x: 2, y: 0, z: 2 } },
    ],
  })
  const moveName = options.moveName ?? 'Branch Selection Test'
  const pokemonSheet = {
    slug: 'brancher',
    nickname: 'Brancher',
    species: 'Bulbasaur',
    level: 5,
    movelist: [{ name: moveName, frequency: 'Scene' }],
  } as CharacterSheet
  const panel = useMoveAutomationPanel({
    map,
    spawnedPokemon: computed(() => [
      spawned({ id: 'user-token', species: 'Brancher', sheetSlug: 'brancher', position: { x: 1, y: 0, z: 1 } }),
      spawned({ id: 'target-token', species: 'Target', sheetSlug: 'target', currentHp: 20, maxHp: 20, position: { x: 2, y: 0, z: 2 } }),
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
    recordMoveUsage: options.recordMoveUsage,
    onMoveUse: options.onMoveUse,
    onBeforeNonImmediateAction: options.onBeforeNonImmediateAction,
  })
  return { map, panel }
}

const targetCountPanel = (options: {
  recordMoveUsage?: (request: { placementId: string; moveName: string }) => void | Promise<void>
  onMoveUse?: (event: { userId: string; moveName: string }) => void | Promise<void>
  onBeforeNonImmediateAction?: (event: { userId: string; moveName: string }) => void
  onRangedAttackOfOpportunity?: (event: { provokerId: string; targetIds: string[]; moveName: string }) => void
  enqueueMoveAnimations?: (events: readonly MoveAnimationEvent[]) => void | Promise<void>
  modifyHp?: (update: MoveAutomationTransaction['hpUpdates'][number]) => void | Promise<void>
} = {}) => {
  const map = ref({
    ...mapFixture(),
    dimensions: { x: 10, y: 2, z: 5 },
    placements: [
      { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'multi', position: { x: 0, y: 0, z: 0 } },
      { id: 'target-a', sheetKind: 'pokemon' as const, sheetSlug: 'target-a', position: { x: 1, y: 0, z: 0 } },
      { id: 'target-b', sheetKind: 'pokemon' as const, sheetSlug: 'target-b', position: { x: 2, y: 0, z: 0 } },
      { id: 'target-c', sheetKind: 'pokemon' as const, sheetSlug: 'target-c', position: { x: 3, y: 0, z: 0 } },
      { id: 'far-target', sheetKind: 'pokemon' as const, sheetSlug: 'far-target', position: { x: 8, y: 0, z: 0 } },
    ],
  })
  const pokemonSheet = {
    slug: 'multi',
    nickname: 'Multi',
    species: 'Bulbasaur',
    level: 5,
    movelist: [{ name: 'Fake 6, 2 Targets', frequency: 'Scene' }],
  } as CharacterSheet
  const panel = useMoveAutomationPanel({
    map,
    spawnedPokemon: computed(() => [
      spawned({ id: 'user-token', species: 'Multi', sheetSlug: 'multi', position: { x: 0, y: 0, z: 0 } }),
      spawned({ id: 'target-a', species: 'Target A', sheetSlug: 'target-a', currentHp: 20, maxHp: 20, position: { x: 1, y: 0, z: 0 } }),
      spawned({ id: 'target-b', species: 'Target B', sheetSlug: 'target-b', currentHp: 20, maxHp: 20, position: { x: 2, y: 0, z: 0 } }),
      spawned({ id: 'target-c', species: 'Target C', sheetSlug: 'target-c', currentHp: 20, maxHp: 20, position: { x: 3, y: 0, z: 0 } }),
      spawned({ id: 'far-target', species: 'Far Target', sheetSlug: 'far-target', currentHp: 20, maxHp: 20, position: { x: 8, y: 0, z: 0 } }),
    ]),
    pokemonBySlug: ref(new Map([[pokemonSheet.slug, pokemonSheet]])),
    trainerBySlug: ref(new Map<string, TrainerSheet>()),
    canEditMap: computed(() => false),
    canControlPlacement: (id) => id === 'user-token',
    modifyHp: options.modifyHp ?? (() => undefined),
    modifyCombatStages: () => undefined,
    modifyConditions: () => undefined,
    applyMoveFieldEffect: () => undefined,
    placeHazard: () => undefined,
    recordMoveUsage: options.recordMoveUsage,
    onMoveUse: options.onMoveUse,
    onBeforeNonImmediateAction: options.onBeforeNonImmediateAction,
    onRangedAttackOfOpportunity: options.onRangedAttackOfOpportunity,
    enqueueMoveAnimations: options.enqueueMoveAnimations,
    now: () => 12000,
  })
  return { map, panel }
}

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

  it('opens scripts with multiple target branches into branch-selection state', async () => {
    await withRegisteredMoveAutomationScript(branchSelectionScript(), () => {
      const { panel } = branchSelectionPanel()

      panel.openMoveAutomation({ id: 'user-token', moveName: 'Branch Selection Test' })

      expect(panel.moveAutomationTargeting.value).toBeNull()
      expect(panel.moveAutomationTargetBranchSelection.value).toMatchObject({
        userId: 'user-token',
        moveName: 'Branch Selection Test',
        options: [
          {
            branchId: 'single',
            label: 'Melee — 1 Target',
            targetMode: 'one-target',
            targetCount: 1,
            range: 'Melee, 1 Target',
            mode: 'target',
            disabled: false,
          },
          {
            branchId: 'line-3',
            label: 'Line 3',
            targetMode: 'multi-target',
            targetCount: null,
            range: 'Line 3',
            mode: 'area-confirmation',
            areaTemplates: [{ kind: 'line', size: 3, label: 'Line 3' }],
            disabled: false,
          },
        ],
      })
    })
  })

  it('does not notify or record usage when branch selection opens', async () => {
    await withRegisteredMoveAutomationScript(branchSelectionScript(), () => {
      const recordMoveUsage = vi.fn()
      const onMoveUse = vi.fn()
      const onBeforeNonImmediateAction = vi.fn()
      const { panel } = branchSelectionPanel({
        recordMoveUsage,
        onMoveUse,
        onBeforeNonImmediateAction,
      })

      panel.openMoveAutomation({ id: 'user-token', moveName: 'Branch Selection Test' })

      expect(panel.moveAutomationTargetBranchSelection.value?.moveName).toBe('Branch Selection Test')
      expect(recordMoveUsage).not.toHaveBeenCalled()
      expect(onMoveUse).not.toHaveBeenCalled()
      expect(onBeforeNonImmediateAction).not.toHaveBeenCalled()
    })
  })

  it('cancels active branch selection without notifying or recording usage', async () => {
    await withRegisteredMoveAutomationScript(branchSelectionScript(), () => {
      const recordMoveUsage = vi.fn()
      const onMoveUse = vi.fn()
      const onBeforeNonImmediateAction = vi.fn()
      const { panel } = branchSelectionPanel({
        recordMoveUsage,
        onMoveUse,
        onBeforeNonImmediateAction,
      })

      panel.openMoveAutomation({ id: 'user-token', moveName: 'Branch Selection Test' })
      expect(panel.moveAutomationTargetBranchSelection.value).not.toBeNull()

      panel.cancelMoveAutomationTargeting()

      expect(panel.moveAutomationTargetBranchSelection.value).toBeNull()
      expect(panel.moveAutomationTargeting.value).toBeNull()
      expect(recordMoveUsage).not.toHaveBeenCalled()
      expect(onMoveUse).not.toHaveBeenCalled()
      expect(onBeforeNonImmediateAction).not.toHaveBeenCalled()
    })
  })

  it('selecting a target branch transitions into the existing target or area flow without notifying or recording usage', async () => {
    await withRegisteredMoveAutomationScript(branchSelectionScript(), () => {
      const recordMoveUsage = vi.fn()
      const onMoveUse = vi.fn()
      const onBeforeNonImmediateAction = vi.fn()
      const { panel } = branchSelectionPanel({
        recordMoveUsage,
        onMoveUse,
        onBeforeNonImmediateAction,
      })

      panel.openMoveAutomation({ id: 'user-token', moveName: 'Branch Selection Test' })
      panel.selectMoveAutomationTargetBranch('single')

      expect(panel.moveAutomationTargetBranchSelection.value).toBeNull()
      expect(panel.moveAutomationTargeting.value).toMatchObject({
        userId: 'user-token',
        moveName: 'Branch Selection Test',
        mode: 'target',
        rangeLabel: '1m',
        candidateIds: ['target-token'],
      })
      expect(recordMoveUsage).not.toHaveBeenCalled()
      expect(onMoveUse).not.toHaveBeenCalled()
      expect(onBeforeNonImmediateAction).not.toHaveBeenCalled()

      panel.openMoveAutomation({ id: 'user-token', moveName: 'Branch Selection Test' })
      panel.selectMoveAutomationTargetBranch('line-3')

      expect(panel.moveAutomationTargetBranchSelection.value).toBeNull()
      expect(panel.moveAutomationTargeting.value).toMatchObject({
        userId: 'user-token',
        moveName: 'Branch Selection Test',
        mode: 'area-confirmation',
        rangeLabel: 'Line 3 south-east',
        candidateIds: ['target-token'],
        affectedIds: ['target-token'],
      })
      expect(panel.moveAutomationTargeting.value?.areaCells?.length).toBeGreaterThan(0)
      expect(recordMoveUsage).not.toHaveBeenCalled()
      expect(onMoveUse).not.toHaveBeenCalled()
      expect(onBeforeNonImmediateAction).not.toHaveBeenCalled()
    })
  })

  it('selecting a target-count branch transitions into the explicit multi-select flow', async () => {
    await withRegisteredMoveAutomationScript(targetCountBranchSelectionScript(), () => {
      const recordMoveUsage = vi.fn()
      const { panel } = branchSelectionPanel({
        moveName: 'Target Count Branch Test',
        recordMoveUsage,
      })

      panel.openMoveAutomation({ id: 'user-token', moveName: 'Target Count Branch Test' })

      expect(panel.moveAutomationTargetBranchSelection.value).toMatchObject({
        moveName: 'Target Count Branch Test',
        options: [
          { branchId: 'single', mode: 'target', disabled: false },
          { branchId: 'two-targets', mode: 'target-count', targetCount: 2, disabled: false },
        ],
      })

      panel.selectMoveAutomationTargetBranch('two-targets')

      expect(panel.moveAutomationTargetBranchSelection.value).toBeNull()
      expect(panel.moveAutomationTargeting.value).toMatchObject({
        userId: 'user-token',
        moveName: 'Target Count Branch Test',
        mode: 'target-count',
        rangeLabel: '6m',
        candidateIds: ['target-token'],
        selectedTargetIds: [],
        targetCount: 0,
        maxTargetCount: 2,
      })
      expect(panel.moveAutomationTargeting.value?.areaCells).toBeUndefined()
      expect(panel.moveAutomationTargeting.value?.areaTemplateId).toBeUndefined()
      expect(panel.moveAutomationTargeting.value?.areaTemplateOptions).toBeUndefined()
      expect(panel.moveAutomationTargeting.value?.areaDirection).toBeUndefined()
      expect(panel.moveAutomationTargeting.value?.areaDirectionOptions).toBeUndefined()
      expect(recordMoveUsage).not.toHaveBeenCalled()
    })
  })

  it('records tracked usage exactly once after final single-target branch confirmation', async () => {
    await withRegisteredMoveAutomationScript(branchSelectionScript(), async () => {
      const recordMoveUsage = vi.fn()
      const onMoveUse = vi.fn()
      const onBeforeNonImmediateAction = vi.fn()
      const { map, panel } = branchSelectionPanel({
        recordMoveUsage,
        onMoveUse,
        onBeforeNonImmediateAction,
      })

      panel.openMoveAutomation({ id: 'user-token', moveName: 'Branch Selection Test' })
      panel.selectMoveAutomationTargetBranch('single')

      expect(recordMoveUsage).not.toHaveBeenCalled()
      expect(onMoveUse).not.toHaveBeenCalled()
      expect(onBeforeNonImmediateAction).not.toHaveBeenCalled()

      await panel.selectMoveAutomationTarget('target-token')

      expect(recordMoveUsage).toHaveBeenCalledTimes(1)
      expect(recordMoveUsage).toHaveBeenCalledWith({ placementId: 'user-token', moveName: 'Branch Selection Test' })
      expect(onMoveUse).toHaveBeenCalledTimes(1)
      expect(onMoveUse).toHaveBeenCalledWith({ userId: 'user-token', moveName: 'Branch Selection Test' })
      expect(onBeforeNonImmediateAction).toHaveBeenCalledTimes(1)
      expect(onBeforeNonImmediateAction).toHaveBeenCalledWith({ userId: 'user-token', moveName: 'Branch Selection Test' })
      expect(panel.moveAutomationTargeting.value).toBeNull()
      expect(map.value.metadata?.moveLog).toMatchObject([{ moveName: 'Branch Selection Test', scriptKind: 'explicit' }])
    })
  })

  it('records tracked usage exactly once after final area branch confirmation', async () => {
    await withRegisteredMoveAutomationScript(branchSelectionScript(), async () => {
      const recordMoveUsage = vi.fn()
      const onMoveUse = vi.fn()
      const onBeforeNonImmediateAction = vi.fn()
      const { map, panel } = branchSelectionPanel({
        recordMoveUsage,
        onMoveUse,
        onBeforeNonImmediateAction,
      })

      panel.openMoveAutomation({ id: 'user-token', moveName: 'Branch Selection Test' })
      panel.selectMoveAutomationTargetBranch('line-3')

      expect(panel.moveAutomationTargeting.value).toMatchObject({
        mode: 'area-confirmation',
        affectedIds: ['target-token'],
      })
      expect(recordMoveUsage).not.toHaveBeenCalled()
      expect(onMoveUse).not.toHaveBeenCalled()
      expect(onBeforeNonImmediateAction).not.toHaveBeenCalled()

      await panel.selectMoveAutomationTarget('user-token')

      expect(recordMoveUsage).toHaveBeenCalledTimes(1)
      expect(recordMoveUsage).toHaveBeenCalledWith({ placementId: 'user-token', moveName: 'Branch Selection Test' })
      expect(onMoveUse).toHaveBeenCalledTimes(1)
      expect(onMoveUse).toHaveBeenCalledWith({ userId: 'user-token', moveName: 'Branch Selection Test' })
      expect(onBeforeNonImmediateAction).toHaveBeenCalledTimes(1)
      expect(onBeforeNonImmediateAction).toHaveBeenCalledWith({ userId: 'user-token', moveName: 'Branch Selection Test' })
      expect(panel.moveAutomationTargeting.value).toBeNull()
      expect(map.value.metadata?.moveLog).toMatchObject([{ moveName: 'Branch Selection Test', scriptKind: 'explicit' }])
    })
  })

  it('opens a fake 6, 2 Targets script into target-count targeting without area confirmation', async () => {
    await withRegisteredMoveAutomationScript(targetCountScript(), () => {
      const { panel } = targetCountPanel()

      panel.openMoveAutomation({ id: 'user-token', moveName: 'Fake 6, 2 Targets' })

      const targeting = panel.moveAutomationTargeting.value
      expect(targeting).toMatchObject({
        userId: 'user-token',
        moveName: 'Fake 6, 2 Targets',
        mode: 'target-count',
        rangeLabel: '6m',
        rangeMeters: 6,
        candidateIds: ['target-a', 'target-b', 'target-c'],
        selectedTargetIds: [],
        affectedIds: [],
        targetCount: 0,
        maxTargetCount: 2,
      })
      expect(panel.moveAutomationTargetBranchSelection.value).toBeNull()
      expect(targeting?.areaCells).toBeUndefined()
      expect(targeting?.areaTemplateId).toBeUndefined()
      expect(targeting?.areaTemplateOptions).toBeUndefined()
      expect(targeting?.areaDirection).toBeUndefined()
      expect(targeting?.areaDirectionOptions).toBeUndefined()
    })
  })

  it('toggles and caps explicit target-count selections', async () => {
    await withRegisteredMoveAutomationScript(targetCountScript(), async () => {
      const { panel } = targetCountPanel()

      panel.openMoveAutomation({ id: 'user-token', moveName: 'Fake 6, 2 Targets' })
      await panel.selectMoveAutomationTarget('target-a')
      await panel.selectMoveAutomationTarget('target-b')
      await panel.selectMoveAutomationTarget('target-c')

      expect(panel.moveAutomationTargeting.value).toMatchObject({
        mode: 'target-count',
        selectedTargetIds: ['target-a', 'target-b'],
        affectedIds: ['target-a', 'target-b'],
        targetCount: 2,
        maxTargetCount: 2,
      })

      await panel.selectMoveAutomationTarget('target-a')
      expect(panel.moveAutomationTargeting.value).toMatchObject({
        selectedTargetIds: ['target-b'],
        affectedIds: ['target-b'],
        targetCount: 1,
      })

      await panel.selectMoveAutomationTarget('target-c')
      expect(panel.moveAutomationTargeting.value).toMatchObject({
        selectedTargetIds: ['target-b', 'target-c'],
        affectedIds: ['target-b', 'target-c'],
        targetCount: 2,
      })
    })
  })

  it('blocks target-count confirmation with zero selected targets', async () => {
    await withRegisteredMoveAutomationScript(targetCountScript(), async () => {
      const recordMoveUsage = vi.fn()
      const onMoveUse = vi.fn()
      const onBeforeNonImmediateAction = vi.fn()
      const onRangedAttackOfOpportunity = vi.fn()
      const enqueueMoveAnimations = vi.fn()
      const modifyHp = vi.fn()
      const { panel } = targetCountPanel({
        recordMoveUsage,
        onMoveUse,
        onBeforeNonImmediateAction,
        onRangedAttackOfOpportunity,
        enqueueMoveAnimations,
        modifyHp,
      })

      panel.openMoveAutomation({ id: 'user-token', moveName: 'Fake 6, 2 Targets' })
      await panel.confirmMoveAutomationTargetCount()

      expect(panel.moveAutomationTargeting.value).toMatchObject({
        mode: 'target-count',
        selectedTargetIds: [],
        targetCount: 0,
      })
      expect(recordMoveUsage).not.toHaveBeenCalled()
      expect(onMoveUse).not.toHaveBeenCalled()
      expect(onBeforeNonImmediateAction).not.toHaveBeenCalled()
      expect(onRangedAttackOfOpportunity).not.toHaveBeenCalled()
      expect(enqueueMoveAnimations).not.toHaveBeenCalled()
      expect(modifyHp).not.toHaveBeenCalled()
    })
  })

  it('confirms target-count selections once through multi-target resolution', async () => {
    await withRegisteredMoveAutomationScript(targetCountScript(), async () => {
      const hpUpdates: MoveAutomationTransaction['hpUpdates'] = []
      const recordMoveUsage = vi.fn()
      const onMoveUse = vi.fn()
      const onBeforeNonImmediateAction = vi.fn()
      const onRangedAttackOfOpportunity = vi.fn()
      const enqueueMoveAnimations = vi.fn((_events: readonly MoveAnimationEvent[]) => undefined)
      const { map, panel } = targetCountPanel({
        recordMoveUsage,
        onMoveUse,
        onBeforeNonImmediateAction,
        onRangedAttackOfOpportunity,
        enqueueMoveAnimations,
        modifyHp: (update) => { hpUpdates.push(update) },
      })

      panel.openMoveAutomation({ id: 'user-token', moveName: 'Fake 6, 2 Targets' })
      await panel.selectMoveAutomationTarget('target-a')
      await panel.selectMoveAutomationTarget('target-b')
      await panel.selectMoveAutomationTarget('user-token')
      expect(recordMoveUsage).not.toHaveBeenCalled()
      expect(panel.moveAutomationTargeting.value).toMatchObject({
        mode: 'target-count',
        selectedTargetIds: ['target-a', 'target-b'],
      })

      await panel.confirmMoveAutomationTargetCount()

      expect(recordMoveUsage).toHaveBeenCalledTimes(1)
      expect(recordMoveUsage).toHaveBeenCalledWith({ placementId: 'user-token', moveName: 'Fake 6, 2 Targets' })
      expect(onMoveUse).toHaveBeenCalledTimes(1)
      expect(onMoveUse).toHaveBeenCalledWith({ userId: 'user-token', moveName: 'Fake 6, 2 Targets' })
      expect(onBeforeNonImmediateAction).toHaveBeenCalledTimes(1)
      expect(onBeforeNonImmediateAction).toHaveBeenCalledWith({ userId: 'user-token', moveName: 'Fake 6, 2 Targets' })
      expect(onRangedAttackOfOpportunity).toHaveBeenCalledTimes(1)
      expect(onRangedAttackOfOpportunity).toHaveBeenCalledWith({
        provokerId: 'user-token',
        targetIds: ['target-a', 'target-b'],
        moveName: 'Fake 6, 2 Targets',
      })
      expect(hpUpdates).toEqual([
        { id: 'target-a', currentHp: 17 },
        { id: 'target-b', currentHp: 17 },
      ])
      expect(panel.moveAutomationTargeting.value).toBeNull()
      expect(map.value.metadata?.moveLog).toMatchObject([{ moveName: 'Fake 6, 2 Targets', scriptKind: 'explicit' }])

      expect(enqueueMoveAnimations).toHaveBeenCalledTimes(1)
      const events = enqueueMoveAnimations.mock.calls[0]?.[0] ?? []
      expect(events.length).toBeGreaterThan(0)
      expect(events.some((event) => event.id.includes('use-move-multi-target'))).toBe(true)
      const eventTargetIds = events.flatMap((event) => ('targetId' in event && event.targetId ? [event.targetId] : []))
      expect(eventTargetIds).toEqual(expect.arrayContaining(['target-a', 'target-b']))
      const areaKinds = new Set<MoveAnimationEvent['kind']>([
        MOVE_VFX_KIND.areaPulse,
        MOVE_VFX_KIND.radialBurst,
        MOVE_VFX_KIND.lineSweep,
        MOVE_VFX_KIND.coneSweep,
      ])
      expect(events.some((event) => areaKinds.has(event.kind))).toBe(false)
      expect(events.some((event) => Boolean((event as { areaCells?: unknown }).areaCells))).toBe(false)
    })
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
    const onMoveFeedback = vi.fn()
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
      onMoveFeedback,
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
      expect(onMoveFeedback).toHaveBeenCalledWith({
        feedback: expect.objectContaining({
          moveName: 'Psywave',
          userId: 'user-token',
          targetId: 'target-token',
          phase: 'rolling',
          damageLoss: 20,
        }),
      })
      expect(calls).toEqual([])

      await vi.advanceTimersByTimeAsync(MOVE_FEEDBACK_DAMAGE_FINAL_MS)

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

      await vi.advanceTimersByTimeAsync(MOVE_FEEDBACK_EFFECTIVE_DAMAGE_FINAL_MS - MOVE_FEEDBACK_FINAL_MS)

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

      await vi.advanceTimersByTimeAsync(MOVE_FEEDBACK_DAMAGE_FINAL_MS)

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

      await vi.advanceTimersByTimeAsync(MOVE_FEEDBACK_EFFECTIVE_DAMAGE_FINAL_MS)

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
        expect(events[0]?.startOffsetMs, scenario.label).toBe(MOVE_FEEDBACK_ANIMATION_LAUNCH_MS)
        const semanticFollowUpKinds = new Set<MoveAnimationEvent['kind']>([
          MOVE_VFX_KIND.healing,
          MOVE_VFX_KIND.buffDebuff,
          MOVE_VFX_KIND.status,
        ])
        for (const event of events.slice(1)) {
          const expectedStartOffset = semanticFollowUpKinds.has(event.kind)
            ? MOVE_FEEDBACK_EFFECTIVE_DAMAGE_FINAL_MS
            : MOVE_FEEDBACK_ANIMATION_IMPACT_MS
          expect(event.startOffsetMs, `${scenario.label}:${event.kind}`).toBe(expectedStartOffset)
        }

        if (scenario.label === 'hit') {
          expect(hpCalls).toEqual([])
          await vi.advanceTimersByTimeAsync(MOVE_FEEDBACK_EFFECTIVE_DAMAGE_FINAL_MS)
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
    expect(launchEvent?.startOffsetMs).toBe(MOVE_FEEDBACK_ANIMATION_LAUNCH_MS)
    expect(impactEvent?.startOffsetMs).toBe(MOVE_FEEDBACK_ANIMATION_IMPACT_MS)
    expect(statusEvent).toMatchObject({
      targetId: 'target-token',
      startOffsetMs: MOVE_FEEDBACK_DAMAGE_FINAL_MS,
      conditionNames: ['Paralysis'],
    })

    expect(calls).toEqual([])
    await vi.advanceTimersByTimeAsync(MOVE_FEEDBACK_OUTCOME_MS)
    expect(calls).toEqual([])
    await vi.advanceTimersByTimeAsync(MOVE_FEEDBACK_ANIMATION_IMPACT_MS - MOVE_FEEDBACK_OUTCOME_MS)
    expect(calls).toEqual([])
    await vi.advanceTimersByTimeAsync(MOVE_FEEDBACK_DAMAGE_FINAL_MS - MOVE_FEEDBACK_ANIMATION_IMPACT_MS)
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

  it('lets Ranged Blast moves free-aim their area center instead of snapping to a token', () => {
    const map = ref({
      ...mapFixture(),
      dimensions: { x: 12, y: 2, z: 12 },
      placements: [
        { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'bolt', position: { x: 1, y: 0, z: 1 } },
        { id: 'target-token', sheetKind: 'pokemon' as const, sheetSlug: 'target', position: { x: 4, y: 0, z: 4 } },
      ],
    })
    const pokemonSheet = {
      slug: 'bolt',
      nickname: 'Bolt',
      species: 'Bulbasaur',
      level: 5,
      movelist: [{ name: 'Swift' }],
    } as CharacterSheet
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned({ id: 'user-token', sheetSlug: 'bolt', position: { x: 1, y: 0, z: 1 } }),
        spawned({ id: 'target-token', species: 'Target', sheetSlug: 'target', position: { x: 4, y: 0, z: 4 } }),
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

    panel.openMoveAutomation({ id: 'user-token', moveName: 'Swift' })

    expect(panel.moveAutomationTargeting.value).toMatchObject({
      mode: 'area-confirmation',
      moveName: 'Swift',
      rangeLabel: 'Ranged 8 Blast 2 centered on Target',
      rangeMeters: 8,
      areaAimMode: 'free',
      areaAimCenter: { x: 4, y: 0, z: 4 },
      areaAimRangeMeters: 8,
      candidateIds: ['target-token'],
    })

    panel.aimMoveAutomationArea({ x: 5, y: 0, z: 4 })

    expect(panel.moveAutomationTargeting.value).toMatchObject({
      rangeLabel: 'Ranged 8 Blast 2 centered at (5, 0, 4)',
      areaAimMode: 'free',
      areaAimCenter: { x: 5, y: 0, z: 4 },
      candidateIds: ['target-token'],
      affectedIds: ['target-token'],
    })
    expect(panel.moveAutomationTargeting.value?.areaCells).toContainEqual({ x: 5, y: 0, z: 4 })

    panel.aimMoveAutomationArea({ x: 11, y: 0, z: 11 })

    expect(panel.moveAutomationTargeting.value?.areaAimCenter).toEqual({ x: 5, y: 0, z: 4 })
  })

  it('exposes legal area-template alternatives and free-aims Close Blast choices', () => {
    const map = ref({
      ...mapFixture(),
      dimensions: { x: 8, y: 4, z: 8 },
      placements: [
        { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'sludger', position: { x: 3, y: 1, z: 3 } },
        { id: 'target-token', sheetKind: 'pokemon' as const, sheetSlug: 'target', position: { x: 4, y: 1, z: 3 } },
      ],
    })
    const pokemonSheet = {
      slug: 'sludger',
      nickname: 'Sludger',
      species: 'Grimer',
      level: 5,
      movelist: [{ name: 'Sludge Wave' }],
    } as CharacterSheet
    const burstId = moveAutomationAreaTemplateId({ kind: 'burst', size: 1 })
    const closeBlastId = moveAutomationAreaTemplateId({ kind: 'close-blast', size: 2 })
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned({ id: 'user-token', species: 'Sludger', sheetSlug: 'sludger', position: { x: 3, y: 1, z: 3 } }),
        spawned({ id: 'target-token', species: 'Target', sheetSlug: 'target', position: { x: 4, y: 1, z: 3 } }),
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

    panel.openMoveAutomation({ id: 'user-token', moveName: 'Sludge Wave' })

    expect(panel.moveAutomationTargeting.value).toMatchObject({
      mode: 'area-confirmation',
      moveName: 'Sludge Wave',
      rangeLabel: 'Burst 1',
      areaTemplateId: burstId,
      areaTemplateOptions: [
        { id: burstId, label: 'Burst 1' },
        { id: closeBlastId, label: 'Close Blast 2' },
      ],
      areaDirectionOptions: [],
    })

    panel.selectMoveAutomationAreaTemplate(closeBlastId)

    expect(panel.moveAutomationTargeting.value).toMatchObject({
      rangeLabel: 'Close Blast 2 south-east',
      areaTemplateId: closeBlastId,
      areaAimMode: 'free',
      areaAimRangeMeters: 2,
      areaDirectionOptions: [],
    })
    expect(panel.moveAutomationTargeting.value?.areaDirection).toBeUndefined()

    panel.aimMoveAutomationArea({ x: 4, y: 1, z: 3 })
    expect(panel.moveAutomationTargeting.value).toMatchObject({
      rangeLabel: 'Close Blast 2 aimed at (4, 1, 3)',
      areaTemplateId: closeBlastId,
      areaAimMode: 'free',
      areaAimCenter: { x: 4, y: 1, z: 3 },
      candidateIds: ['target-token'],
      affectedIds: ['target-token'],
    })

    panel.aimMoveAutomationArea({ x: 7, y: 1, z: 7 })
    expect(panel.moveAutomationTargeting.value?.areaAimCenter).toEqual({ x: 4, y: 1, z: 3 })

    panel.selectMoveAutomationAreaTemplate(burstId)
    expect(panel.moveAutomationTargeting.value).toMatchObject({
      rangeLabel: 'Burst 1',
      areaTemplateId: burstId,
      areaDirectionOptions: [],
    })
    expect(panel.moveAutomationTargeting.value?.areaDirection).toBeUndefined()
  })

  it('plans area VFX from the confirmed area-template choice only', async () => {
    const map = ref({
      ...mapFixture(),
      dimensions: { x: 8, y: 4, z: 8 },
      placements: [
        { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'gasser', position: { x: 3, y: 1, z: 3 } },
        { id: 'target-token', sheetKind: 'pokemon' as const, sheetSlug: 'target', position: { x: 4, y: 1, z: 4 } },
      ],
    })
    const pokemonSheet = {
      slug: 'gasser',
      nickname: 'Gasser',
      species: 'Koffing',
      level: 5,
      movelist: [{ name: 'Poison Gas' }],
    } as CharacterSheet
    const coneId = moveAutomationAreaTemplateId({ kind: 'cone', size: 2 })
    const enqueuedEvents: MoveAnimationEvent[][] = []
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned({ id: 'user-token', species: 'Gasser', sheetSlug: 'gasser', position: { x: 3, y: 1, z: 3 } }),
        spawned({ id: 'target-token', species: 'Target', sheetSlug: 'target', position: { x: 4, y: 1, z: 4 } }),
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
      enqueueMoveAnimations: (events) => { enqueuedEvents.push([...events]) },
      now: () => 15500,
    })

    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    try {
      panel.openMoveAutomation({ id: 'user-token', moveName: 'Poison Gas' })
      await panel.selectMoveAutomationTarget('user-token')

      panel.openMoveAutomation({ id: 'user-token', moveName: 'Poison Gas' })
      panel.selectMoveAutomationAreaTemplate(coneId)
      await panel.selectMoveAutomationTarget('user-token')
    } finally {
      random.mockRestore()
    }

    expect(enqueuedEvents).toHaveLength(2)
    expect(enqueuedEvents[0]?.map((event) => event.kind)).not.toContain(MOVE_VFX_KIND.coneSweep)
    expect(enqueuedEvents[1]?.map((event) => event.kind)).toContain(MOVE_VFX_KIND.coneSweep)
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

    expect(calls).toEqual(['vfx:dash,area-pulse,target-flash,badge,badge,target-flash,badge,badge', 'hp:first-token', 'hp:second-token'])
    expect(enqueueMoveAnimations).toHaveBeenCalledTimes(1)
    const events = enqueueMoveAnimations.mock.calls[0]?.[0] ?? []
    expect(events.map((event) => event.kind)).toEqual([
      MOVE_VFX_KIND.dash,
      MOVE_VFX_KIND.areaPulse,
      MOVE_VFX_KIND.targetFlash,
      MOVE_VFX_KIND.badge,
      MOVE_VFX_KIND.badge,
      MOVE_VFX_KIND.targetFlash,
      MOVE_VFX_KIND.badge,
      MOVE_VFX_KIND.badge,
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
        kind: MOVE_VFX_KIND.badge,
        targetId: 'first-token',
        label: 'Hit',
        startOffsetMs: 220,
      }),
      expect.objectContaining({
        kind: MOVE_VFX_KIND.badge,
        targetId: 'first-token',
        label: expect.stringMatching(/^\d+ Damage$/),
        startOffsetMs: 460,
      }),
      expect.objectContaining({
        kind: MOVE_VFX_KIND.targetFlash,
        targetId: 'second-token',
        startOffsetMs: 280,
      }),
      expect.objectContaining({
        kind: MOVE_VFX_KIND.badge,
        targetId: 'second-token',
        label: 'Hit',
        startOffsetMs: 280,
      }),
      expect.objectContaining({
        kind: MOVE_VFX_KIND.badge,
        targetId: 'second-token',
        label: expect.stringMatching(/^\d+ Damage$/),
        startOffsetMs: 520,
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

  it('routes Pass movement through the token move handler so live play can persist the destination', async () => {
    const map = ref({
      ...mapFixture(),
      dimensions: { x: 7, y: 2, z: 3 },
      placements: [
        { id: 'user-token', sheetKind: 'pokemon' as const, sheetSlug: 'scratcher', position: { x: 1, y: 0, z: 1 } },
        { id: 'first-token', sheetKind: 'pokemon' as const, sheetSlug: 'first', position: { x: 2, y: 0, z: 1 } },
      ],
    })
    const pokemonSheet = {
      slug: 'scratcher',
      nickname: 'Scratcher',
      species: 'Meowth',
      level: 5,
      movelist: [{ name: 'Scratch' }],
    } as CharacterSheet
    const moveToken = vi.fn(async (_request: { id: string; position: { x: number; y: number; z: number } }) => undefined)
    const panel = useMoveAutomationPanel({
      map,
      spawnedPokemon: computed(() => [
        spawned({ id: 'user-token', species: 'Scratcher', sheetSlug: 'scratcher', position: { x: 1, y: 0, z: 1 } }),
        spawned({ id: 'first-token', species: 'First', sheetSlug: 'first', currentHp: 40, maxHp: 40, position: { x: 2, y: 0, z: 1 } }),
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
      moveToken,
    })

    panel.openMoveAutomation({ id: 'user-token', moveName: 'Scratch' })
    panel.selectMoveAutomationAreaDirection('east')

    const random = vi.spyOn(Math, 'random').mockReturnValue(0.9)
    try {
      await panel.selectMoveAutomationTarget('user-token')
    } finally {
      random.mockRestore()
    }

    expect(moveToken).toHaveBeenCalledTimes(1)
    expect(moveToken).toHaveBeenCalledWith({ id: 'user-token', position: { x: 5, y: 0, z: 1 } })
    expect(map.value.placements.find((placement) => placement.id === 'user-token')?.position).toEqual({ x: 1, y: 0, z: 1 })
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
