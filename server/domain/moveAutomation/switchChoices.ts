import { createHash } from 'node:crypto'
import type {
  MoveEffectSwitchInitiativePolicy,
  MoveEffectSwitchPositionPolicy,
} from '#shared/moveAutomation/effects'
import type { PendingMoveResponseOption } from '#shared/moveAutomation/responseOptions'
import { isSlug } from '#shared/paths'
import type { SheetPlacement } from '~/types/map'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { canPlacePokemon } from '~/utils/gridPlacement'
import type { PositionedGridFootprint } from '~/utils/gridGeometry'
import { placementToSpawned, type SheetLookup } from '~/utils/placement'
import {
  tokenFacingForPlacement,
  tokenFacingStoresLegacyTurned,
} from '~/utils/tokenFacing'
import { buildVoxelOccupancy } from '~/utils/voxelOccupancy'
import type {
  AuthoritativeMoveRulesContext,
  AuthoritativeMoveSheetRead,
} from './context'

export const AUTHORITATIVE_SWITCH_CHOICE_LIMITS = Object.freeze({
  rosterEntries: 32,
  choices: 32,
})

export type AuthoritativeSwitchChoiceErrorCode =
  | 'switch-choice-invalid'
  | 'switch-choice-roster-limit'
  | 'switch-choice-owner-ambiguous'
  | 'switch-choice-option-unknown'

export class AuthoritativeSwitchChoiceError extends Error {
  readonly code: AuthoritativeSwitchChoiceErrorCode

  constructor(code: AuthoritativeSwitchChoiceErrorCode, message: string) {
    super(message)
    this.name = 'AuthoritativeSwitchChoiceError'
    this.code = code
  }
}

export interface AuthoritativeSwitchChoice {
  readonly option: PendingMoveResponseOption
  readonly trainerPlacementId: string
  readonly trainerSheetSlug: string
  readonly recalledPlacementId: string
  readonly replacementSheetSlug: string
  readonly sentOutPlacement: SheetPlacement
}

export interface AuthoritativeSwitchChoiceSet {
  readonly setId: string
  readonly recalledPlacementId: string
  readonly trainerPlacementId: string | null
  readonly trainerSheetSlug: string | null
  readonly positionPolicy: MoveEffectSwitchPositionPolicy
  readonly initiativePolicy: MoveEffectSwitchInitiativePolicy
  readonly choices: readonly AuthoritativeSwitchChoice[]
  readonly sheetReads: readonly AuthoritativeMoveSheetRead[]
}

export interface EnumerateAuthoritativeSwitchChoicesInput {
  readonly context: AuthoritativeMoveRulesContext
  readonly recalledPlacementId: string
  readonly setId: string
  readonly positionPolicy: MoveEffectSwitchPositionPolicy
  readonly initiativePolicy: MoveEffectSwitchInitiativePolicy
}

export interface RevalidateAuthoritativeSwitchChoiceInput
  extends EnumerateAuthoritativeSwitchChoicesInput {
  readonly optionId: string
}

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/

const fail = (
  code: AuthoritativeSwitchChoiceErrorCode,
  message: string,
): never => {
  throw new AuthoritativeSwitchChoiceError(code, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const stableHash = (value: string): string => (
  createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 24)
)

const assertInput = (input: EnumerateAuthoritativeSwitchChoicesInput): void => {
  if (
    !STABLE_ID_PATTERN.test(input.setId)
    || input.setId.length > 160
    || input.recalledPlacementId.length === 0
    || input.recalledPlacementId.length > 200
    || input.positionPolicy !== 'recalled-position'
    || input.initiativePolicy !== 'inherit-slot'
  ) {
    fail(
      'switch-choice-invalid',
      'Switch choice identity and reviewed placement/initiative policies are invalid.',
    )
  }
}

const normalizedTeam = (sheet: TrainerSheet): readonly string[] => {
  const team = sheet.currentTeam ?? []
  if (!Array.isArray(team) || team.length > AUTHORITATIVE_SWITCH_CHOICE_LIMITS.rosterEntries) {
    return fail(
      'switch-choice-roster-limit',
      `Trainer ${sheet.slug} current team exceeds ${AUTHORITATIVE_SWITCH_CHOICE_LIMITS.rosterEntries} entries.`,
    )
  }
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of team) {
    if (typeof value !== 'string') {
      return fail('switch-choice-invalid', `Trainer ${sheet.slug} has a malformed current-team entry.`)
    }
    const slug = value.trim()
    if (!slug || !isSlug(slug)) {
      return fail('switch-choice-invalid', `Trainer ${sheet.slug} has an invalid current-team slug.`)
    }
    if (seen.has(slug)) continue
    seen.add(slug)
    result.push(slug)
  }
  return result
}

