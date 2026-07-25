import { createHash } from 'node:crypto'
import { createError } from 'h3'
import type { AuthRole } from '#shared/auth'
import { parseAbilityDeclarationIntent } from '#shared/abilityAutomation/declarationIntent'
import { isAbilityMechanicOperation, parseAbilityMechanicOperation } from '#shared/abilityAutomation/mechanics'
import { parseAbilityResolutionPublicResult, type AbilityResolutionPublicResult } from '#shared/abilityAutomation/results'
import type { PlayerProfile } from '#shared/playerProfiles'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { TabletopMap } from '~/types/map'
import {
  actorCanControlMapPlacement,
  playerProfileLinkedTrainerSheetsForTokenControl,
} from '../policies/playerProfileTokenControlPolicy'
import { buildAuthoritativeAbilityContext } from '../domain/abilityAutomation/context'
import { hashAbilityDeclarationIntent, resolveAbilityDeclarationIntent } from '../domain/abilityAutomation/declarationIntent'
import {
  planAbilitySharedEffects,
  reduceAbilitySharedCombatStageEffects,
} from '../domain/abilityAutomation/effectKernel'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY, type AbilityAutomationRuntimeRegistry } from '../domain/abilityAutomation/registry'
import { createAbilityStatePlan } from '../domain/abilityAutomation/statePlan'
import {
  appendAbilityTraceEvents,
  createAbilityResolutionTraceForContext,
  traceAbilityCombatStageReduction,
} from '../domain/abilityAutomation/trace'
import { executeAa060ActivatedMechanic } from '../domain/abilityAutomation/mechanics/aa060Activated'
import { executeAa061ActivatedMechanic } from '../domain/abilityAutomation/mechanics/aa061Activated'
import { executeAa062ActivatedMechanic } from '../domain/abilityAutomation/mechanics/aa062Activated'
import { executeAa063ActivatedMechanic } from '../domain/abilityAutomation/mechanics/aa063Activated'
import { executeAa064ActivatedMechanic } from '../domain/abilityAutomation/mechanics/aa064Activated'
import { executeAa065ActivatedMechanic } from '../domain/abilityAutomation/mechanics/aa065Activated'
import { executeAa066ActivatedMechanic } from '../domain/abilityAutomation/mechanics/aa066Activated'
import { executeAa067ActivatedMechanic } from '../domain/abilityAutomation/mechanics/aa067Activated'
import { executeAa068ActivatedMechanic } from '../domain/abilityAutomation/mechanics/aa068Activated'
import { executeAa069ActivatedMechanic } from '../domain/abilityAutomation/mechanics/aa069Activated'
import { executeAa070ActivatedMechanic } from '../domain/abilityAutomation/mechanics/aa070Activated'
import { executeAa071ActivatedMechanic } from '../domain/abilityAutomation/mechanics/aa071Activated'
import { executeAa072ActivatedMechanic } from '../domain/abilityAutomation/mechanics/aa072Activated'
import { executeAa073ActivatedMechanic } from '../domain/abilityAutomation/mechanics/aa073Activated'
import { executeAa074ActivatedMechanic } from '../domain/abilityAutomation/mechanics/aa074Activated'
import { executeAa075ActivatedMechanic } from '../domain/abilityAutomation/mechanics/aa075Activated'
import { executeAa076ActivatedMechanic } from '../domain/abilityAutomation/mechanics/aa076Activated'
import { reconcileAa075IceFaceTemporaryHpOwnershipAfterMove } from '../domain/abilityAutomation/mechanics/aa075TemporaryHpIntegration'
import { createAa063AbilityCombatStageImmunities } from '../domain/abilityAutomation/mechanics/aa063DefenseIntegration'
import { applyNativeCoreMapChanges } from '../domain/moveAutomation/planNativeV2MoveState'
import { createMoveStateChangePlan, type MoveStateChangePlan } from '../domain/moveAutomation/plan'
import { createSqliteAbilityDeclarationOfferRepository, type AbilityDeclarationOfferRepository } from '../storage/abilityDeclarationOfferRepository'
import { createSqliteAbilityResolutionOperationRepository, type AbilityResolutionOperationRepository } from '../storage/abilityResolutionOperationRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { createSqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'
import { listRepositorySheets, type ListSheetsRepository } from './listSheets'
import { loadMapUseCase } from './loadMap'

export interface ResolveAbilityDeclarationInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly intent: unknown
}
export interface ResolveAbilityDeclarationDependencies {
  readonly database?: RotomDatabase
  readonly mapRepository?: MapRepository<unknown>
  readonly sheetRepository?: SheetRepository<Record<string, unknown>> & ListSheetsRepository
  readonly offerRepository?: AbilityDeclarationOfferRepository
  readonly operationRepository?: AbilityResolutionOperationRepository
  readonly registry?: AbilityAutomationRuntimeRegistry
  readonly now?: () => number
}
const fail = (statusCode: number, statusMessage: string): never => { throw createError({ statusCode, statusMessage }) }
const targetIds = (choices: ReturnType<typeof resolveAbilityDeclarationIntent>['choices']): readonly string[] => Object.freeze([
  ...new Set(choices.flatMap(choice => choice.options.flatMap(option => (
    option.value.kind === 'token' || option.value.kind === 'self' ? [option.value.placementId] : []
  )))),
])
const outcomeFor = (results: ReturnType<typeof reduceAbilitySharedCombatStageEffects>['operationResults']): 'applied' | 'prevented' | 'no-op' => (
  results.some(result => result.outcome === 'applied') ? 'applied'
    : results.some(result => result.outcome === 'prevented') ? 'prevented' : 'no-op'
)
const deterministicRandom = (seed: string): (() => number) => {
  let draw = 0
  return () => {
    const digest = createHash('sha256').update(`${seed}:${draw++}`).digest()
    return digest.readUInt32BE(0) / 0x1_0000_0000
  }
}
const materializeMap = (map: TabletopMap, changes: MoveStateChangePlan, now: number): TabletopMap => ({
  ...applyNativeCoreMapChanges(map, changes),
  revision: nextRevision(normalizeRevision(map.revision)),
  updatedAt: now,
})

