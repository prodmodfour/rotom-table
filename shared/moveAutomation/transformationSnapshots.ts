import type {
  MovementCapabilitySpeeds,
  MovementCapabilityTraits,
} from '~/types/movement'
import type { SpriteAnimation, SpriteCrop } from '~/types/pokemon'

/** Hard bounds for one durable, server-authored Transform snapshot. */
export const ENCOUNTER_TRANSFORMATION_LIMITS = Object.freeze({
  moves: 64,
  types: 4,
  abilities: 32,
  otherCapabilities: 64,
  identifierChars: 160,
  textChars: 160,
  urlChars: 500,
  animationFrames: 512,
  animationDimension: 4096,
  animationDurationMs: 3_600_000,
  numericMagnitude: 1_000_000,
})

export interface EncounterTransformationMoveSnapshot {
  readonly canonicalMoveId: string
  /** Exact reviewed runtime copied when Transform resolved. */
  readonly copiedSpecHash: string
}

/** Closed capability snapshot used as Transform's immutable projection base. */
export interface EncounterTransformationCapabilitySnapshot {
  readonly movementSpeeds: MovementCapabilitySpeeds
  readonly movementTraits: MovementCapabilityTraits
  readonly power: number | null
  readonly size: string | null
  readonly naturewalk: string | null
  readonly other: readonly string[]
}

/** Renderer-safe form data copied into map projection without changing sheet identity. */
export interface EncounterTransformationAppearanceSnapshot {
  readonly species: string
  readonly size: string
  readonly width: number
  readonly height: number
  readonly base: number
  readonly clearance: number
  readonly slug: string
  readonly spriteUrl: string
  readonly profileSpriteUrl: string | null
  readonly backSpriteUrl: string | null
  readonly spriteAnimation: SpriteAnimation | null
  readonly backSpriteAnimation: SpriteAnimation | null
  readonly spriteCrop: SpriteCrop | null
}

/**
 * Complete volatile form copied at Transform resolution time.
 *
 * HP, injuries, stats, stages, conditions, items, level, identity, and every
 * other user-owned value are deliberately absent. They continue to project
 * from the transforming user's authoritative sheet/map state.
 */
export interface EncounterTransformationEffectPayload {
  readonly copiedFromPlacementId: string
  readonly moves: readonly EncounterTransformationMoveSnapshot[]
  readonly typeIds: readonly string[]
  readonly abilityNames: readonly string[]
  readonly weightClass: number
  readonly capabilities: EncounterTransformationCapabilitySnapshot
  readonly appearance: EncounterTransformationAppearanceSnapshot
}

export type EncounterTransformationValidationCode =
  | 'invalid-transformation-snapshot'
  | 'limit-exceeded'
  | 'duplicate-id'

export class EncounterTransformationValidationError extends Error {
  readonly code: EncounterTransformationValidationCode
  readonly path: string
  readonly detail: string

  constructor(
    code: EncounterTransformationValidationCode,
    path: string,
    detail: string,
  ) {
    super(`${path}: ${detail}`)
    this.name = 'EncounterTransformationValidationError'
    this.code = code
    this.path = path
    this.detail = detail
  }
}

type UnknownRecord = Record<string, unknown>

const PAYLOAD_FIELDS = [
  'copiedFromPlacementId',
  'moves',
  'typeIds',
  'abilityNames',
  'weightClass',
  'capabilities',
  'appearance',
] as const
const MOVE_FIELDS = ['canonicalMoveId', 'copiedSpecHash'] as const
const CAPABILITY_FIELDS = [
  'movementSpeeds',
  'movementTraits',
  'power',
  'size',
  'naturewalk',
  'other',
] as const
const MOVEMENT_SPEED_FIELDS = [
  'overland',
  'sky',
  'swim',
  'levitate',
  'burrow',
  'climb',
  'teleporter',
] as const
const MOVEMENT_TRAIT_FIELDS = ['phasing', 'jump'] as const
const JUMP_FIELDS = ['long', 'high'] as const
const APPEARANCE_FIELDS = [
  'species',
  'size',
  'width',
  'height',
  'base',
  'clearance',
  'slug',
  'spriteUrl',
  'profileSpriteUrl',
  'backSpriteUrl',
  'spriteAnimation',
  'backSpriteAnimation',
  'spriteCrop',
] as const
const ANIMATION_FIELDS = [
  'url',
  'frameWidth',
  'frameHeight',
  'frames',
  'columns',
  'rows',
  'durationsMs',
  'totalDurationMs',
] as const
const CROP_FIELDS = ['canvasWidth', 'canvasHeight', 'left', 'top', 'width', 'height'] as const

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const SHA_256_PATTERN = /^[a-f0-9]{64}$/
const SAFE_ASSET_PATH_PATTERN = /^\/(?!\/)[^\\\u0000-\u001f\u007f]*$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

