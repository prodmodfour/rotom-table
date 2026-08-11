import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  BREEDING_PARENT_REQUIRED_VALIDATION_IDS,
  parseBreedingParentDiscoveryFilterV1,
  parseBreedingParentDiscoveryProjectionV1,
  parseBreedingParentSelectionV1,
  type BreedingParentCandidateReasonId,
  type BreedingParentCandidateV1,
  type BreedingParentCompatibilityPreviewV1,
  type BreedingParentDiscoveryProjectionV1,
  type BreedingParentGenderId,
  type BreedingParentRosterField,
} from '#shared/breeding/parentDiscovery'
import { normalizePlayerProfile, type PlayerProfile } from '#shared/playerProfiles'
import { isSlug } from '#shared/paths'
import type { SheetKind } from '#shared/sheets'
import type { BreedingSpeciesId } from '#shared/breeding/ids'
import {
  parseAuthoritativeBreedingActorAuthorityV1,
} from '../domain/breeding/authorization'
import {
  parseBreedingCampaignOptionSnapshotV1,
  type BreedingCampaignOptionSnapshotV1,
} from '../domain/breeding/campaignOptions'
import {
  evaluateBreedingCompatibility,
  type BreedingCompatibilityParentFacts,
  type BreedingCompatibilityReasonId,
} from '../domain/breeding/compatibility'
import {
  BREEDING_CANONICAL_SPECIES,
  canonicalBreedingSpeciesIdentity,
} from '../domain/breeding/canonicalIds'
import {
  compiledBreedingSpeciesSpec,
} from '../domain/breeding/registry'
import type { BreedingSpeciesSpecV1 } from '#shared/breeding/specs'
import {
  BREEDING_PERFORMANCE_BUDGET_POLICY_V1,
  breedingPerformanceOutputFitsBudget,
} from '#shared/breeding/performanceBudgets'

export interface BreedingParentDiscoveryStoredSheet {
  readonly kind: SheetKind
  readonly slug: string
  readonly document: unknown
  readonly revision: number
  readonly updatedAt: number
}
export interface BreedingParentDiscoverySheetReader {
  get(kind: SheetKind, slug: string): BreedingParentDiscoveryStoredSheet | null
  list(kind?: SheetKind): readonly BreedingParentDiscoveryStoredSheet[]
}
export interface DiscoverBreedingParentsInput {
  readonly sheets: BreedingParentDiscoverySheetReader
  readonly actorAuthority: unknown
  readonly profile: unknown | null
  readonly campaignOptions: unknown
  readonly atCampaignMinute: number
  readonly filter: unknown
  readonly selection: unknown
}
export type BreedingParentDiscoveryAuthorityErrorCode =
  | 'breeding.parent-discovery.invalid-authority'
  | 'breeding.parent-discovery.unauthorized'
  | 'breeding.parent-discovery.resource-unavailable'
  | 'breeding.parent-discovery.ambiguous-link'
  | 'breeding.parent-discovery.limit-exceeded'
  | 'breeding.parent-discovery.stale-selection'
  | 'breeding.parent-discovery.corrupt-storage'
export class BreedingParentDiscoveryAuthorityError extends Error {
  readonly code: BreedingParentDiscoveryAuthorityErrorCode
  constructor(code: BreedingParentDiscoveryAuthorityErrorCode, message: string) {
    super(message)
    this.name = 'BreedingParentDiscoveryAuthorityError'
    this.code = code
  }
}

type UnknownRecord = Record<string, unknown>
interface CandidateAuthority {
  readonly projection: BreedingParentCandidateV1
  readonly facts: BreedingCompatibilityParentFacts | null
}
interface TrainerAuthority {
  readonly trainerSheetSlug: string
  readonly trainerSheetRevision: number
  readonly candidates: readonly CandidateAuthority[]
}

