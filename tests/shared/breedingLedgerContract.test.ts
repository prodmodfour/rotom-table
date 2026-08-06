import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  BREEDING_ADJUDICATION_KINDS,
  BREEDING_ROLL_PURPOSES,
  BreedingLedgerValidationError,
  parseBreedingConsentRecordV1,
  parseBreedingGmAdjudicationRecordV1,
  parseBreedingOptionOfferRecordV1,
  parseBreedingRollRecordV1,
  type BreedingRollFormula,
  type BreedingRollPurpose,
} from '../../shared/breeding/ledgers'
import {
  BreedingLedgerAuthorityError,
  assertBreedingLedgerRecordExactReplay,
  createBreedingCheckRecordFromRoll,
  createBreedingConsentRecordV1,
  createBreedingConsentRevisionV1,
  createBreedingGmAdjudicationRecordV1,
  createBreedingOptionOfferRecordV1,
  createBreedingOptionOfferRevisionV1,
  createBreedingRollRecordFromInjectedValues,
  isBreedingConsentCurrentlyUsable,
  parseAuthoritativeBreedingCheckRecordV1,
  parseAuthoritativeBreedingConsentRecordV1,
  parseAuthoritativeBreedingGmAdjudicationRecordV1,
  parseAuthoritativeBreedingOptionOfferRecordV1,
  parseAuthoritativeBreedingRollRecordV1,
  validateBreedingAdjudicationOfferLink,
  validateBreedingCheckRollLink,
  validateBreedingConsentSuccessor,
  validateBreedingGmAdjudicationSuccessor,
  validateBreedingOperationRollSet,
  validateBreedingOptionOfferSuccessor,
  validateBreedingProjectCheckSet,
} from '../../server/domain/breeding/ledgers'

