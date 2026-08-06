import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseBreedingCheckRecordV1,
  parseBreedingConsentRecordV1,
  parseBreedingGmAdjudicationRecordV1,
  parseBreedingOptionOfferRecordV1,
  parseBreedingRollRecordV1,
  type BreedingCheckRecordV1,
  type BreedingConsentRecordV1,
  type BreedingGmAdjudicationRecordV1,
  type BreedingOptionOfferRecordV1,
  type BreedingRollRecordV1,
} from '#shared/breeding/ledgers'
import type { BreedingOperationId } from '#shared/breeding/ids'

export type BreedingRollRecordDefinitionV1 = Omit<BreedingRollRecordV1, 'definitionSha256'>
export type BreedingCheckRecordDefinitionV1 = Omit<BreedingCheckRecordV1, 'definitionSha256'>
export type BreedingOptionOfferRecordDefinitionV1 = Omit<BreedingOptionOfferRecordV1, 'definitionSha256'>
export type BreedingConsentRecordDefinitionV1 = Omit<BreedingConsentRecordV1, 'definitionSha256'>
export type BreedingGmAdjudicationRecordDefinitionV1 = Omit<BreedingGmAdjudicationRecordV1, 'definitionSha256'>
export type BreedingReplaySafeLedgerRecordV1 = BreedingRollRecordV1 | BreedingCheckRecordV1 | BreedingOptionOfferRecordV1 | BreedingConsentRecordV1 | BreedingGmAdjudicationRecordV1

export type BreedingLedgerAuthorityErrorCode =
  | 'breeding.ledger.hash-mismatch'
  | 'breeding.ledger.identity-collision'
  | 'breeding.ledger.invalid-transition'
  | 'breeding.ledger.link-mismatch'
export class BreedingLedgerAuthorityError extends Error {
  readonly code: BreedingLedgerAuthorityErrorCode
  readonly path: string
  constructor(code: BreedingLedgerAuthorityErrorCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingLedgerAuthorityError'
    this.code = code
    this.path = path
  }
}
const fail = (code: BreedingLedgerAuthorityErrorCode, path: string, message: string): never => { throw new BreedingLedgerAuthorityError(code, path, message) }
const hash = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const same = (left: unknown, right: unknown): boolean => stableJsonStringify(left) === stableJsonStringify(right)
const withoutHash = <Value extends { readonly definitionSha256: string }>(value: Value): Omit<Value, 'definitionSha256'> => {
  const { definitionSha256: _definitionSha256, ...definition } = value
  return definition
}
const stripInputHash = <Value extends object>(value: Value): Omit<Value, 'definitionSha256'> => {
  const { definitionSha256: _definitionSha256, ...definition } = value as Value & { readonly definitionSha256?: unknown }
  return definition
}
const verify = <Value extends { readonly definitionSha256: string }>(value: Value, path: string): Value => {
  if (hash(withoutHash(value)) !== value.definitionSha256) fail('breeding.ledger.hash-mismatch', `${path}.definitionSha256`, 'does not match the strict ledger record.')
  return value
}
export const breedingLedgerRecordDefinitionSha256 = (value: BreedingReplaySafeLedgerRecordV1): string => hash(withoutHash(value))
export const parseAuthoritativeBreedingRollRecordV1 = (value: unknown, path = 'rollRecord'): BreedingRollRecordV1 => verify(parseBreedingRollRecordV1(value, path), path)
export const parseAuthoritativeBreedingCheckRecordV1 = (value: unknown, path = 'checkRecord'): BreedingCheckRecordV1 => verify(parseBreedingCheckRecordV1(value, path), path)
export const parseAuthoritativeBreedingOptionOfferRecordV1 = (value: unknown, path = 'offerRecord'): BreedingOptionOfferRecordV1 => verify(parseBreedingOptionOfferRecordV1(value, path), path)
export const parseAuthoritativeBreedingConsentRecordV1 = (value: unknown, path = 'consentRecord'): BreedingConsentRecordV1 => verify(parseBreedingConsentRecordV1(value, path), path)
export const parseAuthoritativeBreedingGmAdjudicationRecordV1 = (value: unknown, path = 'adjudicationRecord'): BreedingGmAdjudicationRecordV1 => verify(parseBreedingGmAdjudicationRecordV1(value, path), path)

