import { createHash } from 'node:crypto'
import { normalizeRevision, nextRevision } from '#shared/sessionRevisions'
import type { LivePlayOpId } from '#shared/livePlayCommands'
import {
  PENDING_MOVE_RESOLUTION_SCHEMA_VERSION,
  parsePendingMoveResolution,
  type PendingMovePreStepAttackOfOpportunityContext,
  type PendingMoveReactionResponseWindow,
  type PendingMoveResolution,
  type PendingMoveResolutionPublicSummary,
  type PendingMoveResolutionResourceRead,
  type PendingMoveResponseOwner,
} from '#shared/moveAutomation/pendingResolution'
import { MOVE_RULESET_PROVENANCE } from '#shared/moveAutomation/ruleset'
import type { MoveResolutionTraceAncestryEntry } from '#shared/moveAutomation/trace'
import type { MoveReactionRequestEffectOperation } from '#shared/moveAutomation/effects'
import {
  applyAttackOfOpportunityStateUpdate,
  readAttackOfOpportunityState,
  writeAttackOfOpportunityState,
  type AttackOfOpportunityTriggerPayload,
} from '#shared/attackOfOpportunityState'
import {
  createEmptyEncounterState,
  parseEncounterState,
} from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GridAnchor, SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  attackOfOpportunityStruggleOptions,
  canMakeAttackOfOpportunity,
  movementAttackOfOpportunityAttackerIds,
  rangedAttackOfOpportunityAttackerIds,
} from '~/utils/attackOfOpportunity'
import {
  buildTokenMoveMenuOptions,
  moveEntriesForPlacement,
} from '~/utils/mapTokenMoves'
import { isPlayerCharacterAttackOfOpportunityPair } from '~/utils/playerCharacterTokens'
import { placementToSpawned, type SheetLookup } from '~/utils/placement'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import { moveUsageKey } from '~/utils/moveUsage'
import {
  planAuthoritativeMoveState,
  type AuthoritativeMoveSheetWritePlan,
  type AuthoritativeMoveStatePlan,
} from '../planAuthoritativeMoveState'
import { buildAuthoritativeMoveMapChanges } from './mapChanges'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  createMoveStateChangePlan,
  unavailableMoveStateCompensation,
  type MoveStateChangeInput,
} from './plan'
import type { AuthoritativeMoveRandomSource } from './random'
import { stableJsonStringify } from './stableJson'
import { createMoveResolutionTrace, reduceMoveResolutionTrace } from './trace'
import {
  authoritativeMovementLifecyclePathHash,
  runAuthoritativeMovementLifecycle,
  type MovementLifecycleCursor,
  type PendingMovementLifecycleRun,
} from './movementLifecycle'
import type { EncounterLifecycleTriggerHandler } from './reduceLifecycle'
import {
  resolveAuthoritativeMovement,
  type AuthoritativeMovementSuccess,
} from '../movement/resolveMovement'
import { planAuthoritativeMovementResources } from '../movement/planMovementResources'
import {
  applyAuthoritativeMovementMapTransition,
  type AuthoritativeMovementMapTransition,
} from '../movement/applyMovementTransition'

export const ATTACK_OF_OPPORTUNITY_PROGRAM_VERSION = 2 as const
export const ATTACK_OF_OPPORTUNITY_CANONICAL_ID = 'Attack of Opportunity' as const

const ATTACK_OF_OPPORTUNITY_DEFINITION = Object.freeze({
  version: ATTACK_OF_OPPORTUNITY_PROGRAM_VERSION,
  movementTiming: 'before-provoking-step',
  rangedAttackTiming: 'post-provoking-action',
  responseOwnership: 'defending-placement',
  optionPolicy: 'authoritative-usable-struggle-variants',
  continuationPolicy: 'path-hash-and-full-read-set-revalidation',
})

export const ATTACK_OF_OPPORTUNITY_DEFINITION_HASH = createHash('sha256')
  .update(stableJsonStringify(ATTACK_OF_OPPORTUNITY_DEFINITION))
  .digest('hex')

export interface AttackOfOpportunitySheetDocuments {
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
}

export interface MaterializeAttackOfOpportunityInput extends AttackOfOpportunitySheetDocuments {
  readonly resolutionId: string
  readonly originOpId: string
  readonly originMapSlug: string
  readonly continuationMapRevision: number
  readonly createdAt: number
  readonly map: TabletopMap
  readonly trigger: AttackOfOpportunityTriggerPayload
  readonly playerCharacterSheetKeys: ReadonlySet<string>
}

export interface MaterializeMovementAttackOfOpportunityInput
  extends AttackOfOpportunitySheetDocuments {
  readonly resolutionId: string
  readonly originOpId: LivePlayOpId
  readonly originMapSlug: string
  readonly declarationPreviousRevision: number
  readonly continuationMapRevision: number
  readonly createdAt: number
  readonly map: TabletopMap
  readonly movement: AuthoritativeMovementSuccess
  readonly playerCharacterSheetKeys: ReadonlySet<string>
}

export interface MaterializedMovementAttackOfOpportunity {
  readonly pendingResolution: PendingMoveResolution
  readonly lifecycle: PendingMovementLifecycleRun
  readonly committedCost: number
}

export type AttackOfOpportunityMovementOutcome =
  | { readonly kind: 'not-applicable' }
  | { readonly kind: 'waiting'; readonly reasonCode: 'movement.awaiting-opportunity-responses' }
  | { readonly kind: 'continued'; readonly reasonCode: 'movement.opportunity-attack-cleared' }
  | {
      readonly kind: 'shortened'
      readonly reasonCode: 'movement.typed-interrupt-shortened-path'
      readonly destination: GridAnchor
    }
  | {
      readonly kind: 'cancelled'
      readonly reasonCode:
        | 'movement.typed-interrupt-fainted-provoker'
        | 'movement.typed-interrupt-relocated-provoker'
        | 'movement.typed-interrupt-no-legal-step'
    }

export interface AttackOfOpportunityResponsePlan {
  readonly previousMap: TabletopMap
  readonly nextMap: TabletopMap
  readonly previousRevision: number
  readonly revision: number
  readonly sheetReads: readonly {
    readonly kind: 'pokemon' | 'trainer'
    readonly slug: string
    readonly revision: number
  }[]
  readonly sheetWrites: readonly AuthoritativeMoveSheetWritePlan[]
  readonly pendingResolution: PendingMoveResolution
  readonly childMovePlan: AuthoritativeMoveStatePlan | null
  readonly movementTransition: AuthoritativeMovementMapTransition | null
  readonly movementOutcome: AttackOfOpportunityMovementOutcome
}

const sheetsLookup = (input: AttackOfOpportunitySheetDocuments): SheetLookup => ({
  pokemon: new Map(input.pokemonSheets),
  trainer: new Map(input.trainerSheets),
})

