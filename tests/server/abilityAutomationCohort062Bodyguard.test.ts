import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { isAuthoritativePendingMoveStatePlan, planAuthoritativeMoveStateExecution } from '../../server/domain/planAuthoritativeMoveState'
import { isAuthoritativePendingMoveResolution } from '../../server/domain/resolveAuthoritativeMove'
import { resumeMoveSpec } from '../../server/domain/moveAutomation/resumeSpec'
import { planResumedMoveState } from '../../server/domain/moveAutomation/planResumedMoveState'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { aa062MoveOverlayOperations } from '../../server/domain/abilityAutomation/mechanics/aa062MoveIntegration'

const sheet = (input: { slug: string; species: string; move?: string; ability?: string }): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: input.species, level: 20, revision: 3,
  types: ['Normal'], abilities: input.ability ? [{ name: input.ability }] : [],
  movelist: input.move ? [{ name: input.move }] : [],
  stats: { hp: { added: 30 }, atk: { added: 25 }, satk: { added: 80 }, def: { added: 5 }, sdef: { added: 5 } },
  combat: { currentHp: 100, conditions: [] },
})
const map = (): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'foes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'heroes', position: { x: 2, y: 0, z: 1 } },
    { id: 'bodyguard', sheetKind: 'pokemon', sheetSlug: 'bodyguard', sideId: 'heroes', position: { x: 2, y: 0, z: 2 } },
  ]
  return {
    schemaVersion: 2, slug: 'aa062-bodyguard', name: 'Bodyguard', revision: 5,
    dimensions: { x: 8, y: 4, z: 5 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] }, placements,
    encounterState: {
      ...encounter,
      sides: { heroes: { id: 'heroes', label: 'Heroes', status: 'active' }, foes: { id: 'foes', label: 'Foes', status: 'active' } },
      history: { ...encounter.history, sceneId: 'scene:bodyguard' },
      turnResources: Object.fromEntries(placements.map(placement => [
        placement.id, createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 }),
      ])),
    },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
  }
}
const sheets = () => new Map<string, CharacterSheet>([
  ['actor', sheet({ slug: 'actor', species: 'Machop', move: 'Water Gun' })],
  ['target', sheet({ slug: 'target', species: 'Eevee' })],
  ['bodyguard', sheet({ slug: 'bodyguard', species: 'Eevee', ability: 'Bodyguard' })],
])
const complete = (optionId: string | null, operationId: string) => {
  const pokemonSheets = sheets()
  const declaration = planAuthoritativeMoveStateExecution({
    map: map(), pokemonSheets, trainerSheets: new Map(),
    intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Water Gun', selection: { kind: 'single-target', targetPlacementId: 'target' } },
    random: () => 0.5, now: () => 1_000, operationId,
    pendingResolutionId: `resolution:${operationId}`,
  })
  expect(isAuthoritativePendingMoveStatePlan(declaration)).toBe(true)
  if (!isAuthoritativePendingMoveStatePlan(declaration)) throw new Error('Expected Bodyguard response.')
  const pending = declaration.suspension.pendingResolution
  const window = pending.outstandingWindows[0]!
  const execution = resumeMoveSpec({
    pendingResolution: structuredClone(pending), map: structuredClone(declaration.nextMap),
    pokemonSheets, trainerSheets: new Map(),
    response: { requestId: window.windowId, optionId }, now: 2_000, random: () => 0.5,
  })
  expect(isAuthoritativePendingMoveResolution(execution)).toBe(false)
  if (isAuthoritativePendingMoveResolution(execution)) throw new Error('Expected completed Bodyguard move.')
  const plan = planResumedMoveState({
    pendingResolution: pending, declarationPlan: declaration.suspension.preWindowPlan,
    responseOpId: `op_response_${operationId}`,
    responseWindowId: window.windowId, responseOptionId: optionId,
    chosenBy: { kind: 'target', id: 'bodyguard' },
    map: declaration.nextMap, pokemonSheets, trainerSheets: new Map(), execution, plannedAt: 2_000,
  })
  return { execution, plan, window }
}

