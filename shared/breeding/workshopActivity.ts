import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '../automation/stableJson'
import { cloneStrictJson, deepFreezeStrictJson, type StrictJsonObject } from '../automation/strictJson'
import { parseBreedingProjectIdSyntax, parsePokemonEggIdSyntax, type BreedingProjectId, type PokemonEggId } from './ids'
import { BREEDING_PROJECT_STATUSES, type BreedingProjectStatus } from './project'
import { POKEMON_EGG_STATUSES, type PokemonEggGenderId, type PokemonEggSourceKind, type PokemonEggStatus } from './egg'
import { isPlayerProfileId, type PlayerProfileId } from '../playerProfiles'
import { isSlug } from '../paths'
import { computeRulesetSourceSha256 } from '../ruleset/sourceHash'

export const BREEDING_WORKSHOP_ACTIVITY_API_PATH = '/api/breeding/workshop/activity' as const
export const BREEDING_WORKSHOP_ACTIVITY_CARD_LIMIT = 50 as const
export const BREEDING_WORKSHOP_ACTIVITY_HISTORY_LIMIT = 12 as const

export const BREEDING_WORKSHOP_PROJECT_STAGES = Object.freeze([
  'planning', 'awaiting-consent', 'initial-time', 'check', 'additional-time', 'production-ready',
  'completed', 'ended',
] as const)
export type BreedingWorkshopProjectStage = typeof BREEDING_WORKSHOP_PROJECT_STAGES[number]
export const BREEDING_WORKSHOP_EGG_STAGES = Object.freeze([
  'incubating', 'ready', 'decision-required', 'hatching', 'completed', 'ended',
] as const)
export type BreedingWorkshopEggStage = typeof BREEDING_WORKSHOP_EGG_STAGES[number]
export const BREEDING_WORKSHOP_HISTORY_KINDS = Object.freeze([
  'additional-time-started', 'check-failed', 'check-ready', 'check-succeeded', 'created',
  'egg-cancelled', 'egg-hatched', 'egg-produced', 'egg-ready', 'egg-special-required',
  'egg-status-changed', 'initial-time-started', 'ownership-transferred', 'project-ended',
  'production-ready',
] as const)
export type BreedingWorkshopHistoryKind = typeof BREEDING_WORKSHOP_HISTORY_KINDS[number]
export type BreedingWorkshopActivityAudience = 'gm' | 'owner'
export type BreedingWorkshopParentRelationship = 'owned' | 'participating'
export type BreedingWorkshopConsentStatus = 'active' | 'expired' | 'not-required' | 'revoked' | 'waiting'
export type BreedingWorkshopRecoveryState = 'none' | 'pending'
export type BreedingWorkshopTransferState = 'accepted' | 'available' | 'expired' | 'offered' | 'unavailable'
export type BreedingWorkshopTransferAction = 'none' | 'review' | 'start'
export type BreedingWorkshopTransferReasonId =
  | 'breeding.workshop-transfer.active-offer'
  | 'breeding.workshop-transfer.pending-recovery'
  | 'breeding.workshop-transfer.status-unavailable'
  | null