/** Build an immutable roll only from already-injected values; this function never draws randomness. */
export const createBreedingRollRecordFromInjectedValues = (
  value: Omit<BreedingRollRecordDefinitionV1, 'total'>,
): BreedingRollRecordV1 => {
  const definition: BreedingRollRecordDefinitionV1 = { ...value, total: value.values.reduce((sum, die) => sum + die, value.modifier) }
  return parseAuthoritativeBreedingRollRecordV1({ ...definition, definitionSha256: hash(definition) })
}
export const createBreedingCheckRecordFromRoll = (input: {
  readonly checkRecordId: BreedingCheckRecordV1['checkRecordId']
  readonly operationId: BreedingOperationId
  readonly commandSha256: string
  readonly projectId: BreedingCheckRecordV1['projectId']
  readonly projectRevision: number
  readonly breederSnapshotDefinitionSha256: string
  readonly authoritativeSkillTotal: number
  readonly roll: BreedingRollRecordV1
  readonly rulesetDefinitionSha256: string
  readonly resolvedAtCampaignMinute: number
}): BreedingCheckRecordV1 => {
  const roll = parseAuthoritativeBreedingRollRecordV1(input.roll)
  if (roll.purpose !== 'breeder-check-d20' || roll.operationId !== input.operationId || roll.commandSha256 !== input.commandSha256
    || roll.target.kind !== 'breeding-project' || roll.target.projectId !== input.projectId || roll.target.revision !== input.projectRevision
    || !roll.sourceDefinitionHashes.includes(input.rulesetDefinitionSha256) || roll.generatedAtCampaignMinute > input.resolvedAtCampaignMinute) {
    fail('breeding.ledger.link-mismatch', 'roll', 'must be the command-bound breeder check roll for this project revision.')
  }
  const finalTotal = roll.total + input.authoritativeSkillTotal
  const definition: BreedingCheckRecordDefinitionV1 = {
    schemaVersion: 1,
    checkRecordId: input.checkRecordId,
    operationId: input.operationId,
    commandSha256: input.commandSha256,
    projectId: input.projectId,
    projectRevision: input.projectRevision,
    breederSnapshotDefinitionSha256: input.breederSnapshotDefinitionSha256,
    skillId: 'pokemon-education',
    difficultyClass: 12,
    authoritativeSkillTotal: input.authoritativeSkillTotal,
    rollRecordId: roll.rollRecordId,
    dieTotal: roll.total,
    finalTotal,
    outcome: finalTotal >= 12 ? 'success' : 'failure',
    rulesetDefinitionSha256: input.rulesetDefinitionSha256,
    resolvedAtCampaignMinute: input.resolvedAtCampaignMinute,
  }
  return parseAuthoritativeBreedingCheckRecordV1({ ...definition, definitionSha256: hash(definition) })
}
export const createBreedingOptionOfferRevisionV1 = (value: BreedingOptionOfferRecordDefinitionV1): BreedingOptionOfferRecordV1 => {
  const definition = stripInputHash(value) as BreedingOptionOfferRecordDefinitionV1
  return parseAuthoritativeBreedingOptionOfferRecordV1({ ...definition, definitionSha256: hash(definition) })
}
export const createBreedingOptionOfferRecordV1 = (
  value: Omit<BreedingOptionOfferRecordDefinitionV1, 'revision' | 'status' | 'selectedOptionId' | 'settlementOperationId' | 'settlementCommandSha256' | 'settledAtCampaignMinute' | 'settlementReasonId'>,
): BreedingOptionOfferRecordV1 => {
  const definition: BreedingOptionOfferRecordDefinitionV1 = { ...value, revision: 0, status: 'active', selectedOptionId: null, settlementOperationId: null, settlementCommandSha256: null, settledAtCampaignMinute: null, settlementReasonId: null }
  return parseAuthoritativeBreedingOptionOfferRecordV1({ ...definition, definitionSha256: hash(definition) })
}
export const createBreedingConsentRevisionV1 = (value: BreedingConsentRecordDefinitionV1): BreedingConsentRecordV1 => {
  const definition = stripInputHash(value) as BreedingConsentRecordDefinitionV1
  return parseAuthoritativeBreedingConsentRecordV1({ ...definition, definitionSha256: hash(definition) })
}
export const createBreedingConsentRecordV1 = (
  value: Omit<BreedingConsentRecordDefinitionV1, 'revision' | 'status' | 'settledAtCampaignMinute' | 'settlementOperationId' | 'settlementCommandSha256' | 'settlementReasonId'>,
): BreedingConsentRecordV1 => {
  const definition: BreedingConsentRecordDefinitionV1 = { ...value, revision: 0, status: 'active', settledAtCampaignMinute: null, settlementOperationId: null, settlementCommandSha256: null, settlementReasonId: null }
  return parseAuthoritativeBreedingConsentRecordV1({ ...definition, definitionSha256: hash(definition) })
}
export const createBreedingGmAdjudicationRecordV1 = (value: BreedingGmAdjudicationRecordDefinitionV1): BreedingGmAdjudicationRecordV1 => {
  const definition = stripInputHash(value) as BreedingGmAdjudicationRecordDefinitionV1
  return parseAuthoritativeBreedingGmAdjudicationRecordV1({ ...definition, definitionSha256: hash(definition) })
}

