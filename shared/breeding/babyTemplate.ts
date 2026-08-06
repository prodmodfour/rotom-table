import type { BreedingOfferOptionId, PokemonEggId } from './ids'

export const BREEDING_BABY_TEMPLATE_APPLICATION_KINDS = Object.freeze([
  'campaign-option',
  'marsupial',
] as const)
export type BreedingBabyTemplateApplicationKind = typeof BREEDING_BABY_TEMPLATE_APPLICATION_KINDS[number]

export interface BreedingBabyTemplateFrozenEffectsV1 {
  readonly baseStatPenaltyEach: number
  readonly skillRankPenalty: 1
  readonly capabilityPenalty: 2
  readonly sizePercentOfAdult: number
  readonly recoveryBaseStatPointsEachInterval: 1
  readonly recoveryIntervalLevels: 5
  readonly recoveryStepCount: number
  readonly removeSkillAndCapabilityPenaltyAfterFinalRecovery: true
}

/**
 * Owner-safe, server-authored mechanics mirror. This contains no parent,
 * provider, command, receipt, or source evidence and is safe to project with a
 * Pokémon sheet. Storage must preserve it against setup-sheet writes.
 */
export interface BreedingBabyTemplateMechanicsV1 {
  readonly schemaVersion: 1
  readonly applicationKind: BreedingBabyTemplateApplicationKind
  readonly effects: BreedingBabyTemplateFrozenEffectsV1
}

/** Server-private authority retained on the initialized child sheet. */
export interface BreedingBabyTemplateAuthorityV1 extends BreedingBabyTemplateMechanicsV1 {
  readonly sourceEggId: PokemonEggId
  readonly choiceOptionId: BreedingOfferOptionId | null
  readonly choiceEvidenceId: string | null
  readonly providerEvidenceDefinitionSha256s: readonly string[]
  readonly definitionSha256: string
}

export interface BreedingBabyTemplateStageV1 {
  readonly active: boolean
  readonly currentLevel: number
  readonly completedRecoverySteps: number
  readonly remainingBaseStatPenaltyEach: number
  readonly skillRankPenalty: 0 | 1
  readonly capabilityPenalty: 0 | 2
  readonly sizePercentOfAdult: number
  readonly finalRecoveryLevel: number
  readonly nextRecoveryLevel: number | null
}

export type BreedingBabyTemplateValidationCode =
  | 'breeding.baby-template.invalid-document'
  | 'breeding.baby-template.unknown-field'
  | 'breeding.baby-template.invalid-invariant'

export class BreedingBabyTemplateValidationError extends Error {
  readonly code: BreedingBabyTemplateValidationCode
  readonly path: string
  constructor(code: BreedingBabyTemplateValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingBabyTemplateValidationError'
    this.code = code
    this.path = path
  }
}

