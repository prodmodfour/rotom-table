/**
 * Versioned OnboardingDraft contract (P9-012).
 *
 * The draft is authority ONLY for unfinished choices. It stores stable
 * canonical/policy IDs — never rule prose, derived math, or component state.
 * After commit the completed sheets are the sole mechanical authority and the
 * archived draft is provenance.
 */

import {
  isPlayerProfileId,
  type PlayerProfileId,
} from '../playerProfiles'
import {
  OnboardingIdError,
  isOnboardingDecisionId,
  parseOnboardingDraftId,
  parseOnboardingPolicyId,
  parseOnboardingSlotId,
  type OnboardingDecisionId,
  type OnboardingDraftId,
  type OnboardingPolicyId,
  type OnboardingSlotId,
} from './ids'
import {
  isOnboardingDraftState,
  type OnboardingDraftState,
} from './lifecycle'

export const ONBOARDING_DRAFT_SCHEMA_VERSION = 1 as const

/** Six-stat order shared by Trainer and Pokémon allocations. */
export const ONBOARDING_STAT_KEYS = Object.freeze(['hp', 'atk', 'def', 'satk', 'sdef', 'spd'] as const)
export type OnboardingStatKey = typeof ONBOARDING_STAT_KEYS[number]

/** The 17 Trainer skills. Guarded against src/types drift by contract tests. */
export const ONBOARDING_TRAINER_SKILLS = Object.freeze([
  'acrobatics', 'athletics', 'charm', 'combat', 'command',
  'generalEd', 'medicineEd', 'occultEd', 'pokeEd', 'techEd',
  'focus', 'guile', 'intimidate', 'intuition', 'perception',
  'stealth', 'survival',
] as const)
export type OnboardingTrainerSkill = typeof ONBOARDING_TRAINER_SKILLS[number]

const SKILL_SET = new Set<unknown>(ONBOARDING_TRAINER_SKILLS)
export const isOnboardingTrainerSkill = (value: unknown): value is OnboardingTrainerSkill =>
  SKILL_SET.has(value)

export const ONBOARDING_NAME_MAX_LENGTH = 80
export const ONBOARDING_TEXT_MAX_LENGTH = 4_000
export const ONBOARDING_ENTRY_CHOICE_KEY_MAX = 60
export const ONBOARDING_ENTRY_CHOICE_VALUE_MAX = 160
export const ONBOARDING_ENTRY_CHOICES_MAX = 12
export const ONBOARDING_EDGE_ENTRIES_MAX = 60
export const ONBOARDING_FEATURE_ENTRIES_MAX = 60
export const ONBOARDING_MILESTONE_ENTRIES_MAX = 10
export const ONBOARDING_MOVE_ENTRIES_MAX = 10
export const ONBOARDING_ABILITY_ENTRIES_MAX = 4
export const ONBOARDING_POKEMON_BUILDS_MAX = 6
export const ONBOARDING_STAT_VALUE_MAX = 300
export const ONBOARDING_DEFERRED_MAX = 20

export class OnboardingDraftContractError extends Error {
  readonly field: string
  constructor(field: string, message: string) {
    super(message)
    this.name = 'OnboardingDraftContractError'
    this.field = field
  }
}

type UnknownRecord = Record<string, unknown>

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const expectRecord = (value: unknown, field: string): UnknownRecord => {
  if (!isRecord(value)) throw new OnboardingDraftContractError(field, `${field} must be an object`)
  return value
}

const expectInt = (value: unknown, field: string, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new OnboardingDraftContractError(field, `${field} must be an integer between ${min} and ${max}`)
  }
  return value
}

const optionalBoundedString = (value: unknown, field: string, maxLength: number): string | null => {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new OnboardingDraftContractError(field, `${field} must be a string of at most ${maxLength} characters`)
  }
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

const expectBoundedString = (value: unknown, field: string, maxLength: number): string => {
  const parsed = optionalBoundedString(value, field, maxLength)
  if (parsed === null) throw new OnboardingDraftContractError(field, `${field} must be a non-empty string`)
  return parsed
}

