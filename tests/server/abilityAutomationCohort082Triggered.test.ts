import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { moveAutomationAreaTemplateId } from '~/utils/moveAutomationAreaTemplates'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { isAuthoritativePendingMoveResolution } from '../../server/domain/resolveAuthoritativeMove'
import { isAuthoritativePendingMoveStatePlan, planAuthoritativeMoveState, planAuthoritativeMoveStateExecution } from '../../server/domain/planAuthoritativeMoveState'
import { resumeMoveSpec } from '../../server/domain/moveAutomation/resumeSpec'
import { planResumedMoveState } from '../../server/domain/moveAutomation/planResumedMoveState'
import { beginAbilityDeclarationUseCase } from '../../server/useCases/beginAbilityDeclaration'
import { resolveAbilityDeclarationUseCase } from '../../server/useCases/resolveAbilityDeclaration'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'

const id = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const ability = (canonicalId: string) => ({ name: canonicalId, automation: { schemaVersion: 1 as const, instanceId: `base:${id(canonicalId)}`, canonicalId, definitionVersion: null, selections: [] } })
const sheet = (slug: string, abilities: readonly string[] = [], move = 'Tackle'): CharacterSheet => ({
  slug, nickname: slug, species: 'Eevee', level: 30, revision: 3, types: ['Normal'],
  abilities: abilities.map(ability), movelist: [{ name: move }],
  stats: { hp: { added: 100 }, atk: { added: 45 }, def: { added: 35 }, satk: { added: 45 }, sdef: { added: 35 }, spd: { added: 40 } },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 300, injuries: 0, conditions: [] },
})
const fixture = (slug: string, input: { targetAbility?: string; allyAbility?: string } = {}) => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 2, y: 0, z: 2 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 3, y: 0, z: 2 } },
    ...(input.allyAbility ? [{ id: 'ally', sheetKind: 'pokemon' as const, sheetSlug: 'ally', sideId: 'heroes', position: { x: 3, y: 0, z: 3 } }] : []),
  ]
  const map: TabletopMap = {
    schemaVersion: 2, slug, name: slug, revision: 5, dimensions: { x: 10, y: 4, z: 10 }, groundLevelY: 0,
    voxels: [], hazards: [], placements, fieldEffects: { weather: [], terrains: [], rooms: [] },
    encounterState: {
      ...encounter, sides: { heroes: { id: 'heroes', label: 'Heroes', status: 'active' }, foes: { id: 'foes', label: 'Foes', status: 'active' } },
      history: { ...encounter.history, sceneId: `scene:${slug}`, currentRound: 1, currentTurn: { round: 1, turn: 1, placementId: 'actor' } },
      turnResources: Object.fromEntries(placements.map(p => [p.id, createEncounterTurnResourceLedger({ placementId: p.id, round: 1, turn: 1 })])),
    }, initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 }, metadata: {},
  }
  const sheets = new Map<string, CharacterSheet>([
    ['actor', sheet('actor')], ['target', sheet('target', input.targetAbility ? [input.targetAbility] : [])],
    ...(input.allyAbility ? [['ally', sheet('ally', [input.allyAbility])] as const] : []),
  ])
  return { map, sheets, move: 'Tackle' }
}
type State = ReturnType<typeof fixture>
const declare = (s: State, random: () => number = () => 0.75) => planAuthoritativeMoveStateExecution({
  map: s.map, pokemonSheets: s.sheets, trainerSheets: new Map(),
  intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Tackle', selection: { kind: 'single-target', targetPlacementId: 'target' } },
  random, now: () => 1000, operationId: `op_${id(s.map.slug)}`, pendingResolutionId: `resolution:${s.map.slug}`,
})
const complete = (s: State, optionId: string | null, values: readonly number[] = [0.75, 0.75]) => {
  let randomIndex = 0
  const random = () => values[Math.min(randomIndex++, values.length - 1)] ?? 0.75
  const declaration = declare(s, random)
  if (!isAuthoritativePendingMoveStatePlan(declaration)) throw new Error('Expected pending reaction.')
  const pending = declaration.suspension.pendingResolution
  const window = pending.outstandingWindows[0]!
  const execution = resumeMoveSpec({ pendingResolution: structuredClone(pending), map: structuredClone(declaration.nextMap), pokemonSheets: s.sheets, trainerSheets: new Map(), response: { requestId: window.windowId, optionId }, now: 2000, random })
  if (isAuthoritativePendingMoveResolution(execution)) throw new Error('Expected one response to complete.')
  return planResumedMoveState({ pendingResolution: pending, declarationPlan: declaration.suspension.preWindowPlan, responseOpId: `op_response_${id(s.map.slug)}`, responseWindowId: window.windowId, responseOptionId: optionId, chosenBy: window.ownership[0]!, map: declaration.nextMap, pokemonSheets: s.sheets, trainerSheets: new Map(), execution, plannedAt: 2000 })
}
const targetHp = (s: State, plan: ReturnType<typeof complete>) => ((plan.sheetWrites.find(w => w.slug === 'target')?.nextSheet ?? s.sheets.get('target')!) as CharacterSheet).combat?.currentHp ?? 0

