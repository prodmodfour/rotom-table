import { isSlug } from '#shared/paths'
import { normalizeRevision } from '#shared/sessionRevisions'
import {
  MOVE_ITEM_REFERENCE_LIMITS,
  MOVE_ITEM_TRAINER_INVENTORY_SECTIONS,
  MoveItemReferenceValidationError,
  parseMoveItemReference,
  type MoveItemReference,
  type MoveItemTrainerInventorySection,
} from '#shared/moveAutomation/items'
import { findItem, toSlug } from '~~/data/ptuReference'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { SheetKind, SheetPlacement, TabletopMap } from '~/types/map'
import type { InventoryEntry, TrainerSheet } from '~/types/trainerSheet'
import { splitSheetItemNames } from '~/utils/sheetItemNames'
import { deepCloneJson } from '~/utils/serialization'
import { TRAINER_EQUIPMENT_SLOTS } from '~/utils/sheets/trainerInventorySections'
import {
  MOVE_ITEM_MUTATION_LIMITS,
  type MoveConsumedItemRecord,
} from './itemMutationTypes'

export const AUTHORITATIVE_MOVE_ITEM_RESOURCE_LIMITS = Object.freeze({
  requirements: 32,
  candidates: 512,
  groupInventories: 16,
})

export const AUTHORITATIVE_MOVE_ITEM_RESOURCE_SOURCE_KINDS = [
  'actor-equipped',
  'selected-target-equipped',
  'actor-trainer-inventory',
  'group-inventory',
  'map-ground-items',
] as const

export type AuthoritativeMoveItemResourceSourceKind =
  (typeof AUTHORITATIVE_MOVE_ITEM_RESOURCE_SOURCE_KINDS)[number]

interface AuthoritativeMoveItemResourceRequirementBase {
  readonly id: string
  readonly source: {
    readonly kind: AuthoritativeMoveItemResourceSourceKind
  }
}

export interface ActorEquippedMoveItemResourceRequirement
  extends AuthoritativeMoveItemResourceRequirementBase {
  readonly source: { readonly kind: 'actor-equipped' }
}

export interface SelectedTargetEquippedMoveItemResourceRequirement
  extends AuthoritativeMoveItemResourceRequirementBase {
  readonly source: { readonly kind: 'selected-target-equipped' }
}

export interface ActorTrainerInventoryMoveItemResourceRequirement
  extends AuthoritativeMoveItemResourceRequirementBase {
  readonly source: {
    readonly kind: 'actor-trainer-inventory'
    readonly sections: readonly MoveItemTrainerInventorySection[]
  }
}

export interface GroupInventoryMoveItemResourceRequirement
  extends AuthoritativeMoveItemResourceRequirementBase {
  readonly source: {
    readonly kind: 'group-inventory'
    readonly slug: string
    readonly sections: readonly MoveItemTrainerInventorySection[]
  }
}

export interface MapGroundItemsMoveItemResourceRequirement
  extends AuthoritativeMoveItemResourceRequirementBase {
  readonly source: { readonly kind: 'map-ground-items' }
}

/** Server-reviewed declaration of the smallest physical item scope a move needs. */
export type AuthoritativeMoveItemResourceRequirement =
  | ActorEquippedMoveItemResourceRequirement
  | SelectedTargetEquippedMoveItemResourceRequirement
  | ActorTrainerInventoryMoveItemResourceRequirement
  | GroupInventoryMoveItemResourceRequirement
  | MapGroundItemsMoveItemResourceRequirement

export interface AuthoritativeMoveItemSheetRead {
  readonly kind: SheetKind
  readonly slug: string
  readonly revision: number
}

export interface AuthoritativeMoveGroupInventoryRead {
  readonly slug: string
  readonly revision: number
}

export interface AuthoritativeMoveItemCandidate {
  readonly requirementId: string
  readonly reference: MoveItemReference
}

/** Private server-only item snapshot. It must never be projected into accepted results. */
export interface AuthoritativeMoveItemResources {
  readonly requirements: readonly AuthoritativeMoveItemResourceRequirement[]
  readonly candidates: readonly AuthoritativeMoveItemCandidate[]
  readonly sheetReads: readonly AuthoritativeMoveItemSheetRead[]
  readonly groupInventoryReads: readonly AuthoritativeMoveGroupInventoryRead[]
  /** Detached private documents required only by the transactional item planner. */
  readonly groupInventories: ReadonlyMap<string, GroupInventoryDocument>
  /** Private consumed-item evidence supplied by reviewed durable history. */
  readonly consumedItems: readonly MoveConsumedItemRecord[]
}