const placementFor = (map: TabletopMap, id: string): SheetPlacement => (
  map.placements.find(placement => placement.id === id)
  ?? (() => { throw new Error(`Attack of Opportunity placement ${id} is missing.`) })()
)

const sheetForPlacement = (
  placement: SheetPlacement,
  input: AttackOfOpportunitySheetDocuments,
): CharacterSheet | TrainerSheet => {
  const sheet = placement.sheetKind === 'pokemon'
    ? input.pokemonSheets.get(placement.sheetSlug)
    : input.trainerSheets.get(placement.sheetSlug)
  if (!sheet) {
    throw new Error(
      `Attack of Opportunity sheet ${placement.sheetKind}/${placement.sheetSlug} is missing.`,
    )
  }
  return sheet
}

const optionIdForMove = (moveName: string): string => {
  const key = moveUsageKey(moveName)
  if (!key) throw new Error(`Attack of Opportunity move ${moveName} has no stable key.`)
  return `attack-of-opportunity.move.${key}`
}

const optionLabelKeyForMove = (moveName: string): string => {
  const key = moveUsageKey(moveName)
  if (!key) throw new Error(`Attack of Opportunity move ${moveName} has no stable label key.`)
  return `attack-of-opportunity.${key}`
}

const moveOptionsForPlacement = (
  map: TabletopMap,
  placement: SheetPlacement,
  token: NonNullable<ReturnType<typeof placementToSpawned>>,
  documents: AttackOfOpportunitySheetDocuments,
) => {
  const options = attackOfOpportunityStruggleOptions(buildTokenMoveMenuOptions(
    token,
    moveEntriesForPlacement(placement, sheetsLookup(documents), {
      encounterEffects: map.encounterState?.effects ?? [],
    }),
    {
      mapMoveUsage: map.moveUsage,
      sheetMoveUsage: sheetForPlacement(placement, documents).moveUsage,
      activeScene: map.activeScene ?? null,
      currentRound: map.initiative?.round ?? null,
    },
  ))
  const seen = new Set<string>()
  return options.filter(option => {
    const id = optionIdForMove(option.name)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  }).map(option => ({
    id: optionIdForMove(option.name),
    labelKey: optionLabelKeyForMove(option.name),
    moveName: option.name,
  }))
}

const sameAnchor = (
  left: { readonly x: number; readonly y: number; readonly z: number },
  right: { readonly x: number; readonly y: number; readonly z: number },
): boolean => left.x === right.x && left.y === right.y && left.z === right.z

const candidateAttackerIds = (
  map: TabletopMap,
  tokens: readonly NonNullable<ReturnType<typeof placementToSpawned>>[],
  trigger: AttackOfOpportunityTriggerPayload,
): readonly string[] => {
  const provoker = placementFor(map, trigger.provokerId)
  if (trigger.reason === 'movement') {
    if (!sameAnchor(provoker.position, trigger.to)) {
      throw new Error('The movement provocation destination is no longer authoritative.')
    }
    return movementAttackOfOpportunityAttackerIds({
      provokerId: trigger.provokerId,
      from: trigger.from,
      to: trigger.to,
      tokens,
    })
  }
  for (const targetId of trigger.targetIds) placementFor(map, targetId)
  return rangedAttackOfOpportunityAttackerIds({
    provokerId: trigger.provokerId,
    targetIds: trigger.targetIds,
    tokens,
  })
}

interface OpportunityWindowInput extends AttackOfOpportunitySheetDocuments {
  readonly map: TabletopMap
  readonly trigger: AttackOfOpportunityTriggerPayload
  readonly playerCharacterSheetKeys: ReadonlySet<string>
}

const movementWindowId = (step: number, attackerId: string): string => {
  const digest = createHash('sha256').update(`${step}:${attackerId}`).digest('hex').slice(0, 16)
  return `attack-of-opportunity.window.movement-${step}.${digest}`
}

const windowsForTrigger = (
  input: OpportunityWindowInput,
  options: {
    readonly candidateIds?: readonly string[]
    readonly timing?: 'cleanup' | 'movement-step'
    readonly movementStep?: number
  } = {},
): readonly PendingMoveReactionResponseWindow[] => {
  const timing = options.timing ?? 'cleanup'
  const sheets = sheetsLookup(input)
  const tokens = input.map.placements.flatMap(placement => {
    const token = placementToSpawned(placement, sheets, input.map)
    return token ? [token] : []
  })
  const byId = new Map(tokens.map(token => [token.id, token]))
  const provoker = byId.get(input.trigger.provokerId)
  if (!provoker) throw new Error('The Attack of Opportunity provoker cannot be resolved.')
  const state = readAttackOfOpportunityState(input.map.metadata)
  const currentRound = input.map.initiative?.round ?? null
  const candidateIds = options.candidateIds
    ?? candidateAttackerIds(input.map, tokens, input.trigger)

  return candidateIds.flatMap((attackerId, index) => {
    const attacker = byId.get(attackerId)
    if (!attacker || !canMakeAttackOfOpportunity(attacker)) return []
    if (state.usedRoundByAttackerId[attackerId] === currentRound) return []
    if (isPlayerCharacterAttackOfOpportunityPair({
      attacker,
      provoker,
      playerCharacterSheetKeys: input.playerCharacterSheetKeys,
      pokemonBySlug: input.pokemonSheets,
      trainerBySlug: input.trainerSheets,
    })) return []

    const placement = placementFor(input.map, attackerId)
    const moveOptions = moveOptionsForPlacement(input.map, placement, attacker, input)
    if (moveOptions.length === 0) return []
    const windowId = timing === 'movement-step'
      ? movementWindowId(options.movementStep ?? 0, attackerId)
      : `attack-of-opportunity.window.${index + 1}`
    const reasonCode = `maneuver.attack-of-opportunity.${input.trigger.reason}`
    return [{
      windowId,
      operationId: `${windowId}.request`,
      kind: 'reaction',
      phase: timing === 'movement-step' ? 'movement' : 'cleanup',
      reasonCode,
      promptKey: timing === 'movement-step'
        ? 'maneuver.attack-of-opportunity.interrupt-before-step'
        : 'maneuver.attack-of-opportunity.resolve-after-provoking-action',
      ownership: [{ kind: 'placement', id: attackerId }],
      options: moveOptions.map(({ id, labelKey }) => ({ id, labelKey })),
      allowPass: true,
      timing,
      priority: 0,
      depth: 0,
    }]
  })
}

