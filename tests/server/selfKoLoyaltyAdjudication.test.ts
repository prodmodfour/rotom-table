import { describe, expect, it } from 'vitest'
import { LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION, type ResolveMoveIntent } from '#shared/livePlayMoveResolution'
import { moveAutomationAreaTemplateId } from '~/utils/moveAutomationAreaTemplates'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveStateExecution,
} from '~~/server/domain/planAuthoritativeMoveState'
import { planResumedMoveState } from '~~/server/domain/moveAutomation/planResumedMoveState'
import { resumeMoveSpec } from '~~/server/domain/moveAutomation/resumeSpec'

const placement = (id: string, slug: string, x: number): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug: slug,
  sideId: id === 'actor' ? 'heroes' : 'foes',
  position: { x, y: 0, z: 1 },
})

type SelfKoMove = 'Explosion' | 'Self-Destruct'

const pokemon = (
  slug: string,
  options: {
    readonly actor?: boolean
    readonly volatileBomb?: boolean
    readonly moveName?: SelfKoMove
    readonly loyalty?: number
  } = {},
): CharacterSheet => ({
  slug,
  nickname: slug,
  species: options.actor ? 'Pikachu' : 'Abra',
  level: 20,
  revision: 3,
  loyalty: options.actor ? options.loyalty ?? 3 : undefined,
  movelist: options.actor ? [{ name: options.moveName ?? 'Explosion' }] : [],
  capabilities: options.volatileBomb ? { other: ['Volatile Bomb'] } : undefined,
  stats: {
    hp: { added: 100 },
    atk: { added: 8, stage: 0 },
    def: { added: 8, stage: 0 },
    satk: { added: 8, stage: 0 },
    sdef: { added: 8, stage: 0 },
    spd: { added: 8, stage: 0 },
  },
  combatStages: { acc: 0 },
  combat: { currentHp: 200, conditions: [] },
})

