import { createHash } from 'node:crypto'
import type { CharacterSheet } from '~/types/characterSheet'
import { applyExperienceToSheet } from '~/utils/sheetMutations'
import {
  POKEMON_EXPERIENCE_CHART,
  calculatePokemonLevelFromExperience,
  pokemonExperienceNeededForLevel,
} from '~/utils/sheets/pokemonExperience'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseEncounterSettlementDocument,
  type EncounterSettlementAllocation,
  type EncounterSettlementAllocationDestination,
  type EncounterSettlementAuthorityRef,
  type EncounterSettlementDocument,
} from '#shared/encounterSettlement/document'
import {
  applyCapabilityEvolutionTransition,
} from '../capabilityAutomation/evolutionProviders'
import {
  resolveMarsupialRelationship,
  withoutMarsupialPouchState,
  type ValidMarsupialRelationship,
} from '../capabilityAutomation/marsupialRelationship'
import type {
  EncounterSettlementRewardDestinationAuthority,
  EncounterSettlementRewardPermissionAuthority,
  EncounterSettlementRewardWriteAuthority,
} from './rewardPackage'

export const ENCOUNTER_SETTLEMENT_EXPERIENCE_DISTRIBUTION_METHODS = [
  'fixed', 'weighted', 'individual',
] as const
export type EncounterSettlementExperienceDistributionMethod =
  typeof ENCOUNTER_SETTLEMENT_EXPERIENCE_DISTRIBUTION_METHODS[number]

export interface EncounterSettlementExperienceRecipientDeclaration {
  readonly participantId: string
  readonly weight: number | null
  readonly amount: number | null
}

export interface EncounterSettlementExperienceDeclaration {
  readonly rewardId: string
  readonly destination: EncounterSettlementAllocationDestination
  readonly method: EncounterSettlementExperienceDistributionMethod
  readonly recipients: readonly EncounterSettlementExperienceRecipientDeclaration[]
  readonly permission: EncounterSettlementRewardPermissionAuthority
}

export interface EncounterSettlementPokemonExperienceAuthority {
  readonly sheetSlug: string
  readonly revision: number
  readonly sheet: CharacterSheet
}

export interface EncounterSettlementExperienceAuthoritySnapshot {
  readonly completeness: 'authoritative-current'
  readonly pokemonSheets: readonly EncounterSettlementPokemonExperienceAuthority[]
  readonly declarations: readonly EncounterSettlementExperienceDeclaration[]
}

export interface EncounterSettlementExperienceLevelThreshold {
  readonly level: number
  readonly totalExperience: number
}

export interface EncounterSettlementExperienceRecipientPreview {
  readonly sheetSlug: string
  readonly participantId: string | null
  readonly expectedRevision: number
  readonly grantAmount: number
  readonly totalExperienceBefore: number
  readonly totalExperienceAfter: number
  readonly levelBefore: number
  readonly levelAfter: number
  readonly crossedThresholds: readonly EncounterSettlementExperienceLevelThreshold[]
  readonly lifecycleReasonIds: readonly string[]
}

export interface EncounterSettlementExperienceSheetWrite {
  readonly sheetSlug: string
  readonly expectedRevision: number
  readonly revision: number
  readonly grantAmount: number
  readonly beforeDefinitionSha256: string
  readonly afterDefinitionSha256: string
  readonly nextSheet: CharacterSheet
}

export interface EncounterSettlementBatchExperiencePlan {
  readonly complete: boolean
  readonly document: EncounterSettlementDocument
  readonly allocations: readonly EncounterSettlementAllocation[]
  readonly destinationAuthorities: readonly EncounterSettlementRewardDestinationAuthority[]
  readonly recipientPreviews: readonly EncounterSettlementExperienceRecipientPreview[]
  readonly sheetWrites: readonly EncounterSettlementExperienceSheetWrite[]
  readonly pendingRewardIds: readonly string[]
  readonly deniedRewardIds: readonly string[]
}

