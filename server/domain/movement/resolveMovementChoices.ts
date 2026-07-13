import {
  MOVE_RESPONSE_OPTION_LIMITS,
  type PendingMoveDirectionSelection,
  type PendingMoveDestinationSelection,
  type PendingMoveMovementSelection,
  type PendingMoveResponseOption,
} from '#shared/moveAutomation/responseOptions'
import type { GridAnchor, TabletopMap } from '~/types/map'
import {
  MOVE_AUTOMATION_AREA_DIRECTIONS,
  type MoveAutomationAreaDirection,
} from '~/types/moveAutomation'
import { buildMoveAutomationPassDirectionSteps } from '~/utils/moveAutomationDirections'
import {
  resolveAuthoritativeMovement,
  type AuthoritativeMovementSheetRead,
  type AuthoritativeMovementSheets,
  type AuthoritativeMovementSuccess,
} from './resolveMovement'

export const AUTHORITATIVE_MOVEMENT_CHOICE_LIMITS = Object.freeze({
  candidateAnchors: 4_096,
  options: MOVE_RESPONSE_OPTION_LIMITS.optionsPerWindow,
})

export type AuthoritativeMovementChoiceKind = 'destination' | 'direction'

export type AuthoritativeMovementChoiceErrorCode =
  | 'movement-choice-invalid'
  | 'movement-choice-candidate-limit'
  | 'movement-choice-option-limit'
  | 'movement-choice-option-unknown'
  | 'movement-choice-stale'

export class AuthoritativeMovementChoiceError extends Error {
  readonly code: AuthoritativeMovementChoiceErrorCode

  constructor(code: AuthoritativeMovementChoiceErrorCode, message: string) {
    super(message)
    this.name = 'AuthoritativeMovementChoiceError'
    this.code = code
  }
}

export interface AuthoritativeMovementChoice {
  readonly option: PendingMoveResponseOption & {
    readonly selection: PendingMoveMovementSelection
  }
  readonly movement: AuthoritativeMovementSuccess
}

export interface AuthoritativeMovementChoiceSet {
  readonly kind: AuthoritativeMovementChoiceKind
  readonly setId: string
  readonly placementId: string
  readonly maximumDistance: number
  readonly choices: readonly AuthoritativeMovementChoice[]
  readonly sheetReads: readonly AuthoritativeMovementSheetRead[]
}

interface AuthoritativeMovementChoiceInputBase {
  readonly map: TabletopMap
  readonly sheets: AuthoritativeMovementSheets
  readonly placementId: string
  readonly setId: string
  readonly maximumDistance: number
}

export interface EnumerateAuthoritativeDestinationChoicesInput
  extends AuthoritativeMovementChoiceInputBase {
  readonly kind: 'destination'
  /** Optional server-produced candidate geometry; never accepted from response intent. */
  readonly candidateDestinations?: readonly GridAnchor[]
}

export interface EnumerateAuthoritativeDirectionChoicesInput
  extends AuthoritativeMovementChoiceInputBase {
  readonly kind: 'direction'
  readonly directions: readonly MoveAutomationAreaDirection[]
}

export type EnumerateAuthoritativeMovementChoicesInput =
  | EnumerateAuthoritativeDestinationChoicesInput
  | EnumerateAuthoritativeDirectionChoicesInput

export interface RevalidateAuthoritativeMovementChoiceInput
  extends AuthoritativeMovementChoiceInputBase {
  readonly kind: AuthoritativeMovementChoiceKind
  readonly option: PendingMoveResponseOption
  readonly directions?: readonly MoveAutomationAreaDirection[]
}

const MOVEMENT_DIRECTION_SET = new Set<string>(MOVE_AUTOMATION_AREA_DIRECTIONS)

const fail = (
  code: AuthoritativeMovementChoiceErrorCode,
  message: string,
): never => {
  throw new AuthoritativeMovementChoiceError(code, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const validStableId = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length > 0
  && value.length <= MOVE_RESPONSE_OPTION_LIMITS.identifierChars
  && /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/.test(value)
)

const validPlacementId = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length > 0
  && value.length <= MOVE_RESPONSE_OPTION_LIMITS.placementIdChars
  && value.trim() === value
)