const MAX_STORED_TRAINERS = BREEDING_PERFORMANCE_BUDGET_POLICY_V1.preview.maximumStoredTrainers
const MAX_PROJECTED_TRAINERS = BREEDING_PERFORMANCE_BUDGET_POLICY_V1.preview.maximumProjectedTrainers
const MAX_ROSTER_ENTRIES = BREEDING_PERFORMANCE_BUDGET_POLICY_V1.preview.maximumRosterEntriesPerTrainer
const MAX_PROJECTED_CANDIDATES = BREEDING_PERFORMANCE_BUDGET_POLICY_V1.preview.maximumProjectedCandidates
const speciesBySourceName = new Map(BREEDING_CANONICAL_SPECIES.map(row => [row.sourceName, row]))
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')
const fail = (code: BreedingParentDiscoveryAuthorityErrorCode, message: string): never => {
  throw new BreedingParentDiscoveryAuthorityError(code, message)
}
const campaignMinute = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    return fail('breeding.parent-discovery.invalid-authority', 'Parent discovery requires a current nonnegative campaign minute.')
  }
  return Number(value)
}
const plainRecord = (value: unknown): UnknownRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) return null
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) return null
  }
  return value as UnknownRecord
}
const strictProfile = (value: unknown): PlayerProfile => {
  const row = plainRecord(value)
  const linksValue = row?.linkedCharacters
  if (!row || Object.keys(row).length !== 4
    || !['schemaVersion', 'id', 'displayName', 'linkedCharacters'].every(field => Object.hasOwn(row, field))
    || !Array.isArray(linksValue) || Object.getPrototypeOf(linksValue) !== Array.prototype
    || linksValue.length > 128 || Object.getOwnPropertySymbols(linksValue).length > 0
    || Object.getOwnPropertyNames(linksValue).length !== linksValue.length + 1) {
    return fail('breeding.parent-discovery.invalid-authority', 'Current Profile authority is malformed.')
  }
  for (let index = 0; index < linksValue.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(linksValue, String(index))
    const link = descriptor && 'value' in descriptor ? plainRecord(descriptor.value) : null
    if (!descriptor?.enumerable || !link || Object.keys(link).length !== 2
      || !Object.hasOwn(link, 'sheetKind') || !Object.hasOwn(link, 'sheetSlug')) {
      return fail('breeding.parent-discovery.invalid-authority', 'Current Profile authority is malformed.')
    }
  }
  try { return normalizePlayerProfile(value) }
  catch { return fail('breeding.parent-discovery.invalid-authority', 'Current Profile authority is malformed.') }
}
const strictStoredRevision = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    return fail('breeding.parent-discovery.corrupt-storage', 'A consulted sheet revision is corrupt.')
  }
  return Number(value)
}
const roster = (document: UnknownRecord, field: 'boxedPokemon' | 'currentTeam'): readonly string[] => {
  const value = document[field]
  if (value === undefined) return Object.freeze([])
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > MAX_ROSTER_ENTRIES || Object.getOwnPropertySymbols(value).length > 0
    || Object.getOwnPropertyNames(value).length !== value.length + 1) {
    return fail('breeding.parent-discovery.corrupt-storage', 'A consulted Trainer roster is malformed.')
  }
  const values: string[] = []
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)
      || !isSlug(descriptor.value)) {
      return fail('breeding.parent-discovery.corrupt-storage', 'A consulted Trainer roster is malformed.')
    }
    values.push(descriptor.value)
  }
  if (new Set(values).size !== values.length) {
    return fail('breeding.parent-discovery.ambiguous-link', 'Parent ownership links are ambiguous.')
  }
  return Object.freeze(values)
}
const canonicalSpecies = (value: unknown): BreedingSpeciesId | null => {
  if (typeof value !== 'string') return null
  return canonicalBreedingSpeciesIdentity(value)?.id
    ?? speciesBySourceName.get(value)?.id
    ?? null
}
const canonicalGender = (value: unknown): BreedingParentGenderId | null => {
  if (value === 'Female') return 'female'
  if (value === 'Male') return 'male'
  if (value === 'Genderless' || value === 'No Gender') return 'genderless'
  return null
}
const safeLabel = (value: unknown, fallback: string): string => {
  const raw = typeof value === 'string' ? value : ''
  const cleaned = raw.normalize('NFKC')
    .replace(/[<>\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  const bounded = Array.from(cleaned).slice(0, 80).join('').trim()
  return bounded || fallback
}
const genderMatchesSpec = (genderId: BreedingParentGenderId, spec: BreedingSpeciesSpecV1): boolean => (
  spec.genderPolicy.kind === 'genderless'
    ? genderId === 'genderless'
    : genderId === 'female' || genderId === 'male'
)
const candidate = (input: {
  readonly sheets: BreedingParentDiscoverySheetReader
  readonly parentSheetSlug: string
  readonly trainerSheetSlug: string
  readonly trainerSheetRevision: number
  readonly rosterField: BreedingParentRosterField
}): CandidateAuthority => {
  const stored = input.sheets.get('pokemon', input.parentSheetSlug)
  if (!stored) {
    return Object.freeze({
      projection: Object.freeze({
        parentSheetSlug: input.parentSheetSlug,
        parentSheetRevision: null,
        ownerTrainerSlug: input.trainerSheetSlug,
        ownerTrainerRevision: input.trainerSheetRevision,
        rosterField: input.rosterField,
        label: input.parentSheetSlug,
        speciesId: null,
        genderId: null,
        level: null,
        availability: Object.freeze({
          status: 'unavailable',
          reasonIds: Object.freeze(['breeding.parent-discovery.sheet-unavailable']),
        }),
      }),
      facts: null,
    })
  }
  if (stored.kind !== 'pokemon' || stored.slug !== input.parentSheetSlug) {
    return fail('breeding.parent-discovery.corrupt-storage', 'A consulted Pokémon sheet identity is corrupt.')
  }
  const revision = strictStoredRevision(stored.revision)
  const document = plainRecord(stored.document)
  const reasons: BreedingParentCandidateReasonId[] = []
  if (!document || document.slug !== input.parentSheetSlug) reasons.push('breeding.parent-discovery.sheet-invalid')
  const speciesId = document ? canonicalSpecies(document.species) : null
  if (!speciesId) reasons.push('breeding.parent-discovery.species-unresolved')
  const spec = speciesId ? compiledBreedingSpeciesSpec(speciesId) : null
  if (speciesId && !spec) reasons.push('breeding.parent-discovery.species-spec-unavailable')
  if (spec && spec.eligibilityId !== 'breedable') reasons.push('breeding.parent-discovery.species-not-breedable')
  const genderId = document ? canonicalGender(document.gender) : null
  if (!genderId) reasons.push('breeding.parent-discovery.gender-unresolved')
  if (genderId && spec && !genderMatchesSpec(genderId, spec)) reasons.push('breeding.parent-discovery.gender-mismatch')
  const level = document && Number.isSafeInteger(document.level)
    && Number(document.level) >= 1 && Number(document.level) <= 100
    ? Number(document.level)
    : null
  if (level === null && !reasons.includes('breeding.parent-discovery.sheet-invalid')) {
    reasons.push('breeding.parent-discovery.sheet-invalid')
  }
  reasons.sort(compare)
  const projection: BreedingParentCandidateV1 = Object.freeze({
    parentSheetSlug: input.parentSheetSlug,
    parentSheetRevision: revision,
    ownerTrainerSlug: input.trainerSheetSlug,
    ownerTrainerRevision: input.trainerSheetRevision,
    rosterField: input.rosterField,
    label: safeLabel(document?.nickname, speciesBySourceName.get(document?.species as string)?.sourceName ?? input.parentSheetSlug),
    speciesId,
    genderId,
    level,
    availability: Object.freeze({
      status: reasons.length === 0 ? 'selectable' : 'unavailable',
      reasonIds: Object.freeze(reasons),
    }),
  })
  const facts: BreedingCompatibilityParentFacts | null = reasons.length === 0 && speciesId && spec && genderId && level
    ? Object.freeze({
        parentRef: input.parentSheetSlug,
        speciesId,
        genderId,
        level,
        eggGroupIds: spec.eggGroupIds,
        gmMaturityConfirmed: true,
      })
    : null
  return Object.freeze({ projection, facts })
}
const trainerAuthority = (
  sheets: BreedingParentDiscoverySheetReader,
  stored: BreedingParentDiscoveryStoredSheet,
): TrainerAuthority => {
  if (stored.kind !== 'trainer') {
    return fail('breeding.parent-discovery.corrupt-storage', 'A consulted Trainer sheet identity is corrupt.')
  }
  const revision = strictStoredRevision(stored.revision)
  const document = plainRecord(stored.document)
  if (!document || document.slug !== stored.slug) {
    return fail('breeding.parent-discovery.corrupt-storage', 'A consulted Trainer sheet is corrupt.')
  }
  const currentTeam = roster(document, 'currentTeam')
  const boxedPokemon = roster(document, 'boxedPokemon')
  if (currentTeam.length + boxedPokemon.length > MAX_ROSTER_ENTRIES) {
    return fail('breeding.parent-discovery.limit-exceeded', 'A consulted Trainer roster exceeds the discovery bound.')
  }
  if (currentTeam.some(slug => boxedPokemon.includes(slug))) {
    return fail('breeding.parent-discovery.ambiguous-link', 'Parent ownership links are ambiguous.')
  }
  const candidates = [
    ...boxedPokemon.map(parentSheetSlug => candidate({
      sheets,
      parentSheetSlug,
      trainerSheetSlug: stored.slug,
      trainerSheetRevision: revision,
      rosterField: 'boxed-pokemon',
    })),
    ...currentTeam.map(parentSheetSlug => candidate({
      sheets,
      parentSheetSlug,
      trainerSheetSlug: stored.slug,
      trainerSheetRevision: revision,
      rosterField: 'current-team',
    })),
  ].sort((left, right) => compare(
    `${left.projection.rosterField}\u0000${left.projection.parentSheetSlug}`,
    `${right.projection.rosterField}\u0000${right.projection.parentSheetSlug}`,
  ))
  return Object.freeze({
    trainerSheetSlug: stored.slug,
    trainerSheetRevision: revision,
    candidates: Object.freeze(candidates),
  })
}
const safeCompatibilityPreview = (input: {
  readonly first: CandidateAuthority
  readonly second: CandidateAuthority
  readonly options: BreedingCampaignOptionSnapshotV1
  readonly actorAuthorityDefinitionSha256: string
  readonly minute: number
}): BreedingParentCompatibilityPreviewV1 => {
  const reasonIds: string[] = []
  if (!input.first.facts || !input.second.facts) {
    reasonIds.push('breeding.parent-preview.candidate-unavailable')
  }
  else {
    const result = evaluateBreedingCompatibility({
      parents: [input.first.facts, input.second.facts],
      options: input.options,
      roleOverride: null,
    })
    if (result.status === 'unavailable') reasonIds.push(...result.reasonIds)
  }
  const safeReasons = [...new Set(reasonIds)]
    .filter((reason): reason is BreedingCompatibilityReasonId | 'breeding.parent-preview.candidate-unavailable' => (
      reason !== 'breeding.compatibility.maturity-unconfirmed'
    ))
    .sort(compare)
  const previewId = `breeding-parent-preview:v1:${sha256({
    actorAuthorityDefinitionSha256: input.actorAuthorityDefinitionSha256,
    campaignOptionSnapshotDefinitionSha256: input.options.definitionSha256,
    generatedAtCampaignMinute: input.minute,
    parentRefs: [input.first.projection, input.second.projection].map(value => ({
      pokemonSheetSlug: value.parentSheetSlug,
      expectedSheetRevision: value.parentSheetRevision,
    })),
  }).slice(0, 32)}`
  return Object.freeze({
    previewId,
    status: safeReasons.length === 0 ? 'requires-validation' : 'unavailable',
    reasonIds: Object.freeze(safeReasons),
    requiredValidationIds: BREEDING_PARENT_REQUIRED_VALIDATION_IDS,
  })
}

/**
 * Discover only Profile-controlled parent rows (or GM-authorized campaign rows),
 * then project compatibility as a non-authorizing preview. No public sheet,
 * map, encounter, placement, or browser visibility flag grants discovery.
 */
export const discoverBreedingParentsV1 = (
  input: DiscoverBreedingParentsInput,
): BreedingParentDiscoveryProjectionV1 => {
  const minute = campaignMinute(input.atCampaignMinute)
  const actor = (() => {
    try { return parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority) }
    catch { return fail('breeding.parent-discovery.invalid-authority', 'Current actor authority is invalid.') }
  })()
  if (actor.evaluatedAtCampaignMinute !== minute) {
    return fail('breeding.parent-discovery.invalid-authority', 'Current actor authority is stale.')
  }
  const options = parseBreedingCampaignOptionSnapshotV1(input.campaignOptions)
  const filter = parseBreedingParentDiscoveryFilterV1(input.filter)
  const selection = parseBreedingParentSelectionV1(input.selection)

  let profile: PlayerProfile | null = null
  if (actor.role === 'player') {
    if (input.profile === null) {
      return fail('breeding.parent-discovery.unauthorized', 'Parent discovery is unavailable for this viewer.')
    }
    profile = strictProfile(input.profile)
    if (profile.id !== actor.authenticatedProfileId
      || sha256(profile) !== actor.profileDefinitionSha256
      || filter.trainerSheetSlug === null
      || actor.selectedTrainerSlug !== filter.trainerSheetSlug
      || !profile.linkedCharacters.some(link => (
        link.sheetKind === 'trainer' && link.sheetSlug === filter.trainerSheetSlug
      ))) {
      return fail('breeding.parent-discovery.unauthorized', 'Parent discovery is unavailable for this viewer.')
    }
  }
  else if (input.profile !== null) {
    return fail('breeding.parent-discovery.invalid-authority', 'GM discovery cannot adopt a player Profile.')
  }

  const storedTrainers = input.sheets.list('trainer')
  if (storedTrainers.length > MAX_STORED_TRAINERS) {
    return fail('breeding.parent-discovery.limit-exceeded', 'Parent discovery exceeds the bounded campaign inventory.')
  }
  const trainerRows = [...storedTrainers].sort((left, right) => compare(left.slug, right.slug))
  if (trainerRows.some((row, index) => !isSlug(row.slug)
    || (index > 0 && trainerRows[index - 1]!.slug === row.slug))) {
    return fail('breeding.parent-discovery.corrupt-storage', 'The consulted Trainer inventory has invalid or duplicate identities.')
  }
  const allRosterOwners = new Map<string, string>()
  for (const stored of trainerRows) {
    if (stored.kind !== 'trainer') {
      return fail('breeding.parent-discovery.corrupt-storage', 'A consulted Trainer inventory row is corrupt.')
    }
    const document = plainRecord(stored.document)
    if (!document || document.slug !== stored.slug) {
      return fail('breeding.parent-discovery.corrupt-storage', 'A consulted Trainer sheet is corrupt.')
    }
    for (const parentSlug of [...roster(document, 'boxedPokemon'), ...roster(document, 'currentTeam')]) {
      if (allRosterOwners.has(parentSlug)) {
        return fail('breeding.parent-discovery.ambiguous-link', 'Parent ownership links are ambiguous.')
      }
      allRosterOwners.set(parentSlug, stored.slug)
    }
  }

  const authorizedRows = actor.role === 'player'
    ? trainerRows.filter(row => row.slug === filter.trainerSheetSlug)
    : filter.trainerSheetSlug === null
      ? trainerRows
      : trainerRows.filter(row => row.slug === filter.trainerSheetSlug)
  if (filter.trainerSheetSlug !== null && authorizedRows.length !== 1) {
    return fail(
      actor.role === 'player' ? 'breeding.parent-discovery.unauthorized' : 'breeding.parent-discovery.resource-unavailable',
      'Parent discovery is unavailable for this viewer.',
    )
  }
  if (authorizedRows.length > MAX_PROJECTED_TRAINERS) {
    return fail('breeding.parent-discovery.limit-exceeded', 'Parent discovery requires a narrower Trainer filter.')
  }

  const authorities = authorizedRows.map(row => trainerAuthority(input.sheets, row))
  const speciesFilter = new Set(filter.speciesIds)
  const rosterFilter = new Set(filter.rosterFields)
  const projected = authorities.map(trainer => ({
    ...trainer,
    candidates: trainer.candidates.filter(value => (
      rosterFilter.has(value.projection.rosterField)
      && (speciesFilter.size === 0 || (value.projection.speciesId !== null && speciesFilter.has(value.projection.speciesId)))
      && (filter.availability === 'all' || value.projection.availability.status === filter.availability)
    )),
  }))
  const visibleCandidates = projected.flatMap(trainer => trainer.candidates)
  if (visibleCandidates.length > MAX_PROJECTED_CANDIDATES) {
    return fail('breeding.parent-discovery.limit-exceeded', 'Parent discovery requires narrower filters.')
  }
  const visibleBySlug = new Map(visibleCandidates.map(value => [value.projection.parentSheetSlug, value]))
  const selected = selection.parentRefs.map(ref => {
    const value = visibleBySlug.get(ref.pokemonSheetSlug)
    if (!value || value.projection.parentSheetRevision !== ref.expectedSheetRevision) {
      return fail('breeding.parent-discovery.stale-selection', 'Selected parents are stale or unavailable to this viewer.')
    }
    return value
  })
  const compatibilityPreview = selected.length === 2
    ? safeCompatibilityPreview({
        first: selected[0]!,
        second: selected[1]!,
        options,
        actorAuthorityDefinitionSha256: actor.definitionSha256,
        minute,
      })
    : null
  const projection = parseBreedingParentDiscoveryProjectionV1({
    schemaVersion: 1,
    audience: actor.role === 'gm' ? 'gm' : 'owner',
    generatedAtCampaignMinute: minute,
    trainerSheets: projected.map(trainer => ({
      trainerSheetSlug: trainer.trainerSheetSlug,
      trainerSheetRevision: trainer.trainerSheetRevision,
      candidates: trainer.candidates.map(value => value.projection),
    })),
    selectedParentRefs: selection.parentRefs,
    compatibilityPreview,
  })
  if (!breedingPerformanceOutputFitsBudget('preview', projection)) {
    return fail('breeding.parent-discovery.limit-exceeded', 'Parent discovery projection exceeds the release budget.')
  }
  return projection
}