/* ------------------------------------------------------------------ */
/* Build entries                                                      */
/* ------------------------------------------------------------------ */

export interface OnboardingEntryChoiceMap {
  readonly [key: string]: string
}

const parseEntryChoices = (value: unknown, field: string): OnboardingEntryChoiceMap => {
  if (value === undefined || value === null) return {}
  const record = expectRecord(value, field)
  const keys = Object.keys(record)
  if (keys.length > ONBOARDING_ENTRY_CHOICES_MAX) {
    throw new OnboardingDraftContractError(field, `${field} must have at most ${ONBOARDING_ENTRY_CHOICES_MAX} entries`)
  }
  const out: Record<string, string> = {}
  for (const key of keys.sort()) {
    if (key.length === 0 || key.length > ONBOARDING_ENTRY_CHOICE_KEY_MAX) {
      throw new OnboardingDraftContractError(field, `${field} key "${key}" exceeds ${ONBOARDING_ENTRY_CHOICE_KEY_MAX} characters`)
    }
    out[key] = expectBoundedString(record[key], `${field}.${key}`, ONBOARDING_ENTRY_CHOICE_VALUE_MAX)
  }
  return out
}

export interface OnboardingEdgeEntryV1 {
  readonly entryId: string
  readonly canonicalId: string
  readonly grantLevel: number | null
  readonly choices: OnboardingEntryChoiceMap
}

export interface OnboardingFeatureEntryV1 {
  readonly entryId: string
  readonly canonicalId: string
  readonly isClassAnchor: boolean
  readonly choices: OnboardingEntryChoiceMap
}

export interface OnboardingMilestoneChoiceV1 {
  readonly level: number
  readonly optionId: string
  readonly immediateAllocation: Readonly<Partial<Record<OnboardingStatKey, number>>>
}

export interface OnboardingBackgroundV1 {
  readonly name: string
  readonly adept: readonly OnboardingTrainerSkill[]
  readonly novice: readonly OnboardingTrainerSkill[]
  readonly pathetic: readonly OnboardingTrainerSkill[]
}

export interface OnboardingTrainerIdentityV1 {
  readonly playedBy: string | null
  readonly age: string | null
  readonly sex: string | null
  readonly portraitUrl: string | null
  readonly accentColor: string | null
  readonly physicalDescription: string | null
  readonly background: string | null
  readonly personality: string | null
  readonly goalsAndDreams: string | null
}

export interface OnboardingTrainerBuildV1 {
  readonly name: string | null
  readonly identity: OnboardingTrainerIdentityV1
  readonly statAllocation: Readonly<Record<OnboardingStatKey, number>>
  readonly background: OnboardingBackgroundV1 | null
  readonly trainingFeatureId: string | null
  readonly edges: readonly OnboardingEdgeEntryV1[]
  readonly features: readonly OnboardingFeatureEntryV1[]
  readonly milestoneChoices: readonly OnboardingMilestoneChoiceV1[]
}

export type OnboardingGenderChoice = 'Male' | 'Female' | null

export interface OnboardingPokemonBuildV1 {
  readonly buildId: string
  readonly speciesId: string | null
  readonly nickname: string | null
  readonly natureId: string | null
  readonly gender: OnboardingGenderChoice
  readonly abilityIds: readonly string[]
  readonly moveIds: readonly string[]
  readonly addedStats: Readonly<Record<OnboardingStatKey, number>>
  readonly heldItemId: string | null
  readonly caughtBallId: string | null
  readonly teamSlot: number | null
}

export interface OnboardingDraftV1 {
  readonly schemaVersion: typeof ONBOARDING_DRAFT_SCHEMA_VERSION
  readonly draftId: OnboardingDraftId
  readonly slotId: OnboardingSlotId
  readonly profileId: PlayerProfileId
  readonly policyId: OnboardingPolicyId
  readonly policyVersion: number
  readonly state: OnboardingDraftState
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly currentDecisionId: OnboardingDecisionId | null
  readonly trainerBuild: OnboardingTrainerBuildV1
  readonly pokemonBuilds: readonly OnboardingPokemonBuildV1[]
  readonly deferredDecisions: readonly OnboardingDecisionId[]
  readonly submissionRevision: number
  readonly catalogFingerprint: string
}

