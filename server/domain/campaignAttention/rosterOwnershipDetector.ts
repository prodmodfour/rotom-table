import { createHash } from 'node:crypto'
import { stableJsonStringify } from '../../../shared/automation/stableJson'
import {
  createOpenCampaignAttentionItem,
  type CampaignAttentionActionIntent,
  type CampaignAttentionAuthorityRef,
  type CampaignAttentionDecisionKind,
  type CampaignAttentionEntityKind,
  type CampaignAttentionItem,
  type CampaignAttentionReason,
  type CampaignAttentionSourceEventKind,
  type CampaignAttentionUrgency,
} from '../../../shared/campaignAttention/model'
import {
  parseAuthoritativePokemonBreedingOriginV1,
  parseAuthoritativePokemonEggDocumentV1,
  validatePokemonBreedingOriginAgainstHatchedEgg,
} from '../breeding/lineage'
import {
  assertBreedingOperationResultMatchesCommand,
  createBreedingOperationCommandHash,
} from '../breeding/operations'
import type { PokemonEggDocumentV1 } from '../../../shared/breeding/egg'
import type { PokemonBreedingOriginV1 } from '../../../shared/breeding/lineage'
import { isSlug } from '../../../shared/paths'
import {
  normalizePlayerProfile,
  type PlayerProfile,
} from '../../../shared/playerProfiles'
import type { CharacterSheet } from '../../../src/types/characterSheet'
import type { TrainerSheet } from '../../../src/types/trainerSheet'
import { TRAINER_TEAM_LIMIT } from '../../../src/utils/trainerPokemonLinks'
import type { StoredSheetDocument } from '../../storage/sheetRepository'
import type { BreedingOperationLedgerRecord } from '../../storage/breedingOperationRepository'
import type {
  StoredEncounterSettlementAttentionSource,
  StoredEncounterSettlementHistoryFact,
} from '../../storage/encounterSettlementRepository'
import {
  parseSheetEquipmentStateForOwner,
  type EquipmentOwnerKind,
} from '../../../shared/itemAutomation/equipment'
import { reconcileSheetEquipmentCompatibility } from '../itemAutomation/equipmentCompatibilityReconciliation'
import { campaignAttentionItemFromSettlementSource } from './settlementProvider'

const LIMIT = 10_000
const ROSTER_ENTRY_LIMIT = 10_000
const PROFILE_LINK_LIMIT = 10_000
const SHA256 = /^[a-f0-9]{64}$/

export const CAMPAIGN_ROSTER_OWNERSHIP_ATTENTION_LIMIT = LIMIT
export const CAMPAIGN_ROSTER_ENTRY_LIMIT = ROSTER_ENTRY_LIMIT
export const CAMPAIGN_PROFILE_LINK_LIMIT = PROFILE_LINK_LIMIT

export const CAMPAIGN_EQUIPMENT_COMPATIBILITY_REASON_CODES = Object.freeze([
  'equipment.definition-pending',
  'equipment.definition-unavailable',
  'equipment.record-stale',
  'equipment.owner-incompatible',
  'equipment.slot-incompatible',
  'equipment.slot-occupied',
  'equipment.unresolved-slot',
  'equipment.exclusivity-conflict',
  'equipment.configuration-required',
  'equipment.configuration-unexpected',
  'equipment.configuration-invalid',
  'equipment.configuration-stale',
  'equipment.capability-required',
  'equipment.skill-required',
  'equipment.species-incompatible',
  'equipment.evolution-stage-incompatible',
] as const)
const EQUIPMENT_REASON_SET = new Set<string>(CAMPAIGN_EQUIPMENT_COMPATIBILITY_REASON_CODES)

export interface CampaignProfileAuthorityV1 {
  readonly profileId: string
  readonly revision: number
  readonly definitionSha256: string
  readonly profile: PlayerProfile
}

interface CurrentSheet {
  readonly stored: StoredSheetDocument
  readonly document: Record<string, unknown>
  readonly malformed: boolean
}

interface TrainerRoster {
  readonly trainer: CurrentSheet
  readonly team: readonly string[]
  readonly box: readonly string[]
  readonly malformed: boolean
}

