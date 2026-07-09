import {
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayCommandAccepted,
  type LivePlayCommandDuplicate,
  type LivePlayCommandResult,
} from '#shared/livePlayCommands'
import {
  parseLivePlayMoveStatePatchPayload,
} from '#shared/livePlayMoveState'
import type { LivePlayMovePresentationSummary } from '#shared/livePlayMovePresentation'
import { deepCloneJson } from '~/utils/serialization'

export type ExtractAcceptedMovePresentationResult =
  | {
      readonly ok: true
      readonly presentation: LivePlayMovePresentationSummary
    }
  | {
      readonly ok: false
      readonly reason: 'not-accepted' | 'not-a-move' | 'invalid'
      readonly message: string
    }

type AcceptedResponseLike = LivePlayCommandResult

const isDuplicate = (
  response: AcceptedResponseLike,
): response is LivePlayCommandDuplicate & AcceptedResponseLike => (
  response.ok === true && 'duplicate' in response && response.duplicate === true
)

const acceptedResult = (response: AcceptedResponseLike): LivePlayCommandAccepted | null => {
  if (!response.ok) return null
  if (isDuplicate(response)) return response.original.ok ? response.original : null
  return response
}

/**
 * Extracts the bounded presentation summary from a durable accepted result.
 * Route-only response extras are deliberately ignored; operation patches are
 * the shared HTTP, status, duplicate, and realtime source of truth.
 */
export const extractAcceptedMovePresentation = (
  response: AcceptedResponseLike,
): ExtractAcceptedMovePresentationResult => {
  const accepted = acceptedResult(response)
  if (!accepted) {
    return { ok: false, reason: 'not-accepted', message: 'Command result was not accepted.' }
  }

  const patches = accepted.patches.filter((patch) => patch.type === LIVE_PLAY_PATCH_TYPES.MOVE_STATE)
  if (patches.length === 0) {
    return { ok: false, reason: 'not-a-move', message: 'Accepted result has no move presentation patch.' }
  }
  if (patches.length !== 1) {
    return {
      ok: false,
      reason: 'invalid',
      message: `Accepted result contained ${patches.length} move presentation patches; exactly one is allowed.`,
    }
  }

  const parsed = parseLivePlayMoveStatePatchPayload(patches[0]?.payload)
  if (!parsed.valid) {
    return {
      ok: false,
      reason: 'invalid',
      message: `Accepted move presentation patch is invalid: ${parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`,
    }
  }
  if (parsed.payload.presentation.operationId !== accepted.opId || accepted.opId !== response.opId) {
    return {
      ok: false,
      reason: 'invalid',
      message: 'Accepted move presentation operation ID does not match its terminal result.',
    }
  }

  return {
    ok: true,
    presentation: deepCloneJson(parsed.payload.presentation),
  }
}