const validDistance = (value: unknown): value is number => (
  Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 1_000
)

const validAnchor = (value: unknown): value is GridAnchor => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const anchor = value as Record<string, unknown>
  return Number.isSafeInteger(anchor.x)
    && Number.isSafeInteger(anchor.y)
    && Number.isSafeInteger(anchor.z)
}

const anchorKey = (anchor: GridAnchor): string => `${anchor.x},${anchor.y},${anchor.z}`

const sameAnchor = (left: GridAnchor, right: GridAnchor): boolean => (
  left.x === right.x && left.y === right.y && left.z === right.z
)

const stableNamespaceHash = (value: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

const destinationOptionId = (setId: string, destination: GridAnchor): string => (
  `movement.destination.${stableNamespaceHash(setId)}.${destination.x}.${destination.y}.${destination.z}`
)

const directionOptionId = (
  setId: string,
  direction: MoveAutomationAreaDirection,
  destination: GridAnchor,
): string => (
  `movement.direction.${stableNamespaceHash(setId)}.${direction}.${destination.x}.${destination.y}.${destination.z}`
)

const validateBaseInput = (input: AuthoritativeMovementChoiceInputBase): GridAnchor => {
  if (!validStableId(input.setId) || !validPlacementId(input.placementId)) {
    return fail('movement-choice-invalid', 'Movement choice set and placement IDs must be bounded identifiers.')
  }
  if (!validDistance(input.maximumDistance)) {
    return fail('movement-choice-invalid', 'Movement choice distance must be a positive bounded integer.')
  }
  const placements = input.map.placements.filter(placement => placement.id === input.placementId)
  if (placements.length !== 1 || !validAnchor(placements[0]?.position)) {
    return fail('movement-choice-invalid', 'Movement choice actor must resolve to one authoritative placement.')
  }
  return { ...placements[0]!.position }
}

const deduplicateSheetReads = (
  reads: readonly AuthoritativeMovementSheetRead[],
): readonly AuthoritativeMovementSheetRead[] => {
  const byReference = new Map<string, AuthoritativeMovementSheetRead>()
  for (const read of reads) {
    const key = `${read.kind}:${read.slug}`
    const existing = byReference.get(key)
    if (existing && existing.revision !== read.revision) {
      return fail(
        'movement-choice-stale',
        `Movement choice consulted ${key} at conflicting revisions.`,
      )
    }
    if (!existing) byReference.set(key, { ...read })
  }
  return [...byReference.values()]
}

const boundedGeneratedCandidates = (
  input: AuthoritativeMovementChoiceInputBase,
  origin: GridAnchor,
): readonly GridAnchor[] => {
  const distance = input.maximumDistance
  const minimumX = Math.max(0, origin.x - distance)
  const maximumX = Math.min(input.map.dimensions.x - 1, origin.x + distance)
  const minimumY = Math.max(0, origin.y - distance)
  const maximumY = Math.min(input.map.dimensions.y - 1, origin.y + distance)
  const minimumZ = Math.max(0, origin.z - distance)
  const maximumZ = Math.min(input.map.dimensions.z - 1, origin.z + distance)
  const candidateCount = (maximumX - minimumX + 1)
    * (maximumY - minimumY + 1)
    * (maximumZ - minimumZ + 1)
  if (candidateCount > AUTHORITATIVE_MOVEMENT_CHOICE_LIMITS.candidateAnchors) {
    return fail(
      'movement-choice-candidate-limit',
      `Movement choice would inspect ${candidateCount} anchors; at most ${AUTHORITATIVE_MOVEMENT_CHOICE_LIMITS.candidateAnchors} are allowed.`,
    )
  }

  const candidates: GridAnchor[] = []
  // Stable map order: elevation, row, then column.
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let z = minimumZ; z <= maximumZ; z += 1) {
      for (let x = minimumX; x <= maximumX; x += 1) {
        if (x === origin.x && y === origin.y && z === origin.z) continue
        candidates.push({ x, y, z })
      }
    }
  }
  return candidates
}