export type AuthoritativeMoveItemResourceErrorCode =
  | 'invalid-requirement'
  | 'duplicate-requirement'
  | 'invalid-consumed-item'
  | 'duplicate-consumed-item'
  | 'limit-exceeded'
  | 'resource-missing'
  | 'revision-conflict'

export class AuthoritativeMoveItemResourceError extends Error {
  readonly code: AuthoritativeMoveItemResourceErrorCode

  constructor(code: AuthoritativeMoveItemResourceErrorCode, message: string) {
    super(message)
    this.name = 'AuthoritativeMoveItemResourceError'
    this.code = code
  }
}

type UnknownRecord = Record<string, unknown>

const REQUIREMENT_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const SOURCE_KIND_SET = new Set<unknown>(AUTHORITATIVE_MOVE_ITEM_RESOURCE_SOURCE_KINDS)
const INVENTORY_SECTION_SET = new Set<unknown>(MOVE_ITEM_TRAINER_INVENTORY_SECTIONS)

const fail = (
  code: AuthoritativeMoveItemResourceErrorCode,
  message: string,
): never => {
  throw new AuthoritativeMoveItemResourceError(code, message)
}

const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const assertExactFields = (
  value: UnknownRecord,
  fields: readonly string[],
  path: string,
): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.hasOwn(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length === 0 && unknown.length === 0) return
  fail(
    'invalid-requirement',
    `${path} has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`,
  )
}

const parseRequirementId = (value: unknown, path: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MOVE_ITEM_REFERENCE_LIMITS.itemIdChars
    || !REQUIREMENT_ID_PATTERN.test(value)
  ) {
    return fail('invalid-requirement', `${path} must be a bounded stable identifier.`)
  }
  return value
}

const parseConsumedItemStableId = (value: unknown, path: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MOVE_ITEM_MUTATION_LIMITS.identifierChars
    || !REQUIREMENT_ID_PATTERN.test(value)
  ) {
    return fail('invalid-consumed-item', `${path} must be a bounded stable identifier.`)
  }
  return value
}

const parseSections = (
  value: unknown,
  path: string,
): readonly MoveItemTrainerInventorySection[] => {
  if (!Array.isArray(value) || value.length === 0) {
    return fail('invalid-requirement', `${path} must be a non-empty inventory section array.`)
  }
  if (value.length > MOVE_ITEM_TRAINER_INVENTORY_SECTIONS.length) {
    fail('limit-exceeded', `${path} contains too many inventory sections.`)
  }
  const sections = value.map((section, index) => {
    if (!INVENTORY_SECTION_SET.has(section)) {
      return fail('invalid-requirement', `${path}[${index}] is not a supported inventory section.`)
    }
    return section as MoveItemTrainerInventorySection
  })
  if (new Set(sections).size !== sections.length) {
    fail('duplicate-requirement', `${path} must not contain duplicate inventory sections.`)
  }
  return Object.freeze(sections)
}

const parseRequirement = (
  value: unknown,
  index: number,
): AuthoritativeMoveItemResourceRequirement => {
  const path = `itemResourceRequirements[${index}]`
  if (!isRecord(value)) {
    return fail('invalid-requirement', `${path} must be an object.`)
  }
  assertExactFields(value, ['id', 'source'], path)
  if (!isRecord(value.source)) {
    return fail('invalid-requirement', `${path}.source must be an object.`)
  }
  const source = value.source
  if (!SOURCE_KIND_SET.has(source.kind)) {
    fail('invalid-requirement', `${path}.source.kind is not supported.`)
  }
  const id = parseRequirementId(value.id, `${path}.id`)

  if (source.kind === 'actor-trainer-inventory') {
    assertExactFields(source, ['kind', 'sections'], `${path}.source`)
    return Object.freeze({
      id,
      source: Object.freeze({
        kind: 'actor-trainer-inventory' as const,
        sections: parseSections(source.sections, `${path}.source.sections`),
      }),
    })
  }
  if (source.kind === 'group-inventory') {
    assertExactFields(source, ['kind', 'slug', 'sections'], `${path}.source`)
    if (typeof source.slug !== 'string' || !isSlug(source.slug)) {
      return fail('invalid-requirement', `${path}.source.slug must be a resource slug.`)
    }
    return Object.freeze({
      id,
      source: Object.freeze({
        kind: 'group-inventory' as const,
        slug: source.slug,
        sections: parseSections(source.sections, `${path}.source.sections`),
      }),
    })
  }

  assertExactFields(source, ['kind'], `${path}.source`)
  return Object.freeze({
    id,
    source: Object.freeze({ kind: source.kind }),
  }) as AuthoritativeMoveItemResourceRequirement
}

