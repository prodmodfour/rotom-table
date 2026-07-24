import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { AA073_GULP_MISSILE_CAPABILITY } from '#shared/abilityAutomation/aa073'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveState,
  planAuthoritativeMoveStateExecution,
} from '../../server/domain/planAuthoritativeMoveState'
import { isAuthoritativePendingMoveResolution } from '../../server/domain/resolveAuthoritativeMove'
import { resumeMoveSpec } from '../../server/domain/moveAutomation/resumeSpec'
import { planResumedMoveState } from '../../server/domain/moveAutomation/planResumedMoveState'
import type { PendingMoveResolution } from '#shared/moveAutomation/pendingResolution'

const slugify = (value: string): string => value.toLowerCase().replaceAll(' ', '-').replaceAll('’', '')
const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const,
    instanceId: `base:${slugify(canonicalId)}`,
    canonicalId,
    definitionVersion: null,
    selections: [],
  },
})
const sheet = (input: {
  slug: string
  move?: string
  ability?: string
  currentHp?: number
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: 'Eevee',
  level: 20,
  revision: 3,
  types: ['Normal'],
  abilities: input.ability ? [ability(input.ability)] : [],
  movelist: input.move ? [{ name: input.move }] : [],
  stats: {
    hp: { added: 45 }, atk: { added: 25 }, def: { added: 25 },
    satk: { added: 25 }, sdef: { added: 25 }, spd: { added: 25 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: input.currentHp ?? 150, injuries: 0, conditions: [] },
})

const battleMap = (slug: string): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
    { id: 'far-foe', sheetKind: 'pokemon', sheetSlug: 'far-foe', sideId: 'foes', position: { x: 9, y: 0, z: 9 } },
  ]
  return {
    schemaVersion: 2,
    slug,
    name: slug,
    revision: 5,
    dimensions: { x: 12, y: 4, z: 12 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [], hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements,
    encounterState: {
      ...encounter,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: {
        ...encounter.history,
        sceneId: `scene:${slug}`,
        currentRound: 1,
        currentTurn: { round: 1, turn: 1, placementId: 'actor' },
      },
      turnResources: Object.fromEntries(placements.map(placement => [
        placement.id,
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 }),
      ])),
    },
    initiative: { activeId: 'actor', round: 1 },
    activeScene: { name: 'Scene', startedAt: 100 },
  }
}

const declare = (input: {
  slug: string
  move: string
  ability: string
  targetHp?: number
  random?: () => number
}) => {
  const map = battleMap(input.slug)
  const pokemonSheets = new Map<string, CharacterSheet>([
    ['actor', sheet({
      slug: 'actor',
      move: input.ability === 'Gulp Missile' && input.move === 'Stockpile' ? undefined : input.move,
      ability: input.ability,
    })],
    ['target', sheet({ slug: 'target', move: 'Tackle', currentHp: input.targetHp })],
    ['far-foe', sheet({ slug: 'far-foe' })],
  ])
  const result = planAuthoritativeMoveStateExecution({
    map,
    pokemonSheets,
    trainerSheets: new Map(),
    intent: {
      schemaVersion: 1,
      placementId: 'actor',
      moveName: input.move,
      selection: ['Stockpile', 'Swords Dance'].includes(input.move)
        ? { kind: 'self' }
        : { kind: 'single-target', targetPlacementId: 'target' },
    },
    random: input.random ?? (() => 0.5),
    now: () => 1_000,
    operationId: `op_${input.slug}`,
    pendingResolutionId: `resolution:${input.slug}`,
  })
  return { result, pokemonSheets }
}

const resume = (input: {
  pending: PendingMoveResolution
  map: TabletopMap
  pokemonSheets: ReadonlyMap<string, CharacterSheet>
  optionId: string | null
}) => resumeMoveSpec({
  pendingResolution: structuredClone(input.pending),
  map: structuredClone(input.map),
  pokemonSheets: input.pokemonSheets,
  trainerSheets: new Map(),
  response: { requestId: input.pending.outstandingWindows[0]!.windowId, optionId: input.optionId },
  now: 2_000,
  random: () => 0.5,
})

