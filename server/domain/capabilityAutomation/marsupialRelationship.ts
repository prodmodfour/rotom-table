import {
  createEmptyCapabilityCampaignState,
  parseCapabilityCampaignState,
  type CapabilityCampaignState,
  type CapabilityMarsupialPouchState,
} from '#shared/capabilityAutomation/campaignState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { pokemonHasResolvedCapability } from '~/utils/sheets/pokemonDerived'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'

export type MarsupialRelationshipRole = 'mother' | 'baby'

export interface AbsentMarsupialRelationship {
  readonly status: 'absent'
  readonly subjectSlug: string
}

export interface ValidMarsupialRelationship {
  readonly status: 'valid'
  readonly subjectSlug: string
  readonly subjectRole: MarsupialRelationshipRole
  readonly pouch: CapabilityMarsupialPouchState
  readonly mother: CharacterSheet
  readonly baby: CharacterSheet
}

export interface CorruptMarsupialRelationship {
  readonly status: 'corrupt'
  readonly subjectSlug: string
  readonly reasonCode: string
  readonly message: string
}

export type MarsupialRelationshipResolution =
  | AbsentMarsupialRelationship
  | ValidMarsupialRelationship
  | CorruptMarsupialRelationship

type PouchRead =
  | { readonly ok: true; readonly pouch: CapabilityMarsupialPouchState | null }
  | { readonly ok: false }

const readPouch = (sheet: CharacterSheet): PouchRead => {
  try {
    return { ok: true, pouch: parseCapabilityCampaignState(sheet.capabilityCampaignState).marsupialPouch }
  }
  catch {
    return { ok: false }
  }
}

const rawPouchMentions = (sheet: CharacterSheet, slugs: ReadonlySet<string>): boolean => {
  const state = sheet.capabilityCampaignState as unknown
  if (!state || typeof state !== 'object' || Array.isArray(state)) return false
  const pouch = (state as Record<string, unknown>).marsupialPouch
  if (!pouch || typeof pouch !== 'object' || Array.isArray(pouch)) return false
  const raw = pouch as Record<string, unknown>
  return (typeof raw.motherSheetSlug === 'string' && slugs.has(raw.motherSheetSlug))
    || (typeof raw.babySheetSlug === 'string' && slugs.has(raw.babySheetSlug))
}

const corrupt = (
  subjectSlug: string,
  reasonCode: string,
  message: string,
): CorruptMarsupialRelationship => Object.freeze({ status: 'corrupt', subjectSlug, reasonCode, message })

export const marsupialRelationshipClaimedSlugs = (sheet: CharacterSheet): readonly string[] => {
  const read = readPouch(sheet)
  return read.ok && read.pouch
    ? Object.freeze([read.pouch.motherSheetSlug, read.pouch.babySheetSlug])
    : Object.freeze([])
}

const pouchMatches = (
  left: CapabilityMarsupialPouchState,
  right: CapabilityMarsupialPouchState,
): boolean => sameJsonValue(left, right)

const hasMarsupial = (sheet: CharacterSheet): boolean => {
  try {
    return typeof sheet.species === 'string' && pokemonHasResolvedCapability(sheet, 'Marsupial')
  }
  catch {
    return false
  }
}

/**
 * Resolve one durable Marsupial relationship from authoritative Pokémon
 * sheets. The relationship is valid only when both participants retain the
 * exact same reciprocal record. `pokemonBySlug` should contain every sheet
 * that can claim the subject so one-sided and duplicate claims fail closed.
 */