/** Strictly validate server registration/test-seam requirement data. */
export const parseAuthoritativeMoveItemResourceRequirements = (
  value: unknown,
): readonly AuthoritativeMoveItemResourceRequirement[] => {
  if (!Array.isArray(value)) {
    return fail('invalid-requirement', 'itemResourceRequirements must be an array.')
  }
  if (value.length > AUTHORITATIVE_MOVE_ITEM_RESOURCE_LIMITS.requirements) {
    fail(
      'limit-exceeded',
      `itemResourceRequirements must contain at most ${AUTHORITATIVE_MOVE_ITEM_RESOURCE_LIMITS.requirements} entries.`,
    )
  }
  const requirements = value.map(parseRequirement)
  const ids = new Set<string>()
  for (const requirement of requirements) {
    if (ids.has(requirement.id)) {
      fail('duplicate-requirement', `Item resource requirement ${requirement.id} is duplicated.`)
    }
    ids.add(requirement.id)
  }
  return Object.freeze(requirements)
}

const EMPTY_ITEM_RESOURCES: AuthoritativeMoveItemResources = Object.freeze({
  requirements: Object.freeze([]),
  candidates: Object.freeze([]),
  sheetReads: Object.freeze([]),
  groupInventoryReads: Object.freeze([]),
  groupInventories: Object.freeze(new Map()),
  consumedItems: Object.freeze([]),
})

export const emptyAuthoritativeMoveItemResources = (): AuthoritativeMoveItemResources => (
  EMPTY_ITEM_RESOURCES
)

/** Current reviewed legacy requirements. Later item specs register equivalent typed scopes. */
const REVIEWED_REQUIREMENTS = new Map<string, readonly AuthoritativeMoveItemResourceRequirement[]>([
  ['Knock Off', parseAuthoritativeMoveItemResourceRequirements([{
    id: 'knock-off.target-equipped',
    source: { kind: 'selected-target-equipped' },
  }])],
])

export const reviewedMoveItemResourceRequirementsFor = (
  canonicalMoveId: string,
): readonly AuthoritativeMoveItemResourceRequirement[] => (
  REVIEWED_REQUIREMENTS.get(canonicalMoveId) ?? Object.freeze([])
)

export const requiredMoveGroupInventorySlugs = (
  requirements: readonly AuthoritativeMoveItemResourceRequirement[],
): readonly string[] => {
  const slugs: string[] = []
  const seen = new Set<string>()
  for (const requirement of requirements) {
    if (requirement.source.kind !== 'group-inventory') continue
    if (seen.has(requirement.source.slug)) continue
    seen.add(requirement.source.slug)
    slugs.push(requirement.source.slug)
  }
  if (slugs.length > AUTHORITATIVE_MOVE_ITEM_RESOURCE_LIMITS.groupInventories) {
    fail('limit-exceeded', 'Move item requirements consult too many group inventories.')
  }
  return Object.freeze(slugs)
}

const canonicalItemIdentity = (
  value: unknown,
): { readonly id: string } | null => {
  if (typeof value !== 'string') return null
  const item = findItem(value)
  if (!item) return null
  const id = toSlug(item.name)
  return id ? { id } : null
}