/* ------------------------------------------------------------------ */
/* Parsing                                                            */
/* ------------------------------------------------------------------ */

const ENTRY_ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/

const parseStatRecord = (
  value: unknown,
  field: string,
): Readonly<Record<OnboardingStatKey, number>> => {
  const record = expectRecord(value ?? {}, field)
  const out = {} as Record<OnboardingStatKey, number>
  for (const key of ONBOARDING_STAT_KEYS) {
    const raw = record[key] ?? 0
    out[key] = expectInt(raw, `${field}.${key}`, 0, ONBOARDING_STAT_VALUE_MAX)
  }
  for (const key of Object.keys(record)) {
    if (!(ONBOARDING_STAT_KEYS as readonly string[]).includes(key)) {
      throw new OnboardingDraftContractError(`${field}.${key}`, `${field} contains unknown stat key "${key}"`)
    }
  }
  return out
}

const parseSkillList = (
  value: unknown,
  field: string,
  maxEntries: number,
): readonly OnboardingTrainerSkill[] => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > maxEntries) {
    throw new OnboardingDraftContractError(field, `${field} must be an array of at most ${maxEntries} skills`)
  }
  const seen = new Set<string>()
  return value.map((entry, index) => {
    if (!isOnboardingTrainerSkill(entry)) {
      throw new OnboardingDraftContractError(`${field}[${index}]`, `${field}[${index}] must be a canonical trainer skill`)
    }
    if (seen.has(entry)) {
      throw new OnboardingDraftContractError(`${field}[${index}]`, `${field} must not repeat skill "${entry}"`)
    }
    seen.add(entry)
    return entry
  })
}

const parseEntryId = (value: unknown, field: string): string => {
  const parsed = expectBoundedString(value, field, 41)
  if (!ENTRY_ID_RE.test(parsed)) {
    throw new OnboardingDraftContractError(field, `${field} must match ${ENTRY_ID_RE}`)
  }
  return parsed
}

const parseEdgeEntry = (value: unknown, field: string): OnboardingEdgeEntryV1 => {
  const record = expectRecord(value, field)
  return {
    entryId: parseEntryId(record.entryId, `${field}.entryId`),
    canonicalId: expectBoundedString(record.canonicalId, `${field}.canonicalId`, 120),
    grantLevel: record.grantLevel === null || record.grantLevel === undefined
      ? null
      : expectInt(record.grantLevel, `${field}.grantLevel`, 1, 50),
    choices: parseEntryChoices(record.choices, `${field}.choices`),
  }
}

const parseFeatureEntry = (value: unknown, field: string): OnboardingFeatureEntryV1 => {
  const record = expectRecord(value, field)
  return {
    entryId: parseEntryId(record.entryId, `${field}.entryId`),
    canonicalId: expectBoundedString(record.canonicalId, `${field}.canonicalId`, 120),
    isClassAnchor: record.isClassAnchor === true,
    choices: parseEntryChoices(record.choices, `${field}.choices`),
  }
}

const parseMilestoneChoice = (value: unknown, field: string): OnboardingMilestoneChoiceV1 => {
  const record = expectRecord(value, field)
  const allocationRecord = expectRecord(record.immediateAllocation ?? {}, `${field}.immediateAllocation`)
  const immediateAllocation: Partial<Record<OnboardingStatKey, number>> = {}
  for (const key of Object.keys(allocationRecord)) {
    if (!(ONBOARDING_STAT_KEYS as readonly string[]).includes(key)) {
      throw new OnboardingDraftContractError(`${field}.immediateAllocation.${key}`, `unknown stat key "${key}"`)
    }
    immediateAllocation[key as OnboardingStatKey] = expectInt(
      allocationRecord[key],
      `${field}.immediateAllocation.${key}`,
      0,
      ONBOARDING_STAT_VALUE_MAX,
    )
  }
  return {
    level: expectInt(record.level, `${field}.level`, 1, 50),
    optionId: expectBoundedString(record.optionId, `${field}.optionId`, 80),
    immediateAllocation,
  }
}