const initialTrace = (input: {
  readonly triggerReason: AttackOfOpportunityTriggerPayload['reason']
  readonly windows: readonly PendingMoveReactionResponseWindow[]
  readonly phase: 'cleanup' | 'movement'
  readonly timing: 'cleanup' | 'movement-step'
}) => {
  let trace = createMoveResolutionTrace({
    program: {
      canonicalId: ATTACK_OF_OPPORTUNITY_CANONICAL_ID,
      runtimeKind: 'attack-of-opportunity',
      runtimeVersion: ATTACK_OF_OPPORTUNITY_PROGRAM_VERSION,
      definitionHash: ATTACK_OF_OPPORTUNITY_DEFINITION_HASH,
    },
    ruleset: {
      rulesetId: MOVE_RULESET_PROVENANCE.rulesetId,
      sourceDataSha256: MOVE_RULESET_PROVENANCE.sourceData.sha256,
    },
    ancestry: [],
  })
  trace = reduceMoveResolutionTrace(trace, {
    kind: 'phase-transition',
    from: null,
    to: input.phase,
    reasonCode: input.timing === 'movement-step'
      ? 'attack-of-opportunity-pre-movement-step'
      : 'attack-of-opportunity-post-action-phase',
  })
  for (const window of input.windows) {
    trace = reduceMoveResolutionTrace(trace, {
      kind: 'operation',
      phase: input.phase,
      operationId: window.operationId,
      operationKind: 'reaction-request',
      recipientIds: window.ownership.flatMap(owner => owner.id ? [owner.id] : []),
      outcome: 'pending',
      reasonCode: window.reasonCode,
      input: {
        timing: input.timing,
        priority: 0,
        triggerReason: input.triggerReason,
        ...(input.timing === 'cleanup'
          ? { timingLimitation: 'post-provoking-action' }
          : { movementTiming: 'before-provoking-step' }),
      },
      result: { requestId: window.windowId, requestKind: 'reaction' },
    })
    trace = reduceMoveResolutionTrace(trace, {
      kind: 'choice',
      phase: input.phase,
      requestId: window.windowId,
      requestKind: 'reaction',
      outcome: 'requested',
      optionId: null,
      reasonCode: window.reasonCode,
    })
  }
  return trace
}

const initialReadSet = (
  input: OpportunityWindowInput & {
    readonly originMapSlug: string
    readonly continuationMapRevision: number
  },
  windows: readonly PendingMoveReactionResponseWindow[],
  additionalSheetReads: readonly {
    readonly kind: 'pokemon' | 'trainer'
    readonly slug: string
    readonly revision: number
  }[] = [],
): readonly PendingMoveResolutionResourceRead[] => {
  const reads: PendingMoveResolutionResourceRead[] = [{
    kind: 'map',
    slug: input.originMapSlug,
    revision: input.continuationMapRevision,
  }]
  const ids = new Set([
    input.trigger.provokerId,
    ...windows.flatMap(window => window.ownership.flatMap(owner => owner.id ? [owner.id] : [])),
  ])
  const seen = new Set<string>()
  const appendSheetRead = (read: {
    readonly kind: 'pokemon' | 'trainer'
    readonly slug: string
    readonly revision: number
  }): void => {
    const key = `${read.kind}:${read.slug}`
    if (seen.has(key)) return
    seen.add(key)
    reads.push({
      kind: 'sheet',
      sheetKind: read.kind,
      slug: read.slug,
      revision: normalizeRevision(read.revision),
    })
  }
  for (const read of additionalSheetReads) appendSheetRead(read)
  for (const placement of input.map.placements) {
    if (!ids.has(placement.id)) continue
    const sheet = sheetForPlacement(placement, input)
    appendSheetRead({
      kind: placement.sheetKind,
      slug: placement.sheetSlug,
      revision: normalizeRevision(sheet.revision),
    })
  }
  return reads
}

export const attackOfOpportunityPersistenceIdentity = (input: {
  readonly mapSlug: string
  readonly causalOpId: string
}): { readonly resolutionId: string; readonly originOpId: string } => {
  const digest = createHash('sha256')
    .update(`${input.mapSlug}:${input.causalOpId}:attack-of-opportunity`)
    .digest('hex')
  return {
    resolutionId: `resolution-attack-of-opportunity-${digest}`,
    originOpId: `op_aoo_${digest.slice(0, 48)}`,
  }
}

export const materializeAttackOfOpportunity = (
  input: MaterializeAttackOfOpportunityInput,
): PendingMoveResolution | null => {
  const windows = windowsForTrigger(input)
  if (windows.length === 0) return null
  const publicSummary: PendingMoveResolutionPublicSummary = {
    schemaVersion: PENDING_MOVE_RESOLUTION_SCHEMA_VERSION,
    resolutionId: input.resolutionId,
    actorPlacementId: input.trigger.provokerId,
    canonicalMoveId: ATTACK_OF_OPPORTUNITY_CANONICAL_ID,
    phase: 'cleanup',
    status: 'pending',
    outstandingWindowCount: windows.length,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  }
  return parsePendingMoveResolution({
    schemaVersion: PENDING_MOVE_RESOLUTION_SCHEMA_VERSION,
    continuationKind: 'attack-of-opportunity',
    continuationContext: {
      kind: 'attack-of-opportunity',
      triggerReason: input.trigger.reason,
      provokerPlacementId: input.trigger.provokerId,
      from: input.trigger.reason === 'movement' ? { ...input.trigger.from } : null,
      to: input.trigger.reason === 'movement' ? { ...input.trigger.to } : null,
      targetPlacementIds: input.trigger.reason === 'ranged-attack'
        ? [...input.trigger.targetIds]
        : [],
      timingLimitation: 'post-provoking-action',
    },
    resolutionId: input.resolutionId,
    originMapSlug: input.originMapSlug,
    originOpId: input.originOpId,
    actorPlacementId: input.trigger.provokerId,
    canonicalMoveId: ATTACK_OF_OPPORTUNITY_CANONICAL_ID,
    specVersion: ATTACK_OF_OPPORTUNITY_PROGRAM_VERSION,
    specHash: ATTACK_OF_OPPORTUNITY_DEFINITION_HASH,
    rulesetId: MOVE_RULESET_PROVENANCE.rulesetId,
    rulesetHash: MOVE_RULESET_PROVENANCE.sourceData.sha256,
    phase: 'cleanup',
    readSet: initialReadSet(input, windows),
    trace: initialTrace({
      triggerReason: input.trigger.reason,
      windows,
      phase: 'cleanup',
      timing: 'cleanup',
    }),
    rollLedger: [],
    outstandingWindows: windows,
    chosenOptions: [],
    causalAncestry: [],
    status: 'pending',
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    publicSummary,
  })
}

const mapWithPlacementPosition = (
  map: TabletopMap,
  placementId: string,
  position: GridAnchor,
): TabletopMap => ({
  ...deepCloneJson(map),
  placements: map.placements.map(placement => placement.id === placementId
    ? { ...deepCloneJson(placement), position: { ...position } }
    : deepCloneJson(placement)),
})

const movementReactionOperation = (input: {
  readonly eventId: string
  readonly window: PendingMoveReactionResponseWindow
}): MoveReactionRequestEffectOperation => ({
  id: input.window.operationId,
  kind: 'reaction-request',
  source: { kind: 'lifecycle-event', id: input.eventId },
  recipients: { kind: 'actor' },
  phase: 'movement',
  reasonCode: input.window.reasonCode,
  payload: {
    requestId: input.window.windowId,
    promptKey: input.window.promptKey,
    options: input.window.options.map(option => ({
      id: option.id,
      labelKey: option.labelKey,
    })),
    allowPass: true,
    timing: 'movement-step',
    priority: input.window.priority,
  },
})

