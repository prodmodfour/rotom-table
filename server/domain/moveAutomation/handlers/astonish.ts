import { createHash } from 'node:crypto'
import type { MoveEffectOperation } from '#shared/moveAutomation/effects'
import type {
  RegisteredMoveHandlerContext,
  RegisteredMoveHandlerRegistration,
} from './registry'

export const ASTONISH_HANDLER_ID = 'astonish.unaware-flinch' as const
export const ASTONISH_UNAWARE_MARKER_CAPABILITY_ID =
  'astonish-unaware-flinch-used' as const
export const ASTONISH_UNAWARE_REQUEST_ID = 'astonish.target-awareness' as const
export const ASTONISH_UNAWARE_OPTION_ID = 'target-unaware' as const

const ASTONISH_ACCURACY_ROLL_ID = 'astonish.accuracy-roll' as const
const ASTONISH_BRANCH_OPERATION_ID = 'astonish.choose-target-awareness' as const
const ASTONISH_ORDINARY_FLINCH_OPERATION_ID = 'astonish.threshold-flinch' as const
const ASTONISH_AUTOMATIC_FLINCH_OPERATION_ID = 'astonish.unaware-automatic-flinch' as const
const ASTONISH_MARKER_OPERATION_ID = 'astonish.mark-unaware-flinch-used' as const

const actorSheetIdentityHash = (context: RegisteredMoveHandlerContext): string => (
  createHash('sha256')
    .update(`${context.actor.placement.sheetKind}:${context.actor.placement.sheetSlug}`, 'utf8')
    .digest('hex')
)

export const astonishUnawareMarkerTag = (
  context: RegisteredMoveHandlerContext,
): string => `astonish.actor-sheet.${actorSheetIdentityHash(context)}`

export const astonishUnawareMarkerEffectId = (
  context: RegisteredMoveHandlerContext,
): string => `effect.astonish.unaware-flinch.${actorSheetIdentityHash(context)}`

export const hasUsedAstonishUnawareFlinch = (
  context: RegisteredMoveHandlerContext,
): boolean => {
  const actorTag = astonishUnawareMarkerTag(context)
  return (context.map.encounterState?.effects ?? []).some(effect => (
    effect.kind === 'capability'
    && effect.payload.capabilityId === ASTONISH_UNAWARE_MARKER_CAPABILITY_ID
    && effect.tags.includes(actorTag)
  ))
}

const flinchPayload = (automatic: boolean) => ({
  action: 'apply' as const,
  conditionId: 'flinch',
  conditionSource: null,
  filter: null,
  randomChoice: null,
  ...(automatic
    ? {}
    : {
        accuracyRollTrigger: {
          rollId: ASTONISH_ACCURACY_ROLL_ID,
          trigger: { kind: 'range' as const, minimum: 15 },
        },
      }),
  duration: null,
  saveTiming: 'canonical' as const,
  stackPolicy: { kind: 'add-stack' as const, maxStacks: 64 },
})

const ordinaryFlinchOperation = (
  sourceId: string,
): MoveEffectOperation => ({
  id: ASTONISH_ORDINARY_FLINCH_OPERATION_ID,
  kind: 'condition',
  source: { kind: 'operation', id: sourceId },
  recipients: { kind: 'hit-targets' },
  phase: 'after-damage',
  reasonCode: 'astonish.flinch-on-15-plus',
  payload: flinchPayload(false),
})

/**
 * The natural 15+ branch is immediate. While the once-per-scene clause remains
 * available, a durable target-owned answer records whether that target was
 * unaware; only that reviewed answer can select automatic Flinch and consume
 * the sheet-bound scene marker.
 */
const runAstonishHandler = (context: RegisteredMoveHandlerContext) => {
  context.reads.recordPlacement(context.actor.placement)
  const alreadyUsed = hasUsedAstonishUnawareFlinch(context)
  if (alreadyUsed) {
    return {
      operations: [ordinaryFlinchOperation('astonish.damage')],
      traceEntries: [{
        kind: 'predicate' as const,
        phase: 'after-damage' as const,
        predicateId: 'astonish.unaware-flinch-available',
        outcome: false,
        reasonCode: 'astonish.unaware-flinch-already-used',
        input: { actorSheetMarker: true },
      }],
    }
  }

  const operations: readonly MoveEffectOperation[] = [
    {
      id: ASTONISH_BRANCH_OPERATION_ID,
      kind: 'branch',
      source: { kind: 'operation', id: 'astonish.damage' },
      recipients: { kind: 'damaged-targets' },
      phase: 'after-damage',
      reasonCode: 'astonish.confirm-target-awareness',
      payload: {
        kind: 'choice',
        selectionId: 'astonish.target-awareness',
        scope: 'resolution',
        owner: 'recipients',
        requestId: ASTONISH_UNAWARE_REQUEST_ID,
        promptKey: 'move.astonish.confirm-target-awareness',
        options: [{
          id: ASTONISH_UNAWARE_OPTION_ID,
          labelKey: 'move.astonish.target-was-unaware',
          operationIds: [
            ASTONISH_AUTOMATIC_FLINCH_OPERATION_ID,
            ASTONISH_MARKER_OPERATION_ID,
          ],
        }],
        pass: {
          id: 'astonish.target-aware',
          operationIds: [ASTONISH_ORDINARY_FLINCH_OPERATION_ID],
        },
      },
    },
    ordinaryFlinchOperation(ASTONISH_BRANCH_OPERATION_ID),
    {
      id: ASTONISH_AUTOMATIC_FLINCH_OPERATION_ID,
      kind: 'condition',
      source: { kind: 'operation', id: ASTONISH_BRANCH_OPERATION_ID },
      recipients: { kind: 'hit-targets' },
      phase: 'after-damage',
      reasonCode: 'astonish.unaware-automatic-flinch',
      payload: flinchPayload(true),
    },
    {
      id: ASTONISH_MARKER_OPERATION_ID,
      kind: 'temporary-effect',
      source: { kind: 'operation', id: ASTONISH_BRANCH_OPERATION_ID },
      recipients: { kind: 'actor' },
      phase: 'after-damage',
      reasonCode: 'astonish.consume-unaware-flinch',
      payload: {
        action: 'add',
        effectId: astonishUnawareMarkerEffectId(context),
        recipientScope: 'placements',
        definition: {
          kind: 'capability',
          duration: { kind: 'scene', remaining: null },
          stacks: 1,
          charges: null,
          stackPolicy: { kind: 'replace', maxStacks: null },
          chargePolicy: { kind: 'none', amount: null },
          tags: [
            'astonish',
            'once-per-scene',
            astonishUnawareMarkerTag(context),
          ],
          payload: {
            capabilityId: ASTONISH_UNAWARE_MARKER_CAPABILITY_ID,
            action: 'grant',
          },
          dispel: { policy: 'none', tags: [] },
          transferPolicy: 'retain',
        },
      },
    },
  ]

  return {
    operations,
    traceEntries: [{
      kind: 'predicate' as const,
      phase: 'after-damage' as const,
      predicateId: 'astonish.unaware-flinch-available',
      outcome: true,
      reasonCode: 'astonish.unaware-flinch-available',
      input: { actorSheetMarker: false },
    }],
  }
}

export const ASTONISH_MOVE_HANDLER_REGISTRATION: RegisteredMoveHandlerRegistration =
  Object.freeze({
    id: ASTONISH_HANDLER_ID,
    version: 1,
    run: runAstonishHandler,
  })
