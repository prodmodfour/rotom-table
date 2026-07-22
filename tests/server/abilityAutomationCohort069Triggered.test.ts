import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveStateExecution,
} from '../../server/domain/planAuthoritativeMoveState'
import { isAuthoritativePendingMoveResolution } from '../../server/domain/resolveAuthoritativeMove'
import { resumeMoveSpec } from '../../server/domain/moveAutomation/resumeSpec'
import { planResumedMoveState } from '../../server/domain/moveAutomation/planResumedMoveState'
import type { PendingMoveResolution } from '#shared/moveAutomation/pendingResolution'
import type { MoveStateChangePlan } from '../../server/domain/moveAutomation/plan'

const slugify = (value: string): string => value.toLowerCase().replaceAll(' ', '-').replaceAll('’', '')
const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const, instanceId: `base:${slugify(canonicalId)}`,
    canonicalId, definitionVersion: null, selections: [],
  },
})
const sheet = (input: {
  slug: string
  move?: string
  ability?: string
  hp?: number
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 20, revision: 3,
  types: ['Normal'], abilities: input.ability ? [ability(input.ability)] : [],
  movelist: input.move ? [{ name: input.move }] : [],
  stats: {
    hp: { added: 45 }, atk: { added: 25 }, def: { added: 25 },
    satk: { added: 25 }, sdef: { added: 25 }, spd: { added: 25 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: input.hp ?? 150, injuries: 0, conditions: [] },
})
const battleMap = (slug: string): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
  ]
  return {
    schemaVersion: 2, slug, name: slug, revision: 5,
    dimensions: { x: 8, y: 4, z: 8 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] }, placements,
    encounterState: {
      ...encounter,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: {
        ...encounter.history, sceneId: `scene:${slug}`, currentRound: 1,
        currentTurn: { round: 1, turn: 1, placementId: 'actor' },
      },
      turnResources: Object.fromEntries(placements.map(placement => [
        placement.id, createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 }),
      ])),
    },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
  }
}

const declare = (input: {
  slug: string
  move: string
  actorAbility?: string
  targetAbility?: string
  targetHp?: number
  random?: () => number
}) => {
  const map = battleMap(input.slug)
  const pokemonSheets = new Map<string, CharacterSheet>([
    ['actor', sheet({ slug: 'actor', move: input.move, ability: input.actorAbility })],
    ['target', sheet({ slug: 'target', ability: input.targetAbility, hp: input.targetHp })],
  ])
  const result = planAuthoritativeMoveStateExecution({
    map, pokemonSheets, trainerSheets: new Map(),
    intent: {
      schemaVersion: 1, placementId: 'actor', moveName: input.move,
      selection: { kind: 'single-target', targetPlacementId: 'target' },
    },
    random: input.random ?? (() => 0.99), now: () => 1_000,
    operationId: `op_${input.slug}`, pendingResolutionId: `resolution:${input.slug}`,
  })
  if (!isAuthoritativePendingMoveStatePlan(result)) {
    throw new Error(`Expected ${input.actorAbility ?? input.targetAbility} to open a durable window.`)
  }
  return { result, pokemonSheets }
}

const resume = (input: {
  pending: PendingMoveResolution
  map: TabletopMap
  pokemonSheets: ReadonlyMap<string, CharacterSheet>
  optionId: string | null
  random?: () => number
}) => resumeMoveSpec({
  pendingResolution: structuredClone(input.pending),
  map: structuredClone(input.map),
  pokemonSheets: input.pokemonSheets, trainerSheets: new Map(),
  response: {
    requestId: input.pending.outstandingWindows[0]!.windowId,
    optionId: input.optionId,
  },
  now: 2_000, random: input.random ?? (() => 0.99),
})

const completePlan = (input: {
  declaration: ReturnType<typeof declare>
  pending: PendingMoveResolution
  execution: Exclude<ReturnType<typeof resume>, PendingMoveResolution>
  optionId: string | null
  chosenBy: 'actor' | 'target'
  declarationPlan?: MoveStateChangePlan | null
}) => planResumedMoveState({
  pendingResolution: input.pending,
  declarationPlan: input.declarationPlan
    ?? input.declaration.result.suspension.preWindowPlan,
  responseOpId: `op_response_${input.pending.resolutionId.replaceAll(/[^a-zA-Z0-9_-]/g, '_')}`,
  responseWindowId: input.pending.outstandingWindows[0]!.windowId,
  responseOptionId: input.optionId,
  chosenBy: { kind: 'placement', id: input.chosenBy },
  map: input.declaration.result.nextMap,
  pokemonSheets: input.declaration.pokemonSheets, trainerSheets: new Map(),
  execution: input.execution, plannedAt: 2_000,
})