const parseBoundedEntries = <T>(
  value: unknown,
  field: string,
  maxEntries: number,
  parseEntry: (entry: unknown, entryField: string) => T,
): readonly T[] => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > maxEntries) {
    throw new OnboardingDraftContractError(field, `${field} must be an array of at most ${maxEntries} entries`)
  }
  return value.map((entry, index) => parseEntry(entry, `${field}[${index}]`))
}

const parseUniqueEntryIds = (entries: readonly { entryId: string }[], field: string): void => {
  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.entryId)) {
      throw new OnboardingDraftContractError(field, `${field} must not repeat entryId "${entry.entryId}"`)
    }
    seen.add(entry.entryId)
  }
}

export const parseOnboardingTrainerBuild = (
  value: unknown,
  field = 'trainerBuild',
): OnboardingTrainerBuildV1 => {
  const record = expectRecord(value ?? {}, field)
  const identityRecord = expectRecord(record.identity ?? {}, `${field}.identity`)
  const backgroundValue = record.background === undefined || record.background === null
    ? null
    : expectRecord(record.background, `${field}.background`)

  const edges = parseBoundedEntries(record.edges, `${field}.edges`, ONBOARDING_EDGE_ENTRIES_MAX, parseEdgeEntry)
  const features = parseBoundedEntries(record.features, `${field}.features`, ONBOARDING_FEATURE_ENTRIES_MAX, parseFeatureEntry)
  parseUniqueEntryIds(edges, `${field}.edges`)
  parseUniqueEntryIds(features, `${field}.features`)

  return {
    name: optionalBoundedString(record.name, `${field}.name`, ONBOARDING_NAME_MAX_LENGTH),
    identity: {
      playedBy: optionalBoundedString(identityRecord.playedBy, `${field}.identity.playedBy`, ONBOARDING_NAME_MAX_LENGTH),
      age: optionalBoundedString(identityRecord.age, `${field}.identity.age`, 40),
      sex: optionalBoundedString(identityRecord.sex, `${field}.identity.sex`, 40),
      portraitUrl: optionalBoundedString(identityRecord.portraitUrl, `${field}.identity.portraitUrl`, 500),
      accentColor: optionalBoundedString(identityRecord.accentColor, `${field}.identity.accentColor`, 20),
      physicalDescription: optionalBoundedString(identityRecord.physicalDescription, `${field}.identity.physicalDescription`, ONBOARDING_TEXT_MAX_LENGTH),
      background: optionalBoundedString(identityRecord.background, `${field}.identity.background`, ONBOARDING_TEXT_MAX_LENGTH),
      personality: optionalBoundedString(identityRecord.personality, `${field}.identity.personality`, ONBOARDING_TEXT_MAX_LENGTH),
      goalsAndDreams: optionalBoundedString(identityRecord.goalsAndDreams, `${field}.identity.goalsAndDreams`, ONBOARDING_TEXT_MAX_LENGTH),
    },
    statAllocation: parseStatRecord(record.statAllocation, `${field}.statAllocation`),
    background: backgroundValue === null
      ? null
      : {
          name: expectBoundedString(backgroundValue.name, `${field}.background.name`, ONBOARDING_NAME_MAX_LENGTH),
          adept: parseSkillList(backgroundValue.adept, `${field}.background.adept`, 4),
          novice: parseSkillList(backgroundValue.novice, `${field}.background.novice`, 4),
          pathetic: parseSkillList(backgroundValue.pathetic, `${field}.background.pathetic`, 4),
        },
    trainingFeatureId: optionalBoundedString(record.trainingFeatureId, `${field}.trainingFeatureId`, 120),
    edges,
    features,
    milestoneChoices: parseBoundedEntries(record.milestoneChoices, `${field}.milestoneChoices`, ONBOARDING_MILESTONE_ENTRIES_MAX, parseMilestoneChoice),
  }
}