const movementCheckpointHandler = (
  checkpoints: readonly {
    readonly step: number
    readonly windows: readonly PendingMoveReactionResponseWindow[]
  }[],
): EncounterLifecycleTriggerHandler => {
  const byStepAndPlacementId = new Map(checkpoints.flatMap(checkpoint => (
    checkpoint.windows.flatMap(window => window.ownership.flatMap(owner => (
      owner.kind === 'placement' && owner.id
        ? [[`${checkpoint.step}:${owner.id}`, window] as const]
        : []
    )))
  )))
  return {
    id: 'handler.attack-of-opportunity.movement',
    resolve: ({ event }) => {
      if (event.kind !== 'placement-leaving-adjacency') return []
      const window = byStepAndPlacementId.get(
        `${event.movement.step}:${event.adjacentPlacementId}`,
      )
      if (!window) return []
      return [{
        effectId: null,
        reasonCode: window.reasonCode,
        operations: [movementReactionOperation({ eventId: event.eventId, window })],
        emittedEvents: [],
      }]
    },
  }
}

export const movementAttackOfOpportunityPersistenceIdentity = (input: {
  readonly mapSlug: string
  readonly originOpId: LivePlayOpId
  readonly commandHash: string
}): { readonly resolutionId: string; readonly originOpId: LivePlayOpId } => {
  const digest = createHash('sha256')
    .update(`${input.mapSlug}:${input.originOpId}:${input.commandHash}:movement-opportunity-attack`)
    .digest('hex')
  return {
    resolutionId: `resolution-movement-opportunity-attack-${digest}`,
    originOpId: input.originOpId,
  }
}

/**
 * Locate the first server-derived lost-adjacency checkpoint with at least one
 * eligible defender, then materialize one durable pre-step continuation. No
 * map, resource, or repository mutation occurs at this boundary.
 */
export const materializeMovementAttackOfOpportunity = (
  input: MaterializeMovementAttackOfOpportunityInput,
): MaterializedMovementAttackOfOpportunity | null => {
  if (input.movement.placementId !== placementFor(input.map, input.movement.placementId).id) {
    throw new Error('Movement opportunity attack placement identity is inconsistent.')
  }
  if (input.movement.mode !== 'shift') {
    throw new Error('Movement opportunity attacks support only shift-mode movement.')
  }
  const policyKind = input.movement.policy.kind
  if (policyKind === 'pass') {
    throw new Error('Movement opportunity attacks do not support pass-policy movement.')
  }
  const movementId = `movement.attack-of-opportunity.${createHash('sha256')
    .update(`${input.originMapSlug}:${input.originOpId}`)
    .digest('hex')}`

  for (const step of input.movement.triggeringSteps) {
    if (step.leftAdjacentPlacementIds.length === 0) continue
    const trigger: AttackOfOpportunityTriggerPayload = {
      action: 'provoke',
      reason: 'movement',
      provokerId: input.movement.placementId,
      from: { ...step.from },
      to: { ...step.to },
    }
    const checkpointMap = mapWithPlacementPosition(
      input.map,
      input.movement.placementId,
      step.from,
    )
    const windows = windowsForTrigger({
      ...input,
      map: checkpointMap,
      trigger,
    }, {
      candidateIds: step.leftAdjacentPlacementIds,
      timing: 'movement-step',
      movementStep: step.index,
    })
    if (windows.length === 0) continue

    const lifecycle = runAuthoritativeMovementLifecycle({
      movement: input.movement,
      movementId,
      sourceOperationId: input.originOpId,
      mode: 'voluntary',
      state: parseEncounterState(input.map.encounterState ?? createEmptyEncounterState()),
      handlers: [movementCheckpointHandler([{ step: step.index, windows }])],
    })
    if (lifecycle.status !== 'pending-interrupt') {
      throw new Error('Eligible movement opportunity attacks did not suspend their provoking step.')
    }
    const operationIds = new Set(lifecycle.pendingInterrupts.map(interrupt => interrupt.operation.id))
    if (windows.some(window => !operationIds.has(window.operationId))) {
      throw new Error('Movement opportunity attack lifecycle lost an eligible defender window.')
    }

    const context: PendingMovePreStepAttackOfOpportunityContext = {
      kind: 'attack-of-opportunity',
      triggerReason: 'movement',
      provokerPlacementId: input.movement.placementId,
      from: { ...step.from },
      to: { ...step.to },
      targetPlacementIds: [],
      timing: 'pre-movement-step',
      movementPath: {
        schemaVersion: 1,
        movementId,
        sourceOperationId: input.originOpId,
        mode: 'shift',
        policy: policyKind,
        origin: { ...input.movement.origin },
        destination: { ...input.movement.destination },
        requestedDestination: { ...input.movement.destination },
        path: input.movement.path.map(cell => ({ ...cell })),
        cumulativeCosts: [
          0,
          ...input.movement.triggeringSteps.map(candidate => candidate.cumulativeCost),
        ],
        committedStepCount: lifecycle.completedStepCount,
        cursor: { ...lifecycle.cursor },
        declarationPreviousRevision: input.declarationPreviousRevision,
        declarationRevision: input.continuationMapRevision,
      },
    }
    const publicSummary: PendingMoveResolutionPublicSummary = {
      schemaVersion: PENDING_MOVE_RESOLUTION_SCHEMA_VERSION,
      resolutionId: input.resolutionId,
      actorPlacementId: input.movement.placementId,
      canonicalMoveId: ATTACK_OF_OPPORTUNITY_CANONICAL_ID,
      phase: 'movement',
      status: 'pending',
      outstandingWindowCount: windows.length,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    }
    const pendingResolution = parsePendingMoveResolution({
      schemaVersion: PENDING_MOVE_RESOLUTION_SCHEMA_VERSION,
      continuationKind: 'attack-of-opportunity',
      continuationContext: context,
      resolutionId: input.resolutionId,
      originMapSlug: input.originMapSlug,
      originOpId: input.originOpId,
      actorPlacementId: input.movement.placementId,
      canonicalMoveId: ATTACK_OF_OPPORTUNITY_CANONICAL_ID,
      specVersion: ATTACK_OF_OPPORTUNITY_PROGRAM_VERSION,
      specHash: ATTACK_OF_OPPORTUNITY_DEFINITION_HASH,
      rulesetId: MOVE_RULESET_PROVENANCE.rulesetId,
      rulesetHash: MOVE_RULESET_PROVENANCE.sourceData.sha256,
      phase: 'movement',
      readSet: initialReadSet({
        ...input,
        map: checkpointMap,
        trigger,
      }, windows, input.movement.sheetReads),
      trace: initialTrace({
        triggerReason: 'movement',
        windows,
        phase: 'movement',
        timing: 'movement-step',
      }),
      rollLedger: [],
      outstandingWindows: windows,
      chosenOptions: [],
      causalAncestry: [],
      status: 'pending',
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      publicSummary,
    })
    return {
      pendingResolution,
      lifecycle,
      committedCost: context.movementPath.cumulativeCosts[lifecycle.completedStepCount] ?? 0,
    }
  }

  return null
}