export interface BreedingWorkshopActivityRequestV1 {
  readonly profileId: PlayerProfileId | null
  readonly trainerSheetSlug: string
}
export interface BreedingWorkshopActivityTrainerV1 {
  readonly trainerSheetSlug: string
  readonly trainerRevision: number
  readonly displayName: string
}
export interface BreedingWorkshopHistoryEntryV1 {
  readonly kind: BreedingWorkshopHistoryKind
  readonly campaignMinute: number
}
export interface BreedingWorkshopRecoverySummaryV1 {
  readonly state: BreedingWorkshopRecoveryState
  readonly pendingSinceCampaignMinute: number | null
  readonly canRefresh: boolean
}
export interface BreedingWorkshopProjectProgressV1 {
  readonly stage: BreedingWorkshopProjectStage
  readonly accumulatedCampaignMinutes: number
  readonly targetCampaignMinutes: 480
  readonly percent: number
}
export interface BreedingWorkshopEggProgressV1 {
  readonly stage: BreedingWorkshopEggStage
  readonly accumulatedCampaignMinutes: number
  readonly targetCampaignMinutes: number
  readonly percent: number
  readonly paused: boolean
}
export interface BreedingWorkshopProjectParentV1 {
  readonly parentIndex: 0 | 1
  readonly relationship: BreedingWorkshopParentRelationship
  readonly displayName: string
  readonly pokemonSheetSlug: string | null
  readonly consentStatus: BreedingWorkshopConsentStatus
}
export interface BreedingWorkshopProjectCardV1 {
  readonly aggregateKind: 'breeding-project'
  readonly projectId: BreedingProjectId
  readonly revision: number
  readonly status: BreedingProjectStatus
  readonly breederDisplayName: string
  readonly parents: readonly [BreedingWorkshopProjectParentV1, BreedingWorkshopProjectParentV1]
  readonly progress: BreedingWorkshopProjectProgressV1
  readonly history: readonly BreedingWorkshopHistoryEntryV1[]
  readonly recovery: BreedingWorkshopRecoverySummaryV1
  readonly createdAtCampaignMinute: number
  readonly updatedAtCampaignMinute: number
  readonly statusChangedAtCampaignMinute: number
}
export interface BreedingWorkshopEggTransferV1 {
  readonly state: BreedingWorkshopTransferState
  readonly action: BreedingWorkshopTransferAction
  readonly reasonId: BreedingWorkshopTransferReasonId
  readonly counterpartyTrainerSlug: string | null
  readonly expiresAtCampaignMinute: number | null
}
export interface BreedingWorkshopEggCardV1 {
  readonly aggregateKind: 'pokemon-egg'
  readonly eggId: PokemonEggId
  readonly revision: number
  readonly status: PokemonEggStatus
  readonly sourceKind: PokemonEggSourceKind
  readonly speciesName: string
  readonly natureName: string
  readonly abilityName: string
  readonly genderId: PokemonEggGenderId
  readonly startingLevel: number
  readonly progress: BreedingWorkshopEggProgressV1
  readonly history: readonly BreedingWorkshopHistoryEntryV1[]
  readonly recovery: BreedingWorkshopRecoverySummaryV1
  readonly transfer: BreedingWorkshopEggTransferV1
  readonly childSheetSlug: string | null
  readonly createdAtCampaignMinute: number
  readonly updatedAtCampaignMinute: number
  readonly statusChangedAtCampaignMinute: number
}
export interface BreedingWorkshopActivityProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: BreedingWorkshopActivityAudience
  readonly trainer: BreedingWorkshopActivityTrainerV1
  readonly generatedAtCampaignMinute: number
  readonly projectsTruncated: boolean
  readonly eggsTruncated: boolean
  readonly projects: readonly BreedingWorkshopProjectCardV1[]
  readonly eggs: readonly BreedingWorkshopEggCardV1[]
  readonly securityPolicyDefinitionSha256: string
  readonly projectionDefinitionSha256: string
}

export class BreedingWorkshopActivityContractError extends Error {
  readonly code:
    | 'breeding.workshop-activity.hash-mismatch'
    | 'breeding.workshop-activity.invalid-document'
    | 'breeding.workshop-activity.invalid-id'
    | 'breeding.workshop-activity.invalid-invariant'
    | 'breeding.workshop-activity.security-policy-mismatch'
  readonly path: string
  constructor(code: BreedingWorkshopActivityContractError['code'], path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingWorkshopActivityContractError'
    this.code = code
    this.path = path
  }
}

