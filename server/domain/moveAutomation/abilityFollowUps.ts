import { createHash } from 'node:crypto'
import { normalizeRevision, nextRevision } from '#shared/sessionRevisions'
import {
  PENDING_MOVE_RESOLUTION_SCHEMA_VERSION,
  activePendingMoveResponseWindows,
  parsePendingMoveResolution,
  type PendingMoveResolution,
  type PendingMoveResolutionPublicSummary,
  type PendingMoveResolutionResourceRead,
  type PendingMoveResponseOwner,
  type PendingMoveReactionResponseWindow,
  type PendingMoveResponseWindow,
} from '#shared/moveAutomation/pendingResolution'
import { MOVE_RULESET_PROVENANCE } from '#shared/moveAutomation/ruleset'
import {
  createEmptyEncounterState,
  parseEncounterState,
} from '#shared/moveAutomation/encounterState'
import type { MoveEffectOperation } from '#shared/moveAutomation/effects'
import type { MoveResolutionAuditTrace } from '#shared/moveAutomation/trace'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { MoveAutomationTransaction } from '~/types/moveAutomation'
import type { TrainerSheet } from '~/types/trainerSheet'
import { moveEntriesForPlacement } from '~/utils/mapTokenMoves'
import {
  buildCelebrateTriggerPrompts,
} from '~/utils/moveAutomationCelebrate'
import {
  buildCuteCharmReactionPrompts,
} from '~/utils/moveAutomationCuteCharm'
import {
  buildMoxieTriggerPrompts,
} from '~/utils/moveAutomationMoxie'
import {
  buildPoisonPointReactionPrompts,
} from '~/utils/moveAutomationPoisonPoint'
import {
  buildSpiteReactionPrompts,
} from '~/utils/moveAutomationSpite'
import { placementToSpawned, type SheetLookup } from '~/utils/placement'
import { deepCloneJson } from '~/utils/serialization'
import type {
  AuthoritativeMoveMapChanges,
  AuthoritativeMoveSheetWritePlan,
} from '../planAuthoritativeMoveState'
import type { AuthoritativeMoveResolution } from '../resolveAuthoritativeMove'
import {
  buildAbilityFollowUpEffectOperations,
  abilityFollowUpSpecForKind,
  abilityFollowUpSpecForWindow,
  ABILITY_FOLLOW_UP_DEFINITION_HASH,
  ABILITY_FOLLOW_UP_PROGRAM_VERSION,
  type AbilityFollowUpKind,
} from './abilityFollowUpSpecs'
import {
  buildAuthoritativeMoveRulesContext,
  deduplicateAuthoritativeMoveSheetReads,
  type AuthoritativeMoveSheetRead,
} from './context'
import type { MoveSpecEmittedOperation } from './executeSpec'
import { buildAuthoritativeMoveMapChanges } from './mapChanges'
import { applyNativeCoreMapChanges, nativeSheetWritesFromStateChanges } from './planNativeV2MoveState'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  createMoveStateChangePlan,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from './plan'
import {
  isMoveCoreTokenEffectEmission,
  reduceMoveCoreTokenEffects,
} from './reducers/coreTokenEffects'
import { createStandardMoveCoreTokenEffectImmunityQueries } from './reducers/immunities'
import {
  isMoveMapOperationEmission,
  reduceMoveMapOperations,
} from './reducers/mapOperations'
import { createMoveResolutionTrace, reduceMoveResolutionTrace } from './trace'

export interface AbilityFollowUpCandidate {
  readonly kind: AbilityFollowUpKind
  readonly ownerPlacementId: string
}

export interface MaterializeAbilityFollowUpsInput {
  readonly resolutionId: string
  readonly originOpId: string
  readonly originMapSlug: string
  readonly continuationMapRevision: number
  readonly createdAt: number
  readonly resolution: AuthoritativeMoveResolution
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly sheetWrites: readonly AuthoritativeMoveSheetWritePlan[]
}

export const abilityFollowUpPersistenceIdentity = (input: {
  readonly mapSlug: string
  readonly causalOpId: string
}): { readonly resolutionId: string; readonly originOpId: string } => {
  const digest = createHash('sha256')
    .update(`${input.mapSlug}:${input.causalOpId}:ability-follow-ups`)
    .digest('hex')
  return {
    resolutionId: `resolution-ability-follow-up-${digest}`,
    originOpId: `op_followup_${digest.slice(0, 48)}`,
  }
}

