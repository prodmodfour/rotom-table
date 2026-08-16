import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { MoveEffectSwitchStateTransferPolicy } from '#shared/moveAutomation/effects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement } from '~/types/map'
import type { CombatStageMap } from '~/types/combatStages'
import {
  COMBAT_STAGE_KEYS,
  clampCombatStage,
  normalizeCombatStages,
} from '~/utils/combatStages'
import { pokemonHpSnapshot } from '~/utils/sheetSpawn'
import { applyCombatStagesToSheet } from '~/utils/sheetMutations'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import { mergeDisjointMoveSheetStateChanges } from './mergeSheetStateChanges'
import {
  MOVE_SHEET_STATE_FIELDS,
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  type MoveSheetDocument,
  type MoveStateChangeInput,
} from './plan'

export type MoveSwitchCombatStagePlanningErrorCode =
  | 'switch-stage-sheet-missing'
  | 'switch-stage-sheet-conflict'

export class MoveSwitchCombatStagePlanningError extends Error {
  readonly code: MoveSwitchCombatStagePlanningErrorCode

  constructor(code: MoveSwitchCombatStagePlanningErrorCode, message: string) {
    super(message)
    this.name = 'MoveSwitchCombatStagePlanningError'
    this.code = code
  }
}

export interface PlannedMoveSwitchCombatStages {
  readonly stateChanges: readonly MoveStateChangeInput[]
  readonly previousRecalledStages: CombatStageMap
  readonly previousSentOutStages: CombatStageMap
  readonly currentRecalledStages: CombatStageMap
  readonly currentSentOutStages: CombatStageMap
}

type SheetStateChangeInput = Extract<
  MoveStateChangeInput,
  { readonly kind: 'sheet-state' }
>

const fail = (
  code: MoveSwitchCombatStagePlanningErrorCode,
  message: string,
): never => {
  throw new MoveSwitchCombatStagePlanningError(code, message)
}

const sheetKey = (kind: SheetPlacement['sheetKind'], slug: string): string => (
  `${kind}:${slug}`
)

const authoritativeSheetDocument = (
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
  pokemonSheets: ReadonlyMap<string, CharacterSheet>,
): MoveSheetDocument => {
  if (placement.sheetKind !== 'pokemon') {
    return fail('switch-stage-sheet-missing', 'Baton Pass stage transfer requires Pokémon sheets.')
  }
  const sheet = pokemonSheets.get(placement.sheetSlug)
    ?? fail(
      'switch-stage-sheet-missing',
      `Pokémon sheet ${placement.sheetSlug} is unavailable for switch stage transfer.`,
    )
  return {
    ...deepCloneJson(sheet),
    slug: placement.sheetSlug,
    revision: normalizeRevision(sheet.revision),
  }
}

const stageSnapshot = (sheet: MoveSheetDocument): CombatStageMap => (
  normalizeCombatStages(pokemonHpSnapshot(sheet as CharacterSheet).combatStages)
)

const transferredDestinationStages = (
  source: CombatStageMap,
  destination: CombatStageMap,
): CombatStageMap => normalizeCombatStages(Object.fromEntries(
  COMBAT_STAGE_KEYS.map(stage => [
    stage,
    clampCombatStage(destination[stage] + source[stage]),
  ]),
))

const findSheetChange = (
  changes: readonly MoveStateChangeInput[],
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
): { readonly change: SheetStateChangeInput; readonly index: number } | null => {
  const matches = changes.flatMap((change, index) => (
    change.kind === 'sheet-state'
    && change.scope.sheetKind === placement.sheetKind
    && change.scope.sheetSlug === placement.sheetSlug
      ? [{ change, index }]
      : []
  ))
  if (matches.length > 1) {
    return fail(
      'switch-stage-sheet-conflict',
      `Sheet ${sheetKey(placement.sheetKind, placement.sheetSlug)} has more than one merged state change.`,
    )
  }
  return matches[0] ?? null
}

const projectCurrentSheet = (input: {
  readonly placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>
  readonly authoritative: MoveSheetDocument
  readonly stateChanges: readonly MoveStateChangeInput[]
}): MoveSheetDocument => {
  const existing = findSheetChange(input.stateChanges, input.placement)?.change
  if (!existing) return deepCloneJson(input.authoritative)
  if (
    existing.expectedRevision !== input.authoritative.revision
    || !sameJsonValue(existing.previous, input.authoritative)
  ) {
    return fail(
      'switch-stage-sheet-conflict',
      `Sheet ${sheetKey(input.placement.sheetKind, input.placement.sheetSlug)} stage transfer observed an incompatible snapshot.`,
    )
  }
  return deepCloneJson(existing.current)
}

