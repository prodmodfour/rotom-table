import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { moveAutomationAreaTemplateId } from '~/utils/moveAutomationAreaTemplates'
import {
  isAuthoritativePendingMoveStatePlan,
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
    schemaVersion: 1 as const, instanceId: `base:${slugify(canonicalId)}`,
    canonicalId, definitionVersion: null, selections: [],
  },
})
const sheet = (input: {
  slug: string
  move?: string
  ability?: string
  type?: string
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 20, revision: 3,
  types: [input.type ?? 'Normal'], abilities: input.ability ? [ability(input.ability)] : [],
  movelist: input.move ? [{ name: input.move }] : [],
  stats: {
    hp: { added: 45 }, atk: { added: 25 }, def: { added: 25 },
    satk: { added: 25 }, sdef: { added: 25 }, spd: { added: 25 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 150, injuries: 0, conditions: [] },
})
const battleMap = (slug: string, allies = false): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: allies ? 'heroes' : 'foes', position: { x: 2, y: 0, z: 1 } },
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
  allies?: boolean
  omitMoveFromSheet?: boolean
}) => {
  const map = battleMap(input.slug, input.allies)
  const pokemonSheets = new Map<string, CharacterSheet>([
    ['actor', sheet({
      slug: 'actor', ability: input.actorAbility,
      ...(input.omitMoveFromSheet ? {} : { move: input.move }),
    })],
    ['target', sheet({ slug: 'target', ability: input.targetAbility })],
  ])
  const result = planAuthoritativeMoveStateExecution({
    map, pokemonSheets, trainerSheets: new Map(),
    intent: {
      schemaVersion: 1, placementId: 'actor', moveName: input.move,
      selection: input.move === 'Aromatic Mist'
        ? { kind: 'area', areaTemplateId: moveAutomationAreaTemplateId({ kind: 'burst', size: 1 }) }
        : { kind: 'single-target', targetPlacementId: 'target' },
    },
    random: () => 0.99, now: () => 1_000,
    operationId: `op_${input.slug}`, pendingResolutionId: `resolution:${input.slug}`,
  })
  return { result, pokemonSheets }
}

const resume = (input: {
  pending: PendingMoveResolution
  map: TabletopMap
  pokemonSheets: ReadonlyMap<string, CharacterSheet>
  optionId: string | null
}) => resumeMoveSpec({
  pendingResolution: structuredClone(input.pending), map: structuredClone(input.map),
  pokemonSheets: input.pokemonSheets, trainerSheets: new Map(),
  response: { requestId: input.pending.outstandingWindows[0]!.windowId, optionId: input.optionId },
  now: 2_000, random: () => 0.99,
})

const finish = (input: {
  declaration: ReturnType<typeof declare>
  optionId: string | null
  chosenBy: 'actor' | 'target'
}) => {
  if (!isAuthoritativePendingMoveStatePlan(input.declaration.result)) throw new Error('Expected pending Move.')
  const pending = input.declaration.result.suspension.pendingResolution
  const execution = resume({
    pending, map: input.declaration.result.nextMap,
    pokemonSheets: input.declaration.pokemonSheets, optionId: input.optionId,
  })
  if (isAuthoritativePendingMoveResolution(execution)) throw new Error('Expected completed resumed Move.')
  const plan = planResumedMoveState({
    pendingResolution: pending,
    declarationPlan: input.declaration.result.suspension.preWindowPlan,
    responseOpId: `op_response_${input.declaration.result.nextMap.slug}`,
    responseWindowId: pending.outstandingWindows[0]!.windowId,
    responseOptionId: input.optionId,
    chosenBy: { kind: 'placement', id: input.chosenBy },
    map: input.declaration.result.nextMap,
    pokemonSheets: input.declaration.pokemonSheets, trainerSheets: new Map(),
    execution, plannedAt: 2_000,
  })
  return { pending, execution, plan }
}

const nextSheet = (plan: ReturnType<typeof finish>['plan'], slug: string): CharacterSheet => (
  plan.sheetWrites.find(write => write.slug === slug)?.nextSheet as CharacterSheet
)

