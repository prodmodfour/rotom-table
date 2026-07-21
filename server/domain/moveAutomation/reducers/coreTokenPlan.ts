import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { EncounterState } from '#shared/moveAutomation/encounterState'
import type { CombatStageMap } from '~/types/combatStages'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type {
  MoveAutomationCombatStageUpdate,
  MoveAutomationConditionUpdate,
  MoveAutomationHpUpdate,
} from '~/types/moveAutomation'
import {
  mapWithTemporaryHpForPlacement,
  normalizeTemporaryHpAmount,
} from '~/utils/mapTemporaryHitPoints'
import { normalizeCombatStages } from '~/utils/combatStages'
import { normalizeConditionNames } from '~/utils/statusConditions'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import { sheetConditionNames } from '~/utils/sheetConditions'
import {
  applyCombatStagesToSheet,
  applyConditionsToSheet,
  applyHpToSheet,
  type AnyLiveSheet,
} from '~/utils/sheetMutations'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  createMoveStateChangePlan,
  unavailableMoveStateCompensation,
  type MoveSheetDocument,
  type MoveSheetStateField,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../plan'
import type { AuthoritativeMoveRulesContext } from '../context'
import { failMoveCoreTokenEffectReduction } from './coreTokenEffectError'
import type {
  MoveCoreTokenChangedField,
  MoveCoreTokenEffectOperation,
  MoveCoreTokenEffectRecipient,
  MoveCoreTokenEffectRecipientResult,
} from './coreTokenEffectTypes'

export interface MoveCoreTokenEffectTouch {
  readonly operationOrder: number
  readonly operationId: string
  readonly reasonCode: string
}

export type MoveCoreTokenEffectTouches = Map<
  string,
  Map<MoveCoreTokenChangedField, MoveCoreTokenEffectTouch[]>
>

export const recordMoveCoreTokenEffectTouches = (
  touches: MoveCoreTokenEffectTouches,
  result: MoveCoreTokenEffectRecipientResult,
  operation: Pick<MoveCoreTokenEffectOperation, 'id' | 'reasonCode'>,
  operationOrder: number,
): void => {
  if (result.outcome !== 'applied') return
  const byField = touches.get(result.recipientId) ?? new Map()
  touches.set(result.recipientId, byField)
  for (const field of result.changedFields) {
    const entries = byField.get(field) ?? []
    entries.push({
      operationOrder,
      operationId: operation.id,
      reasonCode: operation.reasonCode,
    })
    byField.set(field, entries)
  }
}

const touchesForField = (
  touches: MoveCoreTokenEffectTouches,
  placementId: string,
  field: MoveCoreTokenChangedField,
): readonly MoveCoreTokenEffectTouch[] => touches.get(placementId)?.get(field) ?? []

const firstTouchOrder = (touches: readonly MoveCoreTokenEffectTouch[]): number => (
  touches.reduce(
    (minimum, touch) => Math.min(minimum, touch.operationOrder),
    Number.MAX_SAFE_INTEGER,
  )
)

const uniqueTouches = (
  touches: readonly MoveCoreTokenEffectTouch[],
): readonly MoveCoreTokenEffectTouch[] => {
  const seen = new Set<string>()
  return touches.filter((touch) => {
    if (seen.has(touch.operationId)) return false
    seen.add(touch.operationId)
    return true
  })
}

const provenance = (
  touches: readonly MoveCoreTokenEffectTouch[],
): { readonly sourceOperationId: string | null; readonly reasonCode: string } => {
  const unique = uniqueTouches(touches)
  return unique.length === 1
    ? {
        sourceOperationId: unique[0]!.operationId,
        reasonCode: unique[0]!.reasonCode,
      }
    : {
        sourceOperationId: null,
        reasonCode: 'core-token-effects',
      }
}

interface OrderedStateChangeInput {
  readonly firstOperationOrder: number
  readonly scopeOrder: number
  readonly tieKey: string
  readonly input: MoveStateChangeInput
}