const normalizeConsumedItems = (
  value: readonly MoveConsumedItemRecord[] | undefined,
): readonly MoveConsumedItemRecord[] => {
  const records = value ?? []
  if (!Array.isArray(records)) {
    return fail('invalid-consumed-item', 'Consumed-item evidence must be an array.')
  }
  if (records.length > MOVE_ITEM_MUTATION_LIMITS.consumptions) {
    fail(
      'limit-exceeded',
      `Move item resources may load at most ${MOVE_ITEM_MUTATION_LIMITS.consumptions} consumed-item records.`,
    )
  }

  const normalized: MoveConsumedItemRecord[] = []
  const consumptionIds = new Set<string>()
  for (const [index, value] of records.entries()) {
    const path = `consumedItems[${index}]`
    if (!isRecord(value)) {
      return fail('invalid-consumed-item', `${path} must be an object.`)
    }
    const expected = new Set(['consumptionId', 'sourceOperationId', 'source', 'canonicalItemId', 'quantity'])
    const missing = [...expected].filter(field => !Object.hasOwn(value, field))
    const unknown = Object.keys(value).filter(field => !expected.has(field))
    if (missing.length > 0 || unknown.length > 0) {
      fail(
        'invalid-consumed-item',
        `${path} has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`,
      )
    }
    const consumptionId = parseConsumedItemStableId(
      value.consumptionId,
      `${path}.consumptionId`,
    )
    if (consumptionIds.has(consumptionId)) {
      fail('duplicate-consumed-item', `Consumed-item identity ${consumptionId} is duplicated.`)
    }
    consumptionIds.add(consumptionId)
    const sourceOperationId = parseConsumedItemStableId(
      value.sourceOperationId,
      `${path}.sourceOperationId`,
    )
    let source: MoveItemReference
    try {
      source = parseMoveItemReference(value.source, `${path}.source`)
    }
    catch (error) {
      if (!(error instanceof MoveItemReferenceValidationError)) throw error
      return fail('invalid-consumed-item', error.message)
    }
    const canonicalItemId = canonicalItemIdentity(value.canonicalItemId)?.id
      ?? fail('invalid-consumed-item', `${path} has unknown canonical item identity.`)
    if (
      canonicalItemId !== value.canonicalItemId
      || canonicalItemId !== source.canonicalItemId
    ) {
      fail('invalid-consumed-item', `${path} has inconsistent canonical item identity.`)
    }
    if (
      !Number.isSafeInteger(value.quantity)
      || Number(value.quantity) < 1
      || Number(value.quantity) > source.quantity
    ) {
      fail(
        'invalid-consumed-item',
        `${path}.quantity must be a positive safe integer within its source snapshot.`,
      )
    }
    normalized.push(Object.freeze({
      consumptionId,
      sourceOperationId,
      source,
      canonicalItemId,
      quantity: Number(value.quantity),
    }))
  }
  return Object.freeze(normalized)
}

const quantityForInventoryEntry = (
  entry: InventoryEntry,
  section: MoveItemTrainerInventorySection,
): number | null => {
  if (section === 'equipment') return 1
  return Number.isSafeInteger(entry.qty) && Number(entry.qty) > 0
    ? Number(entry.qty)
    : null
}

const itemReference = (value: unknown): MoveItemReference | null => {
  try {
    return parseMoveItemReference(value)
  }
  catch (error) {
    if (error instanceof MoveItemReferenceValidationError) return null
    throw error
  }
}

const sheetForPlacement = (
  placement: SheetPlacement,
  pokemonSheets: ReadonlyMap<string, CharacterSheet>,
  trainerSheets: ReadonlyMap<string, TrainerSheet>,
): CharacterSheet | TrainerSheet | null => placement.sheetKind === 'pokemon'
  ? pokemonSheets.get(placement.sheetSlug) ?? null
  : trainerSheets.get(placement.sheetSlug) ?? null

const equippedReferences = (
  placement: SheetPlacement,
  sheet: CharacterSheet | TrainerSheet,
): readonly MoveItemReference[] => {
  const revision = normalizeRevision(sheet.revision)
  if (placement.sheetKind === 'pokemon') {
    return splitSheetItemNames((sheet as CharacterSheet).items?.held).flatMap((name, index) => {
      const canonical = canonicalItemIdentity(name)
      if (!canonical) return []
      const reference = itemReference({
        schemaVersion: 1,
        kind: 'pokemon-held',
        itemId: `held:${index + 1}`,
        canonicalItemId: canonical.id,
        owner: {
          kind: 'sheet',
          sheetKind: 'pokemon',
          slug: placement.sheetSlug,
          revision,
        },
        quantity: 1,
        stack: 'singleton',
        equip: 'pokemon-held',
      })
      return reference ? [reference] : []
    })
  }

  const trainer = sheet as TrainerSheet
  return TRAINER_EQUIPMENT_SLOTS.flatMap(({ key: slot }) => (
    splitSheetItemNames(trainer.equipmentSlots?.[slot]).flatMap((name, index) => {
      const canonical = canonicalItemIdentity(name)
      if (!canonical) return []
      const reference = itemReference({
        schemaVersion: 1,
        kind: 'trainer-equipment-slot',
        itemId: `slot:${slot}:${index + 1}`,
        canonicalItemId: canonical.id,
        owner: {
          kind: 'sheet',
          sheetKind: 'trainer',
          slug: placement.sheetSlug,
          revision,
        },
        slot,
        quantity: 1,
        stack: 'singleton',
        equip: 'trainer-slot',
      })
      return reference ? [reference] : []
    })
  ))
}