describe('AA-070 Move-triggered abilities', () => {
  it('aa070.flame-body.reviewed durably burns the enemy Melee attacker and spends Free/Scene', () => {
    const declaration = declare({ slug: 'aa070-flame-body', move: 'Tackle', targetAbility: 'Flame Body' })
    expect(isAuthoritativePendingMoveStatePlan(declaration.result)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration.result)) return
    expect(declaration.result.suspension.pendingResolution.outstandingWindows[0]?.options).toEqual([
      { id: 'ability.flame-body.use', labelKey: 'ability.flame-body.burn-attacker' },
    ])
    const { plan } = finish({ declaration, optionId: 'ability.flame-body.use', chosenBy: 'target' })
    expect(nextSheet(plan, 'actor').combat?.conditions).toContain('Burned')
    expect(plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(1)
    expect(plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Flame Body', ownerId: 'target', spent: 1,
    }))
  }, 30_000)

  it('aa070.flame-tongue.reviewed adds one Injury and Burn after Lick hits a foe', () => {
    const declaration = declare({
      slug: 'aa070-flame-tongue', move: 'Lick', actorAbility: 'Flame Tongue', omitMoveFromSheet: true,
    })
    expect(isAuthoritativePendingMoveStatePlan(declaration.result)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration.result)) return
    const { plan } = finish({ declaration, optionId: 'ability.flame-tongue.use', chosenBy: 'actor' })
    expect(nextSheet(plan, 'target').combat?.injuries).toBe(1)
    expect(nextSheet(plan, 'target').combat?.conditions).toContain('Burned')
    expect(plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Flame Tongue', spent: 1,
    }))
  }, 30_000)

  it('aa070.flash-fire.reviewed prevents Fire effects and raises exactly the chosen Stat', () => {
    const declaration = declare({ slug: 'aa070-flash-fire', move: 'Ember', targetAbility: 'Flash Fire' })
    expect(isAuthoritativePendingMoveStatePlan(declaration.result)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration.result)) return
    const { plan, execution } = finish({
      declaration, optionId: 'ability.flash-fire.special-attack', chosenBy: 'target',
    })
    const target = nextSheet(plan, 'target')
    expect(target.combat?.currentHp).toBe(150)
    expect(target.combat?.conditions).not.toContain('Burned')
    expect(target.stats?.satk?.stage ?? target.combatStages?.satk).toBe(1)
    expect(target.stats?.atk?.stage ?? target.combatStages?.atk).toBe(0)
    expect(JSON.stringify(execution.auditTrace)).toContain('Flash Fire')

    const cappedMap = battleMap('aa070-flash-fire-capped')
    const cappedTarget = sheet({ slug: 'target', ability: 'Flash Fire' })
    cappedTarget.stats!.atk = { ...cappedTarget.stats!.atk, stage: 6 }
    cappedTarget.stats!.satk = { ...cappedTarget.stats!.satk, stage: 6 }
    const capped = planAuthoritativeMoveStateExecution({
      map: cappedMap,
      pokemonSheets: new Map([
        ['actor', sheet({ slug: 'actor', move: 'Ember' })],
        ['target', cappedTarget],
      ]),
      trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Ember',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.99, now: () => 1_000,
      operationId: 'op_aa070_flash_fire_capped',
      pendingResolutionId: 'resolution:aa070-flash-fire-capped',
    })
    expect(isAuthoritativePendingMoveStatePlan(capped)).toBe(false)
    if (!isAuthoritativePendingMoveStatePlan(capped)) {
      expect(capped.sheetWrites.find(write => write.slug === 'target')).toBeUndefined()
    }
  }, 30_000)

  it('aa070.flavorful-aroma.reviewed grants one-round +1 Accuracy and +5 Damage effects to an ally', () => {
    const declaration = declare({
      slug: 'aa070-flavorful-aroma', move: 'Aromatic Mist', actorAbility: 'Flavorful Aroma',
      allies: true, omitMoveFromSheet: true,
    })
    expect(isAuthoritativePendingMoveStatePlan(declaration.result)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration.result)) return
    const { plan } = finish({ declaration, optionId: 'ability.flavorful-aroma.use', chosenBy: 'actor' })
    expect(plan.nextMap.encounterState?.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'numeric-modifier', affected: expect.objectContaining({ placementIds: ['target'] }),
        payload: expect.objectContaining({ attribute: 'accuracy', operation: 'add', value: 1 }),
      }),
      expect.objectContaining({
        kind: 'numeric-modifier', affected: expect.objectContaining({ placementIds: ['target'] }),
        payload: expect.objectContaining({ attribute: 'damage', operation: 'add', value: 5 }),
      }),
    ]))
    expect(plan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
  }, 30_000)

  it('aa070.flower-power.reviewed persists and replays the chosen Grass Move damage class', () => {
    const declaration = declare({ slug: 'aa070-flower-power', move: 'Absorb', actorAbility: 'Flower Power' })
    expect(isAuthoritativePendingMoveStatePlan(declaration.result)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration.result)) return
    expect(declaration.result.suspension.pendingResolution.outstandingWindows[0]).toMatchObject({
      allowPass: false,
    })
    const { execution } = finish({
      declaration, optionId: 'ability.flower-power.physical', chosenBy: 'actor',
    })
    expect(JSON.stringify(execution.auditTrace)).toContain('"damageClass":"physical"')

    const multiHit = declare({
      slug: 'aa070-flower-power-multi-hit', move: 'Bullet Seed', actorAbility: 'Flower Power',
    })
    expect(isAuthoritativePendingMoveStatePlan(multiHit.result)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(multiHit.result)) return
    const multiHitResult = finish({
      declaration: multiHit, optionId: 'ability.flower-power.special', chosenBy: 'actor',
    })
    expect(JSON.stringify(multiHitResult.execution.auditTrace)).toContain('"damageClass":"special"')
  }, 30_000)

  it('aa070.fluffy-charge.reviewed automatically adds +1 Defense when Charge resolves', () => {
    const map = battleMap('aa070-fluffy-charge')
    const pokemonSheets = new Map<string, CharacterSheet>([
      ['actor', sheet({ slug: 'actor', ability: 'Fluffy Charge' })],
      ['target', sheet({ slug: 'target' })],
    ])
    const result = planAuthoritativeMoveStateExecution({
      map, pokemonSheets, trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Charge', selection: { kind: 'self' } },
      random: () => 0.99, now: () => 1_000,
      operationId: 'op_aa070_fluffy_charge', pendingResolutionId: 'resolution:aa070-fluffy-charge',
    })
    expect(isAuthoritativePendingMoveStatePlan(result)).toBe(false)
    if (isAuthoritativePendingMoveStatePlan(result)) return
    const actor = result.sheetWrites.find(write => write.slug === 'actor')?.nextSheet as CharacterSheet
    expect(actor.stats?.def?.stage ?? actor.combatStages?.def).toBe(1)
    expect(actor.stats?.sdef?.stage ?? actor.combatStages?.sdef).toBe(1)
  }, 30_000)
})