const BUILD_ID_RE = /^starter-[1-6]$/

export const parseOnboardingPokemonBuild = (
  value: unknown,
  field = 'pokemonBuild',
): OnboardingPokemonBuildV1 => {
  const record = expectRecord(value, field)
  const buildId = expectBoundedString(record.buildId, `${field}.buildId`, 20)
  if (!BUILD_ID_RE.test(buildId)) {
    throw new OnboardingDraftContractError(`${field}.buildId`, `${field}.buildId must match ${BUILD_ID_RE}`)
  }
  const gender = record.gender ?? null
  if (gender !== null && gender !== 'Male' && gender !== 'Female') {
    throw new OnboardingDraftContractError(`${field}.gender`, `${field}.gender must be "Male", "Female", or null`)
  }
  const abilityIds = parseBoundedEntries(
    record.abilityIds,
    `${field}.abilityIds`,
    ONBOARDING_ABILITY_ENTRIES_MAX,
    (entry, entryField) => expectBoundedString(entry, entryField, 120),
  )
  const moveIds = parseBoundedEntries(
    record.moveIds,
    `${field}.moveIds`,
    ONBOARDING_MOVE_ENTRIES_MAX,
    (entry, entryField) => expectBoundedString(entry, entryField, 120),
  )
  return {
    buildId,
    speciesId: optionalBoundedString(record.speciesId, `${field}.speciesId`, 120),
    nickname: optionalBoundedString(record.nickname, `${field}.nickname`, ONBOARDING_NAME_MAX_LENGTH),
    natureId: optionalBoundedString(record.natureId, `${field}.natureId`, 40),
    gender,
    abilityIds,
    moveIds,
    addedStats: parseStatRecord(record.addedStats, `${field}.addedStats`),
    heldItemId: optionalBoundedString(record.heldItemId, `${field}.heldItemId`, 120),
    caughtBallId: optionalBoundedString(record.caughtBallId, `${field}.caughtBallId`, 120),
    teamSlot: record.teamSlot === null || record.teamSlot === undefined
      ? null
      : expectInt(record.teamSlot, `${field}.teamSlot`, 1, 6),
  }
}