const trainerInventoryReferences = (
  slug: string,
  revision: number,
  sheet: TrainerSheet,
  sections: readonly MoveItemTrainerInventorySection[],
): readonly MoveItemReference[] => sections.flatMap(section => (
  (sheet.inventory?.[section] ?? []).flatMap((entry, index) => {
    const canonical = canonicalItemIdentity(entry.name)
    const quantity = quantityForInventoryEntry(entry, section)
    if (!canonical || quantity === null) return []
    const storedId: unknown = entry.id
    const itemId = typeof storedId === 'string' && storedId.trim()
      ? storedId.trim()
      : `trainer-row:${section}:${index + 1}`
    const reference = itemReference({
      schemaVersion: 1,
      kind: 'trainer-inventory-row',
      itemId,
      canonicalItemId: canonical.id,
      owner: {
        kind: 'sheet',
        sheetKind: 'trainer',
        slug,
        revision,
      },
      section,
      quantity,
      stack: section === 'equipment' ? 'singleton' : 'stackable',
      equip: 'unequipped',
    })
    return reference ? [reference] : []
  })
))

const groupInventoryReferences = (
  groupInventory: GroupInventoryDocument,
  sections: readonly MoveItemTrainerInventorySection[],
): readonly MoveItemReference[] => sections.flatMap(section => (
  groupInventory.inventory[section].flatMap((entry) => {
    const canonical = canonicalItemIdentity(entry.name)
    const quantity = quantityForInventoryEntry(entry, section)
    if (!canonical || quantity === null) return []
    const reference = itemReference({
      schemaVersion: 1,
      kind: 'group-inventory-row',
      itemId: entry.id,
      canonicalItemId: canonical.id,
      owner: {
        kind: 'group-inventory',
        slug: groupInventory.slug,
        revision: normalizeRevision(groupInventory.revision),
      },
      section,
      quantity,
      stack: section === 'equipment' ? 'singleton' : 'stackable',
      equip: 'unequipped',
    })
    return reference ? [reference] : []
  })
))

const mapGroundItemReferences = (map: TabletopMap): readonly MoveItemReference[] => (
  (map.encounterState?.groundItems ?? []).flatMap((item) => {
    const reference = itemReference({
      schemaVersion: 1,
      kind: 'map-ground-item',
      itemId: item.id,
      canonicalItemId: item.canonicalItemId,
      owner: {
        kind: 'map',
        slug: map.slug,
        revision: normalizeRevision(map.revision),
      },
      quantity: item.quantity,
      stack: item.quantity === 1 ? 'singleton' : 'stackable',
      equip: 'unequipped',
    })
    return reference ? [reference] : []
  })
)

const selectedTargetIds = (map: TabletopMap, targetIds: readonly string[]): readonly string[] => {
  const requested = new Set(targetIds)
  return map.placements.filter(placement => requested.has(placement.id)).map(placement => placement.id)
}

const deduplicateSheetReads = (
  reads: readonly AuthoritativeMoveItemSheetRead[],
): readonly AuthoritativeMoveItemSheetRead[] => {
  const result: AuthoritativeMoveItemSheetRead[] = []
  const byKey = new Map<string, AuthoritativeMoveItemSheetRead>()
  for (const read of reads) {
    const normalized = { ...read, revision: normalizeRevision(read.revision) }
    const key = `${normalized.kind}:${normalized.slug}`
    const previous = byKey.get(key)
    if (previous && previous.revision !== normalized.revision) {
      fail('revision-conflict', `Item sheet ${key} was observed at conflicting revisions.`)
    }
    if (previous) continue
    byKey.set(key, normalized)
    result.push(normalized)
  }
  return Object.freeze(result.map(read => Object.freeze({ ...read })))
}