export const resolveMarsupialRelationship = (input: {
  readonly subjectSlug: string
  readonly pokemonBySlug: ReadonlyMap<string, CharacterSheet>
}): MarsupialRelationshipResolution => {
  const subject = input.pokemonBySlug.get(input.subjectSlug)
  if (!subject) {
    return corrupt(input.subjectSlug, 'marsupial-subject-missing', `Marsupial subject sheet ${input.subjectSlug} is unavailable.`)
  }
  if (subject.slug !== input.subjectSlug) {
    return corrupt(input.subjectSlug, 'marsupial-subject-slug-mismatch', 'Marsupial sheet authority does not match its stored slug.')
  }

  const subjectRead = readPouch(subject)
  if (!subjectRead.ok) {
    return corrupt(input.subjectSlug, 'marsupial-subject-state-malformed', `Marsupial state on ${input.subjectSlug} is malformed.`)
  }

  const parsedClaims: Array<{ readonly slug: string; readonly pouch: CapabilityMarsupialPouchState }> = []
  for (const [slug, sheet] of input.pokemonBySlug) {
    const read = readPouch(sheet)
    if (!read.ok) {
      if (rawPouchMentions(sheet, new Set([input.subjectSlug]))) {
        return corrupt(input.subjectSlug, 'marsupial-related-state-malformed', `A Marsupial state claiming ${input.subjectSlug} is malformed.`)
      }
      continue
    }
    if (read.pouch && (read.pouch.motherSheetSlug === input.subjectSlug || read.pouch.babySheetSlug === input.subjectSlug)) {
      parsedClaims.push({ slug, pouch: read.pouch })
    }
  }

  if (!subjectRead.pouch) {
    if (parsedClaims.length > 0) {
      return corrupt(input.subjectSlug, 'marsupial-one-sided-relationship', `Marsupial state for ${input.subjectSlug} is not reciprocal on both sheets.`)
    }
    return Object.freeze({ status: 'absent', subjectSlug: input.subjectSlug })
  }

  const pouch = subjectRead.pouch
  const subjectRole = pouch.motherSheetSlug === input.subjectSlug
    ? 'mother'
    : pouch.babySheetSlug === input.subjectSlug
      ? 'baby'
      : null
  if (!subjectRole) {
    return corrupt(input.subjectSlug, 'marsupial-subject-not-participant', `Marsupial state on ${input.subjectSlug} does not name that sheet as a participant.`)
  }

  const mother = input.pokemonBySlug.get(pouch.motherSheetSlug)
  const baby = input.pokemonBySlug.get(pouch.babySheetSlug)
  if (!mother || !baby) {
    return corrupt(input.subjectSlug, 'marsupial-counterpart-missing', 'The durable Marsupial counterpart sheet is unavailable.')
  }
  if (mother.slug !== pouch.motherSheetSlug || baby.slug !== pouch.babySheetSlug) {
    return corrupt(input.subjectSlug, 'marsupial-counterpart-slug-mismatch', 'Marsupial participant slugs do not match sheet authority.')
  }

  const motherRead = readPouch(mother)
  const babyRead = readPouch(baby)
  if (!motherRead.ok || !babyRead.ok) {
    return corrupt(input.subjectSlug, 'marsupial-counterpart-state-malformed', 'A durable Marsupial participant has malformed campaign state.')
  }
  if (!motherRead.pouch || !babyRead.pouch
    || !pouchMatches(pouch, motherRead.pouch)
    || !pouchMatches(pouch, babyRead.pouch)) {
    return corrupt(input.subjectSlug, 'marsupial-reciprocal-state-mismatch', 'Marsupial participant slugs, Experience share, or relationship identity do not match exactly.')
  }

  const relationshipSlugs = new Set([pouch.motherSheetSlug, pouch.babySheetSlug])
  const exactClaimSlugs = new Set<string>()
  for (const [slug, sheet] of input.pokemonBySlug) {
    const read = readPouch(sheet)
    if (!read.ok) {
      if (rawPouchMentions(sheet, relationshipSlugs)) {
        return corrupt(input.subjectSlug, 'marsupial-related-state-malformed', 'A malformed Marsupial state claims one of the bound participants.')
      }
      continue
    }
    if (!read.pouch) continue
    const touchesRelationship = relationshipSlugs.has(read.pouch.motherSheetSlug)
      || relationshipSlugs.has(read.pouch.babySheetSlug)
    if (!touchesRelationship) continue
    if (!relationshipSlugs.has(slug) || !pouchMatches(read.pouch, pouch)) {
      return corrupt(input.subjectSlug, 'marsupial-conflicting-claim', 'A Marsupial participant has a duplicate or conflicting relationship claim.')
    }
    exactClaimSlugs.add(slug)
  }
  if (exactClaimSlugs.size !== 2
    || !exactClaimSlugs.has(pouch.motherSheetSlug)
    || !exactClaimSlugs.has(pouch.babySheetSlug)) {
    return corrupt(input.subjectSlug, 'marsupial-one-sided-relationship', 'Marsupial state is not retained reciprocally on exactly two sheets.')
  }

  if (!hasMarsupial(mother) || !hasMarsupial(baby)) {
    return corrupt(input.subjectSlug, 'marsupial-capability-missing', 'Both Marsupial participants must retain the canonical Marsupial Capability.')
  }
  if (mother.babyTemplate === true || (mother.level ?? 0) < 25) {
    return corrupt(input.subjectSlug, 'marsupial-mother-lifecycle-invalid', 'The Marsupial mother must be an adult outside the Baby Template lifecycle.')
  }
  if (baby.babyTemplate !== true || (baby.level ?? 0) >= 25) {
    return corrupt(input.subjectSlug, 'marsupial-baby-lifecycle-invalid', 'The Marsupial baby must retain the Baby Template below Level 25.')
  }

  return Object.freeze({
    status: 'valid',
    subjectSlug: input.subjectSlug,
    subjectRole,
    pouch,
    mother,
    baby,
  })
}