export type EncounterSettlementExperienceAllocationErrorCode =
  | 'incomplete-authority'
  | 'invalid-declaration'
  | 'duplicate-declaration'
  | 'invalid-recipient'
  | 'invalid-distribution'
  | 'stale-sheet-authority'
  | 'invalid-experience-authority'
  | 'corrupt-related-authority'
  | 'overflow'
  | 'foreign-experience-allocation'
  | 'terminal-experience-state'
  | 'stale-experience-plan'

export class EncounterSettlementExperienceAllocationError extends Error {
  constructor(
    readonly code: EncounterSettlementExperienceAllocationErrorCode,
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'EncounterSettlementExperienceAllocationError'
  }
}

const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/
const EXPERIENCE_ALLOCATION_PREFIX = 'settlement-xp-allocation:v1:'
const EXPERIENCE_WRITE_PREFIX = 'settlement-xp-write:v1:'
const EXPERIENCE_METHOD_SET = new Set<string>(ENCOUNTER_SETTLEMENT_EXPERIENCE_DISTRIBUTION_METHODS)
const EXPERIENCE_DESTINATIONS = new Set(['group', 'side', 'participant', 'pokemon-sheet'])
const AUTHORITY_KINDS = new Set([
  'encounter-document', 'map', 'sheet', 'group-inventory', 'campaign-clock',
  'capture-operation', 'item-operation', 'equipment-operation', 'inventory-operation',
  'objective', 'clock', 'phase', 'effect', 'resource',
])

const fail = (
  code: EncounterSettlementExperienceAllocationErrorCode,
  path: string,
  message: string,
): never => {
  throw new EncounterSettlementExperienceAllocationError(code, path, message)
}

const isStableId = (value: unknown): value is string => (
  typeof value === 'string' && STABLE_ID.test(value)
)

const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value, {
    path: 'experienceSheet',
    limits: {
      maxDepth: 64,
      maxNodes: 250_000,
      maxObjectFields: 10_000,
      maxArrayEntries: 100_000,
      maxStringLength: 100_000,
    },
  }))
  .digest('hex')

const deterministicId = (prefix: string, ...parts: readonly string[]): string => {
  const hash = createHash('sha256').update(prefix)
  parts.forEach(part => hash.update('\u0000').update(part))
  return `${prefix}${hash.digest('hex')}`
}

const sameAuthority = (
  left: EncounterSettlementAuthorityRef,
  right: EncounterSettlementAuthorityRef,
): boolean => left.kind === right.kind && left.id === right.id && left.revision === right.revision

const parsePermission = (
  permission: EncounterSettlementRewardPermissionAuthority,
  path: string,
): EncounterSettlementRewardPermissionAuthority => {
  const authority = permission?.authority
  if (!permission || (permission.status !== 'allowed' && permission.status !== 'denied')
    || !authority || !AUTHORITY_KINDS.has(authority.kind)
    || !isStableId(authority.id) || !Number.isSafeInteger(authority.revision) || authority.revision < 0
    || (permission.status === 'denied') !== (permission.reasonId !== null)
    || (permission.reasonId !== null && !isStableId(permission.reasonId))) {
    return fail('invalid-declaration', path, 'must contain one exact allowed or denied permission authority.')
  }
  return Object.freeze({
    status: permission.status,
    authority: Object.freeze({ kind: authority.kind, id: authority.id, revision: authority.revision }),
    reasonId: permission.reasonId,
  })
}

const parseSheetAuthorities = (
  values: readonly EncounterSettlementPokemonExperienceAuthority[],
): ReadonlyMap<string, EncounterSettlementPokemonExperienceAuthority> => {
  if (!Array.isArray(values) || values.length > 4_096) {
    return fail('incomplete-authority', 'authority.pokemonSheets', 'must be one bounded complete Pokémon sheet read.')
  }
  const result = new Map<string, EncounterSettlementPokemonExperienceAuthority>()
  values.forEach((entry, index) => {
    const path = `authority.pokemonSheets[${index}]`
    if (!entry || !isStableId(entry.sheetSlug) || !Number.isSafeInteger(entry.revision)
      || entry.revision < 0 || entry.revision >= Number.MAX_SAFE_INTEGER
      || !entry.sheet || entry.sheet.slug !== entry.sheetSlug) {
      fail('invalid-experience-authority', path, 'must contain one exact Pokémon sheet identity and revision.')
    }
    if (result.has(entry.sheetSlug)) {
      fail('invalid-experience-authority', 'authority.pokemonSheets', 'must not contain duplicate sheet identities.')
    }
    result.set(entry.sheetSlug, Object.freeze({
      sheetSlug: entry.sheetSlug,
      revision: entry.revision,
      sheet: entry.sheet,
    }))
  })
  return result
}