const fail = (
  code: EncounterTransformationValidationCode,
  path: string,
  detail: string,
): never => {
  throw new EncounterTransformationValidationError(code, path, detail)
}

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const parseRecord = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainRecord(value)) {
    return fail('invalid-transformation-snapshot', path, 'must be a plain object.')
  }
  return value
}

const parseExactRecord = (
  value: unknown,
  fields: readonly string[],
  path: string,
): UnknownRecord => {
  const record = parseRecord(value, path)
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(record, field))
  const unknown = Object.keys(record).filter(field => !expected.has(field))
  if (missing.length > 0 || unknown.length > 0) {
    const details = [
      missing.length > 0 ? `missing ${missing.join(', ')}` : '',
      unknown.length > 0 ? `unknown ${unknown.join(', ')}` : '',
    ].filter(Boolean).join('; ')
    fail(
      'invalid-transformation-snapshot',
      path,
      `must contain exactly the supported fields (${details}).`,
    )
  }
  return record
}

const parseArray = (
  value: unknown,
  path: string,
  maximum: number,
): readonly unknown[] => {
  if (!Array.isArray(value)) {
    return fail('invalid-transformation-snapshot', path, 'must be an array.')
  }
  if (value.length > maximum) {
    fail('limit-exceeded', path, `must contain at most ${maximum} entries.`)
  }
  return value
}

const assertUnique = (values: readonly string[], path: string): void => {
  if (new Set(values).size !== values.length) {
    fail('duplicate-id', path, 'must not contain duplicate values.')
  }
}

const parseStableId = (value: unknown, path: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > ENCOUNTER_TRANSFORMATION_LIMITS.identifierChars
    || value.trim() !== value
    || !STABLE_ID_PATTERN.test(value)
  ) {
    return fail(
      'invalid-transformation-snapshot',
      path,
      `must be a lowercase stable identifier of at most ${ENCOUNTER_TRANSFORMATION_LIMITS.identifierChars} characters.`,
    )
  }
  return value
}

const parseText = (value: unknown, path: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > ENCOUNTER_TRANSFORMATION_LIMITS.textChars
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return fail(
      'invalid-transformation-snapshot',
      path,
      `must be trimmed text of at most ${ENCOUNTER_TRANSFORMATION_LIMITS.textChars} characters without control characters.`,
    )
  }
  return value
}

const parseNullableText = (value: unknown, path: string): string | null => (
  value === null ? null : parseText(value, path)
)

const parseInteger = (
  value: unknown,
  path: string,
  minimum: number,
  maximum: number = ENCOUNTER_TRANSFORMATION_LIMITS.numericMagnitude,
): number => {
  if (!Number.isSafeInteger(value)) {
    return fail('invalid-transformation-snapshot', path, 'must be a safe integer.')
  }
  const parsed = Number(value)
  if (parsed < minimum || parsed > maximum) {
    fail('limit-exceeded', path, `must be from ${minimum} through ${maximum}.`)
  }
  return parsed
}

const parseFiniteNumber = (
  value: unknown,
  path: string,
  minimum: number,
): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail('invalid-transformation-snapshot', path, 'must be a finite number.')
  }
  if (
    value < minimum
    || value > ENCOUNTER_TRANSFORMATION_LIMITS.numericMagnitude
  ) {
    fail(
      'limit-exceeded',
      path,
      `must be from ${minimum} through ${ENCOUNTER_TRANSFORMATION_LIMITS.numericMagnitude}.`,
    )
  }
  return value
}

const parseAssetPath = (value: unknown, path: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > ENCOUNTER_TRANSFORMATION_LIMITS.urlChars
    || value.trim() !== value
    || !SAFE_ASSET_PATH_PATTERN.test(value)
  ) {
    return fail(
      'invalid-transformation-snapshot',
      path,
      `must be a root-relative asset path of at most ${ENCOUNTER_TRANSFORMATION_LIMITS.urlChars} characters.`,
    )
  }
  return value
}

const parseNullableAssetPath = (value: unknown, path: string): string | null => (
  value === null ? null : parseAssetPath(value, path)
)

const parseUniqueTextList = (
  value: unknown,
  path: string,
  maximum: number,
  normalize: (value: string) => string = value => value.toLowerCase(),
): readonly string[] => {
  const values = parseArray(value, path, maximum)
    .map((entry, index) => parseText(entry, `${path}[${index}]`))
  assertUnique(values.map(normalize), path)
  return values
}

