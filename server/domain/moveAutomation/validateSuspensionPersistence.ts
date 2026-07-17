import {
  createEmptyEncounterState,
  parseEncounterState,
} from '#shared/moveAutomation/encounterState'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { SheetKind, TabletopMap } from '~/types/map'
import { sameJsonValue } from '~/utils/serialization'
import type { AuthoritativePendingMoveStatePlan } from '../planAuthoritativeMoveState'
import { buildAuthoritativeMoveMapChanges } from './mapChanges'
import {
  applyNativeCoreMapChanges,
  nativeSheetWritesFromStateChanges,
} from './planNativeV2MoveState'

export class PendingMovePersistencePlanError extends Error {
  readonly code = 'invalid-suspension-persistence-plan' as const
  readonly detail: string

  constructor(detail: string) {
    super(`Invalid suspended move persistence plan: ${detail}`)
    this.name = 'PendingMovePersistencePlanError'
    this.detail = detail
  }
}

export interface ValidatePendingMovePersistencePlanInput {
  readonly originMapSlug: string
  readonly originOpId: string
  readonly currentRevision: number
  readonly plan: AuthoritativePendingMoveStatePlan
}

const fail = (detail: string): never => {
  throw new PendingMovePersistencePlanError(detail)
}

const sheetReadKey = (input: {
  readonly kind: SheetKind
  readonly slug: string
}): string => `${input.kind}:${input.slug}`

/**
 * Re-derive the exact persistence envelope from a materialized suspension.
 * This is the final fail-closed boundary preventing deferred operations or a
 * malformed planner projection from entering the declaration transaction.
 */
export const validatePendingMovePersistencePlan = (
  input: ValidatePendingMovePersistencePlanInput,
): void => {
  const { originMapSlug, originOpId, currentRevision, plan } = input
  const { pendingResolution, preWindowPlan, publicSummary } = plan.suspension

  if (
    plan.previousRevision !== currentRevision
    || normalizeRevision(plan.previousMap.revision) !== currentRevision
    || plan.revision !== nextRevision(currentRevision)
  ) {
    fail('map revisions are inconsistent.')
  }
  if (
    plan.previousMap.slug !== originMapSlug
    || plan.nextMap.slug !== originMapSlug
    || pendingResolution.originMapSlug !== originMapSlug
    || pendingResolution.originOpId !== originOpId
  ) {
    fail('origin identity does not match the declaration.')
  }
  if (!sameJsonValue(publicSummary, pendingResolution.publicSummary)) {
    fail('public summary diverges from the private record.')
  }

  const mapReads = pendingResolution.readSet.filter(read => read.kind === 'map')
  if (
    mapReads.length !== 1
    || mapReads[0]?.slug !== originMapSlug
    || mapReads[0]?.revision !== plan.revision
  ) {
    fail('continuation map read is inconsistent.')
  }

  const expectedSheetWrites = nativeSheetWritesFromStateChanges(
    plan.previousMap,
    plan.execution,
    preWindowPlan,
  )
  if (!sameJsonValue(expectedSheetWrites, plan.sheetWrites)) {
    fail('sheet writes exceed the approved pre-window plan.')
  }

  const writesBySheet = new Map(
    expectedSheetWrites.map(write => [sheetReadKey(write), write]),
  )
  const expectedCommitReads = new Map<string, number>()
  for (const read of pendingResolution.readSet) {
    if (read.kind !== 'sheet') continue
    const key = `${read.sheetKind}:${read.slug}`
    const write = writesBySheet.get(key)
    if (write && read.revision !== write.revision) {
      fail(`continuation read ${key} does not match its committed revision.`)
    }
    expectedCommitReads.set(key, write?.expectedRevision ?? read.revision)
  }
  for (const write of expectedSheetWrites) {
    if (expectedCommitReads.get(sheetReadKey(write)) !== write.expectedRevision) {
      fail(`pre-window write ${sheetReadKey(write)} is missing its authoritative read.`)
    }
  }
  if (expectedCommitReads.size !== plan.sheetReads.length) {
    fail('full consulted sheet read set was not retained.')
  }
  for (const read of plan.sheetReads) {
    if (expectedCommitReads.get(sheetReadKey(read)) !== read.revision) {
      fail(`consulted sheet ${sheetReadKey(read)} has an inconsistent commit revision.`)
    }
  }

  const expectedGroupInventoryReads = new Map(
    pendingResolution.readSet.flatMap(read => (
      read.kind === 'group-inventory' ? [[read.slug, read.revision] as const] : []
    )),
  )
  if (expectedGroupInventoryReads.size !== plan.groupInventoryReads.length) {
    fail('full consulted group inventory read set was not retained.')
  }
  for (const read of plan.groupInventoryReads) {
    if (expectedGroupInventoryReads.get(read.slug) !== read.revision) {
      fail(`consulted group inventory ${read.slug} has an inconsistent commit revision.`)
    }
  }

  const mapAfterPreWindowPlan = applyNativeCoreMapChanges(
    plan.previousMap,
    preWindowPlan,
  )
  const encounterAfterPreWindowPlan = parseEncounterState(
    mapAfterPreWindowPlan.encounterState ?? createEmptyEncounterState(),
  )
  if (encounterAfterPreWindowPlan.pendingResolutionSummaries.some(
    summary => summary.resolutionId === publicSummary.resolutionId,
  )) {
    fail('public summary identity already exists.')
  }
  const expectedEncounterState = parseEncounterState({
    ...encounterAfterPreWindowPlan,
    pendingResolutionSummaries: [
      ...encounterAfterPreWindowPlan.pendingResolutionSummaries,
      publicSummary,
    ],
  })
  const expectedNextMap: TabletopMap = {
    ...mapAfterPreWindowPlan,
    encounterState: expectedEncounterState,
    revision: plan.revision,
    updatedAt: pendingResolution.createdAt,
  }
  if (!sameJsonValue(expectedNextMap, plan.nextMap)) {
    fail('next map contains state outside the approved pre-window plan and public summary.')
  }
  const expectedMapChanges = buildAuthoritativeMoveMapChanges(
    plan.previousMap,
    expectedNextMap,
  )
  if (!sameJsonValue(expectedMapChanges, plan.mapChanges)) {
    fail('map change summary diverges from the approved declaration map.')
  }
}