const ROOT = resolve(import.meta.dirname, '../..')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
const policy = readJson<Record<string, any>>('data/breeding-automation/ledger-contract.json')
const ruleset = readJson<Record<string, any>>('data/breeding-automation/ruleset.json')
const op = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const rollId = (value: number): string => `breeding-roll:v1:${value.toString(16).padStart(32, '0')}`
const offerId = (value: number): string => `breeding-offer:v1:${value.toString(16).padStart(32, '0')}`
const optionId = (value: number): string => `option:v1:${value.toString(16).padStart(32, '0')}`
const consentId = (value: number): string => `breeding-consent:v1:${value.toString(16).padStart(32, '0')}`
const adjudicationId = (value: number): string => `breeding-adjudication:v1:${value.toString(16).padStart(32, '0')}`
const checkId = (value: number): string => `breeding-check:v1:${value.toString(16).padStart(32, '0')}`
const PROJECT_ID = 'breeding-project:v1:11111111111111111111111111111111'
const EGG_ID = 'pokemon-egg:v1:22222222222222222222222222222222'
const target = { kind: 'breeding-project', projectId: PROJECT_ID, revision: 4 } as const
const commandHash = 'a'.repeat(64)
const rollParameters: Record<BreedingRollPurpose, { readonly formula: BreedingRollFormula, readonly dieCount: number, readonly dieSides: number, readonly ordered: boolean, readonly modifier: number, readonly values: readonly number[] }> = {
  'breeder-check-d20': { formula: '1d20', dieCount: 1, dieSides: 20, ordered: false, modifier: 0, values: [8] },
  'offspring-family-d20': { formula: '1d20', dieCount: 1, dieSides: 20, ordered: false, modifier: 0, values: [4] },
  'nature-ordered-2d6': { formula: 'ordered-2d6', dieCount: 2, dieSides: 6, ordered: true, modifier: 0, values: [1, 6] },
  'ability-uniform-index': { formula: 'uniform-index', dieCount: 1, dieSides: 3, ordered: false, modifier: 0, values: [3] },
  'gender-d100': { formula: '1d100', dieCount: 1, dieSides: 100, ordered: false, modifier: 0, values: [50] },
  'hatch-duration-percentage': { formula: 'percentage-50-to-200', dieCount: 1, dieSides: 151, ordered: false, modifier: 49, values: [151] },
  'hatch-special-d100': { formula: '1d100', dieCount: 1, dieSides: 100, ordered: false, modifier: 0, values: [100] },
  'provider-bounded': { formula: 'provider-bounded', dieCount: 2, dieSides: 8, ordered: false, modifier: 2, values: [3, 7] },
}
const roll = (purpose: BreedingRollPurpose, ordinal = 0, operation = 1) => createBreedingRollRecordFromInjectedValues({
  schemaVersion: 1,
  rollRecordId: rollId(ordinal + operation * 10) as any,
  operationId: op(operation) as any,
  commandSha256: commandHash,
  operationRollOrdinal: ordinal,
  purpose,
  target,
  ...rollParameters[purpose],
  generatorId: 'server-rng-v1',
  sourceDefinitionHashes: [ruleset.definitionSha256],
  generatedAtCampaignMinute: 100,
})
const offer = () => createBreedingOptionOfferRecordV1({
  schemaVersion: 1,
  offerId: offerId(1) as any,
  choiceKind: 'family',
  target,
  chooserProfileId: 'profile-gm',
  minimumPokemonEducationRank: null,
  options: [
    { optionId: optionId(1) as any, kind: 'family', canonicalValueId: 'family:bulbasaur', valueDefinitionSha256: '1'.repeat(64), authorityEvidenceIds: ['family:bulbasaur'] },
    { optionId: optionId(2) as any, kind: 'family', canonicalValueId: 'family:charmander', valueDefinitionSha256: '2'.repeat(64), authorityEvidenceIds: ['family:charmander'] },
  ],
  issuedOperationId: op(2) as any,
  issuedCommandSha256: 'b'.repeat(64),
  issuedAtCampaignMinute: 110,
  expiresAtCampaignMinute: 200,
})
const consumedOffer = () => {
  const current = offer()
  return createBreedingOptionOfferRevisionV1({
    ...current,
    revision: 1,
    status: 'consumed',
    selectedOptionId: optionId(1) as any,
    settlementOperationId: op(3) as any,
    settlementCommandSha256: 'c'.repeat(64),
    settledAtCampaignMinute: 120,
    settlementReasonId: null,
  })
}
const consent = () => createBreedingConsentRecordV1({
  schemaVersion: 1,
  consentId: consentId(1) as any,
  projectId: PROJECT_ID as any,
  parentSheetSlug: 'pokemon-parent-a',
  parentSheetRevision: 7,
  ownerTrainerSlug: 'trainer-parent-owner',
  consentingProfileId: 'profile-parent-owner',
  scopes: ['own-parent-contribution-attribution', 'own-parent-safe-summary', 'project-participation'].sort() as any,
  grantedAtCampaignMinute: 100,
  expiresAtCampaignMinute: 200,
  grantOperationId: op(4) as any,
  grantCommandSha256: 'd'.repeat(64),
})
const pendingAdjudication = () => createBreedingGmAdjudicationRecordV1({
  schemaVersion: 1,
  adjudicationId: adjudicationId(1) as any,
  revision: 0,
  status: 'pending',
  adjudicationKind: 'offspring-family',
  decisionMode: 'bounded-option',
  target,
  createdByProfileId: 'profile-gm',
  reasonId: 'breeding.adjudication.family-choice',
  offerId: offerId(1) as any,
  decision: null,
  createdOperationId: op(2) as any,
  createdCommandSha256: 'b'.repeat(64),
  createdAtCampaignMinute: 110,
  resolvedByProfileId: null,
  settlementOperationId: null,
  settlementCommandSha256: null,
  settledAtCampaignMinute: null,
  settlementReasonId: null,
  authorityDefinitionHashes: [ruleset.definitionSha256],
})
const resolvedAdjudication = () => createBreedingGmAdjudicationRecordV1({
  ...pendingAdjudication(),
  revision: 1,
  status: 'resolved',
  decision: { kind: 'option', optionId: optionId(1) as any },
  resolvedByProfileId: 'profile-gm',
  settlementOperationId: op(3) as any,
  settlementCommandSha256: 'c'.repeat(64),
  settledAtCampaignMinute: 120,
})