const offerCore = (offer: BreedingOptionOfferRecordV1) => ({ schemaVersion: offer.schemaVersion, offerId: offer.offerId, choiceKind: offer.choiceKind, target: offer.target, chooserProfileId: offer.chooserProfileId, minimumPokemonEducationRank: offer.minimumPokemonEducationRank, options: offer.options, issuedOperationId: offer.issuedOperationId, issuedCommandSha256: offer.issuedCommandSha256, issuedAtCampaignMinute: offer.issuedAtCampaignMinute, expiresAtCampaignMinute: offer.expiresAtCampaignMinute })
const consentCore = (consent: BreedingConsentRecordV1) => ({ schemaVersion: consent.schemaVersion, consentId: consent.consentId, projectId: consent.projectId, parentSheetSlug: consent.parentSheetSlug, parentSheetRevision: consent.parentSheetRevision, ownerTrainerSlug: consent.ownerTrainerSlug, consentingProfileId: consent.consentingProfileId, scopes: consent.scopes, grantedAtCampaignMinute: consent.grantedAtCampaignMinute, expiresAtCampaignMinute: consent.expiresAtCampaignMinute, grantOperationId: consent.grantOperationId, grantCommandSha256: consent.grantCommandSha256 })
const adjudicationCore = (adjudication: BreedingGmAdjudicationRecordV1) => ({ schemaVersion: adjudication.schemaVersion, adjudicationId: adjudication.adjudicationId, adjudicationKind: adjudication.adjudicationKind, decisionMode: adjudication.decisionMode, target: adjudication.target, createdByProfileId: adjudication.createdByProfileId, reasonId: adjudication.reasonId, offerId: adjudication.offerId, createdOperationId: adjudication.createdOperationId, createdCommandSha256: adjudication.createdCommandSha256, createdAtCampaignMinute: adjudication.createdAtCampaignMinute, authorityDefinitionHashes: adjudication.authorityDefinitionHashes })
const successorRevision = (current: { readonly revision: number }, next: { readonly revision: number }, path: string): void => {
  if (next.revision !== current.revision + 1) fail('breeding.ledger.invalid-transition', `${path}.revision`, 'must be exactly current revision plus one.')
}
export const validateBreedingOptionOfferSuccessor = (currentValue: unknown, nextValue: unknown): BreedingOptionOfferRecordV1 => {
  const current = parseAuthoritativeBreedingOptionOfferRecordV1(currentValue, 'currentOffer')
  const next = parseAuthoritativeBreedingOptionOfferRecordV1(nextValue, 'nextOffer')
  if (current.status !== 'active') fail('breeding.ledger.invalid-transition', 'currentOffer.status', 'settled offers cannot transition.')
  successorRevision(current, next, 'nextOffer')
  if (!same(offerCore(current), offerCore(next)) || next.status === 'active') fail('breeding.ledger.invalid-transition', 'nextOffer', 'must settle without changing immutable offer facts.')
  if (next.settledAtCampaignMinute! < current.issuedAtCampaignMinute) fail('breeding.ledger.invalid-transition', 'nextOffer.settledAtCampaignMinute', 'cannot predate issuance.')
  if (next.status === 'consumed' && current.expiresAtCampaignMinute !== null && next.settledAtCampaignMinute! >= current.expiresAtCampaignMinute) fail('breeding.ledger.invalid-transition', 'nextOffer.status', 'cannot consume an expired offer.')
  if (next.status === 'expired' && (current.expiresAtCampaignMinute === null || next.settledAtCampaignMinute! < current.expiresAtCampaignMinute)) fail('breeding.ledger.invalid-transition', 'nextOffer.status', 'cannot expire before its recorded expiry.')
  return next
}
export const validateBreedingConsentSuccessor = (currentValue: unknown, nextValue: unknown): BreedingConsentRecordV1 => {
  const current = parseAuthoritativeBreedingConsentRecordV1(currentValue, 'currentConsent')
  const next = parseAuthoritativeBreedingConsentRecordV1(nextValue, 'nextConsent')
  if (current.status !== 'active') fail('breeding.ledger.invalid-transition', 'currentConsent.status', 'settled consent cannot transition or reactivate.')
  successorRevision(current, next, 'nextConsent')
  if (!same(consentCore(current), consentCore(next)) || next.status === 'active') fail('breeding.ledger.invalid-transition', 'nextConsent', 'must settle without changing grant facts.')
  if (next.status === 'expired' && (current.expiresAtCampaignMinute === null || next.settledAtCampaignMinute! < current.expiresAtCampaignMinute)) fail('breeding.ledger.invalid-transition', 'nextConsent.status', 'cannot expire before its recorded expiry.')
  return next
}
export const validateBreedingGmAdjudicationSuccessor = (currentValue: unknown, nextValue: unknown): BreedingGmAdjudicationRecordV1 => {
  const current = parseAuthoritativeBreedingGmAdjudicationRecordV1(currentValue, 'currentAdjudication')
  const next = parseAuthoritativeBreedingGmAdjudicationRecordV1(nextValue, 'nextAdjudication')
  if (current.status !== 'pending') fail('breeding.ledger.invalid-transition', 'currentAdjudication.status', 'settled adjudication cannot transition.')
  successorRevision(current, next, 'nextAdjudication')
  if (!same(adjudicationCore(current), adjudicationCore(next)) || next.status === 'pending') fail('breeding.ledger.invalid-transition', 'nextAdjudication', 'must settle without changing adjudication authority.')
  return next
}

