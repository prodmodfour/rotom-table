/**
 * Versioned CampaignOnboardingPolicy contract (plan P9-011).
 *
 * A published policy version is immutable: its content participates in a
 * deterministic canonical serialization whose hash is the version's content
 * fingerprint. Editable display metadata (name/description) lives outside the
 * hashed content so relabeling never mutates published semantics.
 *
 * Unknown schema versions fail closed.
 */

import { sanitizeFolderPath } from '../paths'
import {
  ONBOARDING_DECISION_ID_MAX_LENGTH,
  OnboardingIdError,
  isOnboardingDecisionId,
  parseOnboardingPolicyId,
  type OnboardingDecisionId,
  type OnboardingPolicyId,
} from './ids'

export const CAMPAIGN_ONBOARDING_POLICY_SCHEMA_VERSION = 1 as const

export const ONBOARDING_TRAINER_LEVEL_MIN = 1
export const ONBOARDING_TRAINER_LEVEL_MAX = 50
export const ONBOARDING_POKEMON_LEVEL_MIN = 1
export const ONBOARDING_POKEMON_LEVEL_MAX = 100
export const ONBOARDING_STARTER_COUNT_MIN = 1
export const ONBOARDING_STARTER_COUNT_MAX = 6
export const ONBOARDING_POOL_SPECIES_MAX = 400
export const ONBOARDING_RESTRICTION_LIST_MAX = 600
export const ONBOARDING_PACKAGE_ENTRIES_MAX = 40
export const ONBOARDING_PACKAGE_QUANTITY_MAX = 99
export const ONBOARDING_MONEY_MAX = 1_000_000
export const ONBOARDING_LOYALTY_MIN = 0
export const ONBOARDING_LOYALTY_MAX = 10
export const ONBOARDING_DEFERRABLE_DECISIONS_MAX = 20
export const ONBOARDING_POLICY_NAME_MAX_LENGTH = 80
export const ONBOARDING_POLICY_DESCRIPTION_MAX_LENGTH = 2_000

export class OnboardingPolicyContractError extends Error {
  readonly field: string
  constructor(field: string, message: string) {
    super(message)
    this.name = 'OnboardingPolicyContractError'
    this.field = field
  }
}

/* ------------------------------------------------------------------ */
/* Content types                                                      */
/* ------------------------------------------------------------------ */

export type OnboardingMoneyPolicy =
  | { readonly kind: 'canonical-baseline' }
  | { readonly kind: 'explicit', readonly amount: number }

export type OnboardingLoyaltyPolicy =
  | { readonly kind: 'canonical-baseline' }
  | { readonly kind: 'explicit', readonly value: number }

export type OnboardingSourceRestriction =
  | { readonly mode: 'all-canonical' }
  | { readonly mode: 'allow-list', readonly canonicalIds: readonly string[] }
  | { readonly mode: 'deny-list', readonly canonicalIds: readonly string[] }

export type OnboardingStarterPool =
  | { readonly mode: 'any-canonical' }
  | { readonly mode: 'curated-list', readonly speciesIds: readonly string[] }

export type OnboardingStageRestriction = 'unrestricted' | 'first-stage-only'

export type OnboardingMilestoneCollection = 'during-onboarding' | 'defer-to-attention'

export type OnboardingCaughtBallPolicy = 'standard-metadata' | 'none' | 'player-choice'

export type OnboardingUnresolvedChoicePolicy = 'all-required-resolved' | 'allow-optional-deferral'

export const ONBOARDING_INVENTORY_SECTIONS = Object.freeze([
  'keyItems',
  'pokemonItems',
  'medicalKit',
  'pokeBalls',
  'foodStuff',
  'equipment',
] as const)
export type OnboardingInventorySection = typeof ONBOARDING_INVENTORY_SECTIONS[number]

export interface OnboardingItemGrant {
  readonly itemId: string
  readonly quantity: number
  readonly section: OnboardingInventorySection
}

export interface OnboardingHeldItemGrant {
  readonly itemId: string
}

export interface OnboardingTrainerPolicyV1 {
  readonly startingLevel: number
  readonly startingMoney: OnboardingMoneyPolicy
  readonly featureRestriction: OnboardingSourceRestriction
  readonly edgeRestriction: OnboardingSourceRestriction
  readonly milestoneCollection: OnboardingMilestoneCollection
}