const normalizedCandidates = (
  input: EnumerateAuthoritativeDestinationChoicesInput,
  origin: GridAnchor,
): readonly GridAnchor[] => {
  if (input.candidateDestinations === undefined) {
    return boundedGeneratedCandidates(input, origin)
  }
  if (input.candidateDestinations.length > AUTHORITATIVE_MOVEMENT_CHOICE_LIMITS.candidateAnchors) {
    return fail(
      'movement-choice-candidate-limit',
      `Movement choice candidate list exceeds ${AUTHORITATIVE_MOVEMENT_CHOICE_LIMITS.candidateAnchors} anchors.`,
    )
  }
  const seen = new Set<string>()
  return input.candidateDestinations.map((candidate) => {
    if (!validAnchor(candidate)) {
      return fail('movement-choice-invalid', 'Movement choice candidates must be safe integer anchors.')
    }
    const detached = { x: candidate.x, y: candidate.y, z: candidate.z }
    const key = anchorKey(detached)
    if (seen.has(key)) {
      return fail('movement-choice-invalid', `Movement choice candidate ${key} is duplicated.`)
    }
    seen.add(key)
    return detached
  })
}

const resolveDestination = (
  input: AuthoritativeMovementChoiceInputBase,
  destination: GridAnchor,
): ReturnType<typeof resolveAuthoritativeMovement> => resolveAuthoritativeMovement({
  map: input.map,
  sheets: input.sheets,
  placementId: input.placementId,
  mode: 'shift',
  destination,
  policy: {
    kind: 'standard',
    maximumCost: input.maximumDistance,
  },
})

const destinationSelection = (
  setId: string,
  destination: GridAnchor,
): PendingMoveDestinationSelection => ({
  kind: 'movement-destination',
  setId,
  destination: { ...destination },
})

const directionSelection = (
  setId: string,
  direction: MoveAutomationAreaDirection,
  destination: GridAnchor,
): PendingMoveDirectionSelection => ({
  kind: 'movement-direction',
  setId,
  direction,
  destination: { ...destination },
})

const choiceForDestination = (
  input: AuthoritativeMovementChoiceInputBase,
  movement: AuthoritativeMovementSuccess,
): AuthoritativeMovementChoice => ({
  option: {
    id: destinationOptionId(input.setId, movement.destination),
    labelKey: 'move.movement.destination',
    selection: destinationSelection(input.setId, movement.destination),
  },
  movement,
})

const choiceForDirection = (
  input: AuthoritativeMovementChoiceInputBase,
  direction: MoveAutomationAreaDirection,
  movement: AuthoritativeMovementSuccess,
): AuthoritativeMovementChoice => ({
  option: {
    id: directionOptionId(input.setId, direction, movement.destination),
    labelKey: `move.movement.direction.${direction}`,
    selection: directionSelection(input.setId, direction, movement.destination),
  },
  movement,
})

const assertOptionLimit = (choices: readonly AuthoritativeMovementChoice[]): void => {
  if (choices.length > AUTHORITATIVE_MOVEMENT_CHOICE_LIMITS.options) {
    fail(
      'movement-choice-option-limit',
      `Movement choice resolved ${choices.length} options; at most ${AUTHORITATIVE_MOVEMENT_CHOICE_LIMITS.options} are allowed.`,
    )
  }
}

const enumerateDestinations = (
  input: EnumerateAuthoritativeDestinationChoicesInput,
): AuthoritativeMovementChoiceSet => {
  const origin = validateBaseInput(input)
  const candidates = normalizedCandidates(input, origin)
  const choices: AuthoritativeMovementChoice[] = []
  const reads: AuthoritativeMovementSheetRead[] = []
  for (const destination of candidates) {
    const result = resolveDestination(input, destination)
    reads.push(...result.sheetReads)
    if (!result.ok) continue
    choices.push(choiceForDestination(input, result))
    assertOptionLimit(choices)
  }
  return deepFreeze({
    kind: 'destination',
    setId: input.setId,
    placementId: input.placementId,
    maximumDistance: input.maximumDistance,
    choices,
    sheetReads: deduplicateSheetReads(reads),
  })
}

