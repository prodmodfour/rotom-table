import type { MoveRuleScalar } from '#shared/moveAutomation/ast'
import {
  MOVE_AUTOMATION_ITEM_EFFECT_TIMINGS,
  type MoveAutomationItemEffectTiming,
} from '#shared/moveAutomation/globalFields'
import {
  MOVE_ITEM_CONTRIBUTION_QUERIES,
  MOVE_ITEM_POSSESSION_QUERIES,
  MOVE_ITEM_RULE_FAMILIES,
  MOVE_ITEM_RULE_QUERY_LIMITS,
  MOVE_ITEM_RULE_SOURCES,
  type MoveItemContributionQuery,
  type MoveItemPossessionQuery,
  type MoveItemRuleFamily,
  type MoveItemRuleSource,
} from '#shared/moveAutomation/itemRuleQueries'
import {
  moveItemEffectBindingId,
} from '#shared/moveAutomation/itemEffects'
import type { MoveItemReference } from '#shared/moveAutomation/items'
import { toSlug } from '~~/data/ptuReference'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetKind, SheetPlacement } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { splitSheetItemNames } from '~/utils/sheetItemNames'
import { TRAINER_EQUIPMENT_SLOTS } from '~/utils/sheets/trainerInventorySections'
import type { MoveAutomationItemEffectResolution, MoveAutomationItemEffectResolver } from './itemEffects'
import type { AuthoritativeMoveItemResourceQueries } from './itemResources'
import {
  resolveMoveAutomationItemRuleProfile,
  type MoveAutomationItemRuleProfile,
} from './itemRuleData'

export type MoveAutomationItemRuleQueryInput =
  | {
      readonly placementId: string
      readonly query: MoveItemPossessionQuery
    }
  | {
      readonly placementId: string
      readonly query: MoveItemContributionQuery
      readonly source: MoveItemRuleSource
      readonly families: readonly MoveItemRuleFamily[]
      readonly requirementId: string | null
      readonly timing: MoveAutomationItemEffectTiming
    }

export interface MoveAutomationItemRuleCandidate {
  readonly canonicalItemId: string
  readonly family: MoveItemRuleFamily
  readonly profile: MoveAutomationItemRuleProfile
  readonly suppressed: boolean
  readonly suppression: MoveAutomationItemEffectResolution | null
}

export interface MoveAutomationItemRuleResolution {
  readonly placementId: string
  readonly query: MoveItemPossessionQuery | MoveItemContributionQuery
  readonly value: MoveRuleScalar
  readonly physicalItemCount: number
  readonly candidates: readonly MoveAutomationItemRuleCandidate[]
  readonly reasonCode:
    | 'item-rule.holding-nothing'
    | 'item-rule.holding-item'
    | 'item-rule.no-eligible-item'
    | 'item-rule.suppressed'
    | 'item-rule.resolved'
}

export interface MoveAutomationItemRuleResolver {
  resolve(input: MoveAutomationItemRuleQueryInput): MoveAutomationItemRuleResolution
}

export type MoveAutomationItemRuleErrorCode =
  | 'placement-unavailable'
  | 'sheet-unavailable'
  | 'invalid-query'
  | 'ambiguous-item-value'

export class MoveAutomationItemRuleError extends Error {
  readonly code: MoveAutomationItemRuleErrorCode

  constructor(code: MoveAutomationItemRuleErrorCode, message: string) {
    super(message)
    this.name = 'MoveAutomationItemRuleError'
    this.code = code
  }
}

export interface MoveAutomationItemRuleSheetSnapshot {
  readonly kind: SheetKind
  readonly slug: string
  readonly sheet: CharacterSheet | TrainerSheet
}

const fail = (
  code: MoveAutomationItemRuleErrorCode,
  message: string,
): never => {
  throw new MoveAutomationItemRuleError(code, message)
}

const POSSESSION_QUERY_SET = new Set<unknown>(MOVE_ITEM_POSSESSION_QUERIES)
const CONTRIBUTION_QUERY_SET = new Set<unknown>(MOVE_ITEM_CONTRIBUTION_QUERIES)
const SOURCE_SET = new Set<unknown>(MOVE_ITEM_RULE_SOURCES)
const FAMILY_SET = new Set<unknown>(MOVE_ITEM_RULE_FAMILIES)
const TIMING_SET = new Set<unknown>(MOVE_AUTOMATION_ITEM_EFFECT_TIMINGS)
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/