const SHA256 = /^[0-9a-f]{64}$/
const CONTROL = /[\u0000-\u001f\u007f]/u
const PROJECT_STATUS = new Set<string>(BREEDING_PROJECT_STATUSES)
const EGG_STATUS = new Set<string>(POKEMON_EGG_STATUSES)
const PROJECT_STAGES = new Set<string>(BREEDING_WORKSHOP_PROJECT_STAGES)
const EGG_STAGES = new Set<string>(BREEDING_WORKSHOP_EGG_STAGES)
const HISTORY_KINDS = new Set<string>(BREEDING_WORKSHOP_HISTORY_KINDS)
const SOURCE_KINDS = new Set<string>(['breeding', 'fossil', 'gm', 'feature-artificial'])
const CONSENT_STATUSES = new Set<string>(['active', 'expired', 'not-required', 'revoked', 'waiting'])
const fail = (
  code: BreedingWorkshopActivityContractError['code'],
  path: string,
  message: string,
): never => { throw new BreedingWorkshopActivityContractError(code, path, message) }
const clone = (value: unknown, path: string): StrictJsonObject => {
  const result = cloneStrictJson(value, path, {
    limits: {
      depth: 10,
      nodes: 12_000,
      objectFields: 20,
      arrayEntries: BREEDING_WORKSHOP_ACTIVITY_CARD_LIMIT,
      stringLength: 200,
      objectKeyLength: 80,
    },
    rootLabel: path,
    valueLabel: 'Breeding Workshop activity',
    failNotJson: (field, detail) => fail('breeding.workshop-activity.invalid-document', field, detail),
    failLimit: (field, detail) => fail('breeding.workshop-activity.invalid-document', field, detail),
  })
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return fail('breeding.workshop-activity.invalid-document', path, 'must be one plain object.')
  }
  return result as StrictJsonObject
}
const exact = (value: unknown, fields: readonly string[], path: string): StrictJsonObject => {
  const row = clone(value, path)
  const actual = Object.keys(row).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    return fail('breeding.workshop-activity.invalid-document', path, 'must contain exactly the declared fields.')
  }
  return row
}
const integer = (value: unknown, path: string, maximum = Number.MAX_SAFE_INTEGER): number => (
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum
    ? Number(value)
    : fail('breeding.workshop-activity.invalid-document', path, 'must be a bounded nonnegative safe integer.')
)
const text = (value: unknown, path: string): string => (
  typeof value === 'string' && value.length > 0 && value.length <= 120
    && value.trim() === value && !CONTROL.test(value)
    ? value
    : fail('breeding.workshop-activity.invalid-document', path, 'must be bounded safe display text.')
)
const slug = (value: unknown, path: string): string => (
  isSlug(value) && value.length <= 160
    ? value
    : fail('breeding.workshop-activity.invalid-id', path, 'must be a bounded canonical slug.')
)
const optionalSlug = (value: unknown, path: string): string | null => value === null ? null : slug(value, path)
const hash = (value: unknown, path: string): string => (
  typeof value === 'string' && SHA256.test(value)
    ? value
    : fail('breeding.workshop-activity.invalid-document', path, 'must be a lowercase SHA-256 digest.')
)
const bool = (value: unknown, path: string): boolean => (
  typeof value === 'boolean'
    ? value
    : fail('breeding.workshop-activity.invalid-document', path, 'must be boolean.')
)
const percent = (accumulated: number, target: number): number => target <= 0
  ? 100
  : Math.min(100, Math.floor((accumulated * 100) / target))

export const BREEDING_WORKSHOP_ACTIVITY_SECURITY_POLICY_DEFINITION_SHA256 = hash(
  securityPolicyJson.definitionSha256,
  'securityPolicy.definitionSha256',
)

export const parseBreedingWorkshopActivityRequestV1 = (
  value: unknown,
  path = 'activityRequest',
): BreedingWorkshopActivityRequestV1 => {
  const row = exact(value, ['profileId', 'trainerSheetSlug'], path)
  const profileId = row.profileId === null
    ? null
    : isPlayerProfileId(row.profileId)
      ? row.profileId
      : fail('breeding.workshop-activity.invalid-id', `${path}.profileId`, 'must be a current Player Profile ID or null.')
  return deepFreezeStrictJson({
    profileId,
    trainerSheetSlug: slug(row.trainerSheetSlug, `${path}.trainerSheetSlug`),
  }) as BreedingWorkshopActivityRequestV1
}

