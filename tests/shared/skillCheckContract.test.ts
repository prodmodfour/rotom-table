import { describe, expect, it } from 'vitest'
import contract from '../../data/deferred-closure/skill-check-contract.v1.json'
import { parseSkillCheckCommand, parseSkillCheckDocument } from '../../shared/skillChecks/persistence'
import { acceptedSuccessorHead } from '../helpers/deferredClosureSuccessors'
import {
  SKILL_CHECK_OPERATION_KINDS,
  SKILL_CHECK_SKILL_IDS,
  SKILL_CHECK_STATE_TRANSITIONS,
  assertSkillCheckDocumentInvariants,
  parseSkillCheckId,
  parseSkillCheckOperationId,
  type SkillCheckDocumentV1,
} from '../../shared/skillChecks/contract'

const pending = (): SkillCheckDocumentV1 => ({
  schemaVersion: 1,
  checkId: 'skill-check:v1:perception-watch',
  revision: 1,
  state: 'pending',
  mode: 'single',
  requester: { role: 'gm', principalId: 'gm:director' },
  publicLabel: 'Keep watch',
  prompt: 'Make a Perception check.',
  gmNotes: 'Private difficulty context.',
  visibility: 'public-results',
  comparison: { kind: 'dc', difficultyClass: 12, concealment: 'subjects-after-acceptance' },
  situationalModifier: 0,
  subjects: [{
    subjectId: 'skill-check-subject:v1:trainer-maya', kind: 'trainer', sheetSlug: 'maya',
    sheetRevision: 4, skillId: 'perception', controllerProfileIds: ['profile:maya'], response: 'pending', respondedAt: null,
  }],
  journals: [],
  acceptedResults: [],
  corrections: [],
  history: [{ historyId: 'history:request', kind: 'requested', operationId: 'skill-check-op:v1:request01', subjectId: null, headline: 'Check requested', createdAt: 10 }],
  createdAt: 10,
  updatedAt: 10,
  expiresAt: null,
  terminalAt: null,
  lastOperationId: 'skill-check-op:v1:request01',
})