export const parseOnboardingDraft = (value: unknown, label = 'draft'): OnboardingDraftV1 => {
  const record = expectRecord(value, label)
  if (record.schemaVersion !== ONBOARDING_DRAFT_SCHEMA_VERSION) {
    throw new OnboardingDraftContractError(
      `${label}.schemaVersion`,
      `${label}.schemaVersion ${String(record.schemaVersion)} is not supported; expected ${ONBOARDING_DRAFT_SCHEMA_VERSION}`,
    )
  }
  if (!isOnboardingDraftState(record.state)) {
    throw new OnboardingDraftContractError(`${label}.state`, `${label}.state must be a legal draft state`)
  }
  if (!isPlayerProfileId(record.profileId)) {
    throw new OnboardingDraftContractError(`${label}.profileId`, `${label}.profileId must be a player profile ID`)
  }
  const currentDecisionId = record.currentDecisionId ?? null
  if (currentDecisionId !== null && !isOnboardingDecisionId(currentDecisionId)) {
    throw new OnboardingDraftContractError(`${label}.currentDecisionId`, `${label}.currentDecisionId must be a decision ID or null`)
  }
  const deferredRaw = record.deferredDecisions ?? []
  if (!Array.isArray(deferredRaw) || deferredRaw.length > ONBOARDING_DEFERRED_MAX) {
    throw new OnboardingDraftContractError(`${label}.deferredDecisions`, `${label}.deferredDecisions must be an array of at most ${ONBOARDING_DEFERRED_MAX} decision IDs`)
  }
  const deferredDecisions = deferredRaw.map((entry, index) => {
    if (!isOnboardingDecisionId(entry)) {
      throw new OnboardingDraftContractError(`${label}.deferredDecisions[${index}]`, 'must be a decision ID')
    }
    return entry
  })

  const pokemonBuilds = parseBoundedEntries(
    record.pokemonBuilds,
    `${label}.pokemonBuilds`,
    ONBOARDING_POKEMON_BUILDS_MAX,
    parseOnboardingPokemonBuild,
  )
  const buildIds = new Set(pokemonBuilds.map(build => build.buildId))
  if (buildIds.size !== pokemonBuilds.length) {
    throw new OnboardingDraftContractError(`${label}.pokemonBuilds`, 'pokemonBuilds must not repeat buildId')
  }
  const teamSlots = pokemonBuilds.flatMap(build => (build.teamSlot === null ? [] : [build.teamSlot]))
  if (new Set(teamSlots).size !== teamSlots.length) {
    throw new OnboardingDraftContractError(`${label}.pokemonBuilds`, 'pokemonBuilds must not repeat teamSlot')
  }

  const catalogFingerprint = expectBoundedString(record.catalogFingerprint, `${label}.catalogFingerprint`, 64)

  let draftId: OnboardingDraftId
  let slotId: OnboardingSlotId
  let policyId: OnboardingPolicyId
  try {
    draftId = parseOnboardingDraftId(record.draftId, `${label}.draftId`)
    slotId = parseOnboardingSlotId(record.slotId, `${label}.slotId`)
    policyId = parseOnboardingPolicyId(record.policyId, `${label}.policyId`)
  } catch (error) {
    throw new OnboardingDraftContractError(
      label,
      error instanceof OnboardingIdError ? `${error.field}: ${error.message}` : 'invalid identifier',
    )
  }

  return {
    schemaVersion: ONBOARDING_DRAFT_SCHEMA_VERSION,
    draftId,
    slotId,
    profileId: record.profileId,
    policyId,
    policyVersion: expectInt(record.policyVersion, `${label}.policyVersion`, 1, 1_000_000),
    state: record.state,
    revision: expectInt(record.revision, `${label}.revision`, 0, Number.MAX_SAFE_INTEGER),
    createdAt: expectInt(record.createdAt, `${label}.createdAt`, 1, Number.MAX_SAFE_INTEGER),
    updatedAt: expectInt(record.updatedAt, `${label}.updatedAt`, 1, Number.MAX_SAFE_INTEGER),
    currentDecisionId,
    trainerBuild: parseOnboardingTrainerBuild(record.trainerBuild, `${label}.trainerBuild`),
    pokemonBuilds,
    deferredDecisions,
    submissionRevision: expectInt(record.submissionRevision ?? 0, `${label}.submissionRevision`, 0, 10_000),
    catalogFingerprint,
  }
}

/** A fresh empty draft for a newly opened slot. */
export const createEmptyOnboardingDraft = (input: {
  draftId: OnboardingDraftId
  slotId: OnboardingSlotId
  profileId: PlayerProfileId
  policyId: OnboardingPolicyId
  policyVersion: number
  starterCount: number
  catalogFingerprint: string
  now: number
}): OnboardingDraftV1 => parseOnboardingDraft({
  schemaVersion: ONBOARDING_DRAFT_SCHEMA_VERSION,
  draftId: input.draftId,
  slotId: input.slotId,
  profileId: input.profileId,
  policyId: input.policyId,
  policyVersion: input.policyVersion,
  state: 'draft',
  revision: 0,
  createdAt: input.now,
  updatedAt: input.now,
  currentDecisionId: 'trainer.identity',
  trainerBuild: {
    name: null,
    identity: {},
    statAllocation: {},
    background: null,
    trainingFeatureId: null,
    edges: [],
    features: [],
    milestoneChoices: [],
  },
  pokemonBuilds: Array.from({ length: input.starterCount }, (_, index) => ({
    buildId: `starter-${index + 1}`,
    speciesId: null,
    nickname: null,
    natureId: null,
    gender: null,
    abilityIds: [],
    moveIds: [],
    addedStats: {},
    heldItemId: null,
    caughtBallId: null,
    teamSlot: index + 1,
  })),
  deferredDecisions: [],
  submissionRevision: 0,
  catalogFingerprint: input.catalogFingerprint,
})