interface RosterClaim {
  readonly trainerSlug: string
  readonly destination: 'team' | 'box'
}

interface HatchAuthority {
  readonly egg: PokemonEggDocumentV1
  readonly origin: PokemonBreedingOriginV1
  readonly child: CurrentSheet
  readonly owner: CurrentSheet
  readonly destination: 'team' | 'box'
}

const object = (value: unknown): Record<string, unknown> | null => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
)
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const exactKeys = (value: Record<string, unknown>, fields: readonly string[]): boolean => {
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  return actual.length === expected.length && actual.every((field, index) => field === expected[index])
}
const hashJson = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value, {
    path: 'campaignRosterOwnershipAuthority',
    limits: {
      maxDepth: 96,
      maxNodes: 1_000_000,
      maxObjectFields: 20_000,
      maxArrayEntries: 200_000,
      maxStringLength: 100_000,
    },
  }))
  .digest('hex')
const identity = (prefix: string, ...parts: readonly (string | number)[]): string => (
  `${prefix}${hashJson(parts)}`
)
const same = (left: unknown, right: unknown): boolean => stableJsonStringify(left) === stableJsonStringify(right)

export const campaignProfileAuthorityDefinitionSha256 = (profile: PlayerProfile): string => (
  hashJson(normalizePlayerProfile(profile))
)