interface SheetProjection {
  readonly key: string
  readonly kind: SheetPlacement['sheetKind']
  readonly slug: string
  readonly expectedRevision: number
  readonly previous: MoveSheetDocument
  readonly currentBeforeRevision: MoveSheetDocument
  readonly fieldFirstOrders: Map<MoveSheetStateField, number>
  readonly touches: MoveCoreTokenEffectTouch[]
  firstOperationOrder: number
  firstPlacementOrder: number
}

const authoritativePreviousSheet = (
  recipient: MoveCoreTokenEffectRecipient,
): MoveSheetDocument => ({
  ...deepCloneJson(recipient.sheet.sheet),
  slug: recipient.sheet.slug,
  revision: recipient.sheet.revision,
}) as MoveSheetDocument

const projectRecipientSheet = (options: {
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly hpUpdate: MoveAutomationHpUpdate | undefined
  readonly conditionUpdate: MoveAutomationConditionUpdate | undefined
  readonly stageUpdate: MoveAutomationCombatStageUpdate | undefined
  readonly touches: MoveCoreTokenEffectTouches
}): {
  readonly previous: MoveSheetDocument
  readonly current: MoveSheetDocument
  readonly fieldFirstOrders: ReadonlyMap<MoveSheetStateField, number>
  readonly touches: readonly MoveCoreTokenEffectTouch[]
} | null => {
  const { recipient } = options
  const token = recipient.token
  const hpChanged = Boolean(options.hpUpdate && (
    options.hpUpdate.currentHp !== token.currentHp
    || (options.hpUpdate.injuries ?? token.injuries ?? 0) !== (token.injuries ?? 0)
  ))
  const conditionsChanged = Boolean(options.conditionUpdate && !sameJsonValue(
    normalizeConditionNames(options.conditionUpdate.conditions),
    sheetConditionNames(recipient.sheet.kind, recipient.sheet.sheet),
  ))
  const stagesChanged = Boolean(options.stageUpdate && !sameJsonValue(
    normalizeCombatStages(options.stageUpdate.stages),
    normalizeCombatStages(token.combatStages),
  ))
  if (!hpChanged && !conditionsChanged && !stagesChanged) return null

  const fields: Array<{
    readonly field: MoveSheetStateField
    readonly touches: readonly MoveCoreTokenEffectTouch[]
  }> = []
  if (hpChanged) fields.push({ field: 'hp', touches: touchesForField(options.touches, token.id, 'hp') })
  if (conditionsChanged) fields.push({
    field: 'conditions',
    touches: touchesForField(options.touches, token.id, 'conditions'),
  })
  if (stagesChanged) fields.push({
    field: 'combatStages',
    touches: touchesForField(options.touches, token.id, 'combatStages'),
  })
  fields.sort((left, right) => firstTouchOrder(left.touches) - firstTouchOrder(right.touches))

  const previous = authoritativePreviousSheet(recipient)
  let current = deepCloneJson(previous)
  for (const { field } of fields) {
    if (field === 'hp') {
      const update = options.hpUpdate!
      current = applyHpToSheet(
        recipient.placement.sheetKind,
        current as AnyLiveSheet,
        update.currentHp,
        update.injuries,
      ) as MoveSheetDocument
    }
    else if (field === 'conditions') {
      current = applyConditionsToSheet(
        recipient.placement.sheetKind,
        current as AnyLiveSheet,
        [...options.conditionUpdate!.conditions],
      ) as MoveSheetDocument
    }
    else if (field === 'combatStages') {
      current = applyCombatStagesToSheet(
        recipient.placement.sheetKind,
        current as AnyLiveSheet,
        options.stageUpdate!.stages as CombatStageMap,
      ) as MoveSheetDocument
    }
  }

  return {
    previous,
    current: { ...current, slug: recipient.sheet.slug } as MoveSheetDocument,
    fieldFirstOrders: new Map(fields.map(field => [field.field, firstTouchOrder(field.touches)])),
    touches: fields.flatMap(field => field.touches),
  }
}