describe('Breeding replay-safe ledgers', () => {
  it('binds all five strict ledger families and their replay policy', () => {
    expect(policy).toMatchObject({
      schemaVersion: 1,
      contractId: 'ptu-1.05-breeding-replay-ledgers-v1',
      rulesetId: ruleset.rulesetId,
      rulesetDefinitionSha256: ruleset.definitionSha256,
      sourceManifestSha256: sha256(readFileSync(resolve(ROOT, 'data/breeding-automation/source-manifest.json'))),
    })
    expect(policy.definitionSha256).toBe(sha256(stableJsonStringify(policy.definition)))
    expect(policy.definition.rollLedger.purposes).toEqual(BREEDING_ROLL_PURPOSES)
    expect(policy.definition.gmAdjudicationLedger.kinds).toEqual(BREEDING_ADJUDICATION_KINDS)
    expect(policy.definition.replay).toMatchObject({ rollRerun: 'forbidden', optionReuse: 'forbidden', consentReactivation: 'forbidden' })
  })

  it('records every closed roll formula from injected values without hidden randomness', () => {
    for (const [ordinal, purpose] of BREEDING_ROLL_PURPOSES.entries()) {
      const result = roll(purpose, ordinal)
      expect(result.purpose).toBe(purpose)
      expect(result.total).toBe(result.values.reduce((sum, value) => sum + value, result.modifier))
      expect(parseAuthoritativeBreedingRollRecordV1(result)).toEqual(result)
      expect(Object.isFrozen(result.values)).toBe(true)
    }
    expect(roll('nature-ordered-2d6', 0).values).toEqual([1, 6])
    expect(roll('hatch-duration-percentage', 0).total).toBe(200)
  })

  it('rejects missing, extra, contradictory, out-of-range, or duplicate roll evidence', () => {
    const valid = roll('gender-d100')
    expect(() => parseBreedingRollRecordV1({ ...valid, values: [] })).toThrow(BreedingLedgerValidationError)
    expect(() => parseBreedingRollRecordV1({ ...valid, values: [101] })).toThrow(BreedingLedgerValidationError)
    expect(() => parseBreedingRollRecordV1({ ...valid, formula: '1d20', dieSides: 20 })).toThrow(BreedingLedgerValidationError)
    expect(() => parseBreedingRollRecordV1({ ...valid, clientSeed: 5 })).toThrowError(expect.objectContaining({ code: 'breeding.ledger.unknown-field' }))
    const first = roll('gender-d100', 0, 8)
    const duplicateOrdinal = roll('hatch-special-d100', 0, 8)
    expect(() => validateBreedingOperationRollSet([first, duplicateOrdinal])).toThrowError(expect.objectContaining({ code: 'breeding.ledger.identity-collision' }))
    const second = roll('hatch-special-d100', 1, 8)
    expect(validateBreedingOperationRollSet([first, second])).toHaveLength(2)
  })

  it('derives the single DC 12 check from its persisted operation-bound d20', () => {
    const checkRoll = roll('breeder-check-d20', 0, 9)
    const result = createBreedingCheckRecordFromRoll({
      checkRecordId: checkId(1) as any,
      operationId: checkRoll.operationId,
      commandSha256: checkRoll.commandSha256,
      projectId: PROJECT_ID as any,
      projectRevision: 4,
      breederSnapshotDefinitionSha256: 'e'.repeat(64),
      authoritativeSkillTotal: 4,
      roll: checkRoll,
      rulesetDefinitionSha256: ruleset.definitionSha256,
      resolvedAtCampaignMinute: 130,
    })
    expect(result).toMatchObject({ dieTotal: 8, authoritativeSkillTotal: 4, finalTotal: 12, outcome: 'success' })
    expect(validateBreedingCheckRollLink(result, checkRoll)).toEqual(result)
    expect(validateBreedingProjectCheckSet([result])).toEqual([result])
    expect(() => validateBreedingProjectCheckSet([result, result])).toThrow(BreedingLedgerAuthorityError)
    expect(() => createBreedingCheckRecordFromRoll({ ...result, roll: roll('offspring-family-d20', 0, 9) } as any)).toThrowError(expect.objectContaining({ code: 'breeding.ledger.link-mismatch' }))
  })

  it('issues immutable bounded options and consumes one option exactly once', () => {
    const current = offer()
    const next = consumedOffer()
    expect(validateBreedingOptionOfferSuccessor(current, next)).toEqual(next)
    expect(next).toMatchObject({ status: 'consumed', selectedOptionId: optionId(1), settlementOperationId: op(3) })
    expect(Object.isFrozen(next.options)).toBe(true)
    expect(() => validateBreedingOptionOfferSuccessor(next, { ...next, revision: 2 })).toThrow()
    expect(() => createBreedingOptionOfferRevisionV1({ ...next, selectedOptionId: optionId(9) as any })).toThrow(BreedingLedgerValidationError)
    expect(() => parseBreedingOptionOfferRecordV1({ ...current, options: [...current.options].reverse() })).toThrow(BreedingLedgerValidationError)
  })

  it('keeps positive parent consent revision-bound, expiring, and non-reactivatable', () => {
    const current = consent()
    expect(isBreedingConsentCurrentlyUsable(current, { projectId: PROJECT_ID, parentSheetSlug: 'pokemon-parent-a', parentSheetRevision: 7, ownerTrainerSlug: 'trainer-parent-owner', consentingProfileId: 'profile-parent-owner', atCampaignMinute: 199 })).toBe(true)
    expect(isBreedingConsentCurrentlyUsable(current, { projectId: PROJECT_ID, parentSheetSlug: 'pokemon-parent-a', parentSheetRevision: 8, ownerTrainerSlug: 'trainer-parent-owner', consentingProfileId: 'profile-parent-owner', atCampaignMinute: 199 })).toBe(false)
    expect(isBreedingConsentCurrentlyUsable(current, { projectId: PROJECT_ID, parentSheetSlug: 'pokemon-parent-a', parentSheetRevision: 7, ownerTrainerSlug: 'trainer-parent-owner', consentingProfileId: 'profile-parent-owner', atCampaignMinute: 200 })).toBe(false)
    const revoked = createBreedingConsentRevisionV1({ ...current, revision: 1, status: 'revoked', settledAtCampaignMinute: 150, settlementOperationId: op(5) as any, settlementCommandSha256: 'f'.repeat(64), settlementReasonId: 'breeding.consent.revoked' })
    expect(validateBreedingConsentSuccessor(current, revoked)).toEqual(revoked)
    expect(() => validateBreedingConsentSuccessor(revoked, { ...current, revision: 2 })).toThrow()
    const changedParent = createBreedingConsentRevisionV1({ ...revoked, parentSheetRevision: 8 })
    expect(() => validateBreedingConsentSuccessor(current, changedParent)).toThrowError(expect.objectContaining({ code: 'breeding.ledger.invalid-transition' }))
  })

  it('resolves bounded GM adjudication only through its matching consumed offer', () => {
    const pending = pendingAdjudication()
    const resolved = resolvedAdjudication()
    const usedOffer = consumedOffer()
    expect(validateBreedingGmAdjudicationSuccessor(pending, resolved)).toEqual(resolved)
    expect(validateBreedingAdjudicationOfferLink(resolved, usedOffer)).toEqual(resolved)
    const wrongOffer = createBreedingOptionOfferRevisionV1({ ...usedOffer, settlementCommandSha256: '9'.repeat(64) })
    expect(() => validateBreedingAdjudicationOfferLink(resolved, wrongOffer)).toThrowError(expect.objectContaining({ code: 'breeding.ledger.link-mismatch' }))
    expect(() => validateBreedingGmAdjudicationSuccessor(resolved, { ...resolved, revision: 2 })).toThrow()
    const freeOutcome = { ...pending, decision: { kind: 'text', value: 'make it shiny' }, status: 'resolved', revision: 1, resolvedByProfileId: 'profile-gm', settlementOperationId: op(3), settlementCommandSha256: 'c'.repeat(64), settledAtCampaignMinute: 120 }
    expect(() => parseBreedingGmAdjudicationRecordV1(freeOutcome)).toThrow(BreedingLedgerValidationError)
  })

  it('self-hashes, detaches, replays exact identities, and rejects changed identity facts', () => {
    const records = [roll('gender-d100'), offer(), consent(), pendingAdjudication()]
    for (const record of records) expect(assertBreedingLedgerRecordExactReplay(record as any, structuredClone(record) as any)).toEqual(record)
    const changedRoll = { ...records[0], values: [51], total: 51 }
    expect(() => assertBreedingLedgerRecordExactReplay(records[0] as any, changedRoll as any)).toThrow(BreedingLedgerAuthorityError)
    expect(() => parseAuthoritativeBreedingConsentRecordV1({ ...consent(), definitionSha256: '0'.repeat(64) })).toThrowError(expect.objectContaining({ code: 'breeding.ledger.hash-mismatch' }))
    expect(parseAuthoritativeBreedingOptionOfferRecordV1(offer()).status).toBe('active')
    expect(parseAuthoritativeBreedingGmAdjudicationRecordV1(pendingAdjudication()).status).toBe('pending')
    const accessor = structuredClone(consent())
    Object.defineProperty(accessor, 'status', { enumerable: true, get: () => 'active' })
    expect(() => parseBreedingConsentRecordV1(accessor)).toThrow(BreedingLedgerValidationError)
  })
})