const fixture = (
  volatileBomb = false,
  moveName: SelfKoMove = 'Explosion',
  loyalty = 3,
): {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly intent: ResolveMoveIntent
} => ({
  map: {
    schemaVersion: 2,
    slug: 'self-ko-arena',
    name: 'Self-KO Arena',
    revision: 4,
    updatedAt: 100,
    dimensions: { x: 8, y: 3, z: 8 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [placement('actor', 'actor-sheet', 2), placement('target', 'target-sheet', 3)],
    lights: [],
    initiative: { activeId: 'actor', round: 1, manualOrderIds: ['actor', 'target'] },
    activeScene: { name: 'Self-KO Scene', startedAt: 100 },
    metadata: {},
  },
  pokemonSheets: new Map([
    ['actor-sheet', pokemon('actor-sheet', { actor: true, volatileBomb, moveName, loyalty })],
    ['target-sheet', pokemon('target-sheet')],
  ]),
  intent: {
    schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
    placementId: 'actor',
    moveName,
    selection: {
      kind: 'area',
      areaTemplateId: moveAutomationAreaTemplateId({
        kind: 'burst', size: moveName === 'Explosion' ? 2 : 3,
      }),
    },
  },
})

const planDeclaration = (
  volatileBomb = false,
  moveName: SelfKoMove = 'Explosion',
  loyalty = 3,
) => {
  const input = fixture(volatileBomb, moveName, loyalty)
  const plan = planAuthoritativeMoveStateExecution({
    ...input,
    trainerSheets: new Map(),
    random: () => 0.5,
    now: () => 5_000,
    operationId: volatileBomb ? 'op_self_ko_volatile' : 'op_self_ko_declare',
    pendingResolutionId: volatileBomb ? 'resolution.self-ko.volatile' : `resolution.self-ko.${moveName.toLowerCase().replace('-', '')}`,
  })
  return { ...input, plan }
}

const resumeAdjudication = (optionId: string | null, loyalty = 3) => {
  const declared = planDeclaration(false, 'Explosion', loyalty)
  expect(isAuthoritativePendingMoveStatePlan(declared.plan)).toBe(true)
  if (!isAuthoritativePendingMoveStatePlan(declared.plan)) throw new Error('Expected pending Explosion.')
  const pending = declared.plan.suspension.pendingResolution
  const window = pending.outstandingWindows[0]!
  const execution = resumeMoveSpec({
    pendingResolution: pending,
    map: declared.plan.nextMap,
    pokemonSheets: declared.pokemonSheets,
    trainerSheets: new Map(),
    response: { requestId: window.windowId, optionId },
    now: 5_001,
    random: () => 0.5,
  })
  const plan = planResumedMoveState({
    pendingResolution: pending,
    declarationPlan: declared.plan.suspension.preWindowPlan,
    responseOpId: optionId === null ? 'op_explosion_keep_loyalty' : 'op_explosion_lower_loyalty',
    responseWindowId: window.windowId,
    responseOptionId: optionId,
    chosenBy: { kind: 'gm', id: null },
    map: declared.plan.nextMap,
    pokemonSheets: declared.pokemonSheets,
    trainerSheets: new Map(),
    execution,
    plannedAt: 5_001,
  })
  expect(isAuthoritativePendingMoveStatePlan(plan)).toBe(false)
  if (isAuthoritativePendingMoveStatePlan(plan)) throw new Error('Expected completed Explosion.')
  return { pending, window, plan }
}

describe('Explosion and Self-Destruct Loyalty adjudication', () => {
  it('creates a GM-only durable window and atomically merges chosen Loyalty loss with self-HP', () => {
    const { pending, window, plan } = resumeAdjudication('explosion.lower-loyalty')
    expect(window).toMatchObject({
      windowId: 'explosion.loyalty-adjudication',
      ownership: [{ kind: 'gm', id: null }],
      allowPass: true,
      options: [{ id: 'explosion.lower-loyalty' }],
    })
    expect(pending.publicSummary).not.toHaveProperty('ownership')
    const actorWrite = plan.sheetWrites.find(write => write.slug === 'actor-sheet')!
    expect(actorWrite.changedFields).toEqual(expect.arrayContaining(['hp', 'loyalty']))
    expect((actorWrite.nextSheet as CharacterSheet).loyalty).toBe(2)
    expect((actorWrite.nextSheet as CharacterSheet).combat?.currentHp).toBeLessThan(0)
    expect(plan.sheetWrites.filter(write => write.slug === 'actor-sheet')).toHaveLength(1)
  })

  it('opens the same GM adjudication for Self-Destruct', () => {
    const { plan } = planDeclaration(false, 'Self-Destruct')
    expect(isAuthoritativePendingMoveStatePlan(plan)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(plan)) throw new Error('Expected pending Self-Destruct.')
    expect(plan.suspension.pendingResolution.outstandingWindows[0]).toMatchObject({
      windowId: 'self-destruct.loyalty-adjudication',
      ownership: [{ kind: 'gm', id: null }],
      options: [{ id: 'self-destruct.lower-loyalty' }],
    })
  })

  it('keeps Loyalty on pass while still applying the unavoidable self-HP result', () => {
    const { plan } = resumeAdjudication(null)
    const actorWrite = plan.sheetWrites.find(write => write.slug === 'actor-sheet')!
    expect(actorWrite.changedFields).toContain('hp')
    expect(actorWrite.changedFields).not.toContain('loyalty')
    expect((actorWrite.nextSheet as CharacterSheet).loyalty).toBe(3)
    expect((actorWrite.nextSheet as CharacterSheet).combat?.currentHp).toBeLessThan(0)
  })

  it('clamps a selected decrease at zero without producing a no-op Loyalty write', () => {
    const { plan } = resumeAdjudication('explosion.lower-loyalty', 0)
    const actorWrite = plan.sheetWrites.find(write => write.slug === 'actor-sheet')!
    expect(actorWrite.changedFields).not.toContain('loyalty')
    expect((actorWrite.nextSheet as CharacterSheet).loyalty).toBe(0)
  })

  it('lets effective Volatile Bomb suppress the window and Loyalty mutation', () => {
    const { plan } = planDeclaration(true)
    expect(isAuthoritativePendingMoveStatePlan(plan)).toBe(false)
    if (isAuthoritativePendingMoveStatePlan(plan)) throw new Error('Volatile Bomb must not suspend.')
    const actorWrite = plan.sheetWrites.find(write => write.slug === 'actor-sheet')!
    expect(actorWrite.changedFields).toContain('hp')
    expect(actorWrite.changedFields).not.toContain('loyalty')
    expect((actorWrite.nextSheet as CharacterSheet).loyalty).toBe(3)
  })
})