/** Resolve the first closed native operation lane; unsupported nodes fail closed. */
export const resolveAbilityDeclarationUseCase = (
  input: ResolveAbilityDeclarationInput,
  dependencies: ResolveAbilityDeclarationDependencies = {},
): AbilityResolutionPublicResult => {
  const intent = parseAbilityDeclarationIntent(input.intent)
  const intentSha256 = hashAbilityDeclarationIntent(intent)
  const database = dependencies.database ?? getRotomDatabase()
  const mapRepository = dependencies.mapRepository ?? createSqliteMapRepository(database)
  const sheetRepository = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const offerRepository = dependencies.offerRepository ?? createSqliteAbilityDeclarationOfferRepository(database)
  const operationRepository = dependencies.operationRepository ?? createSqliteAbilityResolutionOperationRepository(database)
  const registry = dependencies.registry ?? ABILITY_AUTOMATION_RUNTIME_REGISTRY
  const storedOffer = offerRepository.findByOfferId(intent.offerId) ?? fail(404, 'Ability declaration offer is missing.')
  if (storedOffer.consumedIntentSha256 !== null && storedOffer.consumedIntentSha256 !== intentSha256) {
    fail(409, 'Ability declaration offer was consumed by another intent.')
  }
  const runtime = registry.resolve(intent.canonicalId) ?? fail(409, 'Ability has no manifest-selected native runtime.')
  const { map, revision } = loadMapUseCase({ role: input.role, slug: intent.mapSlug }, { mapRepository })
  const actor = map.placements.find(placement => placement.id === intent.actorPlacementId)
    ?? fail(404, 'Ability actor placement is missing.')
  const trainerSheets = listRepositorySheets<TrainerSheet>(sheetRepository, 'trainer')
  const trainerBySlug = new Map(trainerSheets.map(sheet => [sheet.slug, sheet]))
  const linkedTrainerSheets = playerProfileLinkedTrainerSheetsForTokenControl(input.playerProfile, slug => trainerBySlug.get(slug))
  if (!actorCanControlMapPlacement({ role: input.role, profile: input.playerProfile, placement: actor, linkedTrainerSheets })) {
    fail(403, 'Ability actor is not controlled by this principal.')
  }
  const duplicate = operationRepository.find(intent.intentId)
  if (duplicate) {
    if (duplicate.intentSha256 !== intentSha256) fail(409, 'Ability intent ID was reused with changed input.')
    return duplicate.result
  }
  const now = dependencies.now?.() ?? Date.now()
  const resolved = resolveAbilityDeclarationIntent({
    intent,
    offer: storedOffer.offer,
    runtime,
    currentMapRevision: revision,
    now,
  })
  const pokemonSheets = listRepositorySheets<CharacterSheet>(sheetRepository, 'pokemon')
  const context = buildAuthoritativeAbilityContext({
    map,
    pokemonSheets: new Map(pokemonSheets.map(sheet => [sheet.slug, sheet])),
    trainerSheets: trainerBySlug,
    request: {
      canonicalId: intent.canonicalId,
      modeId: intent.modeId,
      actorPlacementId: intent.actorPlacementId,
      targetPlacementIds: targetIds(resolved.choices),
      triggeringEvent: null,
    },
    runtime,
    resolutionId: `resolution:${intent.intentId}`,
    random: deterministicRandom(intentSha256),
    time: now,
  })
  if (!context.actor.effectiveAbilities.some(ability => (
    ability.instanceId === intent.abilityInstanceId && ability.canonicalId === intent.canonicalId
    && ability.effective && (ability.definitionHash === null || ability.definitionHash === runtime.definitionHash)
  ))) fail(409, 'Ability instance is not currently effective.')
  if (runtime.definition.spec.registeredHandlerId !== null
    || runtime.definition.spec.preconditions.length > 0
    || runtime.definition.spec.costs.length > 0) {
    fail(422, 'Ability runtime requires an execution adapter that is not registered for direct declaration resolution.')
  }
  const selectedOperations = runtime.definition.spec.phases
    .filter(phase => phase.modeId === intent.modeId)
    .flatMap(phase => phase.operations.map(operation => ({ phase: phase.phase, operation })))
  let resolutionPlan: MoveStateChangePlan
  let acceptedOutcome: 'applied' | 'prevented' | 'no-op'
  let trace = createAbilityResolutionTraceForContext({ context })
  if (selectedOperations.length === 1 && isAbilityMechanicOperation(selectedOperations[0]!.operation)) {
    const selected = selectedOperations[0]!
    const mechanicOperation = parseAbilityMechanicOperation(selected.operation)
    const targetMoveFacts = context.targets.flatMap(target => (target.sheet.sheet.movelist ?? []).map(move => ({
      moveId: move.name,
      type: move.type ?? 'Normal',
      damageClass: move.category === 'Physical' ? 'physical' as const
        : move.category === 'Special' ? 'special' as const : 'status' as const,
    })))
    const execution = mechanicOperation.mechanicId.startsWith('aa060.')
      ? executeAa060ActivatedMechanic({
          context,
          operation: mechanicOperation,
          operationId: intent.intentId,
          abilityInstanceId: intent.abilityInstanceId,
          choices: resolved.choices,
          targetMoveFacts,
        })
      : mechanicOperation.mechanicId.startsWith('aa061.')
        ? executeAa061ActivatedMechanic({
            context,
            operation: mechanicOperation,
            operationId: intent.intentId,
            abilityInstanceId: intent.abilityInstanceId,
            choices: resolved.choices,
          })
        : mechanicOperation.mechanicId.startsWith('aa062.')
          ? executeAa062ActivatedMechanic({
              context,
              operation: mechanicOperation,
              operationId: intent.intentId,
              abilityInstanceId: intent.abilityInstanceId,
              choices: resolved.choices,
            })
          : mechanicOperation.mechanicId.startsWith('aa063.')
            ? executeAa063ActivatedMechanic({
                context,
                operation: mechanicOperation,
                operationId: intent.intentId,
                abilityInstanceId: intent.abilityInstanceId,
              })
            : mechanicOperation.mechanicId.startsWith('aa064.')
              ? executeAa064ActivatedMechanic({
                  context,
                  operation: mechanicOperation,
                  operationId: intent.intentId,
                  abilityInstanceId: intent.abilityInstanceId,
                  choices: resolved.choices,
                })
              : mechanicOperation.mechanicId.startsWith('aa065.')
                ? executeAa065ActivatedMechanic({
                    context,
                    operation: mechanicOperation,
                    operationId: intent.intentId,
                    abilityInstanceId: intent.abilityInstanceId,
                    choices: resolved.choices,
                  })
                : mechanicOperation.mechanicId.startsWith('aa066.')
                  ? executeAa066ActivatedMechanic({
                      context,
                      operation: mechanicOperation,
                      operationId: intent.intentId,
                      abilityInstanceId: intent.abilityInstanceId,
                      choices: resolved.choices,
                    })
                  : mechanicOperation.mechanicId.startsWith('aa067.')
                    ? executeAa067ActivatedMechanic({
                        context,
                        operation: mechanicOperation,
                        operationId: intent.intentId,
                        abilityInstanceId: intent.abilityInstanceId,
                        choices: resolved.choices,
                      })
                    : mechanicOperation.mechanicId.startsWith('aa068.')
                      ? executeAa068ActivatedMechanic({
                          context,
                          operation: mechanicOperation,
                          operationId: intent.intentId,
                          abilityInstanceId: intent.abilityInstanceId,
                        })
                      : mechanicOperation.mechanicId.startsWith('aa069.')
                        ? executeAa069ActivatedMechanic({
                            context,
                            operation: mechanicOperation,
                            operationId: intent.intentId,
                            abilityInstanceId: intent.abilityInstanceId,
                            choices: resolved.choices,
                          })
                        : mechanicOperation.mechanicId.startsWith('aa070.')
                          ? executeAa070ActivatedMechanic({
                              context,
                              operation: mechanicOperation,
                              operationId: intent.intentId,
                              choices: resolved.choices,
                            })
                          : mechanicOperation.mechanicId.startsWith('aa071.')
                            ? executeAa071ActivatedMechanic({
                                context,
                                operation: mechanicOperation,
                                operationId: intent.intentId,
                                choices: resolved.choices,
                              })
                            : mechanicOperation.mechanicId.startsWith('aa072.')
                              ? executeAa072ActivatedMechanic({
                                  context,
                                  operation: mechanicOperation,
                                  operationId: intent.intentId,
                                  choices: resolved.choices,
                                })
                              : mechanicOperation.mechanicId.startsWith('aa073.')
                                ? executeAa073ActivatedMechanic({
                                    context,
                                    operation: mechanicOperation,
                                    operationId: intent.intentId,
                                    choices: resolved.choices,
                                  })
                                : mechanicOperation.mechanicId.startsWith('aa074.')
                                  ? executeAa074ActivatedMechanic({
                                      context,
                                      operation: mechanicOperation,
                                      operationId: intent.intentId,
                                      choices: resolved.choices,
                                    })
                                  : mechanicOperation.mechanicId.startsWith('aa075.')
                                    ? executeAa075ActivatedMechanic({
                                        context,
                                        operation: mechanicOperation,
                                        operationId: intent.intentId,
                                        choices: resolved.choices,
                                      })
                                    : mechanicOperation.mechanicId.startsWith('aa076.')
                                      ? executeAa076ActivatedMechanic({
                                          context,
                                          operation: mechanicOperation,
                                          operationId: intent.intentId,
                                          choices: resolved.choices,
                                        })
                                      : null
    const resolvedExecution = execution
      ?? fail(422, 'Ability runtime requires an execution adapter that is not registered for direct declaration resolution.')
    resolutionPlan = resolvedExecution.plan
    acceptedOutcome = resolutionPlan.changes.length > 0 ? 'applied' : 'no-op'
    trace = appendAbilityTraceEvents(trace, [
      { kind: 'phase-transition', reasonCode: `phase.${selected.phase}`, from: null, to: selected.phase },
      ...context.random.snapshot().map(roll => ({
        kind: 'roll' as const, phase: selected.phase,
        reasonCode: `${roll.rollId}.resolved`, roll,
      })),
      {
        kind: 'operation', phase: selected.phase, reasonCode: `ability.${mechanicOperation.mechanicId}`,
        operationId: mechanicOperation.id, operationKind: mechanicOperation.kind,
        recipientIds: targetIds(resolved.choices), outcome: acceptedOutcome,
        input: null,
        result: {
          presentationKey: resolvedExecution.presentationKey,
          ...('controllerPresentationValues' in resolvedExecution
            && Array.isArray(resolvedExecution.controllerPresentationValues)
            ? { controllerPresentationValues: [...resolvedExecution.controllerPresentationValues] }
            : {}),
        },
      },
    ], context.budget)
  }
  else {
    const effects = planAbilitySharedEffects(context)
    if (effects.operations.length !== selectedOperations.length
      || effects.operations.some(effect => effect.operation.kind !== 'combat-stage')) {
      fail(422, 'Ability runtime contains an unsupported direct operation.')
    }
    const reduction = effects.operations.length > 0
      ? reduceAbilitySharedCombatStageEffects({
          context, effects, immunities: createAa063AbilityCombatStageImmunities(context),
        })
      : { plan: createMoveStateChangePlan([]), operationResults: [] }
    resolutionPlan = reduction.plan
    acceptedOutcome = outcomeFor(reduction.operationResults)
    trace = traceAbilityCombatStageReduction(trace, reduction, context.budget)
  }
  const statePlan = createAbilityStatePlan({ context, stateChanges: resolutionPlan, trace })
  const nextMap = reconcileAa075IceFaceTemporaryHpOwnershipAfterMove({
    previousMap: map,
    nextMap: materializeMap(map, resolutionPlan, now),
    operations: [],
    ...(context.runtime.canonicalId === 'Ice Face'
      ? { featureOwnedIncreasePlacementIds: new Set([context.actor.placement.id]) }
      : {}),
  })
  const result = parseAbilityResolutionPublicResult({
    schemaVersion: 1,
    kind: 'accepted',
    operationId: intent.intentId,
    resolutionId: context.resolutionId,
    mapSlug: intent.mapSlug,
    previousRevision: revision,
    revision: nextMap.revision,
    status: 'committed',
    presentation: { key: 'ability.resolution.completed', outcome: acceptedOutcome },
  })
  database.withTransaction(() => {
    const retry = operationRepository.find(intent.intentId)
    if (retry) {
      if (retry.intentSha256 !== intentSha256) fail(409, 'Ability intent ID was reused with changed input.')
      return
    }
    const current = mapRepository.getBySlug(intent.mapSlug)
    if (!current || normalizeRevision(current.revision) !== revision) fail(409, 'Ability map state changed before commit.')
    for (const change of resolutionPlan.changes) {
      if (change.kind !== 'sheet-state') continue
      const persisted = {
        ...(change.current as unknown as Record<string, unknown>),
        slug: change.scope.sheetSlug,
        revision: normalizeRevision((change.current as { revision?: number }).revision),
        updatedAt: now,
      }
      if (sheetRepository.applyLivePlayUpdate({
        kind: change.scope.sheetKind,
        slug: change.scope.sheetSlug,
        expectedRevision: change.expectedRevision,
        nextSheet: persisted,
      }) === 'stale') fail(409, `Ability sheet ${change.scope.sheetSlug} changed before commit.`)
    }
    if (mapRepository.applyLivePlayUpdate({ slug: intent.mapSlug, expectedRevision: revision, nextMap }) === 'stale') {
      fail(409, 'Ability map state changed before commit.')
    }
    offerRepository.consume(intent.offerId, intentSha256, now)
    operationRepository.insert({
      intentSha256,
      intent,
      result,
      audit: {
        schemaVersion: statePlan.schemaVersion,
        resolutionId: statePlan.resolutionId,
        runtime: statePlan.runtime,
        reads: statePlan.reads,
        trace: statePlan.trace,
        rollLedger: statePlan.rollLedger,
      } as unknown as import('#shared/automation/strictJson').StrictJsonValue,
      createdAt: now,
    })
  })
  return result
}