export const isAttackOfOpportunityPendingResolution = (
  resolution: PendingMoveResolution,
): boolean => resolution.continuationKind === 'attack-of-opportunity'

export const isPreStepMovementAttackOfOpportunity = (
  resolution: PendingMoveResolution,
): resolution is PendingMoveResolution & {
  readonly continuationContext: PendingMovePreStepAttackOfOpportunityContext
} => resolution.continuationKind === 'attack-of-opportunity'
  && resolution.continuationContext?.triggerReason === 'movement'
  && 'timing' in resolution.continuationContext
  && resolution.continuationContext.timing === 'pre-movement-step'

const ownerPlacementId = (window: PendingMoveReactionResponseWindow): string => (
  window.ownership.find(owner => owner.kind === 'placement')?.id
  ?? (() => { throw new Error('Attack of Opportunity window lost its defending placement owner.') })()
)

const moveNameForOption = (input: {
  readonly optionId: string
  readonly attackerId: string
  readonly map: TabletopMap
} & AttackOfOpportunitySheetDocuments): string => {
  const placement = placementFor(input.map, input.attackerId)
  const token = placementToSpawned(placement, sheetsLookup(input), input.map)
  if (!token) throw new Error('Attack of Opportunity attacker cannot be resolved.')
  return moveOptionsForPlacement(input.map, placement, token, input)
    .find(option => option.id === input.optionId)?.moveName
    ?? (() => { throw new Error('Attack of Opportunity option is no longer authoritative.') })()
}

const childResolutionId = (pending: PendingMoveResolution, responseOpId: string): string => (
  `resolution-attack-of-opportunity-child-${createHash('sha256')
    .update(`${pending.resolutionId}:${responseOpId}`)
    .digest('hex')}`
)

const childAncestry = (
  pending: PendingMoveResolution,
  window: PendingMoveReactionResponseWindow,
): readonly MoveResolutionTraceAncestryEntry[] => Object.freeze([
  ...pending.causalAncestry,
  Object.freeze({
    depth: pending.causalAncestry.length,
    resolutionId: pending.resolutionId,
    canonicalId: pending.canonicalMoveId,
    definitionHash: pending.specHash,
    parentOperationId: window.operationId,
  }),
])

const traceResponse = (input: {
  readonly pending: PendingMoveResolution
  readonly window: PendingMoveReactionResponseWindow
  readonly optionId: string | null
  readonly childPlan: AuthoritativeMoveStatePlan | null
  readonly childId: string | null
}) => {
  let trace = reduceMoveResolutionTrace(input.pending.trace, {
    kind: 'choice',
    phase: input.pending.phase,
    requestId: input.window.windowId,
    requestKind: 'reaction',
    outcome: input.optionId === null ? 'passed' : 'selected',
    optionId: input.optionId,
    reasonCode: input.window.reasonCode,
  })
  if (input.childPlan && input.childId) {
    trace = reduceMoveResolutionTrace(trace, {
      kind: 'child-move',
      phase: input.pending.phase,
      childResolutionId: input.childId,
      canonicalId: input.childPlan.resolution.canonicalMoveName,
      definitionHash: input.childPlan.resolution.auditTrace.program.definitionHash,
      parentOperationId: input.window.operationId,
      depth: input.childPlan.resolution.auditTrace.ancestry.length,
      outcome: 'completed',
      reasonCode: 'attack-of-opportunity-child-completed',
    })
  }
  return trace
}

const readSetAfter = (input: {
  readonly pending: PendingMoveResolution
  readonly revision: number
  readonly childPlan: AuthoritativeMoveStatePlan | null
  readonly movementReads?: readonly {
    readonly kind: 'pokemon' | 'trainer'
    readonly slug: string
    readonly revision: number
  }[]
}): readonly PendingMoveResolutionResourceRead[] => {
  const reads = input.pending.readSet.map(read => {
    if (read.kind === 'map') return { ...read, revision: input.revision }
    if (read.kind !== 'sheet' || !input.childPlan) return read
    const write = input.childPlan.sheetWrites.find(candidate => (
      candidate.kind === read.sheetKind && candidate.slug === read.slug
    ))
    return write ? { ...read, revision: write.revision } : read
  })
  const keys = new Set(reads.flatMap(read => read.kind === 'sheet'
    ? [`${read.sheetKind}:${read.slug}`]
    : []))
  for (const read of input.movementReads ?? []) {
    const key = `${read.kind}:${read.slug}`
    if (keys.has(key)) continue
    keys.add(key)
    reads.push({
      kind: 'sheet',
      sheetKind: read.kind,
      slug: read.slug,
      revision: read.revision,
    })
  }
  return reads
}

const documentsAfterChild = (
  documents: AttackOfOpportunitySheetDocuments,
  childPlan: AuthoritativeMoveStatePlan | null,
): AttackOfOpportunitySheetDocuments => {
  const pokemonSheets = new Map(documents.pokemonSheets)
  const trainerSheets = new Map(documents.trainerSheets)
  for (const write of childPlan?.sheetWrites ?? []) {
    if (write.kind === 'pokemon') {
      pokemonSheets.set(write.slug, write.nextSheet as CharacterSheet)
    }
    else {
      trainerSheets.set(write.slug, write.nextSheet as TrainerSheet)
    }
  }
  return { pokemonSheets, trainerSheets }
}

const placementDisplayName = (
  placement: SheetPlacement,
  documents: AttackOfOpportunitySheetDocuments,
): string => {
  const sheet = sheetForPlacement(placement, documents)
  if (placement.sheetKind === 'pokemon') {
    const pokemon = sheet as CharacterSheet
    return pokemon.nickname?.trim() || pokemon.species?.trim() || placement.sheetSlug
  }
  const trainer = sheet as TrainerSheet
  return trainer.name?.trim() || placement.sheetSlug
}

const anchorsEqual = (
  left: GridAnchor,
  right: GridAnchor,
): boolean => left.x === right.x && left.y === right.y && left.z === right.z

const pathsEqual = (
  left: readonly GridAnchor[],
  right: readonly GridAnchor[],
): boolean => left.length === right.length
  && left.every((cell, index) => anchorsEqual(cell, right[index]!))

interface RevalidatedOpportunityMovement {
  readonly movement: AuthoritativeMovementSuccess
  readonly shortened: boolean
}