interface SwitchOwner {
  readonly placement: SheetPlacement
  readonly sheet: TrainerSheet
  readonly team: readonly string[]
}

const switchOwner = (
  input: EnumerateAuthoritativeSwitchChoicesInput,
  recalled: SheetPlacement,
): SwitchOwner | null => {
  const bySheet = new Map<string, SwitchOwner>()
  for (const placement of input.context.queries.placements.all()) {
    if (placement.sheetKind !== 'trainer') continue
    const resolved = input.context.queries.sheets.forPlacement(placement)
    if (!resolved || resolved.kind !== 'trainer') continue
    input.context.reads.recordSheet(resolved)
    const sheet = resolved.sheet as TrainerSheet
    const team = normalizedTeam(sheet)
    if (!team.includes(recalled.sheetSlug) || bySheet.has(resolved.slug)) continue
    bySheet.set(resolved.slug, { placement, sheet, team })
  }
  if (bySheet.size > 1) {
    return fail(
      'switch-choice-owner-ambiguous',
      `Pokémon ${recalled.sheetSlug} appears on more than one on-map trainer roster.`,
    )
  }
  return bySheet.values().next().value ?? null
}

const sheetLookup = (context: AuthoritativeMoveRulesContext): SheetLookup => {
  const pokemon = new Map<string, CharacterSheet>()
  const trainer = new Map<string, TrainerSheet>()
  for (const resolved of context.resolvedSheets) {
    if (resolved.kind === 'pokemon') pokemon.set(resolved.slug, resolved.sheet as CharacterSheet)
    else trainer.set(resolved.slug, resolved.sheet as TrainerSheet)
  }
  return { pokemon, trainer }
}

const sentOutPlacementId = (
  setId: string,
  recalledPlacementId: string,
  replacementSheetSlug: string,
): string => `switch.${stableHash(`${setId}:${recalledPlacementId}:${replacementSheetSlug}`)}`

const replacementOption = (
  setId: string,
  recalledPlacementId: string,
  replacementSheetSlug: string,
): PendingMoveResponseOption => ({
  id: `switch.replacement.${stableHash(`${setId}:${recalledPlacementId}:${replacementSheetSlug}`)}`,
  labelKey: `move.switch.replacement.${replacementSheetSlug}`,
})

const inheritedPlacement = (input: {
  readonly recalled: SheetPlacement
  readonly replacementSheetSlug: string
  readonly sentOutPlacementId: string
}): SheetPlacement => {
  const facing = tokenFacingForPlacement(input.recalled)
  return {
    id: input.sentOutPlacementId,
    sheetKind: 'pokemon',
    sheetSlug: input.replacementSheetSlug,
    position: { ...input.recalled.position },
    ...(input.recalled.sideId === undefined ? {} : { sideId: input.recalled.sideId }),
    ...(input.recalled.initiative === undefined
      ? {}
      : { initiative: input.recalled.initiative }),
    facing,
    turned: tokenFacingStoresLegacyTurned(facing),
  }
}

const occupiedFootprints = (
  context: AuthoritativeMoveRulesContext,
  recalledPlacementId: string,
): readonly PositionedGridFootprint[] => context.queries.placements.all().flatMap((placement) => {
  if (placement.id === recalledPlacementId) return []
  const token = context.queries.tokens.get(placement.id)
  if (!token) {
    return fail(
      'switch-choice-invalid',
      `Placement ${placement.id} cannot resolve a footprint for authoritative switch legality.`,
    )
  }
  return [{
    id: placement.id,
    base: token.base,
    clearance: token.clearance,
    position: { ...placement.position },
  }]
})