export const deduplicateAuthoritativeMoveGroupInventoryReads = (
  reads: readonly AuthoritativeMoveGroupInventoryRead[],
): readonly AuthoritativeMoveGroupInventoryRead[] => {
  const result: AuthoritativeMoveGroupInventoryRead[] = []
  const bySlug = new Map<string, AuthoritativeMoveGroupInventoryRead>()
  for (const read of reads) {
    const normalized = { slug: read.slug, revision: normalizeRevision(read.revision) }
    const previous = bySlug.get(normalized.slug)
    if (previous && previous.revision !== normalized.revision) {
      fail(
        'revision-conflict',
        `Group inventory ${normalized.slug} was observed at conflicting revisions.`,
      )
    }
    if (previous) continue
    bySlug.set(normalized.slug, normalized)
    result.push(normalized)
  }
  return Object.freeze(result.map(read => Object.freeze({ ...read })))
}

const candidateKey = (candidate: AuthoritativeMoveItemCandidate): string => {
  const owner = candidate.reference.owner
  const ownerKey = owner.kind === 'sheet'
    ? `${owner.kind}:${owner.sheetKind}:${owner.slug}`
    : `${owner.kind}:${owner.slug}`
  return `${candidate.requirementId}:${candidate.reference.kind}:${ownerKey}:${candidate.reference.itemId}`
}