export const capabilityCampaignStateHasValues = (state: CapabilityCampaignState): boolean => (
  state.storedItems.length > 0
  || state.planter !== null
  || state.keystoneSynchronizations.length > 0
  || state.letterPress !== null
  || state.marsupialPouch !== null
)

/** Remove only server-owned Marsupial state while retaining unrelated state. */
export const withoutMarsupialPouchState = (sheet: CharacterSheet): CharacterSheet => {
  const state = parseCapabilityCampaignState(sheet.capabilityCampaignState)
  const nextState = parseCapabilityCampaignState({ ...state, marsupialPouch: null })
  const next = deepCloneJson(sheet)
  if (capabilityCampaignStateHasValues(nextState)) next.capabilityCampaignState = nextState
  else delete next.capabilityCampaignState
  return next
}

/**
 * Ignore all client attempts to create, erase, or alter pouch state. Other
 * campaign state follows the existing setup-save behavior; omitted fields are
 * filled from current authority so removing the containing object cannot erase
 * the pouch indirectly.
 */
export const preserveServerOwnedMarsupialPouchState = (
  current: CharacterSheet,
  requested: CharacterSheet,
): CharacterSheet => {
  const currentState = parseCapabilityCampaignState(current.capabilityCampaignState)
  const requestedValue = requested.capabilityCampaignState as unknown
  const requestedRecord = requestedValue && typeof requestedValue === 'object' && !Array.isArray(requestedValue)
    ? requestedValue as unknown as Record<string, unknown>
    : {}
  const fallback = current.capabilityCampaignState === undefined
    ? createEmptyCapabilityCampaignState()
    : currentState
  const state = parseCapabilityCampaignState({
    schemaVersion: requestedRecord.schemaVersion ?? fallback.schemaVersion,
    storedItems: requestedRecord.storedItems ?? fallback.storedItems,
    planter: requestedRecord.planter ?? fallback.planter,
    keystoneSynchronizations: requestedRecord.keystoneSynchronizations ?? fallback.keystoneSynchronizations,
    letterPress: requestedRecord.letterPress ?? fallback.letterPress,
    marsupialPouch: currentState.marsupialPouch,
  })
  const next = deepCloneJson(requested)
  if (capabilityCampaignStateHasValues(state)) next.capabilityCampaignState = state
  else delete next.capabilityCampaignState
  return next
}

/** Placement identities for a validated durable pair on one map. */
export const marsupialRelationshipPlacementIds = (
  map: TabletopMap,
  relationship: Pick<ValidMarsupialRelationship, 'pouch'>,
): ReadonlySet<string> => new Set(map.placements.filter(placement => (
  placement.sheetKind === 'pokemon'
  && (placement.sheetSlug === relationship.pouch.motherSheetSlug
    || placement.sheetSlug === relationship.pouch.babySheetSlug)
)).map(placement => placement.id))

/**
 * Clear map-owned pouch mirrors for a relationship whose durable lifecycle has
 * ended. Durable sheet state remains the caller's transactional responsibility.
 */
export const withoutMarsupialTransientMapState = <TMap extends TabletopMap>(
  map: TMap,
  relationship: Pick<ValidMarsupialRelationship, 'pouch'>,
): TMap => {
  const placementIds = new Set(marsupialRelationshipPlacementIds(map, relationship))
  const metadata = { ...(map.metadata ?? {}) }
  if (Array.isArray(metadata.capabilityMarsupialPouches)) {
    metadata.capabilityMarsupialPouches = metadata.capabilityMarsupialPouches.filter((raw) => {
      const pouch = raw as Record<string, unknown>
      const durableSlugMatch = pouch?.motherSheetSlug === relationship.pouch.motherSheetSlug
        && pouch?.babySheetSlug === relationship.pouch.babySheetSlug
      if (durableSlugMatch) {
        if (typeof pouch.motherPlacementId === 'string') placementIds.add(pouch.motherPlacementId)
        if (typeof pouch.babyPlacementId === 'string') placementIds.add(pouch.babyPlacementId)
        return false
      }
      return !placementIds.has(String(pouch?.motherPlacementId))
        && !placementIds.has(String(pouch?.babyPlacementId))
    })
  }
  const runtime = map.encounterState?.capabilityRuntime
  const encounterState = map.encounterState && runtime ? {
    ...map.encounterState,
    capabilityRuntime: {
      ...runtime,
      links: runtime.links.filter(link => (
        link.kind !== 'marsupial-pouch'
        || (!placementIds.has(link.ownerPlacementId)
          && !link.participantPlacementIds.some(id => placementIds.has(id)))
      )),
    },
  } : map.encounterState
  return {
    ...map,
    metadata,
    ...(encounterState === undefined ? {} : { encounterState }),
  } as TMap
}