export interface OnboardingPokemonPolicyV1 {
  readonly starterCount: number
  readonly starterLevel: number
  readonly starterPool: OnboardingStarterPool
  readonly stageRestriction: OnboardingStageRestriction
  readonly additionalMoveSources: readonly never[]
  readonly startingLoyalty: OnboardingLoyaltyPolicy
  readonly caughtBallPolicy: OnboardingCaughtBallPolicy
}

export interface OnboardingPackagesPolicyV1 {
  readonly trainerItems: readonly OnboardingItemGrant[]
  readonly starterHeldItems: readonly OnboardingHeldItemGrant[]
}

export interface OnboardingWorkflowPolicyV1 {
  readonly unresolvedChoicePolicy: OnboardingUnresolvedChoicePolicy
  readonly deferrableDecisions: readonly OnboardingDecisionId[]
  readonly approval: 'gm-review-required'
  readonly destinations: {
    readonly trainerFolder: string
    readonly pokemonFolder: string
  }
}

export interface CampaignOnboardingPolicyContentV1 {
  readonly schemaVersion: typeof CAMPAIGN_ONBOARDING_POLICY_SCHEMA_VERSION
  readonly trainer: OnboardingTrainerPolicyV1
  readonly pokemon: OnboardingPokemonPolicyV1
  readonly packages: OnboardingPackagesPolicyV1
  readonly workflow: OnboardingWorkflowPolicyV1
}

/** Immutable identity of one published policy version. */
export interface OnboardingPolicyIdentityV1 {
  readonly policyId: OnboardingPolicyId
  readonly version: number
  readonly contentHash: string
  readonly publishedAt: number
}

/** Editable presentation metadata; never hashed into identity. */
export interface OnboardingPolicyDisplayV1 {
  readonly name: string
  readonly description: string
}

export interface PublishedOnboardingPolicyV1 {
  readonly identity: OnboardingPolicyIdentityV1
  readonly display: OnboardingPolicyDisplayV1
  readonly content: CampaignOnboardingPolicyContentV1
}

/* ------------------------------------------------------------------ */
/* Parsing                                                            */
/* ------------------------------------------------------------------ */

type UnknownRecord = Record<string, unknown>

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const expectRecord = (value: unknown, field: string): UnknownRecord => {
  if (!isRecord(value)) throw new OnboardingPolicyContractError(field, `${field} must be an object`)
  return value
}

const expectInt = (value: unknown, field: string, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new OnboardingPolicyContractError(field, `${field} must be an integer between ${min} and ${max}`)
  }
  return value
}

const expectBoundedString = (value: unknown, field: string, maxLength: number, allowEmpty = false): string => {
  if (typeof value !== 'string' || value.length > maxLength || (!allowEmpty && value.trim() === '')) {
    throw new OnboardingPolicyContractError(field, `${field} must be a non-empty string of at most ${maxLength} characters`)
  }
  return value
}

const expectEnum = <T extends string>(value: unknown, field: string, allowed: readonly T[]): T => {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new OnboardingPolicyContractError(field, `${field} must be one of ${allowed.join(', ')}`)
  }
  return value as T
}

const expectStringArray = (
  value: unknown,
  field: string,
  maxEntries: number,
  entryMaxLength = 120,
): readonly string[] => {
  if (!Array.isArray(value) || value.length > maxEntries) {
    throw new OnboardingPolicyContractError(field, `${field} must be an array of at most ${maxEntries} entries`)
  }
  const seen = new Set<string>()
  return value.map((entry, index) => {
    const parsed = expectBoundedString(entry, `${field}[${index}]`, entryMaxLength)
    if (seen.has(parsed)) {
      throw new OnboardingPolicyContractError(`${field}[${index}]`, `${field} must not contain duplicate entry "${parsed}"`)
    }
    seen.add(parsed)
    return parsed
  })
}

const parseMoneyPolicy = (value: unknown, field: string): OnboardingMoneyPolicy => {
  const record = expectRecord(value, field)
  const kind = expectEnum(record.kind, `${field}.kind`, ['canonical-baseline', 'explicit'] as const)
  if (kind === 'canonical-baseline') return { kind }
  return { kind, amount: expectInt(record.amount, `${field}.amount`, 0, ONBOARDING_MONEY_MAX) }
}