const finish = (input: {
  declaration: ReturnType<typeof declare>
  optionId: string | null
  chosenBy?: string
}) => {
  if (!isAuthoritativePendingMoveStatePlan(input.declaration.result)) throw new Error('Expected pending Move.')
  const pending = input.declaration.result.suspension.pendingResolution
  const execution = resume({
    pending,
    map: input.declaration.result.nextMap,
    pokemonSheets: input.declaration.pokemonSheets,
    optionId: input.optionId,
  })
  if (isAuthoritativePendingMoveResolution(execution)) throw new Error('Expected completed resumed Move.')
  const plan = planResumedMoveState({
    pendingResolution: pending,
    declarationPlan: input.declaration.result.suspension.preWindowPlan,
    responseOpId: `op_response_${input.declaration.result.nextMap.slug}`,
    responseWindowId: pending.outstandingWindows[0]!.windowId,
    responseOptionId: input.optionId,
    chosenBy: { kind: 'placement', id: input.chosenBy ?? 'actor' },
    map: input.declaration.result.nextMap,
    pokemonSheets: input.declaration.pokemonSheets,
    trainerSheets: new Map(),
    execution,
    plannedAt: 2_000,
  })
  return { pending, execution, plan }
}

const nextActorSheet = (plan: ReturnType<typeof finish>['plan']): CharacterSheet => (
  (plan.sheetWrites.find(write => write.slug === 'actor')?.nextSheet
    ?? plan.sheetWrites.find(write => write.slug === 'actor')?.previousSheet) as CharacterSheet
)