type Row = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/u
const EGG_ID = /^pokemon-egg:v1:[0-9a-f]{32}$/u
const OPTION_ID = /^option:v1:[0-9a-f]{32}$/u
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u
const APPLICATION_KINDS = new Set<string>(BREEDING_BABY_TEMPLATE_APPLICATION_KINDS)
const fail = (code: BreedingBabyTemplateValidationCode, path: string, message: string): never => {
  throw new BreedingBabyTemplateValidationError(code, path, message)
}
const exact = (value: unknown, fields: readonly string[], path: string): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.baby-template.invalid-document', path, 'must be a plain data object.')
  }
  const row = value as Row
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field))
    || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) {
    return fail('breeding.baby-template.unknown-field', path, 'must contain exactly the declared fields.')
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(row, field)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      fail('breeding.baby-template.invalid-document', `${path}.${field}`, 'must be an enumerable data field.')
    }
  }
  return row
}
const integer = (value: unknown, path: string, minimum: number, maximum: number): number => (
  Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
    ? value as number
    : fail('breeding.baby-template.invalid-document', path, `must be an integer from ${minimum} through ${maximum}.`)
)
const parseEffects = (value: unknown, path: string): BreedingBabyTemplateFrozenEffectsV1 => {
  const row = exact(value, [
    'baseStatPenaltyEach',
    'skillRankPenalty',
    'capabilityPenalty',
    'sizePercentOfAdult',
    'recoveryBaseStatPointsEachInterval',
    'recoveryIntervalLevels',
    'recoveryStepCount',
    'removeSkillAndCapabilityPenaltyAfterFinalRecovery',
  ], path)
  const penalty = integer(row.baseStatPenaltyEach, `${path}.baseStatPenaltyEach`, 2, 5)
  if (row.skillRankPenalty !== 1 || row.capabilityPenalty !== 2
    || row.recoveryBaseStatPointsEachInterval !== 1 || row.recoveryIntervalLevels !== 5
    || row.recoveryStepCount !== penalty || row.removeSkillAndCapabilityPenaltyAfterFinalRecovery !== true) {
    return fail('breeding.baby-template.invalid-invariant', path, 'must match the reviewed staged Baby Template recovery policy.')
  }
  return Object.freeze({
    baseStatPenaltyEach: penalty,
    skillRankPenalty: 1,
    capabilityPenalty: 2,
    sizePercentOfAdult: integer(row.sizePercentOfAdult, `${path}.sizePercentOfAdult`, 50, 100),
    recoveryBaseStatPointsEachInterval: 1,
    recoveryIntervalLevels: 5,
    recoveryStepCount: penalty,
    removeSkillAndCapabilityPenaltyAfterFinalRecovery: true,
  })
}

export const parseBreedingBabyTemplateMechanicsV1 = (
  value: unknown,
  path = 'babyTemplateMechanics',
): BreedingBabyTemplateMechanicsV1 => {
  const row = exact(value, ['schemaVersion','applicationKind','effects'], path)
  if (row.schemaVersion !== 1 || typeof row.applicationKind !== 'string' || !APPLICATION_KINDS.has(row.applicationKind)) {
    return fail('breeding.baby-template.invalid-document', path, 'must identify one v1 Baby Template application kind.')
  }
  const effects = parseEffects(row.effects, `${path}.effects`)
  if ((row.applicationKind === 'marsupial') !== (effects.baseStatPenaltyEach === 5)) {
    return fail('breeding.baby-template.invalid-invariant', path, 'only Marsupial authority may freeze the five-point Base Stat penalty.')
  }
  return Object.freeze({ schemaVersion: 1, applicationKind: row.applicationKind as BreedingBabyTemplateApplicationKind, effects })
}

