import { normalizeRevision } from '#shared/sessionRevisions'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import { parseAbilityFieldProviders } from '#shared/abilityAutomation/fieldProviders'
import type { MoveHazardGeometryResolution, MoveMapOperationResult } from '../moveAutomation/reducers/mapOperationTypes'
import type { AuthoritativeMoveRulesContext } from '../moveAutomation/context'
import { reduceMoveGlobalFields } from '../moveAutomation/reducers/mapFieldEffects'
import { reduceMoveHazardZones } from '../moveAutomation/reducers/mapHazardEffects'
import { reduceMoveTemporaryEffect } from '../moveAutomation/reducers/mapTemporaryEffects'
import { createMoveAutomationRelationshipResolver } from '../moveAutomation/relationships'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  createMoveStateChangePlan,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../moveAutomation/plan'
import type { TabletopMap } from '~/types/map'
import { sameJsonValue } from '~/utils/serialization'
import { cloneMapFieldEffects } from '~/utils/mapFieldEffects'
import type { AuthoritativeAbilityContext, AuthoritativeAbilityParticipant } from './context'

export class AuthoritativeAbilityFieldProviderError extends Error {
  constructor(readonly code:
    | 'source-placement-missing' | 'source-ability-inactive' | 'owner-unavailable'
    | 'recipient-unavailable', detail: string) {
    super(detail)
    this.name = 'AuthoritativeAbilityFieldProviderError'
  }
}
const fail = (code: AuthoritativeAbilityFieldProviderError['code'], detail: string): never => {
  throw new AuthoritativeAbilityFieldProviderError(code, detail)
}
const participantFor = (context: AuthoritativeAbilityContext, placementId: string): AuthoritativeAbilityParticipant => (
  [context.actor, context.source, ...context.targets].find(entry => entry.placement.id === placementId)
  ?? fail('owner-unavailable', `Field provider owner ${placementId} was not selected.`)
)
const moveContextFor = (
  context: AuthoritativeAbilityContext,
  ownerPlacementId: string,
  map: TabletopMap,
): AuthoritativeMoveRulesContext => {
  const relationships = createMoveAutomationRelationshipResolver({
    placements: context.placements,
    sides: parseEncounterState(map.encounterState ?? createEmptyEncounterState()).sides,
  })
  return {
    ...context,
    map,
    actor: participantFor(context, ownerPlacementId),
    queries: { ...context.queries, relationships },
  } as unknown as AuthoritativeMoveRulesContext
}
export interface AuthoritativeAbilityFieldProviderPlan {
  readonly plan: MoveStateChangePlan
  readonly currentMap: TabletopMap
  readonly operationResults: readonly MoveMapOperationResult[]
}
/** Reduce reviewed field/hazard/typed-effect providers into one map CAS plan. */
export const planAuthoritativeAbilityFieldProviders = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly providers: unknown
  readonly hazardGeometry?: MoveHazardGeometryResolution
}): AuthoritativeAbilityFieldProviderPlan => {
  const providers = parseAbilityFieldProviders(input.providers)
  const allowedParticipants = new Set([
    input.context.actor.placement.id,
    input.context.source.placement.id,
    ...input.context.targets.map(target => target.placement.id),
  ])
  for (const provider of providers) {
    if (!input.context.queries.placements.get(provider.sourcePlacementId)) {
      fail('source-placement-missing', `Field provider ${provider.providerId} source is missing.`)
    }
    if (!input.context.queries.effectiveAbilities.activeForPlacement(provider.sourcePlacementId)
      .some(ability => ability.instanceId === provider.abilityInstanceId
        && ability.canonicalId === provider.canonicalId)) {
      fail('source-ability-inactive', `Field provider ${provider.providerId} source ability is inactive.`)
    }
    if (!allowedParticipants.has(provider.ownerPlacementId)) {
      fail('owner-unavailable', `Field provider ${provider.providerId} owner was not selected.`)
    }
    if (provider.recipientPlacementIds.some(id => !allowedParticipants.has(id))) {
      fail('recipient-unavailable', `Field provider ${provider.providerId} has an unselected recipient.`)
    }
  }
  let workingMap: TabletopMap = input.context.map
  const operationResults: MoveMapOperationResult[] = []
  for (const provider of providers) {
    const context = moveContextFor(input.context, provider.ownerPlacementId, workingMap)
    const operation = provider.operation
    if (operation.kind === 'field') {
      const reduced = reduceMoveGlobalFields({
        map: workingMap,
        operation,
        context,
        recipientIds: provider.recipientPlacementIds,
        resolutions: input.hazardGeometry,
      })
      workingMap = reduced.currentMap
      operationResults.push({
        operationId: operation.id, operationKind: operation.kind, phase: operation.phase,
        reasonCode: provider.reasonCode, recipientIds: provider.recipientPlacementIds,
        outcome: reduced.changed ? 'applied' : 'no-op', details: reduced.details,
      })
    }
    else if (operation.kind === 'hazard') {
      const reduced = reduceMoveHazardZones({
        context,
        previous: workingMap.encounterState,
        operation,
        recipientIds: provider.recipientPlacementIds,
        resolutions: input.hazardGeometry,
      })
      workingMap = { ...workingMap, encounterState: reduced.current }
      operationResults.push({
        operationId: operation.id, operationKind: operation.kind, phase: operation.phase,
        reasonCode: provider.reasonCode, recipientIds: provider.recipientPlacementIds,
        outcome: reduced.changed ? 'applied' : 'no-op', details: reduced.details,
      })
    }
    else {
      const reduced = reduceMoveTemporaryEffect({
        context,
        previous: workingMap.encounterState,
        operation,
        recipientIds: provider.recipientPlacementIds,
        faintedRecipientIds: [],
      })
      workingMap = { ...workingMap, encounterState: reduced.current }
      operationResults.push({
        operationId: operation.id, operationKind: operation.kind, phase: operation.phase,
        reasonCode: provider.reasonCode, recipientIds: provider.recipientPlacementIds,
        outcome: reduced.changed ? 'applied' : 'no-op', details: reduced.details,
      })
    }
  }
  const revision = normalizeRevision(input.context.map.revision)
  const changes: MoveStateChangeInput[] = []
  const previousEncounter = parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState())
  const currentEncounter = parseEncounterState(workingMap.encounterState ?? createEmptyEncounterState())
  if (!sameJsonValue(previousEncounter, currentEncounter)) {
    changes.push({
      kind: 'encounter-state', scope: { kind: 'encounter', mapSlug: input.context.map.slug },
      expectedRevision: revision, sourceOperationId: null,
      reasonCode: providers.length === 1 ? providers[0]!.reasonCode : 'ability-field-providers',
      previous: previousEncounter, current: currentEncounter,
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    })
  }
  const previousFieldEffects = cloneMapFieldEffects(input.context.map.fieldEffects)
  const currentFieldEffects = cloneMapFieldEffects(workingMap.fieldEffects)
  if (!sameJsonValue(previousFieldEffects, currentFieldEffects)) {
    changes.push({
      kind: 'map-field-effects', scope: { kind: 'map', mapSlug: input.context.map.slug },
      expectedRevision: revision, sourceOperationId: null,
      reasonCode: providers.length === 1 ? providers[0]!.reasonCode : 'ability-field-providers',
      previous: previousFieldEffects,
      current: currentFieldEffects,
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    })
  }
  return Object.freeze({
    plan: createMoveStateChangePlan(changes),
    currentMap: workingMap,
    operationResults: Object.freeze(operationResults),
  })
}