export interface AbilityResolutionControllerEnvelope {
  readonly schemaVersion: 1
  readonly result: AbilityResolutionPublicResult
  readonly controllerPresentationKey: string | null
  readonly controllerPresentationValues?: readonly string[]
}

interface AbilityControllerPresentation {
  readonly key: string | null
  readonly values: readonly string[]
}

const controllerPresentationFromAudit = (audit: unknown): AbilityControllerPresentation => {
  const none = Object.freeze({ key: null, values: Object.freeze([]) })
  if (!audit || typeof audit !== 'object' || Array.isArray(audit)) return none
  const trace = (audit as { trace?: unknown }).trace
  if (!trace || typeof trace !== 'object' || Array.isArray(trace)) return none
  const events = (trace as { events?: unknown }).events
  if (!Array.isArray(events)) return none
  for (const event of events) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) continue
    const result = (event as { result?: unknown }).result
    if (!result || typeof result !== 'object' || Array.isArray(result)) continue
    const key = (result as { presentationKey?: unknown }).presentationKey
    if (key === 'ability.anticipation.super-effective-present'
      || key === 'ability.anticipation.super-effective-absent') {
      return Object.freeze({ key, values: Object.freeze([]) })
    }
    if (key === 'ability.forewarn.moves-revealed') {
      const values = (result as { controllerPresentationValues?: unknown }).controllerPresentationValues
      if (!Array.isArray(values) || values.length === 0 || values.length > 64
        || values.some(value => typeof value !== 'string' || value.length === 0
          || value.length > 160 || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value))) continue
      return Object.freeze({ key, values: Object.freeze([...new Set(values as string[])]) })
    }
  }
  return none
}

/** Authorized response envelope; hidden controller presentation never enters the public accepted result. */
export const resolveAbilityDeclarationForControllerUseCase = (
  input: ResolveAbilityDeclarationInput,
  dependencies: ResolveAbilityDeclarationDependencies = {},
): AbilityResolutionControllerEnvelope => {
  const intent = parseAbilityDeclarationIntent(input.intent)
  const result = resolveAbilityDeclarationUseCase(input, dependencies)
  const database = dependencies.database ?? getRotomDatabase()
  const repository = dependencies.operationRepository
    ?? createSqliteAbilityResolutionOperationRepository(database)
  const operation = repository.find(intent.intentId)
  const presentation = controllerPresentationFromAudit(operation?.audit ?? null)
  return Object.freeze({
    schemaVersion: 1,
    result,
    controllerPresentationKey: presentation.key,
    ...(presentation.values.length > 0
      ? { controllerPresentationValues: presentation.values }
      : {}),
  })
}