const parseLoyaltyPolicy = (value: unknown, field: string): OnboardingLoyaltyPolicy => {
  const record = expectRecord(value, field)
  const kind = expectEnum(record.kind, `${field}.kind`, ['canonical-baseline', 'explicit'] as const)
  if (kind === 'canonical-baseline') return { kind }
  return { kind, value: expectInt(record.value, `${field}.value`, ONBOARDING_LOYALTY_MIN, ONBOARDING_LOYALTY_MAX) }
}

const parseSourceRestriction = (value: unknown, field: string): OnboardingSourceRestriction => {
  const record = expectRecord(value, field)
  const mode = expectEnum(record.mode, `${field}.mode`, ['all-canonical', 'allow-list', 'deny-list'] as const)
  if (mode === 'all-canonical') return { mode }
  return {
    mode,
    canonicalIds: expectStringArray(record.canonicalIds, `${field}.canonicalIds`, ONBOARDING_RESTRICTION_LIST_MAX),
  }
}

const parseStarterPool = (value: unknown, field: string): OnboardingStarterPool => {
  const record = expectRecord(value, field)
  const mode = expectEnum(record.mode, `${field}.mode`, ['any-canonical', 'curated-list'] as const)
  if (mode === 'any-canonical') return { mode }
  const speciesIds = expectStringArray(record.speciesIds, `${field}.speciesIds`, ONBOARDING_POOL_SPECIES_MAX)
  if (speciesIds.length === 0) {
    throw new OnboardingPolicyContractError(`${field}.speciesIds`, `${field}.speciesIds must not be empty for a curated list`)
  }
  return { mode, speciesIds }
}

const parseItemGrant = (value: unknown, field: string): OnboardingItemGrant => {
  const record = expectRecord(value, field)
  return {
    itemId: expectBoundedString(record.itemId, `${field}.itemId`, 120),
    quantity: expectInt(record.quantity, `${field}.quantity`, 1, ONBOARDING_PACKAGE_QUANTITY_MAX),
    section: expectEnum(record.section, `${field}.section`, ONBOARDING_INVENTORY_SECTIONS),
  }
}

const parseHeldItemGrant = (value: unknown, field: string): OnboardingHeldItemGrant => {
  const record = expectRecord(value, field)
  return { itemId: expectBoundedString(record.itemId, `${field}.itemId`, 120) }
}

const parseBoundedArray = <T>(
  value: unknown,
  field: string,
  maxEntries: number,
  parseEntry: (entry: unknown, entryField: string) => T,
): readonly T[] => {
  if (!Array.isArray(value) || value.length > maxEntries) {
    throw new OnboardingPolicyContractError(field, `${field} must be an array of at most ${maxEntries} entries`)
  }
  return value.map((entry, index) => parseEntry(entry, `${field}[${index}]`))
}

const parseFolder = (value: unknown, field: string): string => {
  const raw = expectBoundedString(value, field, 200)
  try {
    return sanitizeFolderPath(raw, { allowEmpty: false, label: field })
  } catch (error) {
    throw new OnboardingPolicyContractError(field, error instanceof Error ? error.message : `${field} is not a valid folder path`)
  }
}