describe('P11-007 generic Skill Check contract', () => {
  it('records the no-existing-surface evidence by exact source bytes', () => {
    expect(contract).toMatchObject({ schemaVersion: 1, ticket: 'P11-007', status: 'reviewed', contractId: 'generic-liveplay-skill-check-v1' })
    expect(contract.existingSurfaceReview.finding).toContain('No generic server-authoritative SkillCheckDocument')
    for (const source of contract.existingSurfaceReview.searchedAuthorities) {
      expect(acceptedSuccessorHead(source.path, source.sha256), source.path).toBeDefined()
      expect(source.finding.length).toBeGreaterThan(0)
    }
  })

  it('uses the exact shared Trainer and Pokémon skill identity set', () => {
    expect(contract.canonicalSkillIds).toEqual(SKILL_CHECK_SKILL_IDS)
    expect(new Set(SKILL_CHECK_SKILL_IDS).size).toBe(17)
    expect(contract.document.subjectKinds).toEqual(['trainer', 'pokemon'])
    expect(contract.document.subjectCountMaximum).toBe(32)
  })

  it('defines bounded operations, idempotency, randomness, and privacy', () => {
    expect(contract.operations.kinds).toEqual(SKILL_CHECK_OPERATION_KINDS)
    expect(contract.operations.exactRetry).toContain('without-reroll')
    expect(contract.document.journal).toMatchObject({ dieSides: 6, serverRandomnessOnly: true, appendOnly: true })
    expect(contract.document.modifierResolution).toMatchObject({ clientRolls: 'forbidden', clientResolvedModifiers: 'forbidden' })
    expect(contract.privacy.structurallyDistinctProjections).toBe(true)
    expect(contract.privacy.neverPublic).toContain('gm-notes')
    expect(contract.nonGoals).toContain('macro-scripting')
  })

  it('accepts a complete pending and accepted document', () => {
    const document = pending()
    expect(parseSkillCheckDocument(document)).toEqual(document)
    expect(() => assertSkillCheckDocumentInvariants(document)).not.toThrow()
    const accepted: SkillCheckDocumentV1 = {
      ...document,
      revision: 2,
      state: 'accepted',
      subjects: [{ ...document.subjects[0]!, response: 'accepted', respondedAt: 11 }],
      journals: [{
        journalId: 'skill-check-journal:v1:perception-watch-1', subjectId: document.subjects[0]!.subjectId,
        attempt: 1, diceCount: 2, dieSides: 6, flatModifier: 1,
        contributors: [{ contributorId: 'sheet:trainer:maya:skill:perception', label: 'Skill modifier', value: 1, visibility: 'gm-and-subject' }],
        results: [5, 6], dieTotal: 11, finalTotal: 12, rolledAt: 12,
      }],
      acceptedResults: [{
        subjectId: document.subjects[0]!.subjectId,
        journalIds: ['skill-check-journal:v1:perception-watch-1'], finalTotal: 12, outcome: 'success', acceptedAt: 12,
      }],
      terminalAt: 12,
      updatedAt: 12,
      lastOperationId: 'skill-check-op:v1:resolve01',
    }
    expect(parseSkillCheckDocument(accepted)).toEqual(accepted)
    expect(() => assertSkillCheckDocumentInvariants(accepted)).not.toThrow()
    expect(() => parseSkillCheckDocument({
      ...accepted,
      journals: [{
        ...accepted.journals[0]!,
        contributors: [{ ...accepted.journals[0]!.contributors[0]!, value: 0 }],
      }],
    })).toThrow('skill-check.invalid-journal')
    expect(() => parseSkillCheckDocument({
      ...accepted,
      acceptedResults: [{ ...accepted.acceptedResults[0]!, outcome: 'failure' }],
    })).toThrow('skill-check.invalid-dc-result')
  })

  it('strictly parses request commands without accepting client-resolved authority', () => {
    expect(parseSkillCheckCommand({
      schemaVersion: 1,
      operationId: 'skill-check-op:v1:request01',
      expectedRevision: 0,
      commandKind: 'request',
      checkId: 'skill-check:v1:perception-watch',
      publicLabel: 'Keep watch',
      prompt: 'Make a Perception check.',
      gmNotes: 'Private difficulty context.',
      visibility: 'public-results',
      comparison: { kind: 'dc', difficulty: { kind: 'explicit', difficultyClass: 12 }, concealment: 'subjects-after-acceptance' },
      situationalModifier: 0,
      expiresAt: null,
      subjects: [{
        subjectId: 'skill-check-subject:v1:trainer-maya',
        kind: 'trainer',
        sheetSlug: 'maya',
        skillId: 'perception',
      }],
    })).toMatchObject({ commandKind: 'request', expectedRevision: 0 })
    expect(parseSkillCheckCommand({
      schemaVersion: 1,
      operationId: 'skill-check-op:v1:preset_request_01',
      expectedRevision: 0,
      commandKind: 'request',
      checkId: 'skill-check:v1:preset-watch',
      publicLabel: 'Keep watch',
      prompt: 'Make a Perception check.',
      gmNotes: '',
      visibility: 'gm-only-results',
      comparison: {
        kind: 'dc',
        difficulty: { kind: 'preset', presetId: 'skill-check-dc-preset:v1:hard' },
        concealment: 'gm-only',
      },
      situationalModifier: 0,
      expiresAt: null,
      subjects: [{
        subjectId: 'skill-check-subject:v1:trainer-maya',
        kind: 'trainer',
        sheetSlug: 'maya',
        skillId: 'perception',
      }],
    })).toMatchObject({ comparison: { difficulty: { presetId: 'skill-check-dc-preset:v1:hard' } } })
    expect(() => parseSkillCheckCommand({
      schemaVersion: 1,
      operationId: 'skill-check-op:v1:request01',
      expectedRevision: 0,
      commandKind: 'request',
      checkId: 'skill-check:v1:perception-watch',
      publicLabel: 'Keep watch',
      prompt: 'Make a Perception check.',
      gmNotes: '',
      visibility: 'public-results',
      comparison: { kind: 'dc', difficulty: { kind: 'explicit', difficultyClass: 12 }, concealment: 'public' },
      situationalModifier: 0,
      expiresAt: null,
      subjects: [],
      clientRoll: 6,
    })).toThrow('skill-check.invalid-shape')
    expect(() => parseSkillCheckCommand({
      schemaVersion: 1,
      operationId: 'skill-check-op:v1:forged_preset_01',
      expectedRevision: 0,
      commandKind: 'request',
      checkId: 'skill-check:v1:forged-preset',
      publicLabel: 'Keep watch',
      prompt: 'Make a Perception check.',
      gmNotes: '',
      visibility: 'public-results',
      comparison: {
        kind: 'dc',
        difficulty: { kind: 'preset', presetId: 'skill-check-dc-preset:v1:forged' },
        concealment: 'public',
      },
      situationalModifier: 0,
      expiresAt: null,
      subjects: [{
        subjectId: 'skill-check-subject:v1:trainer-maya', kind: 'trainer', sheetSlug: 'maya', skillId: 'perception',
      }],
    })).toThrow('skill-check.invalid-comparison')
    expect(() => parseSkillCheckCommand({
      schemaVersion: 1,
      operationId: 'skill-check-op:v1:legacy_dc_shape_01',
      expectedRevision: 0,
      commandKind: 'request',
      checkId: 'skill-check:v1:legacy-dc-shape',
      publicLabel: 'Keep watch',
      prompt: 'Make a Perception check.',
      gmNotes: '',
      visibility: 'public-results',
      comparison: { kind: 'dc', difficultyClass: 12, concealment: 'public' },
      situationalModifier: 0,
      expiresAt: null,
      subjects: [{
        subjectId: 'skill-check-subject:v1:trainer-maya', kind: 'trainer', sheetSlug: 'maya', skillId: 'perception',
      }],
    })).toThrow('skill-check.invalid-shape')
  })

  it('fails closed on schemas, IDs, DCs, group/opposed shape, client-like evidence, and journal drift', () => {
    expect(() => parseSkillCheckDocument({ ...pending(), schemaVersion: 2 })).toThrow('skill-check.unsupported-schema')
    expect(() => parseSkillCheckCommand({ schemaVersion: 2, commandKind: 'resolve' })).toThrow('skill-check.unsupported-schema')
    expect(() => parseSkillCheckId('check:bad')).toThrow()
    expect(() => parseSkillCheckOperationId('skill-check-op:v1:short')).toThrow()
    expect(() => assertSkillCheckDocumentInvariants({ ...pending(), comparison: { kind: 'dc', difficultyClass: 0, concealment: 'public' } })).toThrow('skill-check.invalid-dc')
    expect(() => assertSkillCheckDocumentInvariants({ ...pending(), comparison: { kind: 'opposed', tiePolicy: 'reroll-both-up-to-10-then-journaled-server-coin' } })).toThrow('opposed-requires-two-subjects')
    expect(() => assertSkillCheckDocumentInvariants({ ...pending(), journals: [{ journalId: 'skill-check-journal:v1:forged-roll', subjectId: pending().subjects[0]!.subjectId, attempt: 1, diceCount: 1, dieSides: 6, flatModifier: 0, contributors: [], results: [6], dieTotal: 6, finalTotal: 6, rolledAt: 1 }] })).toThrow('unaccepted-dice-evidence')
  })

  it('permits only monotone state transitions', () => {
    expect(SKILL_CHECK_STATE_TRANSITIONS.pending).toEqual(['pending', 'ready', 'cancelled', 'timed-out'])
    expect(SKILL_CHECK_STATE_TRANSITIONS.ready).toEqual(['accepted', 'cancelled', 'timed-out'])
    expect(SKILL_CHECK_STATE_TRANSITIONS.accepted).toEqual(['accepted'])
  })
})