const freezeCandidates = (
  candidates: readonly AuthoritativeMoveItemCandidate[],
): readonly AuthoritativeMoveItemCandidate[] => {
  const result: AuthoritativeMoveItemCandidate[] = []
  const counts = new Map<string, number>()
  for (const candidate of candidates) {
    const key = candidateKey(candidate)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (const candidate of candidates) {
    const key = candidateKey(candidate)
    // A duplicated physical ID is ambiguous and therefore never a legal
    // mutation candidate. The owning revision remains in the read set.
    if (counts.get(key) !== 1) continue
    result.push(Object.freeze({
      requirementId: candidate.requirementId,
      reference: candidate.reference,
    }))
  }
  if (result.length > AUTHORITATIVE_MOVE_ITEM_RESOURCE_LIMITS.candidates) {
    fail(
      'limit-exceeded',
      `Move item resources produced more than ${AUTHORITATIVE_MOVE_ITEM_RESOURCE_LIMITS.candidates} candidates.`,
    )
  }
  return Object.freeze(result)
}

export interface ResolveAuthoritativeMoveItemResourcesInput {
  readonly map: TabletopMap
  readonly actorPlacementId: string
  readonly selectedTargetPlacementIds: readonly string[]
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly groupInventories: ReadonlyMap<string, GroupInventoryDocument>
  readonly consumedItems?: readonly MoveConsumedItemRecord[]
  readonly requirements: unknown
}

/**
 * Normalize only reviewed, requirement-addressed item locations. Inventory
 * names that do not resolve to canonical rules data never become legal item
 * candidates, but their owning revision is still recorded because absence is
 * an authoritative legality decision.
 */
export const resolveAuthoritativeMoveItemResources = (
  input: ResolveAuthoritativeMoveItemResourcesInput,
): AuthoritativeMoveItemResources => {
  const requirements = parseAuthoritativeMoveItemResourceRequirements(input.requirements)
  const hasConsumedItemInput = input.consumedItems !== undefined
    && (!Array.isArray(input.consumedItems) || input.consumedItems.length > 0)
  if (requirements.length === 0 && !hasConsumedItemInput) {
    return EMPTY_ITEM_RESOURCES
  }

  const actor = input.map.placements.find(placement => placement.id === input.actorPlacementId)
    ?? fail('resource-missing', `Move actor placement ${input.actorPlacementId} was not found.`)
  const targets = new Set(selectedTargetIds(input.map, input.selectedTargetPlacementIds))
  const candidates: AuthoritativeMoveItemCandidate[] = []
  const sheetReads: AuthoritativeMoveItemSheetRead[] = []
  const groupInventoryReads: AuthoritativeMoveGroupInventoryRead[] = []

  const addSheet = (
    requirement: AuthoritativeMoveItemResourceRequirement,
    placement: SheetPlacement,
    mode: 'equipped' | 'inventory',
  ): void => {
    const sheet = sheetForPlacement(placement, input.pokemonSheets, input.trainerSheets)
      ?? fail(
        'resource-missing',
        `Required item sheet ${placement.sheetKind}/${placement.sheetSlug} was not found.`,
      )
    const revision = normalizeRevision(sheet.revision)
    sheetReads.push({ kind: placement.sheetKind, slug: placement.sheetSlug, revision })
    const references = mode === 'equipped'
      ? equippedReferences(placement, sheet)
      : placement.sheetKind === 'trainer'
        ? trainerInventoryReferences(
            placement.sheetSlug,
            revision,
            sheet as TrainerSheet,
            (requirement as ActorTrainerInventoryMoveItemResourceRequirement).source.sections,
          )
        : []
    for (const reference of references) {
      candidates.push({ requirementId: requirement.id, reference })
    }
  }

  for (const requirement of requirements) {
    if (requirement.source.kind === 'actor-equipped') {
      addSheet(requirement, actor, 'equipped')
      continue
    }
    if (requirement.source.kind === 'selected-target-equipped') {
      for (const placement of input.map.placements) {
        if (targets.has(placement.id)) addSheet(requirement, placement, 'equipped')
      }
      continue
    }
    if (requirement.source.kind === 'actor-trainer-inventory') {
      if (actor.sheetKind !== 'trainer') {
        fail(
          'invalid-requirement',
          `Item requirement ${requirement.id} requires a trainer actor inventory.`,
        )
      }
      addSheet(requirement, actor, 'inventory')
      continue
    }
    if (requirement.source.kind === 'group-inventory') {
      const groupInventory = input.groupInventories.get(requirement.source.slug)
        ?? fail(
          'resource-missing',
          `Required group inventory ${requirement.source.slug} was not found.`,
        )
      groupInventoryReads.push({
        slug: groupInventory.slug,
        revision: normalizeRevision(groupInventory.revision),
      })
      for (const reference of groupInventoryReferences(groupInventory, requirement.source.sections)) {
        candidates.push({ requirementId: requirement.id, reference })
      }
      continue
    }
    for (const reference of mapGroundItemReferences(input.map)) {
      candidates.push({ requirementId: requirement.id, reference })
    }
  }

  const consultedGroupSlugs = new Set(groupInventoryReads.map(read => read.slug))
  const groupInventories = Object.freeze(new Map(
    [...input.groupInventories]
      .filter(([slug]) => consultedGroupSlugs.has(slug))
      .map(([slug, document]) => [slug, deepCloneJson(document)] as const),
  ))
  return Object.freeze({
    requirements,
    candidates: freezeCandidates(candidates),
    sheetReads: deduplicateSheetReads(sheetReads),
    groupInventoryReads: deduplicateAuthoritativeMoveGroupInventoryReads(groupInventoryReads),
    groupInventories,
    consumedItems: normalizeConsumedItems(input.consumedItems),
  })
}

export interface AuthoritativeMoveItemResourceQueries {
  all(): readonly MoveItemReference[]
  forRequirement(requirementId: string): readonly MoveItemReference[]
  /** Private recorded consumption; never projected into accepted client results. */
  consumedById(consumptionId: string): MoveConsumedItemRecord | null
}

/** Private immutable query seam consumed only by server rules and handlers. */
export const createAuthoritativeMoveItemResourceQueries = (
  resources: AuthoritativeMoveItemResources = EMPTY_ITEM_RESOURCES,
): AuthoritativeMoveItemResourceQueries => {
  const all = Object.freeze(resources.candidates.map(candidate => candidate.reference))
  const byRequirement = new Map<string, readonly MoveItemReference[]>()
  for (const requirement of resources.requirements) {
    byRequirement.set(
      requirement.id,
      Object.freeze(resources.candidates
        .filter(candidate => candidate.requirementId === requirement.id)
        .map(candidate => candidate.reference)),
    )
  }
  const consumedById = new Map(
    resources.consumedItems.map(record => [record.consumptionId, record] as const),
  )
  return Object.freeze({
    all: () => all,
    forRequirement: (requirementId: string) => byRequirement.get(requirementId) ?? Object.freeze([]),
    consumedById: (consumptionId: string) => consumedById.get(consumptionId) ?? null,
  })
}