const parseHistory = (value: unknown, path: string): readonly BreedingWorkshopHistoryEntryV1[] => {
  if (!Array.isArray(value) || value.length > BREEDING_WORKSHOP_ACTIVITY_HISTORY_LIMIT) {
    return fail('breeding.workshop-activity.invalid-document', path, 'must be a bounded history array.')
  }
  const history = value.map((entry, index) => {
    const item = exact(entry, ['kind', 'campaignMinute'], `${path}[${index}]`)
    if (typeof item.kind !== 'string' || !HISTORY_KINDS.has(item.kind)) {
      return fail('breeding.workshop-activity.invalid-id', `${path}[${index}].kind`, 'must be a closed history kind.')
    }
    return {
      kind: item.kind as BreedingWorkshopHistoryKind,
      campaignMinute: integer(item.campaignMinute, `${path}[${index}].campaignMinute`),
    }
  })
  const identities = new Set<string>()
  for (let index = 0; index < history.length; index += 1) {
    const current = history[index]!
    const previous = history[index - 1]
    const identity = `${current.campaignMinute}\0${current.kind}`
    if (identities.has(identity)
      || (previous && (previous.campaignMinute > current.campaignMinute
        || (previous.campaignMinute === current.campaignMinute && previous.kind > current.kind)))) {
      return fail('breeding.workshop-activity.invalid-invariant', path, 'must be unique and sorted by campaign minute then kind.')
    }
    identities.add(identity)
  }
  return history
}
const parseRecovery = (value: unknown, path: string): BreedingWorkshopRecoverySummaryV1 => {
  const row = exact(value, ['state', 'pendingSinceCampaignMinute', 'canRefresh'], path)
  if ((row.state !== 'none' && row.state !== 'pending') || typeof row.canRefresh !== 'boolean') {
    return fail('breeding.workshop-activity.invalid-document', path, 'must contain a closed recovery state.')
  }
  const pendingSince = row.pendingSinceCampaignMinute === null
    ? null
    : integer(row.pendingSinceCampaignMinute, `${path}.pendingSinceCampaignMinute`)
  if ((row.state === 'pending') !== (pendingSince !== null) || row.canRefresh !== (row.state === 'pending')) {
    return fail('breeding.workshop-activity.invalid-invariant', path, 'pending time and refresh action must match recovery state.')
  }
  return { state: row.state, pendingSinceCampaignMinute: pendingSince, canRefresh: row.canRefresh }
}
const parseProjectProgress = (value: unknown, path: string): BreedingWorkshopProjectProgressV1 => {
  const row = exact(value, ['stage', 'accumulatedCampaignMinutes', 'targetCampaignMinutes', 'percent'], path)
  if (typeof row.stage !== 'string' || !PROJECT_STAGES.has(row.stage) || row.targetCampaignMinutes !== 480) {
    return fail('breeding.workshop-activity.invalid-document', path, 'must contain a closed Project stage and 480-minute target.')
  }
  const accumulated = integer(row.accumulatedCampaignMinutes, `${path}.accumulatedCampaignMinutes`, 480)
  const valuePercent = integer(row.percent, `${path}.percent`, 100)
  if (valuePercent !== percent(accumulated, 480)) {
    return fail('breeding.workshop-activity.invalid-invariant', `${path}.percent`, 'must be derived from exact progress.')
  }
  return { stage: row.stage as BreedingWorkshopProjectStage, accumulatedCampaignMinutes: accumulated, targetCampaignMinutes: 480, percent: valuePercent }
}
const parseEggProgress = (value: unknown, path: string): BreedingWorkshopEggProgressV1 => {
  const row = exact(value, ['stage', 'accumulatedCampaignMinutes', 'targetCampaignMinutes', 'percent', 'paused'], path)
  if (typeof row.stage !== 'string' || !EGG_STAGES.has(row.stage)) {
    return fail('breeding.workshop-activity.invalid-document', `${path}.stage`, 'must be a closed Egg stage.')
  }
  const target = integer(row.targetCampaignMinutes, `${path}.targetCampaignMinutes`)
  const accumulated = integer(row.accumulatedCampaignMinutes, `${path}.accumulatedCampaignMinutes`, target)
  const valuePercent = integer(row.percent, `${path}.percent`, 100)
  if (target < 1 || valuePercent !== percent(accumulated, target)) {
    return fail('breeding.workshop-activity.invalid-invariant', `${path}.percent`, 'must be derived from exact progress.')
  }
  return { stage: row.stage as BreedingWorkshopEggStage, accumulatedCampaignMinutes: accumulated, targetCampaignMinutes: target, percent: valuePercent, paused: bool(row.paused, `${path}.paused`) }
}
const parseParent = (
  value: unknown,
  index: 0 | 1,
  audience: BreedingWorkshopActivityAudience,
  path: string,
): BreedingWorkshopProjectParentV1 => {
  const row = exact(value, ['parentIndex', 'relationship', 'displayName', 'pokemonSheetSlug', 'consentStatus'], path)
  if (row.parentIndex !== index || (row.relationship !== 'owned' && row.relationship !== 'participating')
    || typeof row.consentStatus !== 'string' || !CONSENT_STATUSES.has(row.consentStatus)) {
    return fail('breeding.workshop-activity.invalid-document', path, 'must be a canonical parent slot.')
  }
  const sheetSlug = optionalSlug(row.pokemonSheetSlug, `${path}.pokemonSheetSlug`)
  if ((row.relationship === 'owned') !== (row.consentStatus === 'not-required')
    || (audience === 'owner' && row.relationship === 'participating'
      && (sheetSlug !== null || row.displayName !== 'Participating parent'))
    || ((row.relationship === 'owned' || audience === 'gm') && sheetSlug === null)) {
    return fail('breeding.workshop-activity.invalid-invariant', path, 'relationship, consent, audience, and identity must agree.')
  }
  return {
    parentIndex: index,
    relationship: row.relationship,
    displayName: text(row.displayName, `${path}.displayName`),
    pokemonSheetSlug: sheetSlug,
    consentStatus: row.consentStatus as BreedingWorkshopConsentStatus,
  }
}
const parseTransfer = (value: unknown, path: string): BreedingWorkshopEggTransferV1 => {
  const row = exact(value, ['state', 'action', 'reasonId', 'counterpartyTrainerSlug', 'expiresAtCampaignMinute'], path)
  if (!['accepted', 'available', 'expired', 'offered', 'unavailable'].includes(row.state as string)
    || !['none', 'review', 'start'].includes(row.action as string)) {
    return fail('breeding.workshop-activity.invalid-document', path, 'must contain a closed transfer state and action.')
  }
  const reasonId = row.reasonId === null
    || row.reasonId === 'breeding.workshop-transfer.active-offer'
    || row.reasonId === 'breeding.workshop-transfer.pending-recovery'
    || row.reasonId === 'breeding.workshop-transfer.status-unavailable'
    ? row.reasonId as BreedingWorkshopTransferReasonId
    : fail('breeding.workshop-activity.invalid-id', `${path}.reasonId`, 'must be a closed transfer reason.')
  const counterparty = optionalSlug(row.counterpartyTrainerSlug, `${path}.counterpartyTrainerSlug`)
  const expiresAt = row.expiresAtCampaignMinute === null
    ? null
    : integer(row.expiresAtCampaignMinute, `${path}.expiresAtCampaignMinute`)
  const active = row.state === 'offered' || row.state === 'accepted' || row.state === 'expired'
  if ((row.state === 'available') !== (row.action === 'start')
    || active !== (row.action === 'review')
    || active !== (counterparty !== null && expiresAt !== null)
    || (active ? reasonId !== 'breeding.workshop-transfer.active-offer' : counterparty !== null || expiresAt !== null)
    || (row.state === 'unavailable' && (row.action !== 'none'
      || (reasonId !== 'breeding.workshop-transfer.pending-recovery'
        && reasonId !== 'breeding.workshop-transfer.status-unavailable')))
    || (row.state === 'available' && reasonId !== null)) {
    return fail('breeding.workshop-activity.invalid-invariant', path, 'state, action, reason, counterparty, and expiry must agree.')
  }
  return { state: row.state as BreedingWorkshopTransferState, action: row.action as BreedingWorkshopTransferAction, reasonId, counterpartyTrainerSlug: counterparty, expiresAtCampaignMinute: expiresAt }
}
const timestamps = (row: StrictJsonObject, path: string) => {
  const created = integer(row.createdAtCampaignMinute, `${path}.createdAtCampaignMinute`)
  const updated = integer(row.updatedAtCampaignMinute, `${path}.updatedAtCampaignMinute`)
  const changed = integer(row.statusChangedAtCampaignMinute, `${path}.statusChangedAtCampaignMinute`)
  if (created > changed || changed > updated) {
    return fail('breeding.workshop-activity.invalid-invariant', path, 'campaign timestamps must be monotonic.')
  }
  return { createdAtCampaignMinute: created, updatedAtCampaignMinute: updated, statusChangedAtCampaignMinute: changed }
}
const expectedProjectStage = (status: BreedingProjectStatus): BreedingWorkshopProjectStage => {
  if (status === 'draft') return 'planning'
  if (status === 'awaiting-parent-consent') return 'awaiting-consent'
  if (status === 'initial-time-in-progress') return 'initial-time'
  if (status === 'check-ready') return 'check'
  if (status === 'additional-time-in-progress') return 'additional-time'
  if (status === 'ready-to-produce') return 'production-ready'
  if (status === 'egg-produced') return 'completed'
  return 'ended'
}
const expectedEggStage = (status: PokemonEggStatus): BreedingWorkshopEggStage => {
  if (status === 'incubating') return 'incubating'
  if (status === 'ready') return 'ready'
  if (status === 'awaiting-special-adjudication') return 'decision-required'
  if (status === 'hatching') return 'hatching'
  if (status === 'hatched') return 'completed'
  return 'ended'
}
const parseProjectCard = (
  value: unknown,
  audience: BreedingWorkshopActivityAudience,
  path: string,
): BreedingWorkshopProjectCardV1 => {
  const row = exact(value, [
    'aggregateKind', 'projectId', 'revision', 'status', 'breederDisplayName', 'parents',
    'progress', 'history', 'recovery', 'createdAtCampaignMinute', 'updatedAtCampaignMinute',
    'statusChangedAtCampaignMinute',
  ], path)
  if (row.aggregateKind !== 'breeding-project' || typeof row.status !== 'string' || !PROJECT_STATUS.has(row.status)
    || !Array.isArray(row.parents) || row.parents.length !== 2) {
    return fail('breeding.workshop-activity.invalid-document', path, 'must be a bounded Project card.')
  }
  const projectId = parseBreedingProjectIdSyntax(row.projectId)
    ?? fail('breeding.workshop-activity.invalid-id', `${path}.projectId`, 'must be a Project ID.')
  const status = row.status as BreedingProjectStatus
  const progress = parseProjectProgress(row.progress, `${path}.progress`)
  const cardHistory = parseHistory(row.history, `${path}.history`)
  const cardTimestamps = timestamps(row, path)
  if (progress.stage !== expectedProjectStage(status)
    || cardHistory[0]?.kind !== 'created'
    || cardHistory[0]?.campaignMinute !== cardTimestamps.createdAtCampaignMinute
    || cardHistory.filter(entry => entry.kind === 'created').length !== 1
    || cardHistory.some(entry => entry.campaignMinute < cardTimestamps.createdAtCampaignMinute
      || entry.campaignMinute > cardTimestamps.updatedAtCampaignMinute)) {
    return fail('breeding.workshop-activity.invalid-invariant', path, 'status, stage, history, and aggregate timestamps must agree.')
  }
  return {
    aggregateKind: 'breeding-project',
    projectId,
    revision: integer(row.revision, `${path}.revision`, 2_147_483_647),
    status,
    breederDisplayName: text(row.breederDisplayName, `${path}.breederDisplayName`),
    parents: [
      parseParent(row.parents[0], 0, audience, `${path}.parents[0]`),
      parseParent(row.parents[1], 1, audience, `${path}.parents[1]`),
    ],
    progress,
    history: cardHistory,
    recovery: parseRecovery(row.recovery, `${path}.recovery`),
    ...cardTimestamps,
  }
}
const parseEggCard = (value: unknown, path: string): BreedingWorkshopEggCardV1 => {
  const row = exact(value, [
    'aggregateKind', 'eggId', 'revision', 'status', 'sourceKind', 'speciesName', 'natureName',
    'abilityName', 'genderId', 'startingLevel', 'progress', 'history', 'recovery', 'transfer',
    'childSheetSlug', 'createdAtCampaignMinute', 'updatedAtCampaignMinute', 'statusChangedAtCampaignMinute',
  ], path)
  if (row.aggregateKind !== 'pokemon-egg' || typeof row.status !== 'string' || !EGG_STATUS.has(row.status)
    || typeof row.sourceKind !== 'string' || !SOURCE_KINDS.has(row.sourceKind)
    || (row.genderId !== 'female' && row.genderId !== 'male' && row.genderId !== 'genderless')) {
    return fail('breeding.workshop-activity.invalid-document', path, 'must be a bounded Egg card.')
  }
  const status = row.status as PokemonEggStatus
  const progress = parseEggProgress(row.progress, `${path}.progress`)
  const cardHistory = parseHistory(row.history, `${path}.history`)
  const cardTimestamps = timestamps(row, path)
  const startingLevel = integer(row.startingLevel, `${path}.startingLevel`, 100)
  if (startingLevel < 1 || progress.stage !== expectedEggStage(status)
    || cardHistory[0]?.kind !== 'created'
    || cardHistory[0]?.campaignMinute !== cardTimestamps.createdAtCampaignMinute
    || cardHistory.filter(entry => entry.kind === 'created').length !== 1
    || cardHistory.some(entry => entry.campaignMinute < cardTimestamps.createdAtCampaignMinute
      || entry.campaignMinute > cardTimestamps.updatedAtCampaignMinute)) {
    return fail('breeding.workshop-activity.invalid-invariant', path, 'status, stage, history, Level, and aggregate timestamps must agree.')
  }
  return {
    aggregateKind: 'pokemon-egg',
    eggId: parsePokemonEggIdSyntax(row.eggId)
      ?? fail('breeding.workshop-activity.invalid-id', `${path}.eggId`, 'must be an Egg ID.'),
    revision: integer(row.revision, `${path}.revision`, 2_147_483_647),
    status,
    sourceKind: row.sourceKind as PokemonEggSourceKind,
    speciesName: text(row.speciesName, `${path}.speciesName`),
    natureName: text(row.natureName, `${path}.natureName`),
    abilityName: text(row.abilityName, `${path}.abilityName`),
    genderId: row.genderId,
    startingLevel,
    progress,
    history: cardHistory,
    recovery: parseRecovery(row.recovery, `${path}.recovery`),
    transfer: parseTransfer(row.transfer, `${path}.transfer`),
    childSheetSlug: optionalSlug(row.childSheetSlug, `${path}.childSheetSlug`),
    ...cardTimestamps,
  }
}