export const parseCampaignOnboardingPolicyContent = (
  value: unknown,
  label = 'policy',
): CampaignOnboardingPolicyContentV1 => {
  const record = expectRecord(value, label)
  if (record.schemaVersion !== CAMPAIGN_ONBOARDING_POLICY_SCHEMA_VERSION) {
    throw new OnboardingPolicyContractError(
      `${label}.schemaVersion`,
      `${label}.schemaVersion ${String(record.schemaVersion)} is not supported; expected ${CAMPAIGN_ONBOARDING_POLICY_SCHEMA_VERSION}`,
    )
  }

  const trainer = expectRecord(record.trainer, `${label}.trainer`)
  const pokemon = expectRecord(record.pokemon, `${label}.pokemon`)
  const packages = expectRecord(record.packages, `${label}.packages`)
  const workflow = expectRecord(record.workflow, `${label}.workflow`)

  const unresolvedChoicePolicy = expectEnum(
    workflow.unresolvedChoicePolicy,
    `${label}.workflow.unresolvedChoicePolicy`,
    ['all-required-resolved', 'allow-optional-deferral'] as const,
  )
  const deferrableRaw = workflow.deferrableDecisions ?? []
  if (!Array.isArray(deferrableRaw) || deferrableRaw.length > ONBOARDING_DEFERRABLE_DECISIONS_MAX) {
    throw new OnboardingPolicyContractError(
      `${label}.workflow.deferrableDecisions`,
      `${label}.workflow.deferrableDecisions must be an array of at most ${ONBOARDING_DEFERRABLE_DECISIONS_MAX} decision IDs`,
    )
  }
  const deferrableDecisions = deferrableRaw.map((entry, index) => {
    if (!isOnboardingDecisionId(entry)) {
      throw new OnboardingPolicyContractError(
        `${label}.workflow.deferrableDecisions[${index}]`,
        `deferrable decision must be a bounded decision ID (max ${ONBOARDING_DECISION_ID_MAX_LENGTH} chars)`,
      )
    }
    return entry
  })
  if (unresolvedChoicePolicy === 'all-required-resolved' && deferrableDecisions.length > 0) {
    throw new OnboardingPolicyContractError(
      `${label}.workflow.deferrableDecisions`,
      'deferrableDecisions must be empty when unresolvedChoicePolicy is all-required-resolved',
    )
  }

  const additionalMoveSources = record.pokemon === undefined ? [] : (pokemon.additionalMoveSources ?? [])
  if (!Array.isArray(additionalMoveSources) || additionalMoveSources.length > 0) {
    throw new OnboardingPolicyContractError(
      `${label}.pokemon.additionalMoveSources`,
      'additionalMoveSources must be an empty array in schema version 1 (level-up only)',
    )
  }

  return {
    schemaVersion: CAMPAIGN_ONBOARDING_POLICY_SCHEMA_VERSION,
    trainer: {
      startingLevel: expectInt(trainer.startingLevel, `${label}.trainer.startingLevel`, ONBOARDING_TRAINER_LEVEL_MIN, ONBOARDING_TRAINER_LEVEL_MAX),
      startingMoney: parseMoneyPolicy(trainer.startingMoney, `${label}.trainer.startingMoney`),
      featureRestriction: parseSourceRestriction(trainer.featureRestriction, `${label}.trainer.featureRestriction`),
      edgeRestriction: parseSourceRestriction(trainer.edgeRestriction, `${label}.trainer.edgeRestriction`),
      milestoneCollection: expectEnum(trainer.milestoneCollection, `${label}.trainer.milestoneCollection`, ['during-onboarding', 'defer-to-attention'] as const),
    },
    pokemon: {
      starterCount: expectInt(pokemon.starterCount, `${label}.pokemon.starterCount`, ONBOARDING_STARTER_COUNT_MIN, ONBOARDING_STARTER_COUNT_MAX),
      starterLevel: expectInt(pokemon.starterLevel, `${label}.pokemon.starterLevel`, ONBOARDING_POKEMON_LEVEL_MIN, ONBOARDING_POKEMON_LEVEL_MAX),
      starterPool: parseStarterPool(pokemon.starterPool, `${label}.pokemon.starterPool`),
      stageRestriction: expectEnum(pokemon.stageRestriction, `${label}.pokemon.stageRestriction`, ['unrestricted', 'first-stage-only'] as const),
      additionalMoveSources: [],
      startingLoyalty: parseLoyaltyPolicy(pokemon.startingLoyalty, `${label}.pokemon.startingLoyalty`),
      caughtBallPolicy: expectEnum(pokemon.caughtBallPolicy, `${label}.pokemon.caughtBallPolicy`, ['standard-metadata', 'none', 'player-choice'] as const),
    },
    packages: {
      trainerItems: parseBoundedArray(packages.trainerItems ?? [], `${label}.packages.trainerItems`, ONBOARDING_PACKAGE_ENTRIES_MAX, parseItemGrant),
      starterHeldItems: parseBoundedArray(packages.starterHeldItems ?? [], `${label}.packages.starterHeldItems`, ONBOARDING_PACKAGE_ENTRIES_MAX, parseHeldItemGrant),
    },
    workflow: {
      unresolvedChoicePolicy,
      deferrableDecisions,
      approval: expectEnum(workflow.approval, `${label}.workflow.approval`, ['gm-review-required'] as const),
      destinations: {
        trainerFolder: parseFolder(expectRecord(workflow.destinations, `${label}.workflow.destinations`).trainerFolder, `${label}.workflow.destinations.trainerFolder`),
        pokemonFolder: parseFolder(expectRecord(workflow.destinations, `${label}.workflow.destinations`).pokemonFolder, `${label}.workflow.destinations.pokemonFolder`),
      },
    },
  }
}

