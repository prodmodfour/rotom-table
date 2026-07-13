import type { CharacterSheet } from '~/types/characterSheet'
import type { MovementSemiInvulnerableState } from '~/types/movement'
import type { SheetKind, SheetPlacement } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'
import { findItem, toSlug } from '~~/data/ptuReference'
import {
  hasGroundsourceImmunityCapability,
  hasSoundproofAbility,
} from '~/utils/sheetPassiveAbilityEffects'
import { moveAutomationTargetSuppressesGroundsourceImmunity } from '~/utils/moveAutomationKeywordImmunity'
import { normalizeMoveAutomationSpecialConditionName } from '~/utils/moveAutomationSpecialConditions'
import { conditionLookupKey } from '~/utils/statusConditions'
import { resolveCapabilities } from '~/utils/sheets/pokemonDerived'
import { POKEMON_TYPES } from '~/utils/typeChart'
import type { MoveAutomationHistoryResolver } from './history'

export const MOVE_AUTOMATION_TARGET_VITALITIES = [
  'conscious',
  'fainted',
] as const

export const MOVE_AUTOMATION_TARGET_GROUNDING_STATES = [
  'grounded',
  'airborne',
] as const

export const MOVE_AUTOMATION_TARGET_SIZES = [
  'small',
  'medium',
  'large',
  'huge',
  'gigantic',
] as const

/** Keyword immunities currently derivable from authoritative token state. */
export const MOVE_AUTOMATION_TARGET_IMMUNITY_TAG_IDS = [
  'groundsource',
  'powder',
  'sonic',
] as const

export type MoveAutomationTargetVitality =
  (typeof MOVE_AUTOMATION_TARGET_VITALITIES)[number]
export type MoveAutomationTargetGrounding =
  (typeof MOVE_AUTOMATION_TARGET_GROUNDING_STATES)[number]
export type MoveAutomationTargetSize =
  (typeof MOVE_AUTOMATION_TARGET_SIZES)[number]

export interface MoveAutomationTargetState {
  readonly targetPlacementId: string
  readonly vitality: MoveAutomationTargetVitality
  readonly grounding: MoveAutomationTargetGrounding
  /** Separate from grounding and visual elevation; MA-129 adds targetability semantics. */
  readonly semiInvulnerable: MovementSemiInvulnerableState
  readonly switchedThisScene: boolean
  readonly actedThisTurn: boolean
  readonly actedThisRound: boolean
  readonly damagedThisTurn: boolean
  readonly damagedThisRound: boolean
  /** Canonical lowercase condition IDs, including encounter-projected conditions. */
  readonly conditionIds: readonly string[]
  /** Canonical lowercase Pokémon type IDs. Trainers normally have none. */
  readonly typeIds: readonly string[]
  /** Stable server-derived immunity tags; never supplied by move intent. */
  readonly immunityTagIds: readonly string[]
  readonly size: MoveAutomationTargetSize | null
  readonly weightClass: number | null
  readonly sheetKind: SheetKind
  /** Canonical item slugs for currently held/equipped target items. */
  readonly itemIds: readonly string[]
}

export interface MoveAutomationTargetStateResolver {
  /** Resolving a present placement records its backing sheet as consulted. */
  resolve(targetPlacementId: string): MoveAutomationTargetState | null
}

export interface MoveAutomationTargetStateSheetSnapshot {
  readonly kind: SheetKind
  readonly slug: string
  readonly sheet: CharacterSheet | TrainerSheet
}

export interface CreateMoveAutomationTargetStateResolverInput {
  readonly placements: readonly SheetPlacement[]
  readonly tokens: readonly SpawnedPokemon[]
  readonly sheets: readonly MoveAutomationTargetStateSheetSnapshot[]
  readonly history: MoveAutomationHistoryResolver
  /** Authoritative context read-set seam. Standalone pure queries may omit it. */
  readonly recordSheetRead?: (
    placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
  ) => void
}

export type MoveAutomationTargetStateQueryErrorCode =
  | 'duplicate-placement-id'
  | 'duplicate-token-id'
  | 'duplicate-sheet-reference'

