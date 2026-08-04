import { createHash } from 'node:crypto'
import { parseEncounterState, type EncounterState } from '#shared/moveAutomation/encounterState'
import type { MoveAutomationCombatStageUpdateAccumulator } from '~/utils/moveAutomationStatusUpdates'
import type { MoveAutomationConditionUpdate, MoveAutomationHpUpdate } from '~/types/moveAutomation'
import type { TabletopMap } from '~/types/map'
import type { AnyLiveSheet } from '~/utils/sheetMutations'
import { projectAuthoritativeEffectiveAbilities } from '../effectiveAbilities'
import { resolveSheetAndEdgeAbilityInstances } from '../../edgeAutomation/permanentGrants'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../registry'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import { reduceAbilityOwnedStateCommand } from '../ownedState'

const isEnraged = (conditions: readonly string[]): boolean => conditions.some(condition => (
  condition.trim().toLowerCase() === 'enraged' || condition.trim().toLowerCase() === 'rage'
))
const shortHash = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 24)

export const resolveAa062BerserkDirectTrigger = (input: {
  readonly map: TabletopMap
  readonly placement: TabletopMap['placements'][number]
  readonly sheet: AnyLiveSheet
  readonly previousHp: number
  readonly currentHp: number
  readonly maximumHp: number
  readonly previousConditions: readonly string[]
  readonly currentConditions: readonly string[]
  readonly operationId: string
}): { readonly triggered: boolean; readonly map: TabletopMap } => {
  const runtime = ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve('Berserk')
  if (!runtime) return { triggered: false, map: input.map }
  const ability = projectAuthoritativeEffectiveAbilities({
    baseAbilities: resolveSheetAndEdgeAbilityInstances(input.sheet),
    target: {
      placementId: input.placement.id,
      ...(input.placement.sideId ? { sideId: input.placement.sideId } : {}),
      position: input.placement.position,
    },
    effects: input.map.encounterState?.effects ?? [],
    transformationSnapshots: input.map.encounterState?.abilityTransformations,
  }).find(candidate => candidate.effective && candidate.canonicalId === 'Berserk'
    && (candidate.definitionHash === null || candidate.definitionHash === runtime.definitionHash))
  if (!ability) return { triggered: false, map: input.map }
  let encounter = parseEncounterState(input.map.encounterState)
  const halfStateId = `${ability.instanceId}:berserk-half:${shortHash(encounter.history.sceneId ?? 'encounter')}`
  const halfAlreadyTriggered = (encounter.abilityOwnedState?.entries ?? []).some(entry => entry.stateId === halfStateId)
  const crossedHalf = input.previousHp * 2 > input.maximumHp
    && input.currentHp * 2 <= input.maximumHp
    && input.currentHp < input.previousHp
    && !halfAlreadyTriggered
  const becameEnraged = !isEnraged(input.previousConditions) && isEnraged(input.currentConditions)
  if (!crossedHalf && !becameEnraged) return { triggered: false, map: input.map }
  if (crossedHalf) {
    const result = reduceAbilityOwnedStateCommand(encounter.abilityOwnedState, {
      operationId: `ability.berserk.half:${shortHash(`${input.operationId}:${input.placement.id}`)}`,
      kind: 'create', stateId: halfStateId, expectedVersion: null,
      entry: {
        stateId: halfStateId, ownerPlacementId: input.placement.id,
        sourceAbilityInstanceId: ability.instanceId, canonicalId: 'Berserk', targetPlacementIds: [],
        lifecycle: { kind: 'scene', targetPolicy: null },
        payload: { kind: 'mark', markId: 'aa062.berserk.half-triggered' },
      },
    })
    encounter = parseEncounterState({ ...encounter, abilityOwnedState: result.state })
  }
  return { triggered: true, map: { ...input.map, encounterState: encounter } }
}

/**
 * Apply mandatory Berserk triggers from already-authoritative HP/condition
 * reductions before the atomic core state plan is built.
 */
export const applyAa062BerserkCoreTriggers = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly hpUpdates: readonly MoveAutomationHpUpdate[]
  readonly conditionUpdates: readonly MoveAutomationConditionUpdate[]
  readonly stageAccumulator: MoveAutomationCombatStageUpdateAccumulator
  readonly encounterState: EncounterState
}): { readonly encounterState: EncounterState; readonly triggeredPlacementIds: readonly string[] } => {
  let encounter = parseEncounterState(input.encounterState)
  const triggered: string[] = []
  const hpById = new Map(input.hpUpdates.map(update => [update.id, update]))
  const conditionsById = new Map(input.conditionUpdates.map(update => [update.id, update]))
  for (const placement of input.context.queries.placements.all()) {
    const token = input.context.queries.tokens.get(placement.id)
    if (!token) continue
    const ability = input.context.queries.abilities.activeForPlacement(placement.id)
      .find(candidate => candidate.canonicalId === 'Berserk')
    if (!ability) continue
    const hpUpdate = hpById.get(placement.id)
    const maximumHp = Math.max(1, token.fullMaxHp ?? token.maxHp)
    const crossedHalf = Boolean(hpUpdate
      && token.currentHp * 2 > maximumHp
      && hpUpdate.currentHp * 2 <= maximumHp)
    const halfStateId = `${ability.instanceId}:berserk-half:${shortHash(encounter.history.sceneId ?? 'encounter')}`
    const halfAlreadyTriggered = (encounter.abilityOwnedState?.entries ?? []).some(entry => entry.stateId === halfStateId)
    const conditionUpdate = conditionsById.get(placement.id)
    const becameEnraged = Boolean(conditionUpdate
      && !isEnraged(token.conditions)
      && isEnraged(conditionUpdate.conditions))
    if ((!crossedHalf || halfAlreadyTriggered) && !becameEnraged) continue
    input.stageAccumulator.addDeltas(token, { satk: 1 })
    triggered.push(placement.id)
    if (crossedHalf && !halfAlreadyTriggered) {
      const result = reduceAbilityOwnedStateCommand(encounter.abilityOwnedState, {
        operationId: `ability.berserk.half:${shortHash(`${input.context.resolutionId ?? 'move'}:${placement.id}`)}`,
        kind: 'create', stateId: halfStateId, expectedVersion: null,
        entry: {
          stateId: halfStateId, ownerPlacementId: placement.id,
          sourceAbilityInstanceId: ability.instanceId, canonicalId: 'Berserk', targetPlacementIds: [],
          lifecycle: { kind: 'scene', targetPolicy: null },
          payload: { kind: 'mark', markId: 'aa062.berserk.half-triggered' },
        },
      })
      encounter = parseEncounterState({ ...encounter, abilityOwnedState: result.state })
    }
  }
  return { encounterState: encounter, triggeredPlacementIds: Object.freeze(triggered) }
}