describe('AA-073 Move-triggered abilities', () => {
  it('aa073.grim-neigh.reviewed gates on a damaging foe KO and durably applies both clauses', () => {
    const declaration = declare({
      slug: 'aa073-grim-neigh', move: 'Tackle', ability: 'Grim Neigh', targetHp: 1,
    })
    expect(isAuthoritativePendingMoveStatePlan(declaration.result)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration.result)) return
    expect(declaration.result.suspension.pendingResolution.outstandingWindows[0]?.options).toEqual([
      { id: 'ability.grim-neigh.use', labelKey: 'ability.grim-neigh.boost-and-aura' },
    ])
    const { execution, plan } = finish({ declaration, optionId: 'ability.grim-neigh.use' })
    expect(nextActorSheet(plan).stats?.satk?.stage ?? nextActorSheet(plan).combatStages?.satk).toBe(1)
    expect(plan.nextMap.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'numeric-modifier',
      affected: expect.objectContaining({ placementIds: ['target'] }),
      payload: expect.objectContaining({ attribute: 'accuracy', value: -2 }),
    }))
    expect(plan.nextMap.encounterState?.effects?.some(effect => effect.affected.placementIds.includes('far-foe'))).toBe(false)
    expect(plan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(JSON.stringify(execution.auditTrace)).toContain('ability.grim-neigh.raise-special-attack')

    const noKo = declare({ slug: 'aa073-grim-neigh-no-ko', move: 'Tackle', ability: 'Grim Neigh' })
    expect(isAuthoritativePendingMoveStatePlan(noKo.result)).toBe(false)
  }, 30_000)

  it('aa073.gulp-missile.reviewed arms after a Connection Stockpile and pays Free/Scene x2', () => {
    const declaration = declare({
      slug: 'aa073-gulp-missile-arm', move: 'Stockpile', ability: 'Gulp Missile',
    })
    expect(isAuthoritativePendingMoveStatePlan(declaration.result)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration.result)) return
    expect(declaration.result.suspension.pendingResolution.outstandingWindows[0]?.options).toEqual([
      { id: 'ability.gulp-missile.use', labelKey: 'ability.gulp-missile.arm' },
    ])
    const { plan } = finish({ declaration, optionId: 'ability.gulp-missile.use' })
    expect(plan.nextMap.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'capability',
      payload: { capabilityId: AA073_GULP_MISSILE_CAPABILITY, action: 'grant' },
      affected: expect.objectContaining({ placementIds: ['actor'] }),
    }))
    expect(plan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Gulp Missile', limit: 2, spent: 1,
    }))

    const sheets = new Map(declaration.pokemonSheets)
    for (const write of plan.sheetWrites) {
      if (write.kind === 'pokemon') sheets.set(write.slug, write.nextSheet as CharacterSheet)
    }
    const retaliate = (random: () => number, operationId: string) => planAuthoritativeMoveState({
      map: plan.nextMap,
      pokemonSheets: sheets,
      trainerSheets: new Map(),
      intent: {
        schemaVersion: 1,
        placementId: 'target',
        moveName: 'Tackle',
        selection: { kind: 'single-target', targetPlacementId: 'actor' },
      },
      random,
      now: () => 3_000,
      operationId,
    })
    const retaliation = retaliate(() => 0.99, 'op_aa073_gulp_missile_retaliation')
    const attacker = (retaliation.sheetWrites.find(write => write.slug === 'target')?.nextSheet
      ?? sheets.get('target')) as CharacterSheet
    expect(attacker.combat?.currentHp).toBeLessThan(150)
    expect(attacker.combat?.conditions).toContain('Paralysis')
    expect(retaliation.nextMap.encounterState?.effects.some(effect => (
      effect.kind === 'capability'
      && effect.payload.capabilityId === AA073_GULP_MISSILE_CAPABILITY
    ))).toBe(false)
    expect(JSON.stringify(retaliation.resolution.auditTrace)).toContain('ability.gulp-missile.retaliation-hp')

    let oddDraws = 0
    const odd = retaliate(
      () => [0.75, 0.5, 0.5, 0.7][oddDraws++] ?? 0.7,
      'op_aa073_gulp_missile_odd',
    )
    const oddAttacker = (odd.sheetWrites.find(write => write.slug === 'target')?.nextSheet
      ?? sheets.get('target')) as CharacterSheet
    expect(oddAttacker.combat?.currentHp).toBeLessThan(150)
    expect(oddAttacker.combat?.conditions ?? []).not.toContain('Paralysis')
    expect(oddAttacker.stats?.def?.stage ?? oddAttacker.combatStages?.def).toBe(-1)

    let draws = 0
    const missed = retaliate(
      () => [0.75, 0.5, 0.5, 0][draws++] ?? 0,
      'op_aa073_gulp_missile_miss',
    )
    const missedAttacker = (missed.sheetWrites.find(write => write.slug === 'target')?.nextSheet
      ?? sheets.get('target')) as CharacterSheet
    expect(missedAttacker.combat?.currentHp).toBe(150)
    expect(missedAttacker.combat?.conditions ?? []).not.toContain('Paralysis')
    expect(missedAttacker.stats?.def?.stage ?? missedAttacker.combatStages?.def ?? 0).toBe(0)
    expect(missed.nextMap.encounterState?.effects.some(effect => (
      effect.kind === 'capability'
      && effect.payload.capabilityId === AA073_GULP_MISSILE_CAPABILITY
    ))).toBe(false)

    const parentMiss = retaliate(() => 0, 'op_aa073_gulp_missile_parent_miss')
    expect(parentMiss.nextMap.encounterState?.effects.some(effect => (
      effect.kind === 'capability'
      && effect.payload.capabilityId === AA073_GULP_MISSILE_CAPABILITY
    ))).toBe(true)
    expect(parentMiss.resolution.auditTrace.events.some(event => (
      event.kind === 'roll' && event.reasonCode === 'ability.gulp-missile.retaliation-roll'
    ))).toBe(false)
  }, 30_000)

  it('aa073.heat-mirage.reviewed applies +3 Evasion through the next turn start and costs only Free', () => {
    const declaration = declare({
      slug: 'aa073-heat-mirage', move: 'Ember', ability: 'Heat Mirage',
    })
    expect(isAuthoritativePendingMoveStatePlan(declaration.result)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration.result)) return
    const { plan } = finish({ declaration, optionId: 'ability.heat-mirage.use' })
    expect(plan.nextMap.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'numeric-modifier',
      duration: { kind: 'turns', subject: 'source', boundary: 'start', remaining: 1 },
      payload: expect.objectContaining({ attribute: 'evasion', value: 3 }),
      affected: expect.objectContaining({ placementIds: ['actor'] }),
    }))
    expect(plan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(plan.nextMap.encounterState?.abilityUsage?.entries ?? []).toHaveLength(0)
  }, 30_000)
})