/** Exact duplicate identities replay; changed facts under one identity fail closed. */
export const assertBreedingLedgerRecordExactReplay = <Value extends BreedingReplaySafeLedgerRecordV1>(existingValue: Value, attemptedValue: Value): Value => {
  const existing = parseLedgerRecordByShape(existingValue)
  const attempted = parseLedgerRecordByShape(attemptedValue)
  if (!same(existing, attempted)) fail('breeding.ledger.identity-collision', 'ledgerRecord', 'the stable ledger identity is already bound to different facts.')
  return existing as Value
}
const parseLedgerRecordByShape = (value: unknown): BreedingReplaySafeLedgerRecordV1 => {
  if (!value || typeof value !== 'object') return fail('breeding.ledger.identity-collision', 'ledgerRecord', 'must be a ledger record.')
  const row = value as Record<string, unknown>
  if ('rollRecordId' in row) return parseAuthoritativeBreedingRollRecordV1(value)
  if ('checkRecordId' in row) return parseAuthoritativeBreedingCheckRecordV1(value)
  if ('offerId' in row && 'choiceKind' in row) return parseAuthoritativeBreedingOptionOfferRecordV1(value)
  if ('consentId' in row) return parseAuthoritativeBreedingConsentRecordV1(value)
  if ('adjudicationId' in row) return parseAuthoritativeBreedingGmAdjudicationRecordV1(value)
  return fail('breeding.ledger.identity-collision', 'ledgerRecord', 'has no recognized v1 ledger identity.')
}
export const validateBreedingOperationRollSet = (values: readonly unknown[]): readonly BreedingRollRecordV1[] => {
  if (!Array.isArray(values) || values.length > 32) fail('breeding.ledger.invalid-transition', 'rollRecords', 'must contain at most 32 operation rolls.')
  const records = values.map((value, index) => parseAuthoritativeBreedingRollRecordV1(value, `rollRecords[${index}]`))
  const ids = new Set<string>()
  const ordinals = new Set<number>()
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!
    if (ids.has(record.rollRecordId) || ordinals.has(record.operationRollOrdinal)) fail('breeding.ledger.identity-collision', `rollRecords[${index}]`, 'roll identity and operation ordinal must be unique.')
    if (index > 0 && (record.operationId !== records[0]!.operationId || record.commandSha256 !== records[0]!.commandSha256 || record.operationRollOrdinal <= records[index - 1]!.operationRollOrdinal)) fail('breeding.ledger.invalid-transition', `rollRecords[${index}]`, 'one operation roll set must share command identity and sort by ordinal.')
    ids.add(record.rollRecordId); ordinals.add(record.operationRollOrdinal)
  }
  return Object.freeze(records)
}
export const validateBreedingProjectCheckSet = (values: readonly unknown[]): readonly BreedingCheckRecordV1[] => {
  if (!Array.isArray(values) || values.length > 1) fail('breeding.ledger.invalid-transition', 'checkRecords', 'a project may retain exactly zero or one Breeder check.')
  return Object.freeze(values.map((value, index) => parseAuthoritativeBreedingCheckRecordV1(value, `checkRecords[${index}]`)))
}
export const validateBreedingCheckRollLink = (checkValue: unknown, rollValue: unknown): BreedingCheckRecordV1 => {
  const check = parseAuthoritativeBreedingCheckRecordV1(checkValue)
  const roll = parseAuthoritativeBreedingRollRecordV1(rollValue)
  if (roll.rollRecordId !== check.rollRecordId || roll.operationId !== check.operationId || roll.commandSha256 !== check.commandSha256 || roll.purpose !== 'breeder-check-d20'
    || roll.target.kind !== 'breeding-project' || roll.target.projectId !== check.projectId || roll.target.revision !== check.projectRevision || roll.total !== check.dieTotal
    || !roll.sourceDefinitionHashes.includes(check.rulesetDefinitionSha256) || roll.generatedAtCampaignMinute > check.resolvedAtCampaignMinute) fail('breeding.ledger.link-mismatch', 'checkRecord', 'does not match its immutable check roll.')
  return check
}
export const validateBreedingAdjudicationOfferLink = (adjudicationValue: unknown, offerValue: unknown): BreedingGmAdjudicationRecordV1 => {
  const adjudication = parseAuthoritativeBreedingGmAdjudicationRecordV1(adjudicationValue)
  const offer = parseAuthoritativeBreedingOptionOfferRecordV1(offerValue)
  const expectedChoiceKind = adjudication.adjudicationKind === 'parent-role-override' ? 'parent-role'
    : adjudication.adjudicationKind === 'offspring-family' ? 'family'
      : adjudication.adjudicationKind === 'hatch-duration' ? 'hatch-duration'
        : adjudication.adjudicationKind === 'hatch-special-result' ? 'special-result'
          : adjudication.adjudicationKind === 'source-egg' ? 'species'
            : null
  if (adjudication.decisionMode !== 'bounded-option' || adjudication.offerId !== offer.offerId || !same(adjudication.target, offer.target)
    || offer.issuedOperationId !== adjudication.createdOperationId || offer.issuedCommandSha256 !== adjudication.createdCommandSha256
    || (expectedChoiceKind !== null && offer.choiceKind !== expectedChoiceKind)) fail('breeding.ledger.link-mismatch', 'adjudicationRecord.offerId', 'must bind the same command-issued bounded offer kind and target.')
  if (adjudication.status === 'pending' && offer.status !== 'active') fail('breeding.ledger.link-mismatch', 'adjudicationRecord.offerId', 'pending adjudication requires its active offer.')
  if (adjudication.status === 'resolved' && (adjudication.decision?.kind !== 'option' || offer.status !== 'consumed' || offer.selectedOptionId !== adjudication.decision.optionId
    || offer.settlementOperationId !== adjudication.settlementOperationId || offer.settlementCommandSha256 !== adjudication.settlementCommandSha256
    || offer.chooserProfileId !== adjudication.resolvedByProfileId)) fail('breeding.ledger.link-mismatch', 'adjudicationRecord.decision', 'must match the consumed GM offer exactly.')
  return adjudication
}
export const isBreedingConsentCurrentlyUsable = (consentValue: unknown, input: { readonly projectId: string, readonly parentSheetSlug: string, readonly parentSheetRevision: number, readonly ownerTrainerSlug: string, readonly consentingProfileId: string, readonly atCampaignMinute: number }): boolean => {
  const consent = parseAuthoritativeBreedingConsentRecordV1(consentValue)
  return consent.status === 'active' && consent.projectId === input.projectId && consent.parentSheetSlug === input.parentSheetSlug
    && consent.parentSheetRevision === input.parentSheetRevision && consent.ownerTrainerSlug === input.ownerTrainerSlug
    && consent.consentingProfileId === input.consentingProfileId && (consent.expiresAtCampaignMinute === null || input.atCampaignMinute < consent.expiresAtCampaignMinute)
}