const withStageProjection = (input: {
  readonly stateChanges: readonly MoveStateChangeInput[]
  readonly placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>
  readonly authoritative: MoveSheetDocument
  readonly stages: CombatStageMap
  readonly operationId: string
  readonly plannedAt: number
}): readonly MoveStateChangeInput[] => {
  const result = [...input.stateChanges]
  const existing = findSheetChange(result, input.placement)
  const current = existing?.change.current ?? input.authoritative
  if (sameJsonValue(stageSnapshot(current), input.stages)) return result

  const projected = applyCombatStagesToSheet(
    input.placement.sheetKind,
    current,
    input.stages,
  ) as MoveSheetDocument
  if (existing) {
    const fields = new Set([...existing.change.changedFields, 'combatStages' as const])
    result[existing.index] = {
      ...existing.change,
      sourceOperationId: existing.change.sourceOperationId === input.operationId
        ? input.operationId
        : null,
      reasonCode: existing.change.sourceOperationId === input.operationId
        ? 'move-switch-transfer-combat-stages'
        : 'move-effects-and-switch-stage-transfer',
      current: {
        ...projected,
        slug: input.placement.sheetSlug,
        revision: nextRevision(existing.change.expectedRevision),
        updatedAt: input.plannedAt,
      } as unknown as MoveSheetDocument,
      changedFields: MOVE_SHEET_STATE_FIELDS.filter(field => fields.has(field)),
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    }
    return result
  }

  const expectedRevision = normalizeRevision(input.authoritative.revision)
  result.push({
    kind: 'sheet-state',
    scope: {
      kind: 'sheet',
      sheetKind: input.placement.sheetKind,
      sheetSlug: input.placement.sheetSlug,
    },
    expectedRevision,
    sourceOperationId: input.operationId,
    reasonCode: 'move-switch-transfer-combat-stages',
    previous: deepCloneJson(input.authoritative),
    current: {
      ...projected,
      slug: input.placement.sheetSlug,
      revision: nextRevision(expectedRevision),
      updatedAt: input.plannedAt,
    } as unknown as MoveSheetDocument,
    changedFields: ['combatStages'],
    compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  })
  return result
}

/**
 * Fold authoritative switch stage cleanup into existing typed sheet writes.
 * Every recalled source is cleared; Baton Pass additionally adds each bounded
 * source stage to the replacement from the same operation-entry snapshot, so no
 * stage is copied twice and each physical sheet advances at most one revision.
 */
export const planMoveSwitchCombatStageTransfer = (input: {
  readonly stateChanges: readonly MoveStateChangeInput[]
  readonly recalledPlacement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>
  readonly sentOutPlacement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly operationId: string
  readonly plannedAt: number
  readonly stateTransferPolicy: MoveEffectSwitchStateTransferPolicy
}): PlannedMoveSwitchCombatStages => {
  if (
    input.recalledPlacement.sheetKind === input.sentOutPlacement.sheetKind
    && input.recalledPlacement.sheetSlug === input.sentOutPlacement.sheetSlug
  ) {
    return fail(
      'switch-stage-sheet-conflict',
      'Baton Pass cannot transfer Combat Stages back to the recalled sheet.',
    )
  }
  const stateChanges = mergeDisjointMoveSheetStateChanges(input.stateChanges)
  const recalledAuthoritative = authoritativeSheetDocument(
    input.recalledPlacement,
    input.pokemonSheets,
  )
  const sentOutAuthoritative = authoritativeSheetDocument(
    input.sentOutPlacement,
    input.pokemonSheets,
  )
  const recalledCurrent = projectCurrentSheet({
    placement: input.recalledPlacement,
    authoritative: recalledAuthoritative,
    stateChanges,
  })
  const sentOutCurrent = projectCurrentSheet({
    placement: input.sentOutPlacement,
    authoritative: sentOutAuthoritative,
    stateChanges,
  })
  const previousRecalledStages = stageSnapshot(recalledCurrent)
  const previousSentOutStages = stageSnapshot(sentOutCurrent)

  const currentRecalledStages = normalizeCombatStages()
  const currentSentOutStages = input.stateTransferPolicy === 'baton-pass'
    ? transferredDestinationStages(previousRecalledStages, previousSentOutStages)
    : previousSentOutStages
  const afterRecalled = withStageProjection({
    stateChanges,
    placement: input.recalledPlacement,
    authoritative: recalledAuthoritative,
    stages: currentRecalledStages,
    operationId: input.operationId,
    plannedAt: input.plannedAt,
  })
  const afterSentOut = withStageProjection({
    stateChanges: afterRecalled,
    placement: input.sentOutPlacement,
    authoritative: sentOutAuthoritative,
    stages: currentSentOutStages,
    operationId: input.operationId,
    plannedAt: input.plannedAt,
  })

  return {
    stateChanges: afterSentOut,
    previousRecalledStages,
    previousSentOutStages,
    currentRecalledStages,
    currentSentOutStages,
  }
}