export interface BuildCoreTokenStateChangesInput {
  readonly map: TabletopMap
  readonly placements: readonly SheetPlacement[]
  readonly time: number
  readonly recipientsById: ReadonlyMap<string, MoveCoreTokenEffectRecipient>
  readonly touches: MoveCoreTokenEffectTouches
  readonly hpUpdates: readonly MoveAutomationHpUpdate[]
  readonly conditionUpdates: readonly MoveAutomationConditionUpdate[]
  readonly stageUpdates: readonly MoveAutomationCombatStageUpdate[]
  readonly encounterStateUpdate: {
    readonly previous: EncounterState
    readonly current: EncounterState
  } | null
}

/** Aggregate ordered shared-kernel output into one typed replacement per physical resource. */
export const buildCoreTokenStateChanges = (
  options: BuildCoreTokenStateChangesInput,
): MoveStateChangePlan => {
  const { map, placements, time, touches } = options
  const hpById = new Map(options.hpUpdates.map(update => [update.id, update]))
  const conditionsById = new Map(options.conditionUpdates.map(update => [update.id, update]))
  const stagesById = new Map(options.stageUpdates.map(update => [update.id, update]))
  const placementOrder = new Map(
    placements.map((placement, index) => [placement.id, index]),
  )
  const touchedPlacementIds = [...touches.keys()].sort((left, right) => {
    const leftTouches = [...(touches.get(left)?.values() ?? [])].flat()
    const rightTouches = [...(touches.get(right)?.values() ?? [])].flat()
    const operationDifference = firstTouchOrder(leftTouches) - firstTouchOrder(rightTouches)
    if (operationDifference !== 0) return operationDifference
    return (placementOrder.get(left) ?? Number.MAX_SAFE_INTEGER)
      - (placementOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
  })

  const sheetProjections = new Map<string, SheetProjection>()
  for (const placementId of touchedPlacementIds) {
    const recipient = options.recipientsById.get(placementId)
      ?? failMoveCoreTokenEffectReduction(
        'recipient-not-found',
        `Touched recipient ${placementId} was not resolved.`,
      )
    const projected = projectRecipientSheet({
      recipient,
      hpUpdate: hpById.get(placementId),
      conditionUpdate: conditionsById.get(placementId),
      stageUpdate: stagesById.get(placementId),
      touches,
    })
    if (!projected) continue

    const key = `${recipient.sheet.kind}:${recipient.sheet.slug}`
    const existing = sheetProjections.get(key)
    if (existing) {
      if (!sameJsonValue(existing.currentBeforeRevision, projected.current)) {
        failMoveCoreTokenEffectReduction(
          'conflicting-shared-sheet-effects',
          `Placements sharing ${key} resolve to conflicting core-effect sheet states.`,
        )
      }
      for (const [field, order] of projected.fieldFirstOrders) {
        existing.fieldFirstOrders.set(
          field,
          Math.min(existing.fieldFirstOrders.get(field) ?? Number.MAX_SAFE_INTEGER, order),
        )
      }
      existing.touches.push(...projected.touches)
      existing.firstOperationOrder = Math.min(
        existing.firstOperationOrder,
        firstTouchOrder(projected.touches),
      )
      existing.firstPlacementOrder = Math.min(
        existing.firstPlacementOrder,
        placementOrder.get(placementId) ?? Number.MAX_SAFE_INTEGER,
      )
      continue
    }

    sheetProjections.set(key, {
      key,
      kind: recipient.sheet.kind,
      slug: recipient.sheet.slug,
      expectedRevision: recipient.sheet.revision,
      previous: projected.previous,
      currentBeforeRevision: projected.current,
      fieldFirstOrders: new Map(projected.fieldFirstOrders),
      touches: [...projected.touches],
      firstOperationOrder: firstTouchOrder(projected.touches),
      firstPlacementOrder: placementOrder.get(placementId) ?? Number.MAX_SAFE_INTEGER,
    })
  }

  const ordered: OrderedStateChangeInput[] = []
  for (const projection of sheetProjections.values()) {
    const changedFields = [...projection.fieldFirstOrders.keys()].sort((left, right) => (
      projection.fieldFirstOrders.get(left)! - projection.fieldFirstOrders.get(right)!
    ))
    const source = provenance(projection.touches)
    ordered.push({
      firstOperationOrder: projection.firstOperationOrder,
      scopeOrder: 1,
      tieKey: `${projection.firstPlacementOrder}:${projection.key}`,
      input: {
        kind: 'sheet-state',
        scope: {
          kind: 'sheet',
          sheetKind: projection.kind,
          sheetSlug: projection.slug,
        },
        expectedRevision: projection.expectedRevision,
        sourceOperationId: source.sourceOperationId,
        reasonCode: source.reasonCode,
        previous: projection.previous,
        current: {
          ...projection.currentBeforeRevision,
          revision: nextRevision(projection.expectedRevision),
          updatedAt: time,
        } as unknown as MoveSheetDocument,
        changedFields,
        compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
      },
    })
  }

  if (options.encounterStateUpdate) {
    const encounterTouches = touchedPlacementIds.flatMap(placementId => (
      touchesForField(touches, placementId, 'encounterEffects')
    ))
    const source = provenance(encounterTouches)
    ordered.push({
      firstOperationOrder: firstTouchOrder(encounterTouches),
      scopeOrder: 0,
      tieKey: map.slug,
      input: {
        kind: 'encounter-state',
        scope: { kind: 'encounter', mapSlug: map.slug },
        expectedRevision: normalizeRevision(map.revision),
        sourceOperationId: source.sourceOperationId,
        reasonCode: source.reasonCode,
        previous: deepCloneJson(options.encounterStateUpdate.previous),
        current: deepCloneJson(options.encounterStateUpdate.current),
        compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
      },
    })
  }

  let nextMap: TabletopMap = deepCloneJson(map)
  const temporaryHpTouches: MoveCoreTokenEffectTouch[] = []
  let firstTemporaryHpOrder = Number.MAX_SAFE_INTEGER
  for (const placementId of touchedPlacementIds) {
    const update = hpById.get(placementId)
    if (update?.temporaryHp === undefined) continue
    const recipient = options.recipientsById.get(placementId)
      ?? failMoveCoreTokenEffectReduction(
        'recipient-not-found',
        `Temporary-HP recipient ${placementId} was not resolved.`,
      )
    const previousAmount = normalizeTemporaryHpAmount(recipient.token.temporaryHp)
    const currentAmount = normalizeTemporaryHpAmount(update.temporaryHp)
    if (previousAmount === currentAmount) continue
    const relevantTouches = touchesForField(touches, placementId, 'temporaryHitPoints')
    temporaryHpTouches.push(...relevantTouches)
    firstTemporaryHpOrder = Math.min(firstTemporaryHpOrder, firstTouchOrder(relevantTouches))
    nextMap = mapWithTemporaryHpForPlacement(nextMap, placementId, currentAmount)
  }

  if (!sameJsonValue(map.temporaryHitPoints, nextMap.temporaryHitPoints)) {
    const source = provenance(temporaryHpTouches)
    ordered.push({
      firstOperationOrder: firstTemporaryHpOrder,
      scopeOrder: 0,
      tieKey: map.slug,
      input: {
        kind: 'map-temporary-hit-points',
        scope: { kind: 'map', mapSlug: map.slug },
        expectedRevision: normalizeRevision(map.revision),
        sourceOperationId: source.sourceOperationId,
        reasonCode: source.reasonCode,
        previous: deepCloneJson(map.temporaryHitPoints),
        current: deepCloneJson(nextMap.temporaryHitPoints),
        compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
      },
    })
  }

  ordered.sort((left, right) => (
    left.firstOperationOrder - right.firstOperationOrder
    || left.scopeOrder - right.scopeOrder
    || left.tieKey.localeCompare(right.tieKey)
  ))
  return createMoveStateChangePlan(ordered.map(({ input }) => input))
}

export interface BuildMoveCoreTokenStateChangesInput
  extends Omit<BuildCoreTokenStateChangesInput, 'map' | 'placements' | 'time'> {
  readonly context: AuthoritativeMoveRulesContext
}

/** Move-domain adapter retained for existing callers. */
export const buildMoveCoreTokenStateChanges = (
  options: BuildMoveCoreTokenStateChangesInput,
): MoveStateChangePlan => buildCoreTokenStateChanges({
  ...options,
  map: options.context.map,
  placements: options.context.queries.placements.all(),
  time: options.context.time,
})