export const parseBreedingBabyTemplateAuthorityV1 = (
  value: unknown,
  path = 'babyTemplateAuthority',
): BreedingBabyTemplateAuthorityV1 => {
  const row = exact(value, [
    'schemaVersion','applicationKind','effects','sourceEggId','choiceOptionId','choiceEvidenceId',
    'providerEvidenceDefinitionSha256s','definitionSha256',
  ], path)
  const mechanics = parseBreedingBabyTemplateMechanicsV1({
    schemaVersion: row.schemaVersion,
    applicationKind: row.applicationKind,
    effects: row.effects,
  }, path)
  if (typeof row.sourceEggId !== 'string' || !EGG_ID.test(row.sourceEggId)
    || typeof row.definitionSha256 !== 'string' || !SHA256.test(row.definitionSha256)) {
    return fail('breeding.baby-template.invalid-document', path, 'must bind one Egg and lowercase authority hash.')
  }
  const choiceOptionId = row.choiceOptionId === null
    ? null
    : typeof row.choiceOptionId === 'string' && OPTION_ID.test(row.choiceOptionId)
      ? row.choiceOptionId as BreedingOfferOptionId
      : fail('breeding.baby-template.invalid-document', `${path}.choiceOptionId`, 'must be null or an option ID.')
  const choiceEvidenceId = row.choiceEvidenceId === null
    ? null
    : typeof row.choiceEvidenceId === 'string' && IDENTIFIER.test(row.choiceEvidenceId)
      ? row.choiceEvidenceId
      : fail('breeding.baby-template.invalid-document', `${path}.choiceEvidenceId`, 'must be null or a bounded evidence ID.')
  const rawProviderHashes = row.providerEvidenceDefinitionSha256s
  if (!Array.isArray(rawProviderHashes)
    || Object.getPrototypeOf(rawProviderHashes) !== Array.prototype
    || Object.getOwnPropertySymbols(rawProviderHashes).length > 0
    || Object.getOwnPropertyNames(rawProviderHashes).length !== rawProviderHashes.length + 1) {
    return fail('breeding.baby-template.invalid-document', `${path}.providerEvidenceDefinitionSha256s`, 'must be a strict unique canonical hash array.')
  }
  const providerHashes: string[] = []
  for (let index = 0; index < rawProviderHashes.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(rawProviderHashes, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor) || typeof descriptor.value !== 'string' || !SHA256.test(descriptor.value)
      || (index > 0 && providerHashes[index - 1]! >= descriptor.value)) {
      return fail('breeding.baby-template.invalid-document', `${path}.providerEvidenceDefinitionSha256s[${index}]`, 'must be one canonical enumerable data hash.')
    }
    providerHashes.push(descriptor.value)
  }
  const frozenProviderHashes = Object.freeze(providerHashes)
  const campaignChoice = mechanics.applicationKind === 'campaign-option'
  if (campaignChoice !== (choiceOptionId !== null && choiceEvidenceId !== null)
    || campaignChoice !== (frozenProviderHashes.length === 0)
    || (!campaignChoice && frozenProviderHashes.length < 1)) {
    return fail('breeding.baby-template.invalid-invariant', path, 'campaign choices and Marsupial provider evidence must remain separate and complete.')
  }
  return Object.freeze({
    ...mechanics,
    sourceEggId: row.sourceEggId as PokemonEggId,
    choiceOptionId,
    choiceEvidenceId,
    providerEvidenceDefinitionSha256s: frozenProviderHashes,
    definitionSha256: row.definitionSha256,
  })
}

export const resolveBreedingBabyTemplateStageV1 = (input: {
  readonly mechanics: unknown
  readonly currentLevel: unknown
}): BreedingBabyTemplateStageV1 => {
  const row = exact(input, ['mechanics','currentLevel'], 'babyTemplateStageInput')
  const mechanics = parseBreedingBabyTemplateMechanicsV1(row.mechanics)
  const currentLevel = integer(row.currentLevel, 'currentLevel', 1, 100)
  const effects = mechanics.effects
  const completedRecoverySteps = Math.min(
    effects.recoveryStepCount,
    Math.floor(currentLevel / effects.recoveryIntervalLevels),
  )
  const remainingBaseStatPenaltyEach = effects.baseStatPenaltyEach
    - (completedRecoverySteps * effects.recoveryBaseStatPointsEachInterval)
  const active = remainingBaseStatPenaltyEach > 0
  const sizePercentOfAdult = active
    ? effects.sizePercentOfAdult + Math.floor(
        ((100 - effects.sizePercentOfAdult) * completedRecoverySteps) / effects.recoveryStepCount,
      )
    : 100
  return Object.freeze({
    active,
    currentLevel,
    completedRecoverySteps,
    remainingBaseStatPenaltyEach,
    skillRankPenalty: active ? 1 : 0,
    capabilityPenalty: active ? 2 : 0,
    sizePercentOfAdult,
    finalRecoveryLevel: effects.recoveryStepCount * effects.recoveryIntervalLevels,
    nextRecoveryLevel: active ? (completedRecoverySteps + 1) * effects.recoveryIntervalLevels : null,
  })
}