const currentExperience = (
  authority: EncounterSettlementPokemonExperienceAuthority,
  path: string,
): { readonly level: number, readonly total: number } => {
  const level = authority.sheet.level
  if (!Number.isSafeInteger(level) || level < 1 || level > 100) {
    return fail('invalid-experience-authority', `${path}.level`, 'must be a current Level from 1 through 100.')
  }
  const fallback = pokemonExperienceNeededForLevel(level)
  const total = authority.sheet.totalExp === undefined ? fallback : authority.sheet.totalExp
  if (!Number.isSafeInteger(total) || total! < 0
    || calculatePokemonLevelFromExperience(total) !== level) {
    return fail('invalid-experience-authority', `${path}.totalExp`, 'must be safe total Experience consistent with the current Level.')
  }
  return { level, total: total! }
}

const distributeByWeights = (
  total: number,
  recipients: readonly { readonly participantId: string, readonly weight: number }[],
): ReadonlyMap<string, number> => {
  const totalWeight = recipients.reduce((sum, recipient) => sum + recipient.weight, 0)
  if (!Number.isSafeInteger(totalWeight) || totalWeight < 1) {
    return fail('invalid-distribution', 'authority.declarations.recipients.weight', 'weight total must be a positive safe integer.')
  }
  const denominator = BigInt(totalWeight)
  const shares = recipients.map((recipient) => {
    const product = BigInt(total) * BigInt(recipient.weight)
    return {
      participantId: recipient.participantId,
      amount: Number(product / denominator),
      remainder: product % denominator,
    }
  })
  let remaining = total - shares.reduce((sum, share) => sum + share.amount, 0)
  shares.sort((left, right) => (
    left.remainder === right.remainder
      ? left.participantId.localeCompare(right.participantId)
      : left.remainder > right.remainder ? -1 : 1
  ))
  for (let index = 0; index < shares.length && remaining > 0; index += 1) {
    shares[index]!.amount += 1
    remaining -= 1
  }
  shares.sort((left, right) => left.participantId.localeCompare(right.participantId))
  if (shares.some(share => share.amount < 1)) {
    return fail('invalid-distribution', 'authority.declarations.recipients', 'every selected recipient must receive at least one Experience point.')
  }
  return new Map(shares.map(share => [share.participantId, share.amount] as const))
}

const allocationIdFor = (settlementId: string, rewardId: string): string => (
  deterministicId(EXPERIENCE_ALLOCATION_PREFIX, settlementId, rewardId)
)

const validateDestinationScope = (
  settlement: EncounterSettlementDocument,
  declaration: EncounterSettlementExperienceDeclaration,
  recipientIds: readonly string[],
  path: string,
): void => {
  const destination = declaration.destination
  if (!EXPERIENCE_DESTINATIONS.has(destination.kind) || !isStableId(destination.id)
    || !Number.isSafeInteger(destination.revision) || destination.revision < 0) {
    fail('invalid-declaration', `${path}.destination`, 'must be one current group, side, participant, or Pokémon-sheet destination.')
  }
  const participants = recipientIds.map((id) => settlement.participants.find(participant => participant.participantId === id)!)
  if (destination.kind === 'side') {
    if (destination.revision !== settlement.encounter.encounterRevision
      || participants.some(participant => participant.sideId !== destination.id)) {
      fail('invalid-recipient', `${path}.destination`, 'side recipients and revision must match the current settlement side authority.')
    }
  }
  else if (destination.kind === 'group') {
    if (destination.revision !== settlement.encounter.encounterRevision) {
      fail('invalid-recipient', `${path}.destination.revision`, 'group scope must use the current encounter revision.')
    }
  }
  else if (destination.kind === 'participant') {
    if (participants.length !== 1 || participants[0]!.participantId !== destination.id
      || destination.revision !== participants[0]!.sheetRevision) {
      fail('invalid-recipient', `${path}.destination`, 'participant scope must name its one exact current Pokémon participant.')
    }
  }
  else if (participants.length !== 1 || participants[0]!.sheetSlug !== destination.id
    || destination.revision !== participants[0]!.sheetRevision) {
    fail('invalid-recipient', `${path}.destination`, 'Pokémon-sheet scope must name its one exact current participant sheet.')
  }
}