export const parseBreedingWorkshopActivityProjectionV1 = (
  value: unknown,
  path = 'activity',
): BreedingWorkshopActivityProjectionV1 => {
  const row = exact(value, [
    'schemaVersion', 'audience', 'trainer', 'generatedAtCampaignMinute', 'projectsTruncated',
    'eggsTruncated', 'projects', 'eggs', 'securityPolicyDefinitionSha256', 'projectionDefinitionSha256',
  ], path)
  if (row.schemaVersion !== 1 || (row.audience !== 'owner' && row.audience !== 'gm')
    || !Array.isArray(row.projects) || row.projects.length > BREEDING_WORKSHOP_ACTIVITY_CARD_LIMIT
    || !Array.isArray(row.eggs) || row.eggs.length > BREEDING_WORKSHOP_ACTIVITY_CARD_LIMIT) {
    return fail('breeding.workshop-activity.invalid-document', path, 'must be a bounded v1 activity projection.')
  }
  const trainer = exact(row.trainer, ['trainerSheetSlug', 'trainerRevision', 'displayName'], `${path}.trainer`)
  const projects = row.projects.map((card, index) => parseProjectCard(card, row.audience as BreedingWorkshopActivityAudience, `${path}.projects[${index}]`))
  const eggs = row.eggs.map((card, index) => parseEggCard(card, `${path}.eggs[${index}]`))
  const ordered = (before: { readonly updatedAtCampaignMinute: number }, beforeId: string, after: { readonly updatedAtCampaignMinute: number }, afterId: string): boolean => (
    before.updatedAtCampaignMinute > after.updatedAtCampaignMinute
      || (before.updatedAtCampaignMinute === after.updatedAtCampaignMinute && beforeId < afterId)
  )
  for (let index = 1; index < projects.length; index += 1) {
    if (!ordered(projects[index - 1]!, projects[index - 1]!.projectId, projects[index]!, projects[index]!.projectId)) {
      return fail('breeding.workshop-activity.invalid-invariant', `${path}.projects`, 'must be unique in current repository order.')
    }
  }
  for (let index = 1; index < eggs.length; index += 1) {
    if (!ordered(eggs[index - 1]!, eggs[index - 1]!.eggId, eggs[index]!, eggs[index]!.eggId)) {
      return fail('breeding.workshop-activity.invalid-invariant', `${path}.eggs`, 'must be unique in current repository order.')
    }
  }
  const generatedAtCampaignMinute = integer(row.generatedAtCampaignMinute, `${path}.generatedAtCampaignMinute`)
  const projectsTruncated = bool(row.projectsTruncated, `${path}.projectsTruncated`)
  const eggsTruncated = bool(row.eggsTruncated, `${path}.eggsTruncated`)
  if ((projectsTruncated && projects.length !== BREEDING_WORKSHOP_ACTIVITY_CARD_LIMIT)
    || (eggsTruncated && eggs.length !== BREEDING_WORKSHOP_ACTIVITY_CARD_LIMIT)
    || [...projects, ...eggs].some(card => card.updatedAtCampaignMinute > generatedAtCampaignMinute
      || card.recovery.pendingSinceCampaignMinute !== null
        && card.recovery.pendingSinceCampaignMinute > generatedAtCampaignMinute)
    || eggs.some(card => (card.transfer.state === 'offered' || card.transfer.state === 'accepted')
      ? card.transfer.expiresAtCampaignMinute! <= generatedAtCampaignMinute
      : card.transfer.state === 'expired'
        ? card.transfer.expiresAtCampaignMinute! > generatedAtCampaignMinute
        : false)) {
    return fail('breeding.workshop-activity.invalid-invariant', path, 'truncation, generation time, recovery, and transfer expiry must agree.')
  }
  return deepFreezeStrictJson({
    schemaVersion: 1,
    audience: row.audience,
    trainer: {
      trainerSheetSlug: slug(trainer.trainerSheetSlug, `${path}.trainer.trainerSheetSlug`),
      trainerRevision: integer(trainer.trainerRevision, `${path}.trainer.trainerRevision`, 2_147_483_647),
      displayName: text(trainer.displayName, `${path}.trainer.displayName`),
    },
    generatedAtCampaignMinute,
    projectsTruncated,
    eggsTruncated,
    projects,
    eggs,
    securityPolicyDefinitionSha256: hash(row.securityPolicyDefinitionSha256, `${path}.securityPolicyDefinitionSha256`),
    projectionDefinitionSha256: hash(row.projectionDefinitionSha256, `${path}.projectionDefinitionSha256`),
  }) as BreedingWorkshopActivityProjectionV1
}