export const parseOnboardingPolicyIdentity = (
  value: unknown,
  label = 'policyIdentity',
): OnboardingPolicyIdentityV1 => {
  const record = expectRecord(value, label)
  const contentHash = record.contentHash
  if (typeof contentHash !== 'string' || !/^[0-9a-f]{16,64}$/.test(contentHash)) {
    throw new OnboardingPolicyContractError(`${label}.contentHash`, `${label}.contentHash must be 16-64 lowercase hex characters`)
  }
  const publishedAt = record.publishedAt
  if (typeof publishedAt !== 'number' || !Number.isFinite(publishedAt) || publishedAt <= 0) {
    throw new OnboardingPolicyContractError(`${label}.publishedAt`, `${label}.publishedAt must be a positive timestamp`)
  }
  let policyId: OnboardingPolicyId
  try {
    policyId = parseOnboardingPolicyId(record.policyId, `${label}.policyId`)
  } catch (error) {
    throw new OnboardingPolicyContractError(`${label}.policyId`, error instanceof OnboardingIdError ? error.message : 'invalid policy ID')
  }
  return {
    policyId,
    version: expectInt(record.version, `${label}.version`, 1, 1_000_000),
    contentHash,
    publishedAt,
  }
}

export const parsePublishedOnboardingPolicy = (
  value: unknown,
  label = 'publishedPolicy',
): PublishedOnboardingPolicyV1 => {
  const record = expectRecord(value, label)
  const display = expectRecord(record.display, `${label}.display`)
  return {
    identity: parseOnboardingPolicyIdentity(record.identity, `${label}.identity`),
    display: {
      name: expectBoundedString(display.name, `${label}.display.name`, ONBOARDING_POLICY_NAME_MAX_LENGTH),
      description: expectBoundedString(display.description ?? '', `${label}.display.description`, ONBOARDING_POLICY_DESCRIPTION_MAX_LENGTH, true),
    },
    content: parseCampaignOnboardingPolicyContent(record.content, `${label}.content`),
  }
}

/* ------------------------------------------------------------------ */
/* Canonical serialization for content hashing                        */
/* ------------------------------------------------------------------ */

const sortValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortValue)
  if (isRecord(value)) {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) out[key] = sortValue(value[key])
    return out
  }
  return value
}

/**
 * Deterministic, key-sorted serialization of the parsed content. The server
 * hashes this string (sha256, 16 hex chars) to produce the immutable
 * content fingerprint of a published version.
 */
export const canonicalOnboardingPolicyContentString = (
  content: CampaignOnboardingPolicyContentV1,
): string => JSON.stringify(sortValue(parseCampaignOnboardingPolicyContent(content)))

/** The shipped default policy content used to seed a fresh campaign. */
export const defaultCampaignOnboardingPolicyContent = (): CampaignOnboardingPolicyContentV1 =>
  parseCampaignOnboardingPolicyContent({
    schemaVersion: CAMPAIGN_ONBOARDING_POLICY_SCHEMA_VERSION,
    trainer: {
      startingLevel: 1,
      startingMoney: { kind: 'canonical-baseline' },
      featureRestriction: { mode: 'all-canonical' },
      edgeRestriction: { mode: 'all-canonical' },
      milestoneCollection: 'during-onboarding',
    },
    pokemon: {
      starterCount: 1,
      starterLevel: 5,
      starterPool: { mode: 'any-canonical' },
      stageRestriction: 'unrestricted',
      additionalMoveSources: [],
      startingLoyalty: { kind: 'canonical-baseline' },
      caughtBallPolicy: 'standard-metadata',
    },
    packages: { trainerItems: [], starterHeldItems: [] },
    workflow: {
      unresolvedChoicePolicy: 'all-required-resolved',
      deferrableDecisions: [],
      approval: 'gm-review-required',
      destinations: { trainerFolder: 'players', pokemonFolder: 'players' },
    },
  })
