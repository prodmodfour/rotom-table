import { randomInt as secureRandomInt } from 'node:crypto'
import type { AuthRole } from '#shared/auth'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { PlayerProfile } from '#shared/playerProfiles'
import { parseResumeItemOperationCommand, type ResumeItemOperationCommandV1 } from '#shared/itemAutomation/resume'
import {
  parseUseItemCommand,
  type ItemOperationResultV1,
  type ItemPendingDecisionV1,
} from '#shared/itemAutomation/operations'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import { normalizeRevision, nextRevision } from '#shared/sessionRevisions'
import { toPersistableSheetPayload } from '~/utils/sheetMutations'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteMapRepository } from '../storage/mapRepository'
import { createSqliteSheetRepository, type PersistedSheet } from '../storage/sheetRepository'
import { createSqliteGroupInventoryRepository } from '../storage/groupInventoryRepository'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import {
  createSqliteItemOperationRepository,
  itemOperationResumeCommandSha256,
  type ItemOperationCompensationV1,
  type StoredItemOperationRecord,
} from '../storage/itemOperationRepository'
import { createSqliteRealtimeEventRepository } from '../storage/realtimeEventRepository'
import { buildAuthoritativeItemExecutionContext, AuthoritativeItemExecutionContextError } from '../domain/itemAutomation/executionContext'
import { deriveAuthoritativeItemEligibility } from '../domain/itemAutomation/eligibility'
import { commandFromItemPendingDecision } from '../domain/itemAutomation/pending'
import { planDeterministicItemOperation } from '../domain/itemAutomation/planner'
import { reduceItemOperationPlan } from '../domain/itemAutomation/reducer'
import { assertItemRuntimePlanConformance } from '../domain/itemAutomation/conformance'
import { assertPlannedItemApDrainsCurrent } from '../domain/itemAutomation/ap'
import { playerProfileCanControlTokenSheet } from '#shared/playerProfileTokenControl'
import {
  itemOperationMapUpdatedRealtimeAppendInputs,
  itemOperationPresentationInvalidatedRealtimeAppendInput,
  itemOperationSheetUpdatedRealtimeAppendInputs,
} from '../realtime/itemOperationRealtime'
import { groupInventoryUpdatedRealtimeAppendInputs } from '../realtime/groupInventoryRealtime'
import {
  defaultPersistedRealtimeEventPublisher,
  defaultPersistedRealtimePublicationFailureReporter,
  publishPersistedRealtimeEventsAfterCommit,
  type PersistedRealtimeEventPublisher,
} from '../realtime/persistedBatchPublication'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import { toPersistedMap } from './saveMap'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { authorizeGroupInventoryItemUseActor } from '../policies/groupInventoryItemUsePolicy'

export class ResumeItemOperationUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface ResumeItemOperationInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly command: unknown
  readonly clientId?: string
}

export interface ResumeItemOperationDependencies {
  readonly database?: RotomDatabase
  readonly now?: () => number
  /** Test seam for server-owned rolled healing; maximum is exclusive. */
  readonly randomInt?: (minimum: number, maximumExclusive: number) => number
  readonly publishPersistedRealtimeEvent?: PersistedRealtimeEventPublisher
  readonly failAfterWrite?: (boundary: 'operation-resume' | 'map' | 'sheet' | 'group-inventory' | 'operation' | 'realtime') => void
}

const fail = (statusCode: 400 | 403 | 404 | 409, message: string): never => {
  throw new ResumeItemOperationUseCaseError(statusCode, message)
}

const replayStoredResume = (
  stored: StoredItemOperationRecord,
  resume: ResumeItemOperationCommandV1,
): ItemOperationResultV1 | null => {
  if (!stored.resumeCommand) return null
  if (stored.resumeCommandSha256 !== itemOperationResumeCommandSha256(resume)
    || stableJsonStringify(stored.resumeCommand) !== stableJsonStringify(resume)) {
    fail(409, 'This item operation was already resumed with different choices.')
  }
  const result: ItemOperationResultV1 = stored.result
    ?? fail(409, 'This resumed item operation is pending explicit recovery.')
  return Object.freeze({ ...result, exactReplay: true })
}