export interface AbilityFollowUpResponsePlan {
  readonly previousMap: TabletopMap
  readonly nextMap: TabletopMap
  readonly previousRevision: number
  readonly revision: number
  readonly sheetReads: readonly AuthoritativeMoveSheetRead[]
  readonly sheetWrites: readonly AuthoritativeMoveSheetWritePlan[]
  readonly mapChanges: AuthoritativeMoveMapChanges
  readonly stateChanges: MoveStateChangePlan
  readonly trace: MoveResolutionAuditTrace
  readonly pendingResolution: PendingMoveResolution
}

const sheetLookup = (
  pokemonSheets: ReadonlyMap<string, CharacterSheet>,
  trainerSheets: ReadonlyMap<string, TrainerSheet>,
): SheetLookup => ({
  pokemon: new Map(pokemonSheets),
  trainer: new Map(trainerSheets),
})

const tokensForMap = (
  map: TabletopMap,
  sheets: SheetLookup,
) => map.placements.flatMap((placement) => {
  const token = placementToSpawned(placement, sheets, map)
  return token ? [token] : []
})

const stablePromptId = (kind: AbilityFollowUpKind) => () => `server-${kind}`

/** Preserve the exact eligibility of the five former browser prompt builders. */
export const detectAbilityFollowUps = (input: {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly resolution: AuthoritativeMoveResolution
}): readonly AbilityFollowUpCandidate[] => {
  const sheets = sheetLookup(input.pokemonSheets, input.trainerSheets)
  const tokens = tokensForMap(input.map, sheets)
  const tokenById = new Map(tokens.map(token => [token.id, token]))
  const transaction = input.resolution.transaction
  const attacker = tokenById.get(transaction.userId)
  if (!attacker) return []
  const hitTargets = transaction.hitTargetIds.flatMap(id => tokenById.get(id) ?? [])
  const attackedTargets = transaction.attackedTargetIds.flatMap(id => tokenById.get(id) ?? [])
  const candidates: AbilityFollowUpCandidate[] = []

  const moxie = buildMoxieTriggerPrompts({
    attacker,
    moveName: transaction.moveName,
    hpUpdates: transaction.hpUpdates,
    hitTargetIds: transaction.hitTargetIds,
    tokens,
    idFactory: stablePromptId('moxie'),
  })
  if (moxie.length > 0) candidates.push({ kind: 'moxie', ownerPlacementId: attacker.id })

  const celebrate = buildCelebrateTriggerPrompts({
    attacker,
    moveName: transaction.moveName,
    damaging: input.resolution.script.damaging,
    hitTargets,
    idFactory: stablePromptId('celebrate'),
  })
  if (celebrate.length > 0) candidates.push({ kind: 'celebrate', ownerPlacementId: attacker.id })

  for (const prompt of buildCuteCharmReactionPrompts({
    attacker,
    moveName: transaction.moveName,
    attackedTargets,
    idFactory: stablePromptId('cute-charm'),
  })) {
    candidates.push({ kind: 'cute-charm', ownerPlacementId: prompt.defenderId })
  }

  for (const prompt of buildPoisonPointReactionPrompts({
    attacker,
    moveName: transaction.moveName,
    hitTargets,
    script: input.resolution.script,
    idFactory: stablePromptId('poison-point'),
  })) {
    candidates.push({ kind: 'poison-point', ownerPlacementId: prompt.defenderId })
  }

  for (const prompt of buildSpiteReactionPrompts({
    attacker,
    moveName: transaction.moveName,
    hitTargets,
    moveEntriesForTarget: target => moveEntriesForPlacement(
      input.map.placements.find(placement => placement.id === target.id),
      sheets,
      { encounterEffects: input.map.encounterState?.effects ?? [] },
    ),
    idFactory: stablePromptId('spite'),
  })) {
    candidates.push({ kind: 'spite', ownerPlacementId: prompt.defenderId })
  }

  const seen = new Set<string>()
  return Object.freeze(candidates.filter((candidate) => {
    const key = `${candidate.kind}:${candidate.ownerPlacementId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }))
}

const responseWindow = (
  candidate: AbilityFollowUpCandidate,
  actorPlacementId: string,
  index: number,
  ancestryDepth: number,
): PendingMoveReactionResponseWindow => {
  const spec = abilityFollowUpSpecForKind(candidate.kind)
  const windowId = `ability-follow-up.${candidate.kind}.${index + 1}`
  return {
    windowId,
    operationId: `${windowId}.request`,
    kind: 'reaction',
    phase: 'cleanup',
    reasonCode: spec.reasonCode,
    promptKey: spec.promptKey,
    ownership: candidate.ownerPlacementId === actorPlacementId
      ? [{ kind: 'actor', id: null }]
      : [{ kind: 'placement', id: candidate.ownerPlacementId }],
    options: [{ id: spec.optionId, labelKey: spec.optionLabelKey }],
    allowPass: true,
    timing: 'cleanup',
    priority: spec.priority,
    depth: ancestryDepth,
  }
}

const initialTrace = (
  resolution: AuthoritativeMoveResolution,
  windows: readonly PendingMoveReactionResponseWindow[],
): MoveResolutionAuditTrace => {
  let trace = createMoveResolutionTrace({
    program: {
      canonicalId: resolution.canonicalMoveName,
      runtimeKind: 'ability-follow-ups',
      runtimeVersion: ABILITY_FOLLOW_UP_PROGRAM_VERSION,
      definitionHash: ABILITY_FOLLOW_UP_DEFINITION_HASH,
    },
    ruleset: {
      rulesetId: MOVE_RULESET_PROVENANCE.rulesetId,
      sourceDataSha256: MOVE_RULESET_PROVENANCE.sourceData.sha256,
    },
    ancestry: resolution.auditTrace.ancestry,
  })
  trace = reduceMoveResolutionTrace(trace, {
    kind: 'phase-transition',
    from: null,
    to: 'cleanup',
    reasonCode: 'ability-follow-ups-cleanup-phase',
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
        timing: window.timing,
        priority: window.priority,
        promptKey: window.promptKey,
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

const placementFor = (map: TabletopMap, placementId: string): SheetPlacement => (
  map.placements.find(placement => placement.id === placementId)
  ?? (() => { throw new Error(`Ability follow-up placement ${placementId} is missing.`) })()
)

const sheetRevision = (input: {
  readonly placement: SheetPlacement
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly sheetWrites: readonly AuthoritativeMoveSheetWritePlan[]
}): number => {
  const write = input.sheetWrites.find(candidate => (
    candidate.kind === input.placement.sheetKind
    && candidate.slug === input.placement.sheetSlug
  ))
  if (write) return write.revision
  const sheet = input.placement.sheetKind === 'pokemon'
    ? input.pokemonSheets.get(input.placement.sheetSlug)
    : input.trainerSheets.get(input.placement.sheetSlug)
  if (!sheet) throw new Error(`Ability follow-up sheet ${input.placement.sheetSlug} is missing.`)
  return normalizeRevision(sheet.revision)
}

const initialReadSet = (
  input: MaterializeAbilityFollowUpsInput,
  candidates: readonly AbilityFollowUpCandidate[],
): readonly PendingMoveResolutionResourceRead[] => {
  const reads = new Map<string, PendingMoveResolutionResourceRead>()
  reads.set(`map:${input.originMapSlug}`, {
    kind: 'map',
    slug: input.originMapSlug,
    revision: input.continuationMapRevision,
  })
  const placementIds = new Set([
    input.resolution.actorPlacementId,
    ...candidates.map(candidate => candidate.ownerPlacementId),
  ])
  for (const read of input.resolution.sheetReads) {
    const write = input.sheetWrites.find(candidate => (
      candidate.kind === read.kind && candidate.slug === read.slug
    ))
    reads.set(`sheet:${read.kind}:${read.slug}`, {
      kind: 'sheet',
      sheetKind: read.kind,
      slug: read.slug,
      revision: write?.revision ?? read.revision,
    })
  }
  for (const placementId of placementIds) {
    const placement = placementFor(input.map, placementId)
    reads.set(`sheet:${placement.sheetKind}:${placement.sheetSlug}`, {
      kind: 'sheet',
      sheetKind: placement.sheetKind,
      slug: placement.sheetSlug,
      revision: sheetRevision({
        placement,
        pokemonSheets: input.pokemonSheets,
        trainerSheets: input.trainerSheets,
        sheetWrites: input.sheetWrites,
      }),
    })
  }
  return [...reads.values()]
}

export const materializeAbilityFollowUps = (
  input: MaterializeAbilityFollowUpsInput,
): PendingMoveResolution | null => {
  const candidates = detectAbilityFollowUps(input)
  if (candidates.length === 0) return null
  const ancestryDepth = input.resolution.auditTrace.ancestry.length
  const windows = candidates.map((candidate, index) => responseWindow(
    candidate,
    input.resolution.actorPlacementId,
    index,
    ancestryDepth,
  ))
  const publicSummary: PendingMoveResolutionPublicSummary = {
    schemaVersion: PENDING_MOVE_RESOLUTION_SCHEMA_VERSION,
    resolutionId: input.resolutionId,
    actorPlacementId: input.resolution.actorPlacementId,
    canonicalMoveId: input.resolution.canonicalMoveName,
    phase: 'cleanup',
    status: 'pending',
    outstandingWindowCount: windows.length,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  }
  return parsePendingMoveResolution({
    schemaVersion: PENDING_MOVE_RESOLUTION_SCHEMA_VERSION,
    continuationKind: 'ability-follow-ups',
    resolutionId: input.resolutionId,
    originMapSlug: input.originMapSlug,
    originOpId: input.originOpId,
    actorPlacementId: input.resolution.actorPlacementId,
    canonicalMoveId: input.resolution.canonicalMoveName,
    specVersion: ABILITY_FOLLOW_UP_PROGRAM_VERSION,
    specHash: ABILITY_FOLLOW_UP_DEFINITION_HASH,
    rulesetId: MOVE_RULESET_PROVENANCE.rulesetId,
    rulesetHash: MOVE_RULESET_PROVENANCE.sourceData.sha256,
    phase: 'cleanup',
    readSet: initialReadSet(input, candidates),
    trace: initialTrace(input.resolution, windows),
    rollLedger: [],
    outstandingWindows: windows,
    chosenOptions: [],
    causalAncestry: input.resolution.auditTrace.ancestry,
    status: 'pending',
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    publicSummary,
  })
}

export const isAbilityFollowUpPendingResolution = (
  resolution: PendingMoveResolution,
): boolean => resolution.continuationKind === 'ability-follow-ups'

const emptyDynamicRecipients = () => ({
  attackedTargetIds: [] as string[],
  hitTargetIds: [] as string[],
  missedTargetIds: [] as string[],
  damagedTargetIds: [] as string[],
  faintedTargetIds: [] as string[],
})

const emittedOperations = (
  operations: readonly MoveEffectOperation[],
  actorPlacementId: string,
): readonly MoveSpecEmittedOperation[] => Object.freeze(operations.map(operation => Object.freeze({
  operation,
  recipientIds: operation.recipients.kind === 'actor' ? [actorPlacementId] : [],
})))

const traceSelectedResponse = (input: {
  readonly trace: MoveResolutionAuditTrace
  readonly window: PendingMoveResponseWindow
  readonly optionId: string | null
  readonly operations: readonly MoveSpecEmittedOperation[]
}): MoveResolutionAuditTrace => {
  let trace = reduceMoveResolutionTrace(input.trace, {
    kind: 'choice',
    phase: input.window.phase,
    requestId: input.window.windowId,
    requestKind: 'reaction',
    outcome: input.optionId === null ? 'passed' : 'selected',
    optionId: input.optionId,
    reasonCode: input.window.reasonCode,
  })
  for (const emission of input.operations) {
    trace = reduceMoveResolutionTrace(trace, {
      kind: 'operation',
      phase: emission.operation.phase,
      operationId: emission.operation.id,
      operationKind: emission.operation.kind,
      recipientIds: emission.recipientIds,
      outcome: 'applied',
      reasonCode: emission.operation.reasonCode,
      input: emission.operation.payload as never,
      result: { status: 'emitted' },
    })
  }
  return trace
}

const withoutPlanIdentity = (
  change: MoveStateChangePlan['changes'][number],
): MoveStateChangeInput => {
  const { id: _id, order: _order, ...input } = change
  return deepCloneJson(input) as MoveStateChangeInput
}

const pendingReadSetAfter = (input: {
  readonly pending: PendingMoveResolution
  readonly revision: number
  readonly sheetReads: readonly AuthoritativeMoveSheetRead[]
  readonly sheetWrites: readonly AuthoritativeMoveSheetWritePlan[]
}): readonly PendingMoveResolutionResourceRead[] => {
  const byKey = new Map<string, PendingMoveResolutionResourceRead>()
  byKey.set(`map:${input.pending.originMapSlug}`, {
    kind: 'map',
    slug: input.pending.originMapSlug,
    revision: input.revision,
  })
  for (const read of input.pending.readSet) {
    if (read.kind === 'map') continue
    const key = read.kind === 'sheet'
      ? `sheet:${read.sheetKind}:${read.slug}`
      : `group-inventory:${read.slug}`
    byKey.set(key, read)
  }
  for (const read of input.sheetReads) {
    const write = input.sheetWrites.find(candidate => (
      candidate.kind === read.kind && candidate.slug === read.slug
    ))
    byKey.set(`sheet:${read.kind}:${read.slug}`, {
      kind: 'sheet',
      sheetKind: read.kind,
      slug: read.slug,
      revision: write?.revision ?? read.revision,
    })
  }
  return [...byKey.values()]
}

/**
 * Plan one authorized ability follow-up response. The client contributes only
 * the already-validated option ID; this boundary obtains typed effects from the
 * reviewed registry and returns one CAS-ready map/sheet plan.
 */
export const planAbilityFollowUpResponse = (input: {
  readonly pendingResolution: PendingMoveResolution
  readonly responseOpId: string
  readonly responseWindowId: string
  readonly responseOptionId: string | null
  readonly chosenBy: PendingMoveResponseOwner
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly plannedAt: number
  readonly maxMoveLogEntries?: number
}): AbilityFollowUpResponsePlan => {
  const pending = input.pendingResolution
  if (!isAbilityFollowUpPendingResolution(pending)) {
    throw new Error('A MoveSpec continuation cannot use the ability follow-up planner.')
  }
  const window = activePendingMoveResponseWindows(pending).find(candidate => (
    candidate.windowId === input.responseWindowId
  )) ?? (() => { throw new Error('The ability follow-up window is not the current reviewed priority.') })()
  const context = buildAuthoritativeMoveRulesContext({
    map: input.map,
    pokemonSheets: input.pokemonSheets,
    trainerSheets: input.trainerSheets,
    intent: {
      schemaVersion: 1,
      placementId: pending.actorPlacementId,
      moveName: pending.canonicalMoveId,
      selection: { kind: 'self' },
    },
    selectedPlacementIds: [],
    random: () => { throw new Error('Ability follow-up effects cannot draw randomness.') },
    time: input.plannedAt,
  })
  context.reads.recordPlacement(context.actor.placement)
  const operations = input.responseOptionId === null
    ? []
    : buildAbilityFollowUpEffectOperations({
        window,
        optionId: input.responseOptionId,
        canonicalMoveId: pending.canonicalMoveId,
        context,
      })
  const emissions = emittedOperations(operations, pending.actorPlacementId)
  let trace = traceSelectedResponse({
    trace: pending.trace,
    window,
    optionId: input.responseOptionId,
    operations: emissions,
  })

  const coreOperations = emissions.filter(isMoveCoreTokenEffectEmission)
  const core = reduceMoveCoreTokenEffects({
    context,
    operations: coreOperations,
    dynamicRecipients: emptyDynamicRecipients(),
    immunities: createStandardMoveCoreTokenEffectImmunityQueries({
      moveType: null,
      context,
    }),
    trace,
  })
  trace = core.trace

  const mapOperations = emissions.filter(isMoveMapOperationEmission)
  const mapReduction = mapOperations.length > 0
    ? reduceMoveMapOperations({
        context,
        operations: mapOperations,
        dynamicRecipients: emptyDynamicRecipients(),
        usageResources: [],
        presentation: {
          operationId: input.responseOpId,
          move: {
            name: abilityFollowUpSpecForWindow(window)?.displayName
              ?? (() => { throw new Error('Ability follow-up window definition is unavailable.') })(),
            type: 'Typeless',
          },
          selectedTargetIds: [],
        },
        frequency: null,
        trace,
        maxLogEntries: input.maxMoveLogEntries,
      })
    : null
  if (mapReduction) trace = mapReduction.trace

  const previousRevision = normalizeRevision(input.map.revision)
  const revision = nextRevision(previousRevision)
  const mapAfterLog = mapReduction?.nextMap ?? {
    ...deepCloneJson(input.map),
    revision,
    updatedAt: input.plannedAt,
  }
  if (normalizeRevision(mapAfterLog.revision) !== revision) {
    throw new Error('Ability follow-up response must advance the map exactly once.')
  }
  const mapAfterCore = applyNativeCoreMapChanges(mapAfterLog, core.stateChanges)
  const preliminaryInputs = [
    ...(mapReduction?.stateChanges.changes ?? [])
      .filter(change => change.kind !== 'encounter-state')
      .map(withoutPlanIdentity),
    ...core.stateChanges.changes
      .filter(change => change.kind !== 'encounter-state')
      .map(withoutPlanIdentity),
  ]
  const preliminaryPlan = createMoveStateChangePlan(preliminaryInputs)
  const sheetReads = deduplicateAuthoritativeMoveSheetReads([
    ...pending.readSet.flatMap(read => read.kind === 'sheet'
      ? [{ kind: read.sheetKind, slug: read.slug, revision: read.revision }]
      : []),
    ...context.reads.snapshot(),
    ...core.sheetReads,
    ...(mapReduction?.sheetReads ?? []),
  ])
  const sheetWrites = nativeSheetWritesFromStateChanges(
    input.map,
    {
      actorPlacementId: pending.actorPlacementId,
      selectedTargetIds: [],
    },
    preliminaryPlan,
  )
  const remainingWindows = pending.outstandingWindows.filter(candidate => (
    candidate.windowId !== window.windowId
  ))
  const status = remainingWindows.length > 0 ? 'pending' as const : 'committed' as const
  const readSet = pendingReadSetAfter({
    pending,
    revision,
    sheetReads,
    sheetWrites,
  })
  const publicSummary: PendingMoveResolutionPublicSummary = {
    ...pending.publicSummary,
    phase: 'cleanup',
    status,
    outstandingWindowCount: remainingWindows.length,
    updatedAt: input.plannedAt,
  }
  const nextPending = parsePendingMoveResolution({
    ...pending,
    phase: 'cleanup',
    readSet,
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

  const previousEncounterState = parseEncounterState(
    input.map.encounterState ?? createEmptyEncounterState(),
  )
  const coreEncounterState = parseEncounterState(
    mapAfterCore.encounterState ?? createEmptyEncounterState(),
  )
  const currentEncounterState = parseEncounterState({
    ...coreEncounterState,
    pendingResolutionSummaries: [
      ...coreEncounterState.pendingResolutionSummaries.filter(summary => (
        summary.resolutionId !== pending.resolutionId
      )),
      ...(status === 'pending' ? [nextPending.publicSummary] : []),
    ],
  })
  const nextMap: TabletopMap = {
    ...deepCloneJson(mapAfterCore),
    encounterState: currentEncounterState,
    revision,
    updatedAt: input.plannedAt,
  }
  const stateChanges = createMoveStateChangePlan([
    ...preliminaryInputs,
    {
      kind: 'encounter-state',
      scope: { kind: 'encounter', mapSlug: input.map.slug },
      expectedRevision: previousRevision,
      sourceOperationId: window.operationId,
      reasonCode: status === 'pending'
        ? 'ability-follow-up-response-recorded'
        : 'ability-follow-ups-completed',
      previous: deepCloneJson(previousEncounterState),
      current: deepCloneJson(currentEncounterState),
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    },
  ])

  return {
    previousMap: deepCloneJson(input.map),
    nextMap: deepCloneJson(nextMap),
    previousRevision,
    revision,
    sheetReads: deepCloneJson(sheetReads),
    sheetWrites: deepCloneJson(sheetWrites),
    mapChanges: buildAuthoritativeMoveMapChanges(input.map, nextMap),
    stateChanges,
    trace,
    pendingResolution: nextPending,
  }
}