const revalidateOpportunityMovement = (input: {
  readonly context: PendingMovePreStepAttackOfOpportunityContext
  readonly map: TabletopMap
  readonly documents: AttackOfOpportunitySheetDocuments
}): RevalidatedOpportunityMovement | null => {
  const path = input.context.movementPath
  const mapAtOrigin = mapWithPlacementPosition(
    input.map,
    input.context.provokerPlacementId,
    path.origin,
  )
  for (let endpointIndex = path.path.length - 1;
    endpointIndex > path.committedStepCount;
    endpointIndex -= 1) {
    const destination = path.path[endpointIndex]!
    const movement = resolveAuthoritativeMovement({
      map: mapAtOrigin,
      sheets: {
        pokemon: input.documents.pokemonSheets,
        trainer: input.documents.trainerSheets,
      },
      placementId: input.context.provokerPlacementId,
      mode: 'shift',
      destination,
      policy: path.policy === 'gm-override'
        ? { kind: 'gm-override' }
        : { kind: 'standard' },
    })
    if (!movement.ok) continue
    if (!pathsEqual(movement.path, path.path.slice(0, endpointIndex + 1))) continue
    return {
      movement,
      shortened: endpointIndex < path.path.length - 1,
    }
  }
  return null
}

const movementWindowsByStep = (input: {
  readonly pending: PendingMoveResolution & {
    readonly continuationContext: PendingMovePreStepAttackOfOpportunityContext
  }
  readonly map: TabletopMap
  readonly movement: AuthoritativeMovementSuccess
  readonly documents: AttackOfOpportunitySheetDocuments
  readonly playerCharacterSheetKeys: ReadonlySet<string>
}): readonly {
  readonly step: number
  readonly windows: readonly PendingMoveReactionResponseWindow[]
}[] => input.movement.triggeringSteps.flatMap(step => {
  if (
    step.index <= input.pending.continuationContext.movementPath.committedStepCount
    || step.leftAdjacentPlacementIds.length === 0
  ) return []
  const trigger: AttackOfOpportunityTriggerPayload = {
    action: 'provoke',
    reason: 'movement',
    provokerId: input.pending.actorPlacementId,
    from: { ...step.from },
    to: { ...step.to },
  }
  const windows = windowsForTrigger({
    ...input.documents,
    map: mapWithPlacementPosition(input.map, input.pending.actorPlacementId, step.from),
    trigger,
    playerCharacterSheetKeys: input.playerCharacterSheetKeys,
  }, {
    candidateIds: step.leftAdjacentPlacementIds,
    timing: 'movement-step',
    movementStep: step.index,
  })
  return windows.length > 0 ? [{ step: step.index, windows }] : []
})

const appendRequestedWindowsToTrace = (
  trace: PendingMoveResolution['trace'],
  windows: readonly PendingMoveReactionResponseWindow[],
) => {
  let next = trace
  for (const window of windows) {
    next = reduceMoveResolutionTrace(next, {
      kind: 'operation',
      phase: 'movement',
      operationId: window.operationId,
      operationKind: 'reaction-request',
      recipientIds: window.ownership.flatMap(owner => owner.id ? [owner.id] : []),
      outcome: 'pending',
      reasonCode: window.reasonCode,
      input: {
        timing: 'movement-step',
        priority: window.priority,
        triggerReason: 'movement',
        movementTiming: 'before-provoking-step',
      },
      result: { requestId: window.windowId, requestKind: 'reaction' },
    })
    next = reduceMoveResolutionTrace(next, {
      kind: 'choice',
      phase: 'movement',
      requestId: window.windowId,
      requestKind: 'reaction',
      outcome: 'requested',
      optionId: null,
      reasonCode: window.reasonCode,
    })
  }
  return next
}

interface ContinuedOpportunityMovement {
  readonly map: TabletopMap
  readonly transition: AuthoritativeMovementMapTransition | null
  readonly movement: AuthoritativeMovementSuccess | null
  readonly lifecycle: ReturnType<typeof runAuthoritativeMovementLifecycle> | null
  readonly windows: readonly PendingMoveReactionResponseWindow[]
  readonly context: PendingMovePreStepAttackOfOpportunityContext
  readonly outcome: AttackOfOpportunityMovementOutcome
}