const legalReplacement = (input: {
  readonly source: EnumerateAuthoritativeSwitchChoicesInput
  readonly recalled: SheetPlacement
  readonly owner: SwitchOwner
  readonly replacementSheetSlug: string
  readonly lookup: SheetLookup
  readonly occupied: readonly PositionedGridFootprint[]
  readonly occupiedVoxels: ReadonlySet<string>
}): AuthoritativeSwitchChoice | null => {
  const resolved = input.source.context.queries.sheets.get(
    'pokemon',
    input.replacementSheetSlug,
  )
  if (!resolved || resolved.kind !== 'pokemon') return null
  input.source.context.reads.recordSheet(resolved)

  const id = sentOutPlacementId(
    input.source.setId,
    input.recalled.id,
    input.replacementSheetSlug,
  )
  if (input.source.context.queries.placements.get(id)) return null
  const placement = inheritedPlacement({
    recalled: input.recalled,
    replacementSheetSlug: input.replacementSheetSlug,
    sentOutPlacementId: id,
  })
  const token = placementToSpawned(placement, input.lookup, input.source.context.map)
  if (!token || token.currentHp <= 0) return null
  if (!canPlacePokemon(
    { id: token.id, base: token.base, clearance: token.clearance },
    placement.position,
    [...input.occupied],
    input.source.context.map.dimensions,
    null,
    input.occupiedVoxels,
  )) return null

  return {
    option: replacementOption(
      input.source.setId,
      input.recalled.id,
      input.replacementSheetSlug,
    ),
    trainerPlacementId: input.owner.placement.id,
    trainerSheetSlug: input.owner.sheet.slug,
    recalledPlacementId: input.recalled.id,
    replacementSheetSlug: input.replacementSheetSlug,
    sentOutPlacement: placement,
  }
}

/**
 * Enumerate current-team replacements through the same authoritative sheet,
 * footprint, occupancy, side, and initiative data used by live send-out.
 */
export const enumerateAuthoritativeSwitchChoices = (
  input: EnumerateAuthoritativeSwitchChoicesInput,
): AuthoritativeSwitchChoiceSet => {
  assertInput(input)
  const recalled = input.context.queries.placements.get(input.recalledPlacementId)
  if (!recalled || recalled.sheetKind !== 'pokemon') {
    return fail(
      'switch-choice-invalid',
      'A move-driven switch must recall one authoritative Pokémon placement.',
    )
  }
  input.context.reads.recordPlacement(recalled)
  const owner = switchOwner(input, recalled)
  if (!owner) {
    return deepFreeze({
      setId: input.setId,
      recalledPlacementId: recalled.id,
      trainerPlacementId: null,
      trainerSheetSlug: null,
      positionPolicy: input.positionPolicy,
      initiativePolicy: input.initiativePolicy,
      choices: [],
      sheetReads: input.context.reads.snapshot(),
    })
  }

  const activePokemonSlugs = new Set(input.context.queries.placements.all().flatMap(placement => (
    placement.sheetKind === 'pokemon' && placement.id !== recalled.id
      ? [placement.sheetSlug]
      : []
  )))
  const lookup = sheetLookup(input.context)
  const occupied = occupiedFootprints(input.context, recalled.id)
  const occupiedVoxels = buildVoxelOccupancy(input.context.map.voxels)
  const choices = owner.team.flatMap((replacementSheetSlug) => {
    if (replacementSheetSlug === recalled.sheetSlug || activePokemonSlugs.has(replacementSheetSlug)) {
      return []
    }
    const choice = legalReplacement({
      source: input,
      recalled,
      owner,
      replacementSheetSlug,
      lookup,
      occupied,
      occupiedVoxels,
    })
    return choice ? [choice] : []
  })
  if (choices.length > AUTHORITATIVE_SWITCH_CHOICE_LIMITS.choices) {
    return fail(
      'switch-choice-roster-limit',
      `Switch choices exceed ${AUTHORITATIVE_SWITCH_CHOICE_LIMITS.choices} options.`,
    )
  }

  return deepFreeze({
    setId: input.setId,
    recalledPlacementId: recalled.id,
    trainerPlacementId: owner.placement.id,
    trainerSheetSlug: owner.sheet.slug,
    positionPolicy: input.positionPolicy,
    initiativePolicy: input.initiativePolicy,
    choices,
    sheetReads: input.context.reads.snapshot(),
  })
}

/** Re-enumerate one server-issued replacement against the fresh resume snapshot. */
export const revalidateAuthoritativeSwitchChoice = (
  input: RevalidateAuthoritativeSwitchChoiceInput,
): AuthoritativeSwitchChoice => {
  const set = enumerateAuthoritativeSwitchChoices(input)
  return set.choices.find(choice => choice.option.id === input.optionId)
    ?? fail(
      'switch-choice-option-unknown',
      'The selected replacement is no longer legal for this switch.',
    )
}