/** Resume only the exact original journal row; no rolls, costs, or authority are regenerated. */
export const resumeItemOperationUseCase = (
  input: ResumeItemOperationInput,
  dependencies: ResumeItemOperationDependencies = {},
): {
  readonly result: ItemOperationResultV1
  readonly map?: TabletopMap
  readonly sheets: readonly PersistedSheet[]
  readonly groupInventory?: GroupInventoryDocument
} => {
  let resume
  try { resume = parseResumeItemOperationCommand(input.command) }
  catch { return fail(400, 'Invalid item pending-decision resume command.') }
  const database = dependencies.database ?? getRotomDatabase()
  const operations = createSqliteItemOperationRepository({ database })
  const stored = operations.get(resume.operationId) ?? fail(404, 'The item operation was not found.')
  if (input.role !== 'gm' && !playerProfileCanControlTokenSheet(
    input.playerProfile, stored.command.actorSheet.kind, stored.command.actorSheet.slug,
  )) fail(403, 'The selected player profile does not control the item actor.')
  const groupInventoryUseAuthorized = stored.command.source.kind === 'group'
    && stored.command.context === 'sheet'
    && stored.command.actorSheet.kind === 'trainer'
    && authorizeGroupInventoryItemUseActor({
      role: input.role,
      playerProfile: input.playerProfile,
      trainerSlug: stored.command.actorSheet.slug,
    }).ok
  if (stored.command.source.kind === 'group' && input.role !== 'gm' && !groupInventoryUseAuthorized) {
    fail(403, 'Current shared-inventory actor delegation is required to resume this item use.')
  }
  const pendingDecision: ItemPendingDecisionV1 = stored.pendingDecision
    ?? fail(409, 'The item decision is no longer pending.')
  if (pendingDecision.decisionId !== resume.decisionId) fail(409, 'The item decision is no longer pending.')
  if (pendingDecision.choices.some(choice => choice.privateTo === 'gm') && input.role !== 'gm') {
    fail(403, 'GM authorization is required for this private item decision.')
  }
  const storedReplay = replayStoredResume(stored, resume)
  if (storedReplay) return { result: storedReplay, sheets: [] }
  if (stored.status !== 'pending') fail(409, 'The item decision is no longer pending.')
  let resumedCommand
  try {
    resumedCommand = commandFromItemPendingDecision({
      command: stored.command,
      decision: pendingDecision,
      choices: resume.choices,
    })
  }
  catch (error) { return fail(409, error instanceof Error ? error.message : 'The item decision is invalid.') }

  const maps = createSqliteMapRepository<TabletopMap>(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const groups = createSqliteGroupInventoryRepository(database)
  const campaignClockRepository = createSqliteCampaignClockRepository(database)
  const realtime = createSqliteRealtimeEventRepository({ database })
  const mapRef = resumedCommand.readSet.find(ref => ref.kind === 'map')
  const mapStored = mapRef ? maps.get(mapRef.id) : null
  const map = mapStored?.document ?? null
  const persistedSheets = resumedCommand.readSet.flatMap(ref => ref.kind === 'sheet'
    ? [sheets.getByRef(ref.sheetKind, ref.id) ?? fail(404, `Item operation sheet ${ref.sheetKind}/${ref.id} was not found.`)]
    : [])
  const group = resumedCommand.source.kind === 'group' ? groups.get(resumedCommand.source.slug)?.document ?? null : null
  // A pending shared reservation is row-scoped, not a global inventory lock.
  // Rebase only the exact group aggregate revision; the authoritative context
  // below still resolves the same row, canonical definition, reserved quantity,
  // actor, targets, and every other original read before settlement.
  if (resumedCommand.source.kind === 'group' && group
    && group.revision !== resumedCommand.source.expectedRevision) {
    const groupRefs = resumedCommand.readSet.filter(ref => ref.kind === 'group-inventory')
    if (groupRefs.length !== 1 || groupRefs[0]?.id !== resumedCommand.source.slug) {
      fail(409, 'Pending shared item use lost its exact group read authority.')
    }
    try {
      resumedCommand = parseUseItemCommand({
        ...resumedCommand,
        source: { ...resumedCommand.source, expectedRevision: group.revision },
        readSet: resumedCommand.readSet.map(ref => ref.kind === 'group-inventory'
          ? { ...ref, revision: group.revision }
          : ref),
      })
    }
    catch {
      fail(409, 'Pending shared item use could not rebase its exact group reservation safely.')
    }
  }
  const campaignClock = resumedCommand.readSet.some(ref => ref.kind === 'campaign-clock')
    ? campaignClockRepository.get()
    : null
  const planningTimestamp = (dependencies.now ?? Date.now)()
  const storedExtendedAction = stored.plan?.nonEncounterContext?.extendedAction
  const extendedAction = storedExtendedAction?.mode === 'extended' && storedExtendedAction.phase === 'completion'
    ? {
        phase: 'completion' as const,
        activityId: storedExtendedAction.activityId
          ?? fail(409, 'Pending item operation Extended Action authority is incomplete.'),
        activityRevision: storedExtendedAction.activityRevision
          ?? fail(409, 'Pending item operation Extended Action authority is incomplete.'),
        startedAtCampaignMinute: storedExtendedAction.startedAtCampaignMinute
          ?? fail(409, 'Pending item operation Extended Action authority is incomplete.'),
      }
    : null
  let context
  try {
    context = buildAuthoritativeItemExecutionContext({
      role: input.role,
      playerProfile: input.playerProfile,
      command: resumedCommand,
      map,
      mapRevision: mapStored?.revision ?? null,
      authorityTimestamp: planningTimestamp,
      persistedSheets,
      groupInventory: group,
      campaignClock,
      groupInventoryUseAuthorized,
      reservedSourceQuantity: operations.reservedQuantity(resumedCommand.sourceInstanceId, resumedCommand.operationId),
      extendedAction,
    })
  }
  catch (error) {
    if (error instanceof AuthoritativeItemExecutionContextError) return fail(error.code === 'not-authorized' ? 403 : 409, error.message)
    throw error
  }
  if (stored.canonicalItemId !== context.sourceDefinition.canonicalId
    || stored.canonicalDefinitionSha256 !== context.sourceDefinition.definitionSha256) {
    fail(409, 'The reviewed item definition changed while this item reservation was pending.')
  }
  if (input.role !== 'gm' && pendingDecision.choices.some(choice => choice.privateTo === 'responder-owner')) {
    const responderTargets = context.targets
    if (responderTargets.length === 0 || responderTargets.some(target => !playerProfileCanControlTokenSheet(
      input.playerProfile,
      target.sheet.kind,
      target.sheet.slug,
    ))) {
      fail(403, 'The selected player profile does not control every private item responder.')
    }
  }
  const eligibility = deriveAuthoritativeItemEligibility(context)
  if (!eligibility.available) fail(409, eligibility.reasons[0]?.label ?? 'The item decision is stale.')
  const plan = planDeterministicItemOperation({
    command: resumedCommand,
    definition: context.sourceDefinition,
    source: context.source,
    targets: eligibility.selectedTargets.map(target => ({
      participantId: target.participantId,
      sheetKind: target.sheet.kind,
      sheetSlug: target.sheet.slug,
      revision: target.sheet.revision,
      sheet: target.sheet.sheet,
    })),
    actorSheet: context.actorSheet.sheet,
    map: context.map,
    campaignMinute: context.campaignClock?.campaignMinute,
    operationTimestamp: planningTimestamp,
    nonEncounterContext: context.nonEncounter,
    rollHealingDie: sides => (dependencies.randomInt ?? secureRandomInt)(1, sides + 1),
  })
  const sourceSheets = new Map(persistedSheets.map(value => [`${value.kind}:${value.slug}`, value.sheet as unknown as CharacterSheet | TrainerSheet]))
  const reduced = reduceItemOperationPlan({ plan, map, sheets: sourceSheets, groupInventory: group })
  const now = dependencies.now ?? Date.now
  const assertCurrentReadSetAtCommit = (): void => {
    for (const ref of resumedCommand.readSet) {
      if (ref.kind === 'map' || ref.kind === 'encounter') {
        if (maps.get(ref.id)?.revision !== ref.revision) fail(409, 'The encounter changed before item resume commit.')
      }
      else if (ref.kind === 'sheet') {
        if (sheets.getByRef(ref.sheetKind, ref.id)?.revision !== ref.revision) fail(409, `Item sheet ${ref.sheetKind}/${ref.id} changed before resume commit.`)
      }
      else if (ref.kind === 'group-inventory') {
        if (groups.get(ref.id)?.revision !== ref.revision) fail(409, 'Group inventory changed before item resume commit.')
      }
      else if (ref.kind === 'campaign-clock') {
        if (campaignClockRepository.get().revision !== ref.revision) fail(409, 'The campaign clock changed before item resume commit.')
      }
      else fail(409, `Item resume aggregate ${ref.kind} cannot be revision-checked at commit.`)
    }
  }
  const events: PersistedRealtimeEvent[] = []
  const acceptedSheets: PersistedSheet[] = []
  let acceptedMap: TabletopMap | undefined
  let acceptedGroup: GroupInventoryDocument | undefined
  const result = database.withTransaction((): ItemOperationResultV1 => {
    const concurrent = operations.get(stored.operationId) ?? fail(404, 'The item operation disappeared before resume commit.')
    const concurrentReplay = replayStoredResume(concurrent, resume)
    if (concurrentReplay) return concurrentReplay
    assertCurrentReadSetAtCommit()
    const committedAt = now()
    try {
      assertPlannedItemApDrainsCurrent({ plan, sheets: sourceSheets, now: committedAt })
    }
    catch { fail(409, 'The item actor AP changed before item resume commit.') }
    const compensation: ItemOperationCompensationV1 = {
      schemaVersion: 1,
      map: reduced.mapChanged && reduced.map && mapStored ? {
        slug: mapStored.slug,
        beforeRevision: mapStored.revision,
        afterRevision: nextRevision(mapStored.revision),
        beforeMap: structuredClone(mapStored.document) as unknown as Record<string, unknown>,
        afterMap: structuredClone({
          ...toPersistedMap(
            reduced.map,
            reduced.map.folder ?? '',
            committedAt,
            { revision: nextRevision(mapStored.revision) },
          ),
          shopInterfaces: reduced.map.shopInterfaces ?? [],
        }) as unknown as Record<string, unknown>,
      } : null,
      sheets: reduced.changedSheetKeys.map(key => {
        const [kind, slug] = key.split(':') as ['pokemon' | 'trainer', string]
        const before = persistedSheets.find(value => value.kind === kind && value.slug === slug)
          ?? fail(404, `Item sheet ${key} disappeared.`)
        const after = reduced.sheets.get(key) ?? fail(409, `Item reduction omitted ${key}.`)
        return {
          kind, slug, beforeRevision: before.revision, afterRevision: nextRevision(before.revision),
          beforeSheet: structuredClone(before.sheet),
          afterSheet: structuredClone({
            ...toPersistableSheetPayload({
              ...after,
              revision: nextRevision(before.revision),
              updatedAt: committedAt,
            }),
            folder: before.sheet.folder ?? '',
          }),
        }
      }),
      groupInventory: reduced.groupInventoryChanged && reduced.groupInventory && group ? {
        slug: group.slug,
        beforeRevision: group.revision,
        afterRevision: nextRevision(group.revision),
        beforeDocument: structuredClone(group) as unknown as Record<string, unknown>,
        afterDocument: structuredClone({
          ...reduced.groupInventory,
          revision: nextRevision(group.revision),
          updatedAt: committedAt,
        }) as unknown as Record<string, unknown>,
      } : null,
    }
    assertItemRuntimePlanConformance({
      definition: context.sourceDefinition,
      plan,
      compensation,
      command: resumedCommand,
    })
    const replaced = operations.replacePendingCommand({
      operationId: stored.operationId,
      expectedCommandSha256: stored.commandSha256,
      command: resumedCommand,
      resumeCommand: resume,
      plan,
      compensation,
      updatedAt: committedAt,
    })
    dependencies.failAfterWrite?.('operation-resume')
    if (reduced.mapChanged && reduced.map && mapStored) {
      const nextMap = toPersistedMap(reduced.map, reduced.map.folder ?? '', committedAt, { revision: nextRevision(mapStored.revision) })
      if (maps.applyLivePlayUpdate({ slug: mapStored.slug, expectedRevision: mapStored.revision, nextMap }) === 'stale') fail(409, 'The encounter changed before item resume could commit.')
      acceptedMap = maps.get(mapStored.slug)?.document ?? fail(404, 'The accepted encounter map disappeared.')
      dependencies.failAfterWrite?.('map')
    }
    for (const key of reduced.changedSheetKeys) {
      const [kind, slug] = key.split(':') as ['pokemon' | 'trainer', string]
      const before = persistedSheets.find(value => value.kind === kind && value.slug === slug) ?? fail(404, `Item sheet ${key} disappeared.`)
      const after = reduced.sheets.get(key) ?? fail(409, `Item reduction omitted ${key}.`)
      if (sheets.applyLivePlayUpdate({
        kind, slug, expectedRevision: before.revision,
        nextSheet: toPersistableSheetPayload({ ...after, updatedAt: committedAt }),
        sourceOperationId: resumedCommand.operationId,
      }) === 'stale') fail(409, `Item sheet ${key} changed during resume.`)
      acceptedSheets.push(sheets.getByRef(kind, slug)!)
      dependencies.failAfterWrite?.('sheet')
    }
    if (reduced.groupInventoryChanged && reduced.groupInventory && group) {
      const update = groups.applyLivePlayUpdate({
        slug: group.slug,
        expectedRevision: group.revision,
        nextDocument: { ...reduced.groupInventory, updatedAt: committedAt },
        now: committedAt,
      })
      if (update.status === 'applied') acceptedGroup = update.document
      else fail(409, 'Group inventory changed during item resume.')
      dependencies.failAfterWrite?.('group-inventory')
    }
    const aggregateRefs = plan.readSet.map(ref => {
      if ((ref.kind === 'map' || ref.kind === 'encounter') && acceptedMap) return { ...ref, revision: normalizeRevision(acceptedMap.revision) }
      if (ref.kind === 'sheet') {
        const sheet = acceptedSheets.find(value => value.kind === ref.sheetKind && value.slug === ref.id)
        return sheet ? { ...ref, revision: sheet.revision } : ref
      }
      if (ref.kind === 'group-inventory' && acceptedGroup) return { ...ref, revision: acceptedGroup.revision }
      return ref
    })
    const accepted: ItemOperationResultV1 = {
      schemaVersion: 1,
      operationId: resumedCommand.operationId,
      status: 'accepted',
      canonicalItemId: context.sourceDefinition.canonicalId,
      aggregateRefs,
      receiptId: `item-receipt:${resumedCommand.operationId}`,
      exactReplay: false,
    }
    operations.complete({ operationId: stored.operationId, commandSha256: replaced.commandSha256, status: 'accepted', result: accepted, updatedAt: committedAt })
    dependencies.failAfterWrite?.('operation')
    events.push(...realtime.appendMany([
      ...(acceptedMap ? itemOperationMapUpdatedRealtimeAppendInputs({ operationId: resumedCommand.operationId, map: acceptedMap, clientId: input.clientId }) : []),
      ...acceptedSheets.flatMap(sheet => itemOperationSheetUpdatedRealtimeAppendInputs({ operationId: resumedCommand.operationId, sheet, clientId: input.clientId })),
      ...(acceptedGroup ? groupInventoryUpdatedRealtimeAppendInputs(acceptedGroup, input.clientId, 'item-operation') : []),
      ...(!acceptedMap && map ? [itemOperationPresentationInvalidatedRealtimeAppendInput({
        operationId: resumedCommand.operationId,
        mapSlug: map.slug,
        mapRevision: mapStored?.revision ?? normalizeRevision(map.revision),
        clientId: input.clientId,
      })] : []),
    ]))
    dependencies.failAfterWrite?.('realtime')
    return accepted
  })
  publishPersistedRealtimeEventsAfterCommit({
    events,
    operation: `resume-item-operation:${resume.operationId}`,
    publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
    reportFailure: defaultPersistedRealtimePublicationFailureReporter,
  })
  return {
    result,
    ...(acceptedMap ? { map: acceptedMap } : {}),
    sheets: acceptedSheets,
    ...(acceptedGroup ? { groupInventory: acceptedGroup } : {}),
  }
}