describe('AA-082 triggered and activated integrations', () => {
  it('Parry converts only the triggering Melee hit to a miss and pays Free/Scene on acceptance', () => {
    const state = fixture('aa082-parry', { targetAbility: 'Parry' })
    const declaration = declare(state)
    expect(isAuthoritativePendingMoveStatePlan(declaration)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration)) return
    expect(declaration.suspension.pendingResolution.outstandingWindows[0]?.reasonCode).toBe('ability.parry.optional-miss')
    const plan = complete(state, 'ability.parry.use')
    expect(targetHp(state, plan)).toBe(300)
    expect(plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(1)
    expect(plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({ canonicalId: 'Parry', spent: 1 }))
    const passed = complete(fixture('aa082-parry-pass', { targetAbility: 'Parry' }), null)
    expect(((passed.sheetWrites.find(w => w.slug === 'target')?.nextSheet) as CharacterSheet).combat?.currentHp).toBeLessThan(300)
  }, 30_000)

  it('Pack Hunt opens for an adjacent allied owner, uses a retained d20, and inflicts one Tick only on hit', () => {
    const state = fixture('aa082-pack-hunt', { allyAbility: 'Pack Hunt' })
    const declaration = declare(state)
    expect(isAuthoritativePendingMoveStatePlan(declaration)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration)) return
    const window = declaration.suspension.pendingResolution.outstandingWindows[0]!
    expect(window.reasonCode).toBe('ability.pack-hunt.optional-attack')
    expect(window.ownership).toEqual([{ kind: 'target', id: 'ally' }])
    const plan = complete(state, 'ability.pack-hunt.use')
    if (isAuthoritativePendingMoveStatePlan(plan)) throw new Error('Pack Hunt response must complete the move.')
    const plain = fixture('aa082-pack-hunt-plain')
    const plainPlan = planAuthoritativeMoveState({
      map: plain.map, pokemonSheets: plain.sheets, trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Tackle', selection: { kind: 'single-target', targetPlacementId: 'target' } },
      random: () => 0.75, now: () => 1000, operationId: 'op_pack_plain',
    })
    if (isAuthoritativePendingMoveStatePlan(plainPlan)) throw new Error('Plain Tackle must complete immediately.')
    const plainHp = ((plainPlan.sheetWrites.find(w => w.slug === 'target')?.nextSheet) as CharacterSheet).combat?.currentHp ?? 300
    expect(plainHp - targetHp(state, plan)).toBe(35)
    expect(plan.nextMap.encounterState?.turnResources.ally?.actions.free.spent).toBe(1)
    expect(JSON.stringify(plan.resolution.auditTrace)).toContain('ability.pack-hunt.attack-roll')

    const missState = fixture('aa082-pack-hunt-miss', { allyAbility: 'Pack Hunt' })
    const missed = complete(missState, 'ability.pack-hunt.use', [0.75, 0.75, 0.75, 0])
    if (isAuthoritativePendingMoveStatePlan(missed)) throw new Error('Pack Hunt miss must complete the move.')
    const missPlain = fixture('aa082-pack-hunt-miss-plain')
    const missPlainPlan = planAuthoritativeMoveState({
      map: missPlain.map, pokemonSheets: missPlain.sheets, trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Tackle', selection: { kind: 'single-target', targetPlacementId: 'target' } },
      random: () => 0.75, now: () => 1000, operationId: 'op_pack_miss_plain',
    })
    if (isAuthoritativePendingMoveStatePlan(missPlainPlan)) throw new Error('Plain Tackle must complete immediately.')
    const missPlainHp = ((missPlainPlan.sheetWrites.find(w => w.slug === 'target')?.nextSheet) as CharacterSheet).combat?.currentHp
    expect(targetHp(missState, missed)).toBe(missPlainHp)
  }, 30_000)

  it('Perception durably Disengages before an allied damaging area attack resolves and pays exactly one Free Action', () => {
    const state = fixture('aa082-perception', { allyAbility: 'Perception' })
    state.sheets.set('actor', sheet('actor', [], 'Discharge'))
    state.map.placements[2] = { ...state.map.placements[2]!, position: { x: 2, y: 0, z: 3 } }
    const result = planAuthoritativeMoveStateExecution({
      map: state.map, pokemonSheets: state.sheets, trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Discharge',
        selection: {
          kind: 'area',
          areaTemplateId: moveAutomationAreaTemplateId({ kind: 'cardinally-adjacent', size: 1 }),
        },
      },
      random: () => 0.75, now: () => 1000, operationId: 'op_aa082_perception',
      pendingResolutionId: 'resolution:aa082-perception',
    })
    if (!isAuthoritativePendingMoveStatePlan(result)) throw new Error('Expected Perception reaction.')
    expect(result.suspension.pendingResolution.outstandingWindows[0]?.reasonCode).toBe('ability.perception.optional-disengage')

    let plan: ReturnType<typeof planResumedMoveState> | typeof result = result
    let optionId: string | null = 'ability.perception.use'
    let index = 0
    while (isAuthoritativePendingMoveStatePlan(plan)) {
      const pending = plan.suspension.pendingResolution
      const window = pending.outstandingWindows[0]!
      const execution = resumeMoveSpec({
        pendingResolution: structuredClone(pending), map: structuredClone(plan.nextMap),
        pokemonSheets: state.sheets, trainerSheets: new Map(),
        response: { requestId: window.windowId, optionId },
        now: 2000 + index, random: () => 0.75,
      })
      plan = planResumedMoveState({
        pendingResolution: pending, declarationPlan: plan.suspension.preWindowPlan,
        responseOpId: `op_perception_response_${index}`,
        responseWindowId: window.windowId, responseOptionId: optionId,
        chosenBy: window.ownership[0]!, map: plan.nextMap,
        pokemonSheets: state.sheets, trainerSheets: new Map(), execution,
        plannedAt: 2000 + index,
      })
      index += 1
      if (index > 4) throw new Error('Too many Perception response windows.')
      optionId = isAuthoritativePendingMoveStatePlan(plan)
        ? plan.suspension.pendingResolution.outstandingWindows[0]?.options[0]?.id ?? null
        : null
    }
    const ally = (plan.sheetWrites.find(write => write.slug === 'ally')?.nextSheet ?? state.sheets.get('ally')!) as CharacterSheet
    expect(ally.combat?.currentHp).toBe(300)
    expect(plan.nextMap.placements.find(placement => placement.id === 'ally')?.position).not.toEqual({ x: 2, y: 0, z: 3 })
    expect(plan.nextMap.encounterState?.turnResources.ally?.actions.free.spent).toBe(1)
    expect(plan.resolution.nativeV2?.dynamicRecipients.missedTargetIds).toContain('ally')
  }, 30_000)

  it('Parental Bond gives the deterministic tethered mother Rage, +5 DR, and +5 damage for the Scene when the Baby faints', () => {
    const state = fixture('aa082-parental-faint', { targetAbility: 'Parental Bond' })
    const baby = state.sheets.get('target')!
    state.sheets.set('target', { ...baby, species: 'Kangaskhan', combat: { ...baby.combat!, currentHp: 1 } })
    state.map.placements.push({
      id: 'mother', sheetKind: 'pokemon', sheetSlug: 'mother', sideId: 'foes',
      position: { x: 4, y: 0, z: 2 },
    })
    state.sheets.set('mother', { ...sheet('mother'), species: 'Kangaskhan' })
    const plan = planAuthoritativeMoveState({
      map: state.map, pokemonSheets: state.sheets, trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Tackle', selection: { kind: 'single-target', targetPlacementId: 'target' } },
      random: () => 0.75, now: () => 1000, operationId: 'op_parental_faint',
    })
    if (isAuthoritativePendingMoveStatePlan(plan)) throw new Error('Parental Bond faint must not suspend the move.')
    const rage = plan.nextMap.encounterState?.effects.filter(effect => effect.tags.includes('mother-rage')) ?? []
    expect(rage).toHaveLength(3)
    expect(rage.every(effect => effect.affected.placementIds[0] === 'mother')).toBe(true)
    expect(rage.map(effect => effect.kind).sort()).toEqual(['condition', 'numeric-modifier', 'numeric-modifier'])
    expect(rage.filter(effect => effect.kind === 'numeric-modifier').map(effect => effect.payload.value).sort()).toEqual([5, 5])
  })

  it('Omen revalidates its Range 5 target and atomically pays Swift/Scene with -2 Accuracy', () => {
    const slug = 'aa082-omen'
    const database = openRotomDatabase({ path: ':memory:' }); databases.push(database)
    const mapRepository = createSqliteMapRepository<TabletopMap>(database)
    const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
    mapRepository.saveSetupMap(fixture(slug).map)
    sheetRepository.saveSetupSheet('pokemon', 'actor', sheet('actor', ['Omen']) as unknown as Record<string, unknown>)
    sheetRepository.saveSetupSheet('pokemon', 'target', sheet('target') as unknown as Record<string, unknown>)
    const deps = { mapRepository, sheetRepository, now: () => 1000 }
    const offer = beginAbilityDeclarationUseCase({ role: 'gm', command: { schemaVersion: 1, requestId: 'request:omen', mapSlug: slug, baseRevision: 5, actorPlacementId: 'actor', abilityInstanceId: 'base:omen', canonicalId: 'Omen', modeId: 'activate' } }, deps)
    const declaration = offer.declarations[0]!
    expect(declaration.options).toContainEqual(expect.objectContaining({
      hint: expect.objectContaining({ kind: 'placement', placementId: 'actor' }),
    }))
    const option = declaration.options.find(o => o.hint.kind === 'placement' && o.hint.placementId === 'target')!
    const result = resolveAbilityDeclarationUseCase({ role: 'gm', intent: { schemaVersion: 1, intentId: 'intent:omen', offerId: offer.offerId, offerSha256: offer.offerSha256, mapSlug: slug, baseRevision: offer.mapRevision, actorPlacementId: 'actor', abilityInstanceId: 'base:omen', canonicalId: 'Omen', modeId: 'activate', selections: [{ declarationId: declaration.declarationId, kind: declaration.kind, optionIds: [option.optionId] }] } }, deps)
    expect(result.kind).toBe('accepted')
    const target = sheetRepository.getByRef('pokemon', 'target')!.sheet as unknown as CharacterSheet
    expect(target.combatStages?.acc).toBe(-2)
    const map = mapRepository.getBySlug(slug)!
    expect(map.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({ canonicalId: 'Omen', spent: 1 }))
  })
})

let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(db => db.close()))