const continueOpportunityMovement = (input: {
  readonly pending: PendingMoveResolution & {
    readonly continuationContext: PendingMovePreStepAttackOfOpportunityContext
  }
  readonly map: TabletopMap
  readonly documents: AttackOfOpportunitySheetDocuments
  readonly childPlan: AuthoritativeMoveStatePlan | null
  readonly responseOpId: string
  readonly plannedAt: number
  readonly maxMovementLogEntries?: number
  readonly playerCharacterSheetKeys: ReadonlySet<string>
}): ContinuedOpportunityMovement => {
  const context = input.pending.continuationContext
  const currentPlacement = placementFor(input.map, input.pending.actorPlacementId)
  if (!anchorsEqual(currentPlacement.position, context.from)) {
    return {
      map: input.map,
      transition: null,
      movement: null,
      lifecycle: null,
      windows: [],
      context,
      outcome: {
        kind: 'cancelled',
        reasonCode: 'movement.typed-interrupt-relocated-provoker',
      },
    }
  }
  const provoker = placementToSpawned(
    currentPlacement,
    sheetsLookup(input.documents),
    input.map,
  )
  if (!provoker || provoker.currentHp <= 0) {
    return {
      map: input.map,
      transition: null,
      movement: null,
      lifecycle: null,
      windows: [],
      context,
      outcome: {
        kind: 'cancelled',
        reasonCode: 'movement.typed-interrupt-fainted-provoker',
      },
    }
  }

  const revalidated = revalidateOpportunityMovement({
    context,
    map: input.map,
    documents: input.documents,
  })
  if (!revalidated) {
    return {
      map: input.map,
      transition: null,
      movement: null,
      lifecycle: null,
      windows: [],
      context,
      outcome: {
        kind: 'cancelled',
        reasonCode: 'movement.typed-interrupt-no-legal-step',
      },
    }
  }
  const movement = revalidated.movement
  const lifecycleInput = {
    movement,
    movementId: context.movementPath.movementId,
    sourceOperationId: context.movementPath.sourceOperationId,
    mode: 'voluntary' as const,
  }
  const cursor: MovementLifecycleCursor = {
    ...context.movementPath.cursor,
    pathHash: authoritativeMovementLifecyclePathHash(lifecycleInput),
  }
  const checkpoints = movementWindowsByStep({
    pending: input.pending,
    map: input.map,
    movement,
    documents: input.documents,
    playerCharacterSheetKeys: input.playerCharacterSheetKeys,
  })
  const lifecycle = runAuthoritativeMovementLifecycle({
    ...lifecycleInput,
    state: parseEncounterState(input.map.encounterState ?? createEmptyEncounterState()),
    handlers: [movementCheckpointHandler(checkpoints)],
    cursor,
  })
  const previousCost = context.movementPath.cumulativeCosts[
    context.movementPath.committedStepCount
  ] ?? 0
  const currentCost = lifecycle.completedStepCount === 0
    ? 0
    : movement.triggeringSteps[lifecycle.completedStepCount - 1]?.cumulativeCost ?? 0
  const segmentDistance = Math.max(0, currentCost - previousCost)
  const resources = planAuthoritativeMovementResources({
    map: input.map,
    movement,
    sourceOperationId: input.responseOpId,
    distance: segmentDistance,
    spendAction: false,
  })
  const transition = applyAuthoritativeMovementMapTransition({
    map: input.map,
    placementId: input.pending.actorPlacementId,
    destination: lifecycle.currentPosition,
    distance: segmentDistance,
    encounterState: resources.currentEncounterState,
    timestamp: input.plannedAt,
    userName: placementDisplayName(currentPlacement, input.documents),
    maxLogEntries: input.maxMovementLogEntries,
  })
  if (lifecycle.status !== 'pending-interrupt') {
    return {
      map: transition.nextMap,
      transition,
      movement,
      lifecycle,
      windows: [],
      context,
      outcome: revalidated.shortened
        ? {
            kind: 'shortened',
            reasonCode: 'movement.typed-interrupt-shortened-path',
            destination: { ...movement.destination },
          }
        : {
            kind: 'continued',
            reasonCode: 'movement.opportunity-attack-cleared',
          },
    }
  }

  const interruptEvent = lifecycle.processedPathEvents.find(event => (
    event.eventId === lifecycle.pendingInterrupts[0]?.eventId
    && event.kind === 'placement-leaving-adjacency'
  ))
  if (!interruptEvent || interruptEvent.kind !== 'placement-leaving-adjacency') {
    throw new Error('Resumed movement opportunity attack lost its pre-step lifecycle event.')
  }
  const windows = checkpoints.find(checkpoint => (
    checkpoint.step === interruptEvent.movement.step
  ))?.windows ?? []
  if (windows.length === 0) {
    throw new Error('Resumed movement suspended without eligible defender windows.')
  }
  const nextContext: PendingMovePreStepAttackOfOpportunityContext = {
    ...context,
    from: { ...interruptEvent.from },
    to: { ...interruptEvent.to },
    movementPath: {
      ...context.movementPath,
      destination: { ...movement.destination },
      path: movement.path.map(cell => ({ ...cell })),
      cumulativeCosts: [0, ...movement.triggeringSteps.map(step => step.cumulativeCost)],
      committedStepCount: lifecycle.completedStepCount,
      cursor: { ...lifecycle.cursor },
    },
  }
  return {
    map: transition.nextMap,
    transition,
    movement,
    lifecycle,
    windows,
    context: nextContext,
    outcome: {
      kind: 'waiting',
      reasonCode: 'movement.awaiting-opportunity-responses',
    },
  }
}

const withoutPlanIdentity = (
  change: AuthoritativeMoveStatePlan['stateChanges']['changes'][number],
): MoveStateChangeInput => {
  const { id: _id, order: _order, ...input } = change
  return deepCloneJson(input) as MoveStateChangeInput
}

const finalizedChildPlan = (input: {
  readonly childPlan: AuthoritativeMoveStatePlan
  readonly previousMap: TabletopMap
  readonly nextMap: TabletopMap
  readonly window: PendingMoveReactionResponseWindow
}): AuthoritativeMoveStatePlan => {
  const retained = input.childPlan.stateChanges.changes
    .filter(change => change.kind !== 'map-metadata' && change.kind !== 'encounter-state')
    .map(withoutPlanIdentity)
  const changes: MoveStateChangeInput[] = [...retained]
  if (!sameJsonValue(input.previousMap.metadata, input.nextMap.metadata)) {
    changes.push({
      kind: 'map-metadata',
      scope: { kind: 'map', mapSlug: input.nextMap.slug },
      expectedRevision: normalizeRevision(input.previousMap.revision),
      sourceOperationId: input.window.operationId,
      reasonCode: 'attack-of-opportunity-used',
      previous: deepCloneJson(input.previousMap.metadata),
      current: deepCloneJson(input.nextMap.metadata),
      compensation: unavailableMoveStateCompensation(
        'accepted-log-may-be-observed',
        'externally-observed',
      ),
    })
  }
  const retainedPlacementIds = new Set(retained.flatMap(change => (
    change.scope.kind === 'placement' ? [change.scope.placementId] : []
  )))
  const previousPlacements = new Map(input.previousMap.placements.map(placement => [placement.id, placement]))
  const nextPlacements = new Map(input.nextMap.placements.map(placement => [placement.id, placement]))
  for (const placementId of new Set([...previousPlacements.keys(), ...nextPlacements.keys()])) {
    const previous = previousPlacements.get(placementId) ?? null
    const current = nextPlacements.get(placementId) ?? null
    if (retainedPlacementIds.has(placementId) || sameJsonValue(previous, current)) continue
    changes.push({
      kind: 'placement-state',
      scope: { kind: 'placement', mapSlug: input.nextMap.slug, placementId },
      expectedRevision: normalizeRevision(input.previousMap.revision),
      sourceOperationId: input.window.operationId,
      reasonCode: 'attack-of-opportunity-movement-continuation',
      previous: deepCloneJson(previous),
      current: deepCloneJson(current),
      compensation: unavailableMoveStateCompensation(
        'accepted-movement-may-be-observed',
        'externally-observed',
      ),
    })
  }
  changes.push({
    kind: 'encounter-state',
    scope: { kind: 'encounter', mapSlug: input.nextMap.slug },
    expectedRevision: normalizeRevision(input.previousMap.revision),
    sourceOperationId: input.window.operationId,
    reasonCode: 'attack-of-opportunity-response-recorded',
    previous: parseEncounterState(input.previousMap.encounterState ?? createEmptyEncounterState()),
    current: parseEncounterState(input.nextMap.encounterState ?? createEmptyEncounterState()),
    compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  })
  return {
    ...input.childPlan,
    nextMap: deepCloneJson(input.nextMap),
    mapChanges: buildAuthoritativeMoveMapChanges(input.previousMap, input.nextMap),
    stateChanges: createMoveStateChangePlan(changes),
  }
}

const OPPORTUNITY_ATTACK_RESOURCE_COSTS = Object.freeze([Object.freeze({
  id: 'reaction.cost.opportunity-attack',
  phase: 'pay' as const,
  cost: Object.freeze({
    kind: 'action-resource' as const,
    resource: 'interrupt' as const,
    amount: 1,
  }),
})])

