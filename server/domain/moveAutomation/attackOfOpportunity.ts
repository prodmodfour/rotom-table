import { createHash } from 'node:crypto'
import { normalizeRevision, nextRevision } from '#shared/sessionRevisions'
import {
  PENDING_MOVE_RESOLUTION_SCHEMA_VERSION,
  parsePendingMoveResolution,
  type PendingMoveReactionResponseWindow,
  type PendingMoveResolution,
  type PendingMoveResolutionPublicSummary,
  type PendingMoveResolutionResourceRead,
  type PendingMoveResponseOwner,
} from '#shared/moveAutomation/pendingResolution'
import { MOVE_RULESET_PROVENANCE } from '#shared/moveAutomation/ruleset'
import type { MoveResolutionTraceAncestryEntry } from '#shared/moveAutomation/trace'
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
import type { SheetPlacement, TabletopMap } from '~/types/map'
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

export const ATTACK_OF_OPPORTUNITY_PROGRAM_VERSION = 1 as const
export const ATTACK_OF_OPPORTUNITY_CANONICAL_ID = 'Attack of Opportunity' as const

const ATTACK_OF_OPPORTUNITY_DEFINITION = Object.freeze({
  version: ATTACK_OF_OPPORTUNITY_PROGRAM_VERSION,
  timing: 'cleanup',
  responseOwnership: 'defending-placement',
  optionPolicy: 'authoritative-usable-struggle-variants',
  remainingLimitation: 'post-provoking-action-until-ma-146',
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
    moveEntriesForPlacement(placement, sheetsLookup(documents)),
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

const windowsForTrigger = (
  input: MaterializeAttackOfOpportunityInput,
): readonly PendingMoveReactionResponseWindow[] => {
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

  return candidateAttackerIds(input.map, tokens, input.trigger).flatMap((attackerId, index) => {
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
    const options = moveOptionsForPlacement(input.map, placement, attacker, input)
    if (options.length === 0) return []
    const windowId = `attack-of-opportunity.window.${index + 1}`
    const reasonCode = `maneuver.attack-of-opportunity.${input.trigger.reason}`
    return [{
      windowId,
      operationId: `${windowId}.request`,
      kind: 'reaction',
      phase: 'cleanup',
      reasonCode,
      promptKey: 'maneuver.attack-of-opportunity.resolve-after-provoking-action',
      ownership: [{ kind: 'placement', id: attackerId }],
      options: options.map(({ id, labelKey }) => ({ id, labelKey })),
      allowPass: true,
      timing: 'cleanup',
      priority: 0,
      depth: 0,
    }]
  })
}

const initialTrace = (
  trigger: AttackOfOpportunityTriggerPayload,
  windows: readonly PendingMoveReactionResponseWindow[],
) => {
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
    to: 'cleanup',
    reasonCode: 'attack-of-opportunity-post-action-phase',
  })
  for (const window of windows) {
    trace = reduceMoveResolutionTrace(trace, {
      kind: 'operation',
      phase: 'cleanup',
      operationId: window.operationId,
      operationKind: 'reaction-request',
      recipientIds: window.ownership.flatMap(owner => owner.id ? [owner.id] : []),
      outcome: 'pending',
      reasonCode: window.reasonCode,
      input: {
        timing: 'cleanup',
        priority: 0,
        triggerReason: trigger.reason,
        timingLimitation: 'post-provoking-action',
      },
      result: { requestId: window.windowId, requestKind: 'reaction' },
    })
    trace = reduceMoveResolutionTrace(trace, {
      kind: 'choice',
      phase: 'cleanup',
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
  input: MaterializeAttackOfOpportunityInput,
  windows: readonly PendingMoveReactionResponseWindow[],
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
  for (const placement of input.map.placements) {
    if (!ids.has(placement.id)) continue
    const key = `${placement.sheetKind}:${placement.sheetSlug}`
    if (seen.has(key)) continue
    seen.add(key)
    const sheet = sheetForPlacement(placement, input)
    reads.push({
      kind: 'sheet',
      sheetKind: placement.sheetKind,
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
    trace: initialTrace(input.trigger, windows),
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

export const isAttackOfOpportunityPendingResolution = (
  resolution: PendingMoveResolution,
): boolean => resolution.continuationKind === 'attack-of-opportunity'

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
    phase: 'cleanup',
    requestId: input.window.windowId,
    requestKind: 'reaction',
    outcome: input.optionId === null ? 'passed' : 'selected',
    optionId: input.optionId,
    reasonCode: input.window.reasonCode,
  })
  if (input.childPlan && input.childId) {
    trace = reduceMoveResolutionTrace(trace, {
      kind: 'child-move',
      phase: 'cleanup',
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
}): readonly PendingMoveResolutionResourceRead[] => input.pending.readSet.map(read => {
  if (read.kind === 'map') return { ...read, revision: input.revision }
  if (read.kind !== 'sheet' || !input.childPlan) return read
  const write = input.childPlan.sheetWrites.find(candidate => (
    candidate.kind === read.sheetKind && candidate.slug === read.slug
  ))
  return write ? { ...read, revision: write.revision } : read
})

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
        maxMoveLogEntries: input.maxMoveLogEntries,
        ancestry: childAncestry(pending, window),
        tokenPositionOverrides: pending.continuationContext?.triggerReason === 'movement'
          && pending.continuationContext.from
          ? new Map([[pending.actorPlacementId, pending.continuationContext.from]])
          : undefined,
      })

  const previousRevision = normalizeRevision(input.map.revision)
  const revision = nextRevision(previousRevision)
  const baseMap = childPlan?.nextMap ?? {
    ...deepCloneJson(input.map),
    revision,
    updatedAt: input.plannedAt,
  }
  const remainingWindows = pending.outstandingWindows.filter(candidate => (
    candidate.windowId !== window.windowId
  ))
  const status = remainingWindows.length > 0 ? 'pending' as const : 'committed' as const
  const trace = traceResponse({ pending, window, optionId: input.responseOptionId, childPlan, childId })
  const publicSummary: PendingMoveResolutionPublicSummary = {
    ...pending.publicSummary,
    status,
    outstandingWindowCount: remainingWindows.length,
    updatedAt: input.plannedAt,
  }
  const nextPending = parsePendingMoveResolution({
    ...pending,
    readSet: readSetAfter({ pending, revision, childPlan }),
    trace,
    outstandingWindows: remainingWindows,
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
  const encounter = parseEncounterState(baseMap.encounterState ?? createEmptyEncounterState())
  const nextEncounter = parseEncounterState({
    ...encounter,
    pendingResolutionSummaries: [
      ...encounter.pendingResolutionSummaries.filter(summary => (
        summary.resolutionId !== pending.resolutionId
      )),
      ...(status === 'pending' ? [nextPending.publicSummary] : []),
    ],
  })
  const metadata = childPlan
    ? writeAttackOfOpportunityState(
        baseMap.metadata,
        applyAttackOfOpportunityStateUpdate(
          readAttackOfOpportunityState(baseMap.metadata),
          {
            action: 'mark-attacker-used',
            attackerId,
            round: input.map.initiative?.round ?? null,
          },
        ),
      )
    : baseMap.metadata
  const nextMap: TabletopMap = {
    ...deepCloneJson(baseMap),
    metadata: deepCloneJson(metadata),
    encounterState: nextEncounter,
    revision,
    updatedAt: input.plannedAt,
  }
  const finalChild = childPlan
    ? finalizedChildPlan({ childPlan, previousMap: input.map, nextMap, window })
    : null

  return {
    previousMap: deepCloneJson(input.map),
    nextMap,
    previousRevision,
    revision,
    sheetReads: deepCloneJson(childPlan?.sheetReads ?? pending.readSet.flatMap(read => (
      read.kind === 'sheet'
        ? [{ kind: read.sheetKind, slug: read.slug, revision: read.revision }]
        : []
    ))),
    sheetWrites: deepCloneJson(childPlan?.sheetWrites ?? []),
    pendingResolution: nextPending,
    childMovePlan: finalChild,
  }
}