const assertQuery = (query: MoveAutomationItemRuleQueryInput): void => {
  if (typeof query !== 'object' || query === null) {
    fail('invalid-query', 'Item rule query must be an object.')
  }
  if (!('source' in query)) {
    if (!POSSESSION_QUERY_SET.has(query.query)) {
      fail('invalid-query', 'Item possession query is unsupported.')
    }
    return
  }
  if (!CONTRIBUTION_QUERY_SET.has(query.query)) {
    fail('invalid-query', 'Item contribution query is unsupported.')
  }
  if (!SOURCE_SET.has(query.source)) {
    fail('invalid-query', 'Item contribution source is unsupported.')
  }
  if (
    !Array.isArray(query.families)
    || query.families.length === 0
    || query.families.length > MOVE_ITEM_RULE_QUERY_LIMITS.families
    || query.families.some(family => !FAMILY_SET.has(family))
    || new Set(query.families).size !== query.families.length
  ) {
    fail('invalid-query', 'Item contribution families must be a bounded unique reviewed list.')
  }
  if (!TIMING_SET.has(query.timing)) {
    fail('invalid-query', 'Item contribution timing is unsupported.')
  }
  if (
    query.requirementId !== null
    && (
      typeof query.requirementId !== 'string'
      || query.requirementId.length === 0
      || query.requirementId.length > MOVE_ITEM_RULE_QUERY_LIMITS.identifierChars
      || !STABLE_ID_PATTERN.test(query.requirementId)
    )
  ) {
    fail('invalid-query', 'Item contribution requirement ID is invalid.')
  }
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const placementKey = (
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
): string => `${placement.sheetKind}:${placement.sheetSlug}`

const equippedNames = (
  placement: SheetPlacement,
  sheet: CharacterSheet | TrainerSheet,
): readonly string[] => placement.sheetKind === 'pokemon'
  ? splitSheetItemNames((sheet as CharacterSheet).items?.held)
  : TRAINER_EQUIPMENT_SLOTS.flatMap(({ key }) => (
      splitSheetItemNames((sheet as TrainerSheet).equipmentSlots?.[key])
    ))

const digestionBuffName = (
  placement: SheetPlacement,
  sheet: CharacterSheet | TrainerSheet,
): string | null => {
  const raw = placement.sheetKind === 'pokemon'
    ? (sheet as CharacterSheet).items?.digestionFood
    : (sheet as TrainerSheet).digestion
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null
}

const referenceMatchesPlacement = (
  reference: MoveItemReference,
  placement: SheetPlacement,
): boolean => reference.owner.kind === 'sheet'
  && reference.owner.sheetKind === placement.sheetKind
  && reference.owner.slug === placement.sheetSlug
  && (reference.kind === 'pokemon-held' || reference.kind === 'trainer-equipment-slot')

const itemEffectScope = (
  reference: MoveItemReference,
): 'pokemon-held' | 'trainer-accessory' | 'trainer-other-equipment' => {
  if (reference.kind === 'pokemon-held') return 'pokemon-held'
  if (reference.kind === 'trainer-equipment-slot') {
    return reference.slot === 'accessory'
      ? 'trainer-accessory'
      : 'trainer-other-equipment'
  }
  return fail('invalid-query', 'Item contribution queries require equipped item references.')
}

const rareBenefitEligible = (
  identity: string,
  placement: SheetPlacement,
  sheet: CharacterSheet | TrainerSheet,
): boolean => {
  if (placement.sheetKind !== 'pokemon') return false
  const itemId = toSlug(identity)
  const species = toSlug((sheet as CharacterSheet).species ?? '')
  if (itemId === 'metal-powder') return species === 'ditto'
  if (itemId === 'rare-leek') return species === 'farfetchd'
  if (itemId === 'thick-club') return species === 'cubone' || species === 'marowak'
  if (itemId === 'pink-pearl') return species === 'spoink'
  return false
}

interface ProfileCandidate {
  readonly reference: MoveItemReference | null
  readonly profile: MoveAutomationItemRuleProfile
}

const equippedCandidates = (input: {
  readonly placement: SheetPlacement
  readonly sheet: CharacterSheet | TrainerSheet
  readonly requirementId: string
  readonly items: AuthoritativeMoveItemResourceQueries
}): readonly ProfileCandidate[] => {
  const seen = new Set<string>()
  const candidates: ProfileCandidate[] = []
  for (const reference of input.items.forRequirement(input.requirementId)) {
    if (!referenceMatchesPlacement(reference, input.placement)) continue
    const bindingId = moveItemEffectBindingId(reference)
    if (seen.has(bindingId)) continue
    seen.add(bindingId)
    const profile = resolveMoveAutomationItemRuleProfile(reference.canonicalItemId, {
      rareBenefitEligible: rareBenefitEligible(
        reference.canonicalItemId,
        input.placement,
        input.sheet,
      ),
    })
    if (profile) candidates.push({ reference, profile })
  }
  return candidates
}

const contributionValue = (
  query: MoveItemContributionQuery,
  profile: MoveAutomationItemRuleProfile,
): MoveRuleScalar => {
  if (query === 'family') return profile.family
  if (query === 'category') return profile.flingCategory
  if (query === 'power') return profile.flingPower
  if (query === 'move-type') return profile.moveType
  if (query === 'damage-base') return profile.naturalGiftDamageBase
  if (query === 'effect') return profile.flingEffect
  return true
}

const possessionResolution = (input: {
  readonly placementId: string
  readonly query: MoveItemPossessionQuery
  readonly physicalItemCount: number
}): MoveAutomationItemRuleResolution => {
  const holdingItem = input.physicalItemCount > 0
  const value = input.query === 'holding-item' ? holdingItem : !holdingItem
  return deepFreeze({
    placementId: input.placementId,
    query: input.query,
    value,
    physicalItemCount: input.physicalItemCount,
    candidates: [],
    reasonCode: holdingItem
      ? 'item-rule.holding-item' as const
      : 'item-rule.holding-nothing' as const,
  })
}

/**
 * Build item-dependent move queries over immutable sheet/item/effect snapshots.
 * Possession queries deliberately ignore suppression: Embargo and Magic Room
 * never make a physically equipped item disappear for Acrobatics/Poltergeist.
 */
export const createMoveAutomationItemRuleResolver = (input: {
  readonly placements: readonly SheetPlacement[]
  readonly sheets: readonly MoveAutomationItemRuleSheetSnapshot[]
  readonly items: AuthoritativeMoveItemResourceQueries
  readonly itemEffects: MoveAutomationItemEffectResolver
  readonly recordSheetRead?: (
    placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
  ) => void
}): MoveAutomationItemRuleResolver => {
  const placements = new Map(input.placements.map(placement => [placement.id, placement]))
  const sheets = new Map(input.sheets.map(sheet => [`${sheet.kind}:${sheet.slug}`, sheet.sheet]))

  return Object.freeze({
    resolve: (query: MoveAutomationItemRuleQueryInput): MoveAutomationItemRuleResolution => {
      assertQuery(query)
      const placement = placements.get(query.placementId)
        ?? fail('placement-unavailable', `Item-rule placement ${query.placementId} is unavailable.`)
      const sheet = sheets.get(placementKey(placement))
        ?? fail(
          'sheet-unavailable',
          `Item-rule sheet ${placement.sheetKind}/${placement.sheetSlug} is unavailable.`,
        )
      input.recordSheetRead?.(placement)
      const physicalItemCount = equippedNames(placement, sheet).length

      if (!('source' in query)) {
        return possessionResolution({
          placementId: placement.id,
          query: query.query,
          physicalItemCount,
        })
      }

      if ((query.source === 'equipped') !== (query.requirementId !== null)) {
        return fail(
          'invalid-query',
          'Equipped item contributions require a requirement ID; digestion buffs forbid one.',
        )
      }

      const rawCandidates: readonly ProfileCandidate[] = query.source === 'equipped'
        ? equippedCandidates({
            placement,
            sheet,
            requirementId: query.requirementId!,
            items: input.items,
          })
        : (() => {
            const name = digestionBuffName(placement, sheet)
            if (!name) return []
            const profile = resolveMoveAutomationItemRuleProfile(name, {
              rareBenefitEligible: rareBenefitEligible(name, placement, sheet),
            })
            return profile ? [{ reference: null, profile }] : []
          })()

      const familySet = new Set(query.families)
      const matching = rawCandidates.filter(candidate => familySet.has(candidate.profile.family))
      const candidates = matching.map((candidate): MoveAutomationItemRuleCandidate => {
        const suppression = candidate.reference
          ? input.itemEffects.resolve({
              placementId: placement.id,
              scope: itemEffectScope(candidate.reference),
              timing: query.timing,
              item: candidate.reference,
            })
          : null
        return {
          canonicalItemId: candidate.profile.canonicalItemId,
          family: candidate.profile.family,
          profile: candidate.profile,
          suppressed: suppression?.suppressed === true,
          suppression,
        }
      })
      const eligible = candidates.filter(candidate => !candidate.suppressed)

      if (query.query === 'eligible') {
        return deepFreeze({
          placementId: placement.id,
          query: query.query,
          value: eligible.length > 0,
          physicalItemCount,
          candidates,
          reasonCode: eligible.length > 0
            ? 'item-rule.resolved' as const
            : candidates.length > 0
              ? 'item-rule.suppressed' as const
              : 'item-rule.no-eligible-item' as const,
        })
      }
      if (eligible.length > 1) {
        return fail(
          'ambiguous-item-value',
          `Item-rule ${query.query} for ${placement.id} resolved ${eligible.length} eligible items; a reviewed choice is required.`,
        )
      }
      const selected = eligible[0] ?? null
      return deepFreeze({
        placementId: placement.id,
        query: query.query,
        value: selected ? contributionValue(query.query, selected.profile) : null,
        physicalItemCount,
        candidates,
        reasonCode: selected
          ? 'item-rule.resolved' as const
          : candidates.length > 0
            ? 'item-rule.suppressed' as const
            : 'item-rule.no-eligible-item' as const,
      })
    },
  })
}