export const planAttackOfOpportunityResponse = (input: {
  readonly pendingResolution: PendingMoveResolution
  readonly responseOpId: string
  readonly responseWindowId: string
  readonly responseOptionId: string | null
  readonly chosenBy: PendingMoveResponseOwner
  readonly map: TabletopMap
  readonly plannedAt: number
  readonly random?: AuthoritativeMoveRandomSource
  readonly maxMoveLogEntries?: number
  readonly playerCharacterSheetKeys?: ReadonlySet<string>
} & AttackOfOpportunitySheetDocuments): AttackOfOpportunityResponsePlan => {
  const pending = input.pendingResolution
  if (!isAttackOfOpportunityPendingResolution(pending)) {
    throw new Error('A non-opportunity pending resolution cannot use the opportunity planner.')
  }
  const window = pending.outstandingWindows.find(candidate => (
    candidate.windowId === input.responseWindowId && candidate.kind === 'reaction'
  )) as PendingMoveReactionResponseWindow | undefined
  if (!window) throw new Error('The Attack of Opportunity window is no longer available.')
  const attackerId = ownerPlacementId(window)
  const childId = input.responseOptionId === null
    ? null
    : childResolutionId(pending, input.responseOpId)
  const childPlan = input.responseOptionId === null
    ? null
    : planAuthoritativeMoveState({
        map: input.map,
        pokemonSheets: input.pokemonSheets,
        trainerSheets: input.trainerSheets,
        intent: {
          schemaVersion: 1,
          placementId: attackerId,
          moveName: moveNameForOption({
            optionId: input.responseOptionId,
            attackerId,
            map: input.map,
            pokemonSheets: input.pokemonSheets,
            trainerSheets: input.trainerSheets,
          }),
          selection: {
            kind: 'single-target',
            targetPlacementId: pending.actorPlacementId,
          },
        },
        random: input.random,
        now: () => input.plannedAt,
        operationId: input.responseOpId,
        pendingResolutionId: childId ?? undefined,
        maxMoveLogEntries: input.maxMoveLogEntries,
        ancestry: childAncestry(pending, window),
        resourceCostDeclarations: OPPORTUNITY_ATTACK_RESOURCE_COSTS,
        tokenPositionOverrides: pending.continuationContext?.triggerReason === 'movement'
          && pending.continuationContext.from
          ? new Map([[pending.actorPlacementId, pending.continuationContext.from]])
          : undefined,
      })

  const previousRevision = normalizeRevision(input.map.revision)
  const revision = nextRevision(previousRevision)
  const childBaseMap = childPlan?.nextMap ?? {
    ...deepCloneJson(input.map),
    revision,
    updatedAt: input.plannedAt,
  }
  const metadata = childPlan
    ? writeAttackOfOpportunityState(
        childBaseMap.metadata,
        applyAttackOfOpportunityStateUpdate(
          readAttackOfOpportunityState(childBaseMap.metadata),
          {
            action: 'mark-attacker-used',
            attackerId,
            round: input.map.initiative?.round ?? null,
          },
        ),
      )
    : childBaseMap.metadata
  let workingMap: TabletopMap = {
    ...deepCloneJson(childBaseMap),
    metadata: deepCloneJson(metadata),
    revision,
    updatedAt: input.plannedAt,
  }
  let outstandingWindows = pending.outstandingWindows.filter(candidate => (
    candidate.windowId !== window.windowId
  ))
  let trace = traceResponse({ pending, window, optionId: input.responseOptionId, childPlan, childId })
  let continuationContext = pending.continuationContext
  let movementTransition: AuthoritativeMovementMapTransition | null = null
  let movementOutcome: AttackOfOpportunityMovementOutcome = { kind: 'not-applicable' }
  let movementReads: AuthoritativeMovementSuccess['sheetReads'] = []

  if (isPreStepMovementAttackOfOpportunity(pending)) {
    movementOutcome = {
      kind: 'waiting',
      reasonCode: 'movement.awaiting-opportunity-responses',
    }
    if (outstandingWindows.length === 0) {
      const documents = documentsAfterChild(input, childPlan)
      const continued = continueOpportunityMovement({
        pending,
        map: workingMap,
        documents,
        childPlan,
        responseOpId: input.responseOpId,
        plannedAt: input.plannedAt,
        maxMovementLogEntries: input.maxMoveLogEntries,
        playerCharacterSheetKeys: input.playerCharacterSheetKeys ?? new Set<string>(),
      })
      workingMap = continued.map
      movementTransition = continued.transition
      movementOutcome = continued.outcome
      movementReads = continued.movement?.sheetReads ?? []
      continuationContext = continued.context
      outstandingWindows = [...continued.windows]
      if (continued.windows.length > 0) {
        trace = appendRequestedWindowsToTrace(trace, continued.windows)
      }
    }
  }

  const status = outstandingWindows.length > 0 ? 'pending' as const : 'committed' as const
  const publicSummary: PendingMoveResolutionPublicSummary = {
    ...pending.publicSummary,
    status,
    outstandingWindowCount: outstandingWindows.length,
    updatedAt: input.plannedAt,
  }
  const nextPending = parsePendingMoveResolution({
    ...pending,
    ...(continuationContext ? { continuationContext } : {}),
    readSet: readSetAfter({ pending, revision, childPlan, movementReads }),
    trace,
    outstandingWindows,
    chosenOptions: [
      ...pending.chosenOptions,
      {
        windowId: window.windowId,
        responseOpId: input.responseOpId,
        optionId: input.responseOptionId,
        chosenBy: input.chosenBy,
        chosenAt: input.plannedAt,
      },
    ],
    status,
    updatedAt: input.plannedAt,
    publicSummary,
  })
  const encounter = parseEncounterState(
    workingMap.encounterState ?? createEmptyEncounterState(),
  )
  const nextEncounter = parseEncounterState({
    ...encounter,
    pendingResolutionSummaries: [
      ...encounter.pendingResolutionSummaries.filter(summary => (
        summary.resolutionId !== pending.resolutionId
      )),
      ...(status === 'pending' ? [nextPending.publicSummary] : []),
    ],
  })
  const nextMap: TabletopMap = {
    ...deepCloneJson(workingMap),
    encounterState: nextEncounter,
    revision,
    updatedAt: input.plannedAt,
  }
  const finalChild = childPlan
    ? finalizedChildPlan({ childPlan, previousMap: input.map, nextMap, window })
    : null
  const childReadKeys = new Set((childPlan?.sheetReads ?? []).map(read => (
    `${read.kind}:${read.slug}`
  )))
  const sheetReads = [
    ...(childPlan?.sheetReads ?? pending.readSet.flatMap(read => (
      read.kind === 'sheet'
        ? [{ kind: read.sheetKind, slug: read.slug, revision: read.revision }]
        : []
    ))),
    ...movementReads.filter(read => !childReadKeys.has(`${read.kind}:${read.slug}`)),
  ]

  return {
    previousMap: deepCloneJson(input.map),
    nextMap,
    previousRevision,
    revision,
    sheetReads: deepCloneJson(sheetReads),
    sheetWrites: deepCloneJson(childPlan?.sheetWrites ?? []),
    pendingResolution: nextPending,
    childMovePlan: finalChild,
    movementTransition,
    movementOutcome,
  }
}