export const verifyBreedingWorkshopActivityProjectionV1 = async (
  value: unknown,
  path = 'activity',
): Promise<BreedingWorkshopActivityProjectionV1> => {
  const projection = parseBreedingWorkshopActivityProjectionV1(value, path)
  if (projection.securityPolicyDefinitionSha256 !== BREEDING_WORKSHOP_ACTIVITY_SECURITY_POLICY_DEFINITION_SHA256) {
    return fail('breeding.workshop-activity.security-policy-mismatch', `${path}.securityPolicyDefinitionSha256`, 'does not use the current security policy.')
  }
  const { projectionDefinitionSha256, ...definition } = projection
  let actual: string
  try { actual = await computeRulesetSourceSha256(stableJsonStringify(definition)) }
  catch { return fail('breeding.workshop-activity.hash-mismatch', `${path}.projectionDefinitionSha256`, 'cannot be verified in this browser.') }
  if (actual !== projectionDefinitionSha256) {
    return fail('breeding.workshop-activity.hash-mismatch', `${path}.projectionDefinitionSha256`, 'does not match the exact activity projection.')
  }
  return projection
}

export const breedingWorkshopProjectStatusLabel = (status: BreedingProjectStatus): string => ({
  draft: 'Planning',
  'awaiting-parent-consent': 'Awaiting consent',
  'initial-time-in-progress': 'Initial time in progress',
  'check-ready': 'Breeder check ready',
  'additional-time-in-progress': 'Additional time in progress',
  'ready-to-produce': 'Ready to produce an Egg',
  'egg-produced': 'Egg produced',
  'check-failed': 'Check failed',
  cancelled: 'Cancelled',
  expired: 'Expired',
  abandoned: 'Abandoned',
  conflicted: 'Recovery required',
})[status]
export const breedingWorkshopEggStatusLabel = (status: PokemonEggStatus): string => ({
  incubating: 'Incubating',
  ready: 'Ready to hatch',
  'awaiting-special-adjudication': 'Decision required',
  hatching: 'Hatching',
  hatched: 'Hatched',
  cancelled: 'Cancelled',
  'invalidated-by-gm': 'Unavailable',
})[status]
export const breedingWorkshopHistoryLabel = (kind: BreedingWorkshopHistoryKind): string => ({
  'additional-time-started': 'Additional breeding time started',
  'check-failed': 'Breeder check failed',
  'check-ready': 'Breeder check became ready',
  'check-succeeded': 'Breeder check succeeded',
  created: 'Created',
  'egg-cancelled': 'Egg lifecycle ended',
  'egg-hatched': 'Egg hatched',
  'egg-produced': 'Egg produced',
  'egg-ready': 'Egg became ready',
  'egg-special-required': 'Special hatch review required',
  'egg-status-changed': 'Egg status changed',
  'initial-time-started': 'Initial breeding time started',
  'ownership-transferred': 'Ownership transferred',
  'project-ended': 'Project ended',
  'production-ready': 'Egg production became ready',
})[kind]