const profileAuthority = (value: CampaignProfileAuthorityV1, index: number): CampaignProfileAuthorityV1 => {
  const path = `profiles[${index}]`
  let profile: PlayerProfile
  try { profile = normalizePlayerProfile(value?.profile, `${path}.profile`) }
  catch (error) {
    throw new Error(`Campaign ownership attention found malformed Profile authority: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!value || value.profileId !== profile.id || !integer(value.revision)
    || value.revision >= Number.MAX_SAFE_INTEGER || !SHA256.test(value.definitionSha256)
    || value.definitionSha256 !== campaignProfileAuthorityDefinitionSha256(profile)
    || !same(profile, value.profile)) {
    throw new Error('Campaign ownership attention requires exact hash-bound Profile authority.')
  }
  if (profile.linkedCharacters.length > PROFILE_LINK_LIMIT) {
    throw new Error(`Campaign ownership attention Profile links are bounded to ${PROFILE_LINK_LIMIT} entries.`)
  }
  return Object.freeze({ ...value, profile })
}

const parseCurrentSheet = (stored: StoredSheetDocument): CurrentSheet => {
  const document = object(stored.document)
  const malformed = !integer(stored.revision)
    || stored.revision >= Number.MAX_SAFE_INTEGER
    || !document
    || document.slug !== stored.slug
    || !isSlug(stored.slug)
    || (document.revision !== undefined && document.revision !== stored.revision)
    || (stored.kind === 'trainer'
      ? typeof document.name !== 'string' || !document.name.trim()
        || !Number.isSafeInteger(document.level) || Number(document.level) < 1 || Number(document.level) > 50
      : typeof document.nickname !== 'string' || !document.nickname.trim()
        || typeof document.species !== 'string' || !document.species.trim()
        || !Number.isSafeInteger(document.level) || Number(document.level) < 1 || Number(document.level) > 100)
  return Object.freeze({ stored, document: document ?? {}, malformed })
}

const parseRosterList = (value: unknown): { readonly values: readonly string[], readonly malformed: boolean } => {
  if (value === undefined) return Object.freeze({ values: Object.freeze([]), malformed: false })
  if (!Array.isArray(value) || value.length > ROSTER_ENTRY_LIMIT) {
    return Object.freeze({ values: Object.freeze([]), malformed: true })
  }
  const values: string[] = []
  let malformed = false
  for (const candidate of value) {
    if (!isSlug(candidate) || candidate.length > 160 || values.includes(candidate)) {
      malformed = true
      continue
    }
    values.push(candidate)
  }
  return Object.freeze({ values: Object.freeze(values), malformed })
}

const trainerRoster = (trainer: CurrentSheet): TrainerRoster => {
  const team = parseRosterList(trainer.document.currentTeam)
  const box = parseRosterList(trainer.document.boxedPokemon)
  return Object.freeze({
    trainer,
    team: team.values,
    box: box.values,
    malformed: trainer.malformed || team.malformed || box.malformed
      || team.values.some(slug => box.values.includes(slug)),
  })
}

const createItem = (input: {
  readonly itemIdentityParts: readonly (string | number)[]
  readonly reason: CampaignAttentionReason
  readonly audience: 'gm' | 'owner'
  readonly urgency: CampaignAttentionUrgency
  readonly entityKind: CampaignAttentionEntityKind
  readonly entityId: string
  readonly sourceKind: CampaignAttentionSourceEventKind
  readonly sourceIdentityParts: readonly (string | number)[]
  readonly sourceCampaignMinute: number
  readonly authority: CampaignAttentionAuthorityRef
  readonly decision: CampaignAttentionDecisionKind
  readonly action: CampaignAttentionActionIntent
  readonly href: string
}): CampaignAttentionItem => {
  const itemId = identity('campaign-attention:v1:', ...input.itemIdentityParts)
  return createOpenCampaignAttentionItem({
    itemId,
    reason: input.reason,
    audience: input.audience,
    urgency: input.urgency,
    entity: Object.freeze({ kind: input.entityKind, id: input.entityId }),
    sourceEvent: Object.freeze({
      kind: input.sourceKind,
      eventId: identity('campaign-attention-source:v1:', ...input.sourceIdentityParts),
      campaignMinute: input.sourceCampaignMinute,
    }),
    authority: input.authority,
    requiredDecision: Object.freeze({
      decisionId: identity('campaign-attention-decision:v1:', itemId),
      kind: input.decision,
      authority: input.authority,
    }),
    legalActions: Object.freeze([Object.freeze({
      actionId: identity('campaign-attention-action:v1:', itemId, input.action),
      intent: input.action,
      href: input.href,
      authority: input.authority,
      requiresConfirmation: false,
    })]),
    createdAtCampaignMinute: input.sourceCampaignMinute,
  })
}

const sheetAuthority = (sheet: CurrentSheet): CampaignAttentionAuthorityRef => Object.freeze({
  kind: 'sheet' as const,
  id: sheet.stored.slug,
  revision: sheet.stored.revision,
})
const sheetEntityKind = (sheet: CurrentSheet): 'trainer-sheet' | 'pokemon-sheet' => (
  sheet.stored.kind === 'trainer' ? 'trainer-sheet' : 'pokemon-sheet'
)
const sheetHref = (sheet: CurrentSheet, attention: string): string => (
  sheet.stored.kind === 'trainer'
    ? `/sheets/trainers/${encodeURIComponent(sheet.stored.slug)}?attention=${attention}`
    : `/sheets/pokemon/${encodeURIComponent(sheet.stored.slug)}?attention=${attention}`
)

const ownershipItemForSheet = (input: {
  readonly sheet: CurrentSheet
  readonly discriminator: string
  readonly campaignMinute: number
}): CampaignAttentionItem => createItem({
  itemIdentityParts: ['ownership-review', input.sheet.stored.kind, input.sheet.stored.slug, input.discriminator],
  reason: 'ownership-review', audience: 'gm', urgency: 'blocking',
  entityKind: sheetEntityKind(input.sheet), entityId: input.sheet.stored.slug,
  sourceKind: 'sheet-authority',
  sourceIdentityParts: ['ownership-review', input.sheet.stored.kind, input.sheet.stored.slug,
    input.sheet.stored.revision, input.discriminator],
  sourceCampaignMinute: input.campaignMinute,
  authority: sheetAuthority(input.sheet),
  decision: 'assign-ownership', action: 'review-ownership',
  href: sheetHref(input.sheet, 'ownership'),
})

const teamOverflowItem = (roster: TrainerRoster, campaignMinute: number): CampaignAttentionItem => createItem({
  itemIdentityParts: ['team-overflow', roster.trainer.stored.slug],
  reason: 'team-overflow', audience: 'owner', urgency: 'blocking',
  entityKind: 'trainer-sheet', entityId: roster.trainer.stored.slug,
  sourceKind: 'sheet-authority',
  sourceIdentityParts: ['team-overflow', roster.trainer.stored.slug, roster.trainer.stored.revision],
  sourceCampaignMinute: campaignMinute,
  authority: sheetAuthority(roster.trainer),
  decision: 'repair-team', action: 'review-team',
  href: sheetHref(roster.trainer, 'team'),
})

const equipmentItem = (input: {
  readonly sheet: CurrentSheet
  readonly campaignMinute: number
  readonly malformed: boolean
}): CampaignAttentionItem => createItem({
  itemIdentityParts: ['equipment-review', input.sheet.stored.kind, input.sheet.stored.slug],
  reason: 'equipment-review', audience: 'owner', urgency: input.malformed ? 'blocking' : 'normal',
  entityKind: sheetEntityKind(input.sheet), entityId: input.sheet.stored.slug,
  sourceKind: 'sheet-authority',
  sourceIdentityParts: ['equipment-review', input.sheet.stored.kind, input.sheet.stored.slug,
    input.sheet.stored.revision],
  sourceCampaignMinute: input.campaignMinute,
  authority: sheetAuthority(input.sheet),
  decision: 'repair-equipment', action: 'review-equipment',
  href: sheetHref(input.sheet, 'equipment'),
})

const equipmentNeedsReview = (sheet: CurrentSheet): { readonly needed: boolean, readonly malformed: boolean } => {
  if (sheet.document.equipmentState === undefined) return Object.freeze({ needed: false, malformed: false })
  try {
    const kind: EquipmentOwnerKind = sheet.stored.kind
    const state = parseSheetEquipmentStateForOwner(sheet.document.equipmentState, {
      kind,
      slug: sheet.stored.slug,
    })
    const reconciliation = reconcileSheetEquipmentCompatibility({
      owner: sheet.stored.kind === 'trainer'
        ? { kind: 'trainer', slug: sheet.stored.slug, sheet: sheet.document as unknown as TrainerSheet }
        : { kind: 'pokemon', slug: sheet.stored.slug, sheet: sheet.document as unknown as CharacterSheet },
      equipmentState: state,
      incrementStateRevision: false,
    })
    const incompatible = reconciliation.state.instances.some(instance => (
      instance.activity.reasons.some(reason => EQUIPMENT_REASON_SET.has(reason.code))
    ))
    return Object.freeze({
      needed: reconciliation.changed || reconciliation.state.unresolved.length > 0 || incompatible,
      malformed: false,
    })
  }
  catch {
    return Object.freeze({ needed: true, malformed: true })
  }
}

const captureFacts = (input: {
  readonly sources: readonly StoredEncounterSettlementAttentionSource[]
  readonly facts: readonly StoredEncounterSettlementHistoryFact[]
  readonly pokemon: ReadonlyMap<string, CurrentSheet>
}): {
  readonly items: readonly CampaignAttentionItem[]
  readonly acquiredPokemonSlugs: ReadonlySet<string>
} => {
  const sourceIds = input.sources.map(source => source.sourceId)
  const factIds = input.facts.map(fact => fact.factId)
  if (new Set(sourceIds).size !== sourceIds.length || new Set(factIds).size !== factIds.length) {
    throw new Error('Campaign capture attention requires unique immutable source identities.')
  }
  const facts = new Map(input.facts.map(fact => [fact.factId, fact]))
  const captureSources = input.sources.filter(source => source.reason === 'capture-review')
  const captureHistory = input.facts.filter(fact => fact.kind === 'capture-settled')
  const usedFacts = new Set<string>()
  const items: CampaignAttentionItem[] = []
  const acquired = new Set<string>()
  for (const source of captureSources) {
    const fact = facts.get(source.sourceFactId)
    const payload = object(fact?.payload)
    if (!fact || fact.settlementId !== source.settlementId || fact.operationId !== source.operationId
      || fact.createdAtCampaignMinute !== source.createdAtCampaignMinute
      || fact.kind !== 'capture-settled' || fact.subjectKind !== 'capture'
      || fact.subjectId !== source.entityId || source.entityKind !== 'pokemon-sheet'
      || source.audience !== 'owner' || source.authority.kind !== 'sheet'
      || source.authority.id !== source.entityId || usedFacts.has(fact.factId)
      || !['capture-team', 'capture-box'].includes(fact.resultCode)
      || !payload || !exactKeys(payload, ['rewardId', 'caughtBallPreserved'])
      || typeof payload.rewardId !== 'string' || !payload.rewardId
      || payload.caughtBallPreserved !== true) {
      throw new Error('Campaign capture attention lost its exact immutable settlement authority.')
    }
    const current = input.pokemon.get(source.entityId)
    if (current && source.authority.revision > current.stored.revision) {
      throw new Error('Campaign capture attention has future sheet authority.')
    }
    usedFacts.add(fact.factId)
    acquired.add(source.entityId)
    items.push(campaignAttentionItemFromSettlementSource(source))
  }
  if (captureHistory.length !== usedFacts.size
    || captureHistory.some(fact => !usedFacts.has(fact.factId))) {
    throw new Error('Every immutable capture fact requires exactly one campaign capture-review source.')
  }
  return Object.freeze({ items: Object.freeze(items), acquiredPokemonSlugs: acquired })
}

const hatchAuthority = (input: {
  readonly egg: PokemonEggDocumentV1
  readonly origin: PokemonBreedingOriginV1
  readonly operation: BreedingOperationLedgerRecord
  readonly child: CurrentSheet
  readonly owner: CurrentSheet
}): HatchAuthority => {
  const egg = parseAuthoritativePokemonEggDocumentV1(input.egg)
  const origin = validatePokemonBreedingOriginAgainstHatchedEgg(
    parseAuthoritativePokemonBreedingOriginV1(input.origin),
    egg,
  )
  const command = input.operation?.command
  const result = input.operation?.result
  let accepted: ReturnType<typeof assertBreedingOperationResultMatchesCommand>
  try { accepted = assertBreedingOperationResultMatchesCommand(command, result) }
  catch { throw new Error('Hatched Pokémon attention lost its exact accepted breeding operation authority.') }
  const childRefs = accepted.ok
    ? accepted.aggregateRefs.filter(ref => ref.kind === 'pokemon-sheet' && ref.id === origin.childSheetSlug)
    : []
  const trainerRefs = accepted.ok
    ? accepted.aggregateRefs.filter(ref => ref.kind === 'trainer-sheet' && ref.id === origin.ownerTrainerSlugAtHatch)
    : []
  const eggRefs = accepted.ok
    ? accepted.aggregateRefs.filter(ref => ref.kind === 'pokemon-egg' && ref.id === origin.eggId)
    : []
  if (egg.status !== 'hatched' || input.child.stored.kind !== 'pokemon'
    || input.owner.stored.kind !== 'trainer' || input.child.stored.slug !== egg.childSheetSlug
    || input.owner.stored.slug !== egg.ownerTrainerSlug || input.operation.operationId !== egg.lastOperationId
    || input.operation.commandHash !== createBreedingOperationCommandHash(command)
    || !same(input.operation.scopes, command.scopes) || input.operation.status !== 'accepted'
    || input.operation.settledAtCampaignMinute !== egg.updatedAtCampaignMinute
    || !accepted.ok || accepted.commandKind !== 'complete-hatch' || accepted.outcomeKind !== 'hatched'
    || accepted.committedAtCampaignMinute !== egg.updatedAtCampaignMinute
    || command.commandKind !== 'complete-hatch' || command.payload.eggId !== egg.eggId
    || command.payload.originId !== origin.originId
    || command.payload.destination.trainerSheetSlug !== egg.ownerTrainerSlug
    || eggRefs.length !== 1 || eggRefs[0]!.revision !== egg.revision
    || childRefs.length !== 1 || childRefs[0]!.revision > input.child.stored.revision
    || trainerRefs.length !== 1 || trainerRefs[0]!.revision > input.owner.stored.revision) {
    throw new Error('Hatched Pokémon attention lost its exact accepted breeding operation authority.')
  }
  return Object.freeze({
    egg,
    origin,
    child: input.child,
    owner: input.owner,
    destination: command.payload.destination.kind,
  })
}

const hatchItem = (authority: HatchAuthority): CampaignAttentionItem => createItem({
  itemIdentityParts: ['hatch-review', authority.egg.eggId],
  reason: 'hatch-review', audience: 'owner', urgency: 'normal',
  entityKind: 'pokemon-sheet', entityId: authority.child.stored.slug,
  sourceKind: 'breeding-operation',
  sourceIdentityParts: ['hatch-review', authority.egg.eggId, authority.egg.revision,
    authority.origin.lineageDefinitionSha256],
  sourceCampaignMinute: authority.egg.updatedAtCampaignMinute,
  authority: sheetAuthority(authority.child),
  decision: 'review-hatch', action: 'review-hatch',
  href: sheetHref(authority.child, 'hatch'),
})

const profileRepairItem = (input: {
  readonly authority: CampaignProfileAuthorityV1
  readonly campaignMinute: number
}): CampaignAttentionItem => {
  const opaqueAuthorityId = identity(
    'campaign-profile-authority:v1:', input.authority.profileId, input.authority.definitionSha256,
  )
  const authority: CampaignAttentionAuthorityRef = Object.freeze({
    kind: 'profile', id: opaqueAuthorityId, revision: input.authority.revision,
  })
  return createItem({
    itemIdentityParts: ['profile-link-review', input.authority.profileId],
    reason: 'ownership-review', audience: 'gm', urgency: 'blocking',
    entityKind: 'campaign', entityId: 'campaign',
    sourceKind: 'profile-authority',
    sourceIdentityParts: ['profile-link-review', input.authority.profileId,
      input.authority.revision, input.authority.definitionSha256],
    sourceCampaignMinute: input.campaignMinute,
    authority,
    decision: 'assign-ownership', action: 'review-ownership',
    href: '/campaign?attention=profiles',
  })
}

const sortedItems = (items: readonly CampaignAttentionItem[]): readonly CampaignAttentionItem[] => {
  if (items.length > LIMIT) {
    throw new Error(`Campaign roster and ownership attention is bounded to ${LIMIT} projected items.`)
  }
  if (new Set(items.map(item => item.itemId)).size !== items.length) {
    throw new Error('Campaign roster and ownership attention providers produced duplicate item identity.')
  }
  const urgencyRank: Readonly<Record<CampaignAttentionUrgency, number>> = {
    blocking: 0, urgent: 1, normal: 2, informational: 3,
  }
  return Object.freeze([...items].sort((left, right) => (
    urgencyRank[left.urgency] - urgencyRank[right.urgency]
    || left.reason.localeCompare(right.reason)
    || left.entity.kind.localeCompare(right.entity.kind)
    || left.entity.id.localeCompare(right.entity.id)
    || left.itemId.localeCompare(right.itemId)
  )))
}

export const projectCampaignRosterOwnershipAttention = (input: {
  readonly sheets: readonly StoredSheetDocument[]
  readonly profiles: readonly CampaignProfileAuthorityV1[]
  readonly settlementSources: readonly StoredEncounterSettlementAttentionSource[]
  readonly historyFacts: readonly StoredEncounterSettlementHistoryFact[]
  readonly eggs: readonly PokemonEggDocumentV1[]
  readonly breedingOrigins: readonly PokemonBreedingOriginV1[]
  readonly breedingOperations: readonly BreedingOperationLedgerRecord[]
  readonly campaignMinute: number
  readonly completeness: {
    readonly sheets: true
    readonly profiles: true
    readonly settlementSources: true
    readonly historyFacts: true
    readonly eggs: true
    readonly breedingOrigins: true
    readonly breedingOperations: true
  }
}): readonly CampaignAttentionItem[] => {
  if (input.completeness.sheets !== true || input.completeness.profiles !== true
    || input.completeness.settlementSources !== true || input.completeness.historyFacts !== true
    || input.completeness.eggs !== true || input.completeness.breedingOrigins !== true
    || input.completeness.breedingOperations !== true) {
    throw new Error('Campaign roster and ownership attention requires one complete current authority read.')
  }
  if (!integer(input.campaignMinute)) {
    throw new Error('Campaign roster and ownership attention requires a non-negative safe campaign minute.')
  }
  const collections = [
    input.sheets, input.profiles, input.settlementSources, input.historyFacts,
    input.eggs, input.breedingOrigins, input.breedingOperations,
  ]
  if (collections.some(collection => collection.length > LIMIT)) {
    throw new Error(`Campaign roster and ownership attention reads are each bounded to ${LIMIT} records.`)
  }

  const sheetKeys = input.sheets.map(sheet => `${sheet.kind}:${sheet.slug}`)
  const profileIds = input.profiles.map(profile => profile.profileId)
  const eggIds = input.eggs.map(egg => egg.eggId)
  const originIds = input.breedingOrigins.map(origin => origin.originId)
  const operationIds = input.breedingOperations.map(operation => operation.operationId)
  if (new Set(sheetKeys).size !== sheetKeys.length || new Set(profileIds).size !== profileIds.length
    || new Set(eggIds).size !== eggIds.length || new Set(originIds).size !== originIds.length
    || new Set(operationIds).size !== operationIds.length) {
    throw new Error('Campaign roster and ownership attention requires unique current authority identities.')
  }

  const sheets = input.sheets.map(parseCurrentSheet)
  const trainers = new Map(sheets.filter(sheet => sheet.stored.kind === 'trainer')
    .map(sheet => [sheet.stored.slug, sheet]))
  const pokemon = new Map(sheets.filter(sheet => sheet.stored.kind === 'pokemon')
    .map(sheet => [sheet.stored.slug, sheet]))
  const profiles = input.profiles.map(profileAuthority)
  const profilesByTrainer = new Map<string, CampaignProfileAuthorityV1[]>()
  const items: CampaignAttentionItem[] = []
  const ownershipItems = new Map<string, CampaignAttentionItem>()

  for (const authority of profiles) {
    let staleLink = false
    for (const link of authority.profile.linkedCharacters) {
      const current = link.sheetKind === 'trainer' ? trainers.get(link.sheetSlug) : pokemon.get(link.sheetSlug)
      if (!current) staleLink = true
      if (link.sheetKind === 'trainer' && current) {
        const values = profilesByTrainer.get(link.sheetSlug) ?? []
        values.push(authority)
        profilesByTrainer.set(link.sheetSlug, values)
      }
    }
    if (staleLink) items.push(profileRepairItem({ authority, campaignMinute: input.campaignMinute }))
  }

  const rosters = new Map([...trainers.values()].map(trainer => [trainer.stored.slug, trainerRoster(trainer)]))
  const claims = new Map<string, RosterClaim[]>()
  for (const roster of rosters.values()) {
    if (roster.malformed) {
      ownershipItems.set(`trainer-roster:${roster.trainer.stored.slug}`, ownershipItemForSheet({
        sheet: roster.trainer, discriminator: 'malformed-roster', campaignMinute: input.campaignMinute,
      }))
    }
    if (roster.team.length > TRAINER_TEAM_LIMIT) items.push(teamOverflowItem(roster, input.campaignMinute))
    for (const [destination, values] of [['team', roster.team], ['box', roster.box]] as const) {
      for (const slug of values) {
        const rows = claims.get(slug) ?? []
        rows.push(Object.freeze({ trainerSlug: roster.trainer.stored.slug, destination }))
        claims.set(slug, rows)
        if (!pokemon.has(slug)) {
          ownershipItems.set(`missing-roster-sheet:${roster.trainer.stored.slug}:${slug}`, ownershipItemForSheet({
            sheet: roster.trainer,
            discriminator: identity('missing-roster-sheet:v1:', slug),
            campaignMinute: input.campaignMinute,
          }))
        }
      }
    }
  }
  for (const [slug, rows] of claims) {
    if (rows.length > 1 && pokemon.has(slug)) {
      ownershipItems.set(`duplicate-owner:${slug}`, ownershipItemForSheet({
        sheet: pokemon.get(slug)!, discriminator: 'duplicate-roster-owner', campaignMinute: input.campaignMinute,
      }))
    }
  }

  const captures = captureFacts({
    sources: input.settlementSources,
    facts: input.historyFacts,
    pokemon,
  })
  items.push(...captures.items)
  const acquired = new Set(captures.acquiredPokemonSlugs)

  const originsByEgg = new Map(input.breedingOrigins.map(origin => [origin.eggId, origin]))
  const operations = new Map(input.breedingOperations.map(operation => [operation.operationId, operation]))
  const hatchOwners = new Map<string, string>()
  const usedOrigins = new Set<string>()
  for (const rawEgg of input.eggs) {
    const egg = parseAuthoritativePokemonEggDocumentV1(rawEgg)
    if (egg.updatedAtCampaignMinute > input.campaignMinute) {
      throw new Error('Campaign hatch attention cannot consume future Egg authority.')
    }
    if (egg.status !== 'hatched') continue
    const origin = originsByEgg.get(egg.eggId)
    const operation = operations.get(egg.lastOperationId)
    const child = egg.childSheetSlug ? pokemon.get(egg.childSheetSlug) : null
    const owner = trainers.get(egg.ownerTrainerSlug)
    if (!origin || !operation || !child || !owner) {
      throw new Error('Hatched Pokémon attention requires complete Egg, origin, operation, child, and owner authority.')
    }
    const authority = hatchAuthority({ egg, origin, operation, child, owner })
    if (hatchOwners.has(child.stored.slug)) {
      throw new Error('Hatched Pokémon attention found duplicate child authority.')
    }
    hatchOwners.set(child.stored.slug, owner.stored.slug)
    usedOrigins.add(origin.originId)
    acquired.add(child.stored.slug)
    items.push(hatchItem(authority))
  }
  if (input.breedingOrigins.some(origin => !usedOrigins.has(origin.originId))) {
    throw new Error('Campaign hatch attention found an origin without its exact current hatched Egg.')
  }

  for (const slug of acquired) {
    const current = pokemon.get(slug)
    const currentClaims = claims.get(slug) ?? []
    if (!current) continue
    const expectedHatchOwner = hatchOwners.get(slug)
    if (currentClaims.length !== 1
      || (expectedHatchOwner !== undefined && currentClaims[0]?.trainerSlug !== expectedHatchOwner)) {
      ownershipItems.set(`acquired-owner:${slug}`, ownershipItemForSheet({
        sheet: current, discriminator: 'acquired-roster-assignment', campaignMinute: input.campaignMinute,
      }))
      continue
    }
    const ownerSlug = currentClaims[0]!.trainerSlug
    if ((profilesByTrainer.get(ownerSlug) ?? []).length === 0) {
      const owner = trainers.get(ownerSlug)
      if (owner) ownershipItems.set(`profile-link:${ownerSlug}`, ownershipItemForSheet({
        sheet: owner, discriminator: 'profile-link-required', campaignMinute: input.campaignMinute,
      }))
    }
  }

  for (const trainer of trainers.values()) {
    if (trainer.document.player === true && (profilesByTrainer.get(trainer.stored.slug) ?? []).length === 0) {
      ownershipItems.set(`profile-link:${trainer.stored.slug}`, ownershipItemForSheet({
        sheet: trainer, discriminator: 'profile-link-required', campaignMinute: input.campaignMinute,
      }))
    }
  }

  for (const sheet of sheets) {
    if (sheet.malformed && !ownershipItems.has(`malformed-sheet:${sheet.stored.kind}:${sheet.stored.slug}`)) {
      ownershipItems.set(`malformed-sheet:${sheet.stored.kind}:${sheet.stored.slug}`, ownershipItemForSheet({
        sheet, discriminator: 'malformed-sheet', campaignMinute: input.campaignMinute,
      }))
    }
    const equipment = equipmentNeedsReview(sheet)
    if (equipment.needed) items.push(equipmentItem({
      sheet, campaignMinute: input.campaignMinute, malformed: equipment.malformed,
    }))
  }

  items.push(...ownershipItems.values())
  return sortedItems(items)
}