const legalDirectionMovement = (
  input: EnumerateAuthoritativeDirectionChoicesInput,
  origin: GridAnchor,
  direction: MoveAutomationAreaDirection,
  reads: AuthoritativeMovementSheetRead[],
): AuthoritativeMovementSuccess | null => {
  const steps = buildMoveAutomationPassDirectionSteps({
    origin,
    direction,
    maximumDistance: input.maximumDistance,
  })
  for (const step of [...steps].reverse()) {
    const result = resolveDestination(input, step.position)
    reads.push(...result.sheetReads)
    if (result.ok) return result
  }
  return null
}

const enumerateDirections = (
  input: EnumerateAuthoritativeDirectionChoicesInput,
): AuthoritativeMovementChoiceSet => {
  const origin = validateBaseInput(input)
  if (
    input.directions.length === 0
    || input.directions.length > MOVE_AUTOMATION_AREA_DIRECTIONS.length
    || new Set(input.directions).size !== input.directions.length
    || input.directions.some(direction => !MOVEMENT_DIRECTION_SET.has(direction))
  ) {
    return fail(
      'movement-choice-invalid',
      'Movement direction choices must contain one to ten distinct reviewed directions.',
    )
  }
  const choices: AuthoritativeMovementChoice[] = []
  const reads: AuthoritativeMovementSheetRead[] = []
  for (const direction of input.directions) {
    const movement = legalDirectionMovement(input, origin, direction, reads)
    if (movement) choices.push(choiceForDirection(input, direction, movement))
  }
  assertOptionLimit(choices)
  return deepFreeze({
    kind: 'direction',
    setId: input.setId,
    placementId: input.placementId,
    maximumDistance: input.maximumDistance,
    choices,
    sheetReads: deduplicateSheetReads(reads),
  })
}

/** Enumerate one bounded server-owned movement option set through the oracle. */
export const enumerateAuthoritativeMovementChoices = (
  input: EnumerateAuthoritativeMovementChoicesInput,
): AuthoritativeMovementChoiceSet => input.kind === 'direction'
  ? enumerateDirections(input)
  : enumerateDestinations(input)

const expectedOptionId = (selection: PendingMoveMovementSelection): string => (
  selection.kind === 'movement-direction'
    ? directionOptionId(selection.setId, selection.direction, selection.destination)
    : destinationOptionId(selection.setId, selection.destination)
)

/**
 * Revalidate one stored server-issued option against fresh authoritative state.
 * A changed endpoint, direction set, occupancy, capability, path, or distance
 * fails rather than accepting coordinate material from the response command.
 */
export const revalidateAuthoritativeMovementChoice = (
  input: RevalidateAuthoritativeMovementChoiceInput,
): AuthoritativeMovementChoice => {
  validateBaseInput(input)
  const selection = input.option.selection
  if (
    !selection
    || selection.setId !== input.setId
    || input.option.id !== expectedOptionId(selection)
    || (input.kind === 'destination' && selection.kind !== 'movement-destination')
    || (input.kind === 'direction' && selection.kind !== 'movement-direction')
  ) {
    return fail(
      'movement-choice-option-unknown',
      'Movement response option does not belong to the reviewed server choice set.',
    )
  }

  if (selection.kind === 'movement-direction') {
    if (!input.directions?.includes(selection.direction)) {
      return fail(
        'movement-choice-option-unknown',
        'Movement response direction is not in the reviewed direction set.',
      )
    }
    const set = enumerateDirections({
      kind: 'direction',
      map: input.map,
      sheets: input.sheets,
      placementId: input.placementId,
      setId: input.setId,
      maximumDistance: input.maximumDistance,
      directions: input.directions,
    })
    const current = set.choices.find(choice => choice.option.id === input.option.id)
    if (!current || !sameAnchor(current.movement.destination, selection.destination)) {
      return fail(
        'movement-choice-stale',
        'The selected movement direction no longer resolves to its server-issued destination.',
      )
    }
    return current
  }

  const result = resolveDestination(input, selection.destination)
  if (!result.ok) {
    return fail(
      'movement-choice-stale',
      `The selected movement destination is no longer legal (${result.reasonCode}).`,
    )
  }
  return deepFreeze(choiceForDestination(input, result))
}