const relationshipFor = (
  sheetSlug: string,
  sheets: ReadonlyMap<string, EncounterSettlementPokemonExperienceAuthority>,
): ReturnType<typeof resolveMarsupialRelationship> => resolveMarsupialRelationship({
  subjectSlug: sheetSlug,
  pokemonBySlug: new Map([...sheets].map(([slug, authority]) => [slug, authority.sheet] as const)),
})

const addContribution = (
  contributions: Map<string, number>,
  sheetSlug: string,
  amount: number,
): void => {
  if (amount <= 0) return
  const next = (contributions.get(sheetSlug) ?? 0) + amount
  if (!Number.isSafeInteger(next)) fail('overflow', 'experience.contributions', 'Experience contribution total exceeds safe integer authority.')
  contributions.set(sheetSlug, next)
}

const crossedThresholds = (
  beforeLevel: number,
  afterLevel: number,
): readonly EncounterSettlementExperienceLevelThreshold[] => Object.freeze(
  POKEMON_EXPERIENCE_CHART
    .filter(entry => entry.level > beforeLevel && entry.level <= afterLevel)
    .map(entry => Object.freeze({ level: entry.level, totalExperience: entry.expNeeded })),
)

export const planEncounterSettlementBatchExperience = (input: {
  readonly settlement: unknown
  readonly authority: EncounterSettlementExperienceAuthoritySnapshot
}): EncounterSettlementBatchExperiencePlan => {
  const settlement = parseEncounterSettlementDocument(input.settlement)
  const experienceRewardIds = new Set(settlement.rewardPackage.lines
    .filter(line => line.payload.kind === 'experience')
    .map(line => line.rewardId))
  if (settlement.status === 'committing' || settlement.status === 'completed' || settlement.status === 'cancelled'
    || settlement.rewardPackage.status === 'committed' || settlement.rewardPackage.status === 'cancelled'
    || settlement.rewardPackage.lines.some(line => line.payload.kind === 'experience' && line.disposition === 'committed')
    || settlement.allocations.some(allocation => experienceRewardIds.has(allocation.rewardId) && allocation.state === 'applied')) {
    return fail('terminal-experience-state', 'settlement', 'cannot re-plan Experience after settlement commit has begun.')
  }
  if (!input.authority || input.authority.completeness !== 'authoritative-current'
    || !Array.isArray(input.authority.declarations)) {
    return fail('incomplete-authority', 'authority', 'must contain one complete current Experience authority read.')
  }
  const sheets = parseSheetAuthorities(input.authority.pokemonSheets)
  const experienceLines = settlement.rewardPackage.lines.filter(line => line.payload.kind === 'experience')
  const linesById = new Map(experienceLines.map(line => [line.rewardId, line] as const))
  const declarationsByReward = new Map<string, EncounterSettlementExperienceDeclaration>()
  input.authority.declarations.forEach((declaration, index) => {
    const path = `authority.declarations[${index}]`
    if (!declaration || !isStableId(declaration.rewardId) || !linesById.has(declaration.rewardId)) {
      fail('invalid-declaration', path, 'must name one current Experience reward line.')
    }
    if (declarationsByReward.has(declaration.rewardId)) {
      fail('duplicate-declaration', 'authority.declarations', 'must contain at most one declaration per Experience reward.')
    }
    if (linesById.get(declaration.rewardId)!.disposition === 'excluded') {
      fail('invalid-declaration', path, 'cannot allocate an explicitly excluded Experience reward.')
    }
    declarationsByReward.set(declaration.rewardId, declaration)
  })

  for (const allocation of settlement.allocations.filter(allocation => linesById.has(allocation.rewardId))) {
    if (!allocation.allocationId.startsWith(EXPERIENCE_ALLOCATION_PREFIX)) {
      fail('foreign-experience-allocation', allocation.allocationId, 'cannot replace an Experience allocation not owned by the batch provider.')
    }
    if (allocation.state === 'applied' || allocation.receiptId !== null) {
      fail('terminal-experience-state', allocation.allocationId, 'cannot replace applied Experience allocation evidence.')
    }
  }

  const generatedAllocations: EncounterSettlementAllocation[] = []
  const destinationAuthoritiesByIdentity = new Map<string, EncounterSettlementRewardDestinationAuthority>()
  const contributionByAllocation = new Map<string, Map<string, number>>()
  const baseParticipantBySheet = new Map(settlement.participants
    .filter(participant => participant.sheetKind === 'pokemon')
    .map(participant => [participant.sheetSlug, participant.participantId] as const))
  const deniedRewardIds: string[] = []
  const pendingRewardIds: string[] = []

  for (const line of experienceLines) {
    if (line.disposition === 'excluded') continue
    const declaration = declarationsByReward.get(line.rewardId)
    if (!declaration) {
      pendingRewardIds.push(line.rewardId)
      continue
    }
    const path = `authority.declarations.${line.rewardId}`
    if (!EXPERIENCE_METHOD_SET.has(declaration.method)
      || !Array.isArray(declaration.recipients) || declaration.recipients.length < 1
      || declaration.recipients.length > 1_024) {
      fail('invalid-declaration', path, 'must use one supported method and a bounded non-empty recipient list.')
    }
    const permission = parsePermission(declaration.permission, `${path}.permission`)
    const recipientIds = declaration.recipients.map(recipient => recipient.participantId)
    if (new Set(recipientIds).size !== recipientIds.length || recipientIds.some(id => !isStableId(id))) {
      fail('invalid-recipient', `${path}.recipients`, 'must contain unique stable participant identities.')
    }
    const participants = recipientIds.map((participantId, index) => {
      const participant = settlement.participants.find(candidate => candidate.participantId === participantId)
      if (!participant || participant.sheetKind !== 'pokemon') {
        return fail('invalid-recipient', `${path}.recipients[${index}]`, 'must name one current Pokémon participant.')
      }
      const authority = sheets.get(participant.sheetSlug)
      if (!authority || authority.revision !== participant.sheetRevision) {
        return fail('stale-sheet-authority', `${path}.recipients[${index}]`, 'must retain the exact current participant sheet revision.')
      }
      currentExperience(authority, `${path}.recipients[${index}].sheet`)
      baseParticipantBySheet.set(participant.sheetSlug, participant.participantId)
      return participant
    })
    if (new Set(participants.map(participant => participant.sheetSlug)).size !== participants.length) {
      fail('invalid-recipient', `${path}.recipients`, 'cannot select the same Pokémon sheet through multiple participants.')
    }
    validateDestinationScope(settlement, declaration, recipientIds, path)

    const total = (line.payload as { readonly kind: 'experience', readonly amount: number }).amount
    let baseAmounts: ReadonlyMap<string, number>
    if (declaration.method === 'individual') {
      if (declaration.recipients.some(recipient => recipient.weight !== null
        || !Number.isSafeInteger(recipient.amount) || recipient.amount! < 1)) {
        fail('invalid-distribution', `${path}.recipients`, 'individual distribution requires one positive amount and no weight per recipient.')
      }
      const sum = declaration.recipients.reduce((amount, recipient) => amount + recipient.amount!, 0)
      if (!Number.isSafeInteger(sum) || sum !== total) {
        fail('invalid-distribution', `${path}.recipients`, 'individual amounts must sum exactly to the reward total.')
      }
      baseAmounts = new Map(declaration.recipients.map(recipient => [recipient.participantId, recipient.amount!] as const))
    }
    else {
      const weighted = declaration.method === 'weighted'
      if (declaration.recipients.some(recipient => recipient.amount !== null
        || (weighted
          ? !Number.isSafeInteger(recipient.weight) || recipient.weight! < 1
          : recipient.weight !== null))) {
        fail('invalid-distribution', `${path}.recipients`, weighted
          ? 'weighted distribution requires one positive weight and no amount per recipient.'
          : 'fixed distribution cannot contain weights or individual amounts.')
      }
      baseAmounts = distributeByWeights(total, declaration.recipients.map(recipient => ({
        participantId: recipient.participantId,
        weight: weighted ? recipient.weight! : 1,
      })))
    }

    const allocationId = allocationIdFor(settlement.settlementId, line.rewardId)
    const allocationWeight = declaration.method === 'weighted'
      ? declaration.recipients.reduce((sum, recipient) => sum + recipient.weight!, 0)
      : null
    if (allocationWeight !== null && !Number.isSafeInteger(allocationWeight)) {
      fail('overflow', `${path}.recipients`, 'weight total exceeds safe integer authority.')
    }
    generatedAllocations.push(Object.freeze({
      allocationId,
      rewardId: line.rewardId,
      destination: declaration.destination,
      method: declaration.method,
      amount: total,
      weight: allocationWeight,
      state: 'proposed',
      decisionId: null,
      receiptId: null,
    }))

    const destinationIdentity = `${declaration.destination.kind}\u0000${declaration.destination.id}`
    const existingDestination = destinationAuthoritiesByIdentity.get(destinationIdentity)
    if (existingDestination && (
      existingDestination.destination.revision !== declaration.destination.revision
      || existingDestination.permission.status !== permission.status
      || existingDestination.permission.reasonId !== permission.reasonId
      || !sameAuthority(existingDestination.permission.authority, permission.authority)
    )) {
      fail('invalid-declaration', `${path}.destination`, 'declarations sharing one destination must share exact revision and permission authority.')
    }
    if (!existingDestination) {
      destinationAuthoritiesByIdentity.set(destinationIdentity, Object.freeze({
        destination: declaration.destination,
        permission,
        capacity: Object.freeze({ metric: 'unbounded', limit: null, used: null }),
        writes: Object.freeze([]),
      }))
    }
    if (permission.status === 'denied') {
      deniedRewardIds.push(line.rewardId)
      contributionByAllocation.set(allocationId, new Map())
      continue
    }

    const contributions = new Map<string, number>()
    for (const participant of participants) {
      const amount = baseAmounts.get(participant.participantId)!
      const relationship = relationshipFor(participant.sheetSlug, sheets)
      if (relationship.status === 'corrupt') {
        fail('corrupt-related-authority', `${path}.recipients`, relationship.message)
      }
      if (relationship.status === 'valid'
        && relationship.subjectRole === 'mother'
        && relationship.pouch.experienceSharePercent === 20) {
        const babyAmount = Math.floor(amount * 0.2)
        addContribution(contributions, participant.sheetSlug, amount - babyAmount)
        addContribution(contributions, relationship.pouch.babySheetSlug, babyAmount)
      }
      else addContribution(contributions, participant.sheetSlug, amount)
    }
    if ([...contributions.values()].reduce((sum, amount) => sum + amount, 0) !== total) {
      fail('invalid-distribution', path, 'relationship-aware Experience writes must preserve the exact reward total.')
    }
    contributionByAllocation.set(allocationId, contributions)
  }

  const aggregateContributions = new Map<string, number>()
  for (const contributions of contributionByAllocation.values()) {
    for (const [sheetSlug, amount] of contributions) addContribution(aggregateContributions, sheetSlug, amount)
  }

  const nextSheets = new Map<string, CharacterSheet>()
  const lifecycleReasons = new Map<string, Set<string>>()
  const experienceBefore = new Map<string, { readonly level: number, readonly total: number }>()
  for (const [sheetSlug, grantAmount] of aggregateContributions) {
    const authority = sheets.get(sheetSlug)
      ?? fail('corrupt-related-authority', sheetSlug, 'a relationship-derived Experience recipient sheet is unavailable.')
    const previous = currentExperience(authority, `authority.pokemonSheets.${sheetSlug}`)
    if (previous.total > Number.MAX_SAFE_INTEGER - grantAmount) {
      fail('overflow', sheetSlug, 'Experience total would exceed safe integer authority.')
    }
    experienceBefore.set(sheetSlug, previous)
    const relationship = relationshipFor(sheetSlug, sheets)
    if (relationship.status === 'corrupt') {
      fail('corrupt-related-authority', sheetSlug, relationship.message)
    }
    const granted = applyExperienceToSheet('pokemon', authority.sheet, grantAmount) as CharacterSheet
    const transitioned = applyCapabilityEvolutionTransition(
      authority.sheet,
      granted,
      relationship.status === 'valid' ? { marsupialRelationship: relationship } : {},
    )
    nextSheets.set(sheetSlug, transitioned.sheet)
    lifecycleReasons.set(sheetSlug, new Set(transitioned.reasonCodes))
  }

  const endedRelationships = new Map<string, ValidMarsupialRelationship>()
  for (const sheetSlug of aggregateContributions.keys()) {
    const relationship = relationshipFor(sheetSlug, sheets)
    if (relationship.status !== 'valid') continue
    const babyNext = nextSheets.get(relationship.pouch.babySheetSlug)
    if (babyNext?.babyTemplate === false) {
      endedRelationships.set(relationship.pouch.motherSheetSlug, relationship)
    }
  }
  for (const relationship of endedRelationships.values()) {
    for (const sheetSlug of [relationship.pouch.motherSheetSlug, relationship.pouch.babySheetSlug]) {
      const authority = sheets.get(sheetSlug)
        ?? fail('corrupt-related-authority', sheetSlug, 'a relationship lifecycle write lost its exact sheet authority.')
      const currentNext = nextSheets.get(sheetSlug) ?? authority.sheet
      nextSheets.set(sheetSlug, withoutMarsupialPouchState(currentNext))
      const reasons = lifecycleReasons.get(sheetSlug) ?? new Set<string>()
      reasons.add('capability.marsupial.pouch-ended')
      lifecycleReasons.set(sheetSlug, reasons)
    }
  }

  const writesByAllocation = new Map<string, EncounterSettlementRewardWriteAuthority[]>()
  for (const [allocationId, contributions] of contributionByAllocation) {
    const writes: EncounterSettlementRewardWriteAuthority[] = []
    for (const [sheetSlug, amount] of contributions) {
      const authority = sheets.get(sheetSlug)!
      writes.push(Object.freeze({
        sourceWriteId: deterministicId(EXPERIENCE_WRITE_PREFIX, settlement.settlementId, allocationId, sheetSlug, 'grant'),
        allocationId,
        targetAuthority: Object.freeze({ kind: 'sheet', id: sheetSlug, revision: authority.revision }),
        field: 'experience',
        amount,
        countsTowardAllocation: true,
        capacityCost: 0,
      }))
    }
    const relatedOnlySheets = [...nextSheets.keys()].filter(sheetSlug => (
      !contributions.has(sheetSlug)
      && lifecycleReasons.get(sheetSlug)?.has('capability.marsupial.pouch-ended')
    ))
    for (const sheetSlug of relatedOnlySheets.sort()) {
      const relationship = relationshipFor(sheetSlug, sheets)
      const causedByAllocation = relationship.status === 'valid'
        && [...contributions.keys()].some(contributedSlug => (
          contributedSlug === relationship.pouch.babySheetSlug
          || contributedSlug === relationship.pouch.motherSheetSlug
        ))
      if (!causedByAllocation) continue
      const authority = sheets.get(sheetSlug)!
      writes.push(Object.freeze({
        sourceWriteId: deterministicId(EXPERIENCE_WRITE_PREFIX, settlement.settlementId, allocationId, sheetSlug, 'related-lifecycle'),
        allocationId,
        targetAuthority: Object.freeze({ kind: 'sheet', id: sheetSlug, revision: authority.revision }),
        field: 'experience',
        amount: 0,
        countsTowardAllocation: false,
        capacityCost: 0,
      }))
    }
    writes.sort((left, right) => left.sourceWriteId.localeCompare(right.sourceWriteId))
    writesByAllocation.set(allocationId, writes)
  }

  for (const [identity, destinationAuthority] of destinationAuthoritiesByIdentity) {
    const matchingAllocations = generatedAllocations.filter(allocation => (
      `${allocation.destination.kind}\u0000${allocation.destination.id}` === identity
    ))
    const writes = matchingAllocations.flatMap(allocation => writesByAllocation.get(allocation.allocationId) ?? [])
    destinationAuthoritiesByIdentity.set(identity, Object.freeze({
      ...destinationAuthority,
      writes: Object.freeze(writes),
    }))
  }

  const previews: EncounterSettlementExperienceRecipientPreview[] = []
  const sheetWrites: EncounterSettlementExperienceSheetWrite[] = []
  for (const [sheetSlug, nextSheet] of nextSheets) {
    const authority = sheets.get(sheetSlug)!
    const before = experienceBefore.get(sheetSlug)
      ?? currentExperience(authority, `authority.pokemonSheets.${sheetSlug}`)
    const afterTotal = nextSheet.totalExp ?? before.total
    const afterLevel = nextSheet.level ?? before.level
    const grantAmount = aggregateContributions.get(sheetSlug) ?? 0
    previews.push(Object.freeze({
      sheetSlug,
      participantId: baseParticipantBySheet.get(sheetSlug) ?? null,
      expectedRevision: authority.revision,
      grantAmount,
      totalExperienceBefore: before.total,
      totalExperienceAfter: afterTotal,
      levelBefore: before.level,
      levelAfter: afterLevel,
      crossedThresholds: crossedThresholds(before.level, afterLevel),
      lifecycleReasonIds: Object.freeze([...(lifecycleReasons.get(sheetSlug) ?? [])].sort()),
    }))
    sheetWrites.push(Object.freeze({
      sheetSlug,
      expectedRevision: authority.revision,
      revision: authority.revision + 1,
      grantAmount,
      beforeDefinitionSha256: sha256(authority.sheet),
      afterDefinitionSha256: sha256(nextSheet),
      nextSheet,
    }))
  }
  previews.sort((left, right) => left.sheetSlug.localeCompare(right.sheetSlug))
  sheetWrites.sort((left, right) => left.sheetSlug.localeCompare(right.sheetSlug))

  const otherAllocations = settlement.allocations.filter(allocation => !linesById.has(allocation.rewardId))
  const document = parseEncounterSettlementDocument({
    ...settlement,
    allocations: [...otherAllocations, ...generatedAllocations].sort((left, right) => left.allocationId.localeCompare(right.allocationId)),
  })
  const pending = Object.freeze([...pendingRewardIds].sort())
  const denied = Object.freeze([...deniedRewardIds].sort())
  return Object.freeze({
    complete: pending.length === 0 && denied.length === 0,
    document,
    allocations: Object.freeze(document.allocations.filter(allocation => linesById.has(allocation.rewardId))),
    destinationAuthorities: Object.freeze([...destinationAuthoritiesByIdentity.values()]
      .sort((left, right) => (
        `${left.destination.kind}:${left.destination.id}`.localeCompare(`${right.destination.kind}:${right.destination.id}`)
      ))),
    recipientPreviews: Object.freeze(previews),
    sheetWrites: Object.freeze(sheetWrites),
    pendingRewardIds: pending,
    deniedRewardIds: denied,
  })
}

export const applyEncounterSettlementBatchExperiencePlan = (input: {
  readonly plan: EncounterSettlementBatchExperiencePlan
  readonly currentPokemonSheets: readonly EncounterSettlementPokemonExperienceAuthority[]
}): readonly EncounterSettlementExperienceSheetWrite[] => {
  if (!input.plan.complete) {
    return fail('stale-experience-plan', 'plan.complete', 'all Experience rewards must be allocated or explicitly excluded before application.')
  }
  const current = parseSheetAuthorities(input.currentPokemonSheets)
  for (const write of input.plan.sheetWrites) {
    const authority = current.get(write.sheetSlug)
    if (!authority || authority.revision !== write.expectedRevision
      || sha256(authority.sheet) !== write.beforeDefinitionSha256
      || sha256(write.nextSheet) !== write.afterDefinitionSha256
      || write.revision !== write.expectedRevision + 1) {
      return fail('stale-experience-plan', write.sheetSlug, 'current Experience authority no longer matches the complete batch preview.')
    }
  }
  return input.plan.sheetWrites
}
