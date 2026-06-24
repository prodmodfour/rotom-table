import {
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayCommandAccepted,
  type LivePlayCommandDuplicate,
  type LivePlayCommandResult,
  type LivePlayPatch,
} from '#shared/livePlayCommands'
import {
  parseLivePlayResolvedMoveResult,
  type LivePlayResolvedMoveResult,
} from '#shared/livePlayMoveResolution'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'

export type ExtractResolvedMoveSource = 'response' | 'patch' | 'both'

export type ExtractResolvedMoveResult =
  | {
      readonly ok: true
      readonly move: LivePlayResolvedMoveResult
      readonly source: ExtractResolvedMoveSource
    }
  | {
      readonly ok: false
      readonly message: string
    }

type UnknownRecord = Record<string, unknown>

type LivePlayResolveMoveResponseLike = LivePlayCommandResult & {
  readonly move?: unknown
}

const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const hasOwn = <TKey extends string>(value: object, key: TKey): value is Record<TKey, unknown> => (
  Object.prototype.hasOwnProperty.call(value, key)
)

const isDuplicateResult = (
  response: LivePlayResolveMoveResponseLike,
): response is LivePlayCommandDuplicate & LivePlayResolveMoveResponseLike => (
  response.ok === true && hasOwn(response, 'duplicate') && response.duplicate === true
)

const acceptedResult = (response: LivePlayResolveMoveResponseLike): LivePlayCommandAccepted | null => {
  if (!response.ok) return null
  if (isDuplicateResult(response)) return response.original.ok ? response.original : null
  return response
}

const validationMessage = (source: string, value: unknown): string => {
  const result = parseLivePlayResolvedMoveResult(value)
  if (result.valid) return ''
  return `${source} is not a valid resolved move result: ${result.issues.map((issue) => issue.message).join(' ')}`
}

const parseMove = (
  source: string,
  value: unknown,
): { readonly ok: true; readonly move: LivePlayResolvedMoveResult } | { readonly ok: false; readonly message: string } => {
  const result = parseLivePlayResolvedMoveResult(value)
  if (!result.valid) return { ok: false, message: validationMessage(source, value) }
  return { ok: true, move: deepCloneJson(result.move) }
}

const moveFromRecord = (record: unknown): unknown => {
  if (!isRecord(record)) return undefined
  if (hasOwn(record, 'move')) return record.move
  if (hasOwn(record, 'result')) return record.result
  return undefined
}

const moveStatePatches = (accepted: LivePlayCommandAccepted): readonly LivePlayPatch[] => (
  accepted.patches.filter((patch) => patch.type === LIVE_PLAY_PATCH_TYPES.MOVE_STATE)
)

const moveFromResponse = (
  response: LivePlayResolveMoveResponseLike,
  accepted: LivePlayCommandAccepted,
): unknown => {
  if (hasOwn(response, 'move')) return response.move
  if (hasOwn(accepted, 'move')) return accepted.move
  return undefined
}

export const extractResolvedMoveResult = (
  response: LivePlayResolveMoveResponseLike,
): ExtractResolvedMoveResult => {
  const accepted = acceptedResult(response)
  if (!accepted) return { ok: false, message: 'Resolve-move response was not accepted.' }

  const responseMoveValue = moveFromResponse(response, accepted)
  const responseMove = responseMoveValue === undefined ? null : parseMove('response.move', responseMoveValue)
  if (responseMove && !responseMove.ok) return responseMove

  const patches = moveStatePatches(accepted)
  if (patches.length > 1) {
    return { ok: false, message: `Resolve-move response contained ${patches.length} MOVE_STATE patches; exactly one is allowed.` }
  }

  const patch = patches[0] ?? null
  const patchMoveValue = patch ? moveFromRecord(patch.payload) : undefined
  if (patch && patchMoveValue === undefined) {
    return { ok: false, message: 'MOVE_STATE patch did not contain a resolved move result.' }
  }

  const patchMove = patchMoveValue === undefined ? null : parseMove('MOVE_STATE patch move', patchMoveValue)
  if (patchMove && !patchMove.ok) return patchMove

  if (responseMove?.ok && patchMove?.ok) {
    if (!sameJsonValue(responseMove.move, patchMove.move)) {
      return { ok: false, message: 'Resolve-move response.move and MOVE_STATE patch move do not match.' }
    }
    return { ok: true, move: deepCloneJson(patchMove.move), source: 'both' }
  }

  if (patchMove?.ok) return { ok: true, move: deepCloneJson(patchMove.move), source: 'patch' }
  if (responseMove?.ok) return { ok: true, move: deepCloneJson(responseMove.move), source: 'response' }

  return { ok: false, message: 'Resolve-move response did not include usable presentation data.' }
}