const parseMoves = (
  value: unknown,
  path: string,
): readonly EncounterTransformationMoveSnapshot[] => {
  const moves = parseArray(value, path, ENCOUNTER_TRANSFORMATION_LIMITS.moves)
    .map((entry, index): EncounterTransformationMoveSnapshot => {
      const movePath = `${path}[${index}]`
      const move = parseExactRecord(entry, MOVE_FIELDS, movePath)
      const copiedSpecHash = move.copiedSpecHash
      if (typeof copiedSpecHash !== 'string' || !SHA_256_PATTERN.test(copiedSpecHash)) {
        fail(
          'invalid-transformation-snapshot',
          `${movePath}.copiedSpecHash`,
          'must be a lowercase SHA-256 hash.',
        )
      }
      return {
        canonicalMoveId: parseText(move.canonicalMoveId, `${movePath}.canonicalMoveId`),
        copiedSpecHash: copiedSpecHash as string,
      }
    })
  assertUnique(moves.map(move => move.canonicalMoveId.toLowerCase()), `${path}.canonicalMoveId`)
  return moves
}

const parseMovementSpeeds = (
  value: unknown,
  path: string,
): MovementCapabilitySpeeds => {
  const speeds = parseRecord(value, path)
  const supported = new Set<string>(MOVEMENT_SPEED_FIELDS)
  const unknown = Object.keys(speeds).filter(field => !supported.has(field))
  if (unknown.length > 0) {
    fail(
      'invalid-transformation-snapshot',
      path,
      `contains unknown movement speeds ${unknown.join(', ')}.`,
    )
  }
  const parsed: MovementCapabilitySpeeds = {}
  for (const key of MOVEMENT_SPEED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(speeds, key)) continue
    parsed[key] = parseInteger(speeds[key], `${path}.${key}`, 0)
  }
  return parsed
}

const parseMovementTraits = (
  value: unknown,
  path: string,
): MovementCapabilityTraits => {
  const traits = parseExactRecord(value, MOVEMENT_TRAIT_FIELDS, path)
  if (typeof traits.phasing !== 'boolean') {
    fail('invalid-transformation-snapshot', `${path}.phasing`, 'must be a boolean.')
  }
  const jump = parseExactRecord(traits.jump, JUMP_FIELDS, `${path}.jump`)
  return {
    phasing: traits.phasing as boolean,
    jump: {
      long: parseInteger(jump.long, `${path}.jump.long`, 0),
      high: parseInteger(jump.high, `${path}.jump.high`, 0),
    },
  }
}

const parseCapabilities = (
  value: unknown,
  path: string,
): EncounterTransformationCapabilitySnapshot => {
  const capabilities = parseExactRecord(value, CAPABILITY_FIELDS, path)
  return {
    movementSpeeds: parseMovementSpeeds(
      capabilities.movementSpeeds,
      `${path}.movementSpeeds`,
    ),
    movementTraits: parseMovementTraits(
      capabilities.movementTraits,
      `${path}.movementTraits`,
    ),
    power: capabilities.power === null
      ? null
      : parseInteger(capabilities.power, `${path}.power`, 0),
    size: parseNullableText(capabilities.size, `${path}.size`),
    naturewalk: parseNullableText(capabilities.naturewalk, `${path}.naturewalk`),
    other: parseUniqueTextList(
      capabilities.other,
      `${path}.other`,
      ENCOUNTER_TRANSFORMATION_LIMITS.otherCapabilities,
    ),
  }
}

const parseAnimation = (
  value: unknown,
  path: string,
): SpriteAnimation | null => {
  if (value === null) return null
  const animation = parseExactRecord(value, ANIMATION_FIELDS, path)
  const frames = parseInteger(
    animation.frames,
    `${path}.frames`,
    1,
    ENCOUNTER_TRANSFORMATION_LIMITS.animationFrames,
  )
  const columns = parseInteger(
    animation.columns,
    `${path}.columns`,
    1,
    ENCOUNTER_TRANSFORMATION_LIMITS.animationDimension,
  )
  const rows = parseInteger(
    animation.rows,
    `${path}.rows`,
    1,
    ENCOUNTER_TRANSFORMATION_LIMITS.animationDimension,
  )
  if (frames > columns * rows) {
    fail(
      'invalid-transformation-snapshot',
      path,
      'frame count must fit within the declared rows and columns.',
    )
  }
  const durationsMs = parseArray(
    animation.durationsMs,
    `${path}.durationsMs`,
    ENCOUNTER_TRANSFORMATION_LIMITS.animationFrames,
  ).map((duration, index) => parseInteger(
    duration,
    `${path}.durationsMs[${index}]`,
    1,
    ENCOUNTER_TRANSFORMATION_LIMITS.animationDurationMs,
  ))
  if (durationsMs.length !== frames) {
    fail(
      'invalid-transformation-snapshot',
      `${path}.durationsMs`,
      'must contain exactly one duration per frame.',
    )
  }
  const totalDurationMs = parseInteger(
    animation.totalDurationMs,
    `${path}.totalDurationMs`,
    1,
    ENCOUNTER_TRANSFORMATION_LIMITS.animationDurationMs,
  )
  if (durationsMs.reduce((total, duration) => total + duration, 0) !== totalDurationMs) {
    fail(
      'invalid-transformation-snapshot',
      `${path}.totalDurationMs`,
      'must equal the sum of frame durations.',
    )
  }
  return {
    url: parseAssetPath(animation.url, `${path}.url`),
    frameWidth: parseInteger(
      animation.frameWidth,
      `${path}.frameWidth`,
      1,
      ENCOUNTER_TRANSFORMATION_LIMITS.animationDimension,
    ),
    frameHeight: parseInteger(
      animation.frameHeight,
      `${path}.frameHeight`,
      1,
      ENCOUNTER_TRANSFORMATION_LIMITS.animationDimension,
    ),
    frames,
    columns,
    rows,
    durationsMs,
    totalDurationMs,
  }
}