const nextSheet = (plan: ReturnType<typeof completePlan>, slug: string): CharacterSheet => (
  plan.sheetWrites.find(write => write.slug === slug)?.nextSheet as CharacterSheet
)

describe('AA-069 Move-triggered abilities', () => {
  it('aa069.enfeebling-lips.reviewed pauses after a Lovely Kiss hit and lowers exactly the chosen combat Stat', () => {
    const declaration = declare({
      slug: 'aa069-enfeebling', move: 'Lovely Kiss', actorAbility: 'Enfeebling Lips',
    })
    const pending = declaration.result.suspension.pendingResolution
    expect(pending.outstandingWindows[0]).toMatchObject({
      options: expect.arrayContaining([
        expect.objectContaining({ id: 'ability.enfeebling-lips.defense' }),
      ]),
      allowPass: false,
    })
    const execution = resume({
      pending, map: declaration.result.nextMap,
      pokemonSheets: declaration.pokemonSheets,
      optionId: 'ability.enfeebling-lips.defense',
    })
    expect(isAuthoritativePendingMoveResolution(execution)).toBe(false)
    if (isAuthoritativePendingMoveResolution(execution)) return
    const plan = completePlan({
      declaration, pending, execution,
      optionId: 'ability.enfeebling-lips.defense', chosenBy: 'actor',
    })
    const target = nextSheet(plan, 'target')
    expect(target.stats?.def?.stage ?? target.combatStages?.def).toBe(-2)
    expect(target.stats?.atk?.stage ?? target.combatStages?.atk).toBe(0)
  }, 30_000)

  it('aa069.fiery-crash.reviewed durably chooses +2 DB or Fire typing and applies the reviewed Burn range', () => {
    const damageDeclaration = declare({
      slug: 'aa069-fiery-db', move: 'Tackle', actorAbility: 'Fiery Crash',
    })
    const damagePending = damageDeclaration.result.suspension.pendingResolution
    expect(damagePending.outstandingWindows[0]).toMatchObject({ timing: 'declare' })
    const damageExecution = resume({
      pending: damagePending, map: damageDeclaration.result.nextMap,
      pokemonSheets: damageDeclaration.pokemonSheets,
      optionId: 'ability.fiery-crash.damage-base-plus-2',
    })
    expect(isAuthoritativePendingMoveResolution(damageExecution)).toBe(false)
    if (isAuthoritativePendingMoveResolution(damageExecution)) return
    expect(JSON.stringify(damageExecution.auditTrace)).toContain('ability.fiery-crash.damage-base-plus-2')

    const fireDeclaration = declare({
      slug: 'aa069-fiery-fire', move: 'Tackle', actorAbility: 'Fiery Crash',
    })
    const firePending = fireDeclaration.result.suspension.pendingResolution
    const fireExecution = resume({
      pending: firePending, map: fireDeclaration.result.nextMap,
      pokemonSheets: fireDeclaration.pokemonSheets,
      optionId: 'ability.fiery-crash.fire-type', random: () => 0.99,
    })
    expect(isAuthoritativePendingMoveResolution(fireExecution)).toBe(false)
    if (isAuthoritativePendingMoveResolution(fireExecution)) return
    const firePlan = completePlan({
      declaration: fireDeclaration, pending: firePending, execution: fireExecution,
      optionId: 'ability.fiery-crash.fire-type', chosenBy: 'actor',
    })
    expect(nextSheet(firePlan, 'target').combat?.conditions).toContain('Burned')
    expect(JSON.stringify(fireExecution.auditTrace)).toContain('"moveType":"Fire"')

    const existingFire = declare({
      slug: 'aa069-fiery-existing-fire', move: 'Flame Wheel', actorAbility: 'Fiery Crash',
    })
    const existingPending = existingFire.result.suspension.pendingResolution
    expect(existingPending.outstandingWindows[0]?.options).toEqual([
      { id: 'ability.fiery-crash.damage-base-plus-2', labelKey: 'ability.fiery-crash.damage-base-plus-2' },
    ])
    const existingExecution = resume({
      pending: existingPending, map: existingFire.result.nextMap,
      pokemonSheets: existingFire.pokemonSheets,
      optionId: null, random: () => 0.8,
    })
    expect(isAuthoritativePendingMoveResolution(existingExecution)).toBe(false)
    if (isAuthoritativePendingMoveResolution(existingExecution)) return
    const existingPlan = completePlan({
      declaration: existingFire, pending: existingPending, execution: existingExecution,
      optionId: null, chosenBy: 'actor',
    })
    expect(nextSheet(existingPlan, 'target').combat?.conditions).toContain('Burned')
    expect(JSON.stringify(existingExecution.auditTrace)).toContain('"minimum":17')
  }, 30_000)

  it('aa069.fade-away.reviewed avoids only the hit recipient, becomes Invisible, pays Standard/Scene, and grants one Shift', () => {
    const declaration = declare({
      slug: 'aa069-fade', move: 'Tackle', targetAbility: 'Fade Away',
    })
    const pending = declaration.result.suspension.pendingResolution
    expect(pending.outstandingWindows[0]?.options).toEqual([
      { id: 'ability.fade-away.use', labelKey: 'ability.fade-away.avoid-and-shift' },
    ])
    const execution = resume({
      pending, map: declaration.result.nextMap,
      pokemonSheets: declaration.pokemonSheets,
      optionId: 'ability.fade-away.use',
    })
    expect(isAuthoritativePendingMoveResolution(execution)).toBe(false)
    if (isAuthoritativePendingMoveResolution(execution)) return
    const plan = completePlan({
      declaration, pending, execution,
      optionId: 'ability.fade-away.use', chosenBy: 'target',
    })
    expect(plan.sheetWrites.find(write => write.slug === 'target')).toBeUndefined()
    expect(plan.nextMap.encounterState?.turnResources.target?.actions.standard.spent).toBe(1)
    expect(plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Fade Away', spent: 1,
    }))
    expect(plan.nextMap.encounterState?.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'capability', payload: expect.objectContaining({ capabilityId: 'aa069.fade-away.invisibility' }) }),
      expect.objectContaining({ kind: 'capability', payload: expect.objectContaining({ capabilityId: 'aa069.fade-away.shift-ready' }) }),
    ]))
  }, 30_000)

  it('aa069.emergency-exit.reviewed opens only on a below-half crossing and chains into a durable recall choice', () => {
    const declaration = declare({
      slug: 'aa069-emergency', move: 'Tackle', targetAbility: 'Emergency Exit', targetHp: 96,
    })
    const firstPending = declaration.result.suspension.pendingResolution
    expect(firstPending.outstandingWindows[0]?.options).toEqual([
      { id: 'ability.emergency-exit.use', labelKey: 'ability.emergency-exit.switch' },
    ])
    const afterUse = resume({
      pending: firstPending, map: declaration.result.nextMap,
      pokemonSheets: declaration.pokemonSheets,
      optionId: 'ability.emergency-exit.use',
    })
    expect(isAuthoritativePendingMoveResolution(afterUse)).toBe(true)
    if (!isAuthoritativePendingMoveResolution(afterUse)) return
    expect(afterUse.execution.request).toMatchObject({
      kind: 'switch-choice', allowPass: true,
    })
    const intermediate = planResumedMoveState({
      pendingResolution: firstPending,
      declarationPlan: declaration.result.suspension.preWindowPlan,
      responseOpId: 'op_response_aa069_emergency_use',
      responseWindowId: firstPending.outstandingWindows[0]!.windowId,
      responseOptionId: 'ability.emergency-exit.use',
      chosenBy: { kind: 'placement', id: 'target' },
      map: declaration.result.nextMap,
      pokemonSheets: declaration.pokemonSheets, trainerSheets: new Map(),
      execution: afterUse, plannedAt: 2_000,
    })
    expect(isAuthoritativePendingMoveStatePlan(intermediate)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(intermediate)) return
    const secondPending = intermediate.suspension.pendingResolution
    const completed = resume({
      pending: secondPending, map: intermediate.nextMap,
      pokemonSheets: declaration.pokemonSheets,
      optionId: null,
    })
    expect(isAuthoritativePendingMoveResolution(completed)).toBe(false)
    if (isAuthoritativePendingMoveResolution(completed)) return
    const plan = planResumedMoveState({
      pendingResolution: secondPending,
      declarationPlan: intermediate.suspension.preWindowPlan,
      responseOpId: 'op_response_aa069_emergency_recall',
      responseWindowId: secondPending.outstandingWindows[0]!.windowId,
      responseOptionId: null,
      chosenBy: { kind: 'placement', id: 'target' },
      map: intermediate.nextMap,
      pokemonSheets: declaration.pokemonSheets, trainerSheets: new Map(),
      execution: completed, plannedAt: 3_000,
    })
    expect(plan.nextMap.placements.some(placement => placement.id === 'target')).toBe(false)
    expect(plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(1)
    expect(plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Emergency Exit', spent: 1,
    }))
  }, 30_000)
})