export class MoveAutomationTargetStateQueryError extends Error {
  readonly code: MoveAutomationTargetStateQueryErrorCode

  constructor(code: MoveAutomationTargetStateQueryErrorCode, message: string) {
    super(message)
    this.name = 'MoveAutomationTargetStateQueryError'
    this.code = code
  }
}

const fail = (
  code: MoveAutomationTargetStateQueryErrorCode,
  message: string,
): never => {
  throw new MoveAutomationTargetStateQueryError(code, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const uniqueStrings = (values: Iterable<string>): readonly string[] => {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return Object.freeze(result)
}

const placementKey = (
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
): string => `${placement.sheetKind}:${placement.sheetSlug}`

const indexedByUniqueId = <Value>(
  values: readonly Value[],
  idFor: (value: Value) => string,
  code: Extract<
    MoveAutomationTargetStateQueryErrorCode,
    'duplicate-placement-id' | 'duplicate-token-id'
  >,
  label: string,
): ReadonlyMap<string, Value> => {
  const indexed = new Map<string, Value>()
  for (const value of values) {
    const id = idFor(value)
    if (indexed.has(id)) fail(code, `${label} ${id} was listed more than once.`)
    indexed.set(id, value)
  }
  return indexed
}

const indexedSheets = (
  sheets: readonly MoveAutomationTargetStateSheetSnapshot[],
): ReadonlyMap<string, MoveAutomationTargetStateSheetSnapshot> => {
  const indexed = new Map<string, MoveAutomationTargetStateSheetSnapshot>()
  for (const sheet of sheets) {
    const key = `${sheet.kind}:${sheet.slug}`
    if (indexed.has(key)) {
      fail('duplicate-sheet-reference', `Target-state sheet ${key} was listed more than once.`)
    }
    indexed.set(key, sheet)
  }
  return indexed
}

const normalizedConditionIds = (
  conditions: readonly string[],
): readonly string[] => uniqueStrings(conditions.flatMap((condition) => {
  const normalized = normalizeMoveAutomationSpecialConditionName(condition)
  return normalized ? [conditionLookupKey(normalized)] : []
}))

const TYPE_ID_BY_LOWERCASE = new Map(
  POKEMON_TYPES.map(type => [type.toLowerCase(), type.toLowerCase()]),
)

const normalizedTypeIds = (types: readonly string[]): readonly string[] => (
  uniqueStrings(types.flatMap((type) => {
    const normalized = TYPE_ID_BY_LOWERCASE.get(type.trim().toLowerCase())
    return normalized ? [normalized] : []
  }))
)

const normalizedTargetSize = (value: unknown): MoveAutomationTargetSize | null => {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return (MOVE_AUTOMATION_TARGET_SIZES as readonly string[]).includes(normalized)
    ? normalized as MoveAutomationTargetSize
    : null
}

const normalizedWeightClass = (value: unknown): number | null => {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

const pokemonSizeAndWeight = (
  sheet: CharacterSheet,
  token: SpawnedPokemon,
): Pick<MoveAutomationTargetState, 'size' | 'weightClass'> => {
  const rows = resolveCapabilities(sheet).rows
  return {
    size: normalizedTargetSize(
      rows.find(row => row.label === 'Size')?.value ?? token.size,
    ),
    weightClass: normalizedWeightClass(
      rows.find(row => row.label === 'Weight')?.value,
    ),
  }
}

const canonicalItemId = (itemName: string): string | null => {
  const canonicalName = findItem(itemName)?.name ?? itemName.trim()
  const itemId = toSlug(canonicalName)
  return itemId || null
}

const normalizedItemIds = (items: readonly string[]): readonly string[] => (
  uniqueStrings(items.flatMap((item) => {
    const itemId = canonicalItemId(item)
    return itemId ? [itemId] : []
  }))
)

const targetGrounding = (token: SpawnedPokemon): MoveAutomationTargetGrounding => (
  token.movementProfile?.state.grounding
  ?? (
    hasGroundsourceImmunityCapability(token.defenderCapabilities)
    && !moveAutomationTargetSuppressesGroundsourceImmunity(token)
      ? 'airborne'
      : 'grounded'
  )
)

const targetImmunityTagIds = (
  token: SpawnedPokemon,
  typeIds: readonly string[],
  grounding: MoveAutomationTargetGrounding,
): readonly string[] => {
  const tags: string[] = []
  if (grounding === 'airborne') tags.push('groundsource')
  if (typeIds.includes('grass')) tags.push('powder')
  if (hasSoundproofAbility(token.abilityNames)) tags.push('sonic')
  return Object.freeze(tags)
}

const targetState = (options: {
  readonly placement: SheetPlacement
  readonly token: SpawnedPokemon
  readonly sheet: MoveAutomationTargetStateSheetSnapshot
  readonly history: MoveAutomationHistoryResolver
}): MoveAutomationTargetState | null => {
  if (
    options.token.sheetKind !== options.placement.sheetKind
    || options.token.sheetSlug !== options.placement.sheetSlug
    || options.sheet.kind !== options.placement.sheetKind
    || options.sheet.slug !== options.placement.sheetSlug
  ) return null

  const conditionIds = normalizedConditionIds(options.token.conditions)
  const typeIds = normalizedTypeIds(options.token.defenderTypes)
  const grounding = targetGrounding(options.token)
  const sizeAndWeight = options.placement.sheetKind === 'pokemon'
    ? pokemonSizeAndWeight(options.sheet.sheet as CharacterSheet, options.token)
    : { size: normalizedTargetSize(options.token.size), weightClass: null }

  return deepFreeze({
    targetPlacementId: options.placement.id,
    vitality: options.token.currentHp <= 0 || conditionIds.includes('fainted')
      ? 'fainted'
      : 'conscious',
    grounding,
    semiInvulnerable: options.token.movementProfile?.state.semiInvulnerable ?? 'none',
    switchedThisScene: options.history.switchedThisScene(options.placement.id),
    actedThisTurn: options.history.actedThisTurn(options.placement.id),
    actedThisRound: options.history.actedThisRound(options.placement.id),
    damagedThisTurn: options.history.damageReceivedThisTurn(options.placement.id).totalLoss > 0,
    damagedThisRound: options.history.damageReceivedThisRound(options.placement.id).totalLoss > 0,
    conditionIds,
    typeIds,
    immunityTagIds: targetImmunityTagIds(options.token, typeIds, grounding),
    ...sizeAndWeight,
    sheetKind: options.placement.sheetKind,
    itemIds: normalizedItemIds(options.token.tokenItems),
  })
}

/**
 * Snapshot every server-owned target fact once and expose placement-ID-only
 * queries. Client target data, prose, display height, and ownership never enter
 * these mechanics facts.
 */
export const createMoveAutomationTargetStateResolver = (
  input: CreateMoveAutomationTargetStateResolverInput,
): MoveAutomationTargetStateResolver => {
  const placements = indexedByUniqueId(
    input.placements,
    placement => placement.id,
    'duplicate-placement-id',
    'Target-state placement',
  )
  const tokens = indexedByUniqueId(
    input.tokens,
    token => token.id,
    'duplicate-token-id',
    'Target-state token',
  )
  const sheets = indexedSheets(input.sheets)
  const states = new Map<string, MoveAutomationTargetState | null>()
  const sheetReadRefs = new Map(input.placements.map(placement => [
    placement.id,
    Object.freeze({
      sheetKind: placement.sheetKind,
      sheetSlug: placement.sheetSlug,
    }),
  ]))
  const recordSheetRead = input.recordSheetRead

  for (const placement of input.placements) {
    const token = tokens.get(placement.id)
    const sheet = sheets.get(placementKey(placement))
    states.set(
      placement.id,
      token && sheet
        ? targetState({ placement, token, sheet, history: input.history })
        : null,
    )
  }

  return Object.freeze({
    resolve: (targetPlacementId: string): MoveAutomationTargetState | null => {
      if (!placements.has(targetPlacementId)) return null
      const sheetRead = sheetReadRefs.get(targetPlacementId)
      if (sheetRead) recordSheetRead?.(sheetRead)
      return states.get(targetPlacementId) ?? null
    },
  })
}