const parseCrop = (value: unknown, path: string): SpriteCrop | null => {
  if (value === null) return null
  const crop = parseExactRecord(value, CROP_FIELDS, path)
  const canvasWidth = parseFiniteNumber(crop.canvasWidth, `${path}.canvasWidth`, 1)
  const canvasHeight = parseFiniteNumber(crop.canvasHeight, `${path}.canvasHeight`, 1)
  const left = parseFiniteNumber(crop.left, `${path}.left`, 0)
  const top = parseFiniteNumber(crop.top, `${path}.top`, 0)
  const width = parseFiniteNumber(crop.width, `${path}.width`, 1)
  const height = parseFiniteNumber(crop.height, `${path}.height`, 1)
  if (left + width > canvasWidth || top + height > canvasHeight) {
    fail('invalid-transformation-snapshot', path, 'crop must fit within its canvas.')
  }
  return { canvasWidth, canvasHeight, left, top, width, height }
}

const parseAppearance = (
  value: unknown,
  path: string,
): EncounterTransformationAppearanceSnapshot => {
  const appearance = parseExactRecord(value, APPEARANCE_FIELDS, path)
  return {
    species: parseText(appearance.species, `${path}.species`),
    size: parseText(appearance.size, `${path}.size`),
    width: parseFiniteNumber(appearance.width, `${path}.width`, Number.EPSILON),
    height: parseFiniteNumber(appearance.height, `${path}.height`, Number.EPSILON),
    base: parseFiniteNumber(appearance.base, `${path}.base`, Number.EPSILON),
    clearance: parseFiniteNumber(
      appearance.clearance,
      `${path}.clearance`,
      Number.EPSILON,
    ),
    slug: parseStableId(appearance.slug, `${path}.slug`),
    spriteUrl: parseAssetPath(appearance.spriteUrl, `${path}.spriteUrl`),
    profileSpriteUrl: parseNullableAssetPath(
      appearance.profileSpriteUrl,
      `${path}.profileSpriteUrl`,
    ),
    backSpriteUrl: parseNullableAssetPath(
      appearance.backSpriteUrl,
      `${path}.backSpriteUrl`,
    ),
    spriteAnimation: parseAnimation(
      appearance.spriteAnimation,
      `${path}.spriteAnimation`,
    ),
    backSpriteAnimation: parseAnimation(
      appearance.backSpriteAnimation,
      `${path}.backSpriteAnimation`,
    ),
    spriteCrop: parseCrop(appearance.spriteCrop, `${path}.spriteCrop`),
  }
}

/** Strictly parse and detach one durable transformation payload. */
export const parseEncounterTransformationEffectPayload = (
  value: unknown,
  path = 'transformationSnapshot',
): EncounterTransformationEffectPayload => {
  const payload = parseExactRecord(value, PAYLOAD_FIELDS, path)
  const typeIds = parseUniqueTextList(
    payload.typeIds,
    `${path}.typeIds`,
    ENCOUNTER_TRANSFORMATION_LIMITS.types,
    typeId => typeId.toLowerCase(),
  )
  if (typeIds.length === 0) {
    fail('invalid-transformation-snapshot', `${path}.typeIds`, 'must contain at least one type.')
  }
  return {
    copiedFromPlacementId: parseStableId(
      payload.copiedFromPlacementId,
      `${path}.copiedFromPlacementId`,
    ),
    moves: parseMoves(payload.moves, `${path}.moves`),
    typeIds,
    abilityNames: parseUniqueTextList(
      payload.abilityNames,
      `${path}.abilityNames`,
      ENCOUNTER_TRANSFORMATION_LIMITS.abilities,
      ability => ability.toLowerCase(),
    ),
    weightClass: parseInteger(payload.weightClass, `${path}.weightClass`, 1),
    capabilities: parseCapabilities(payload.capabilities, `${path}.capabilities`),
    appearance: parseAppearance(payload.appearance, `${path}.appearance`),
  }
}