const bodyguardOverlays = (input: { candidateIds: string[]; spent?: number }) => {
  const value = map()
  const pokemonSheets = sheets()
  pokemonSheets.set('actor', sheet({ slug: 'actor', species: 'Machop', move: 'Disarming Voice' }))
  const buildContext = () => buildAuthoritativeMoveRulesContext({
    map: value, pokemonSheets, trainerSheets: new Map(),
    intent: {
      schemaVersion: 1, placementId: 'actor', moveName: 'Disarming Voice',
      selection: { kind: 'area', areaTemplateId: 'burst-1' },
    },
    candidatePlacementIds: input.candidateIds, selectedPlacementIds: ['target'],
    random: () => 0.5, time: 1_000, resolutionId: 'resolution:bodyguard-area',
  })
  let context = buildContext()
  if (input.spent !== undefined && value.encounterState) {
    const ability = context.queries.abilities.activeForPlacement('bodyguard')
      .find(candidate => candidate.canonicalId === 'Bodyguard')!
    value.encounterState = {
      ...value.encounterState,
      abilityUsage: {
        schemaVersion: 1, sceneId: 'scene:bodyguard',
        entries: [{
          ownerId: 'bodyguard', abilityInstanceId: ability.instanceId, canonicalId: 'Bodyguard',
          clauseId: 'base', limit: 2, spent: input.spent, operationIds: ['op:one', 'op:two'].slice(0, input.spent),
        }],
      },
    }
    context = buildContext()
  }
  const entry = context.queries.resolveActorMoveEntry('Disarming Voice')
  if (!entry.ok) throw new Error(entry.message)
  return aa062MoveOverlayOperations({
    context, script: entry.entry.script, moveSourceId: 'move.disarming-voice',
  })
}

describe('AA-062 Bodyguard', () => {
  it('aa062.bodyguard.redirect-swap redirects, resists one step, swaps, pays, and supports pass', () => {
    const accepted = complete('ability.bodyguard.use', 'op_bodyguard_use')
    const passed = complete(null, 'op_bodyguard_pass')
    expect(accepted.window.ownership).toEqual([{ kind: 'target', id: 'bodyguard' }])
    expect(accepted.execution.transaction.hpUpdates.map(update => update.id)).toEqual(['bodyguard'])
    expect(passed.execution.transaction.hpUpdates.map(update => update.id)).toEqual(['target'])
    const acceptedHp = accepted.execution.transaction.hpUpdates[0]!.currentHp
    const passedHp = passed.execution.transaction.hpUpdates[0]!.currentHp
    expect(acceptedHp).toBeGreaterThan(passedHp)
    expect(accepted.plan.nextMap.placements.find(placement => placement.id === 'bodyguard')?.position).toEqual({ x: 2, y: 0, z: 1 })
    expect(accepted.plan.nextMap.placements.find(placement => placement.id === 'target')?.position).toEqual({ x: 2, y: 0, z: 2 })
    expect(accepted.plan.nextMap.encounterState?.turnResources.bodyguard?.actions.free.spent).toBe(1)
    expect(accepted.plan.nextMap.encounterState?.abilityUsage?.entries[0]).toMatchObject({ canonicalId: 'Bodyguard', spent: 1, limit: 2 })
  }, 20_000)

  it('offers an area interception only when the swap moves the ally out, and enforces Scene x2', () => {
    const validArea = bodyguardOverlays({ candidateIds: ['target'] })
    expect(validArea.some(operation => operation.reasonCode === 'ability.bodyguard.optional-redirection')).toBe(true)
    expect(bodyguardOverlays({ candidateIds: ['target', 'bodyguard'] })
      .some(operation => operation.reasonCode === 'ability.bodyguard.optional-redirection')).toBe(false)
    expect(bodyguardOverlays({ candidateIds: ['target'], spent: 2 })
      .some(operation => operation.reasonCode === 'ability.bodyguard.optional-redirection')).toBe(false)
  })
})
