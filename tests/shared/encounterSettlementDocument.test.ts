import { describe, expect, it } from 'vitest'
import {
  createEncounterSettlementDocument,
  ENCOUNTER_SETTLEMENT_DOCUMENT_SCHEMA_VERSION,
  EncounterSettlementDocumentValidationError,
  parseEncounterSettlementDocument,
  type EncounterSettlementDocument,
} from '../../shared/encounterSettlement/document'

const authority = (kind = 'sheet', id = 'trainer-a', revision = 3) => ({ kind, id, revision })

const fullDocument = (): Record<string, any> => ({
  schemaVersion: 1,
  settlementId: 'encounter-settlement:v1:00000000000000000000000000000001',
  revision: 2,
  status: 'blocked',
  encounter: {
    encounterId: 'encounter-a',
    encounterRevision: 12,
    linkedMapSlug: 'arena-a',
    linkedMapRevision: 20,
    campaignMinute: 480,
  },
  participants: [{
    participantId: 'placement-a',
    sourceAuthority: authority('map', 'arena-a', 20),
    sheetKind: 'pokemon',
    sheetSlug: 'pokemon-a',
    sheetRevision: 7,
    sideId: 'heroes',
    ownerParticipantId: null,
    settlementRole: 'combatant',
    disposition: 'active',
  }],
  unresolvedGates: [{
    gateId: 'gate-a',
    kind: 'unallocated-reward',
    blocking: true,
    audience: 'gm',
    authorityRefs: [authority('encounter-document', 'encounter-a', 12)],
    participantIds: ['placement-a'],
    resolutionKinds: ['allocate', 'exclude'],
    openedAtSettlementRevision: 1,
  }],
  persistentConsequences: [{
    consequenceId: 'consequence-hp-a',
    participantId: 'placement-a',
    kind: 'hp',
    authority: authority('sheet', 'pokemon-a', 7),
    field: 'combat.currentHp',
    behavior: 'preserve',
    snapshot: { kind: 'integer', before: 3, after: 3 },
    state: 'applied',
    decisionId: null,
    receiptId: 'receipt-consequence-a',
  }],
  rewardPackage: {
    rewardPackageId: 'reward-package-a',
    status: 'ready',
    lines: [{
      rewardId: 'reward-xp-a',
      visibility: 'participant-owner',
      sourceAuthority: authority('encounter-document', 'encounter-a', 12),
      disposition: 'allocated',
      payload: { kind: 'experience', amount: 10 },
    }, {
      rewardId: 'reward-armor-a',
      visibility: 'gm',
      sourceAuthority: authority('encounter-document', 'encounter-a', 12),
      disposition: 'pending',
      payload: {
        kind: 'item',
        canonicalItemId: 'Light Armor',
        quantity: 1,
        serialized: true,
        definitionAuthority: authority('equipment-operation', 'reward-definition-a', 0),
      },
    }, {
      rewardId: 'reward-capture-a',
      visibility: 'destination-owner',
      sourceAuthority: authority('capture-operation', 'capture-operation-a', 0),
      disposition: 'pending',
      payload: {
        kind: 'capture',
        captureOperationId: 'capture-operation-a',
        pokemonSheetSlug: 'captured-pokemon-a',
      },
    }, {
      rewardId: 'reward-story-a',
      visibility: 'gm',
      sourceAuthority: authority('objective', 'objective-a', 1),
      disposition: 'excluded',
      payload: {
        kind: 'narrative',
        factId: 'fact-objective-a',
        note: 'The rival withdrew after the objective was completed.',
      },
    }],
  },
  allocations: [{
    allocationId: 'allocation-xp-a',
    rewardId: 'reward-xp-a',
    destination: { kind: 'participant', id: 'placement-a', revision: 2 },
    method: 'individual',
    amount: 10,
    weight: null,
    state: 'ready',
    decisionId: 'decision-allocation-a',
    receiptId: null,
  }],
  temporaryCleanup: [{
    cleanupId: 'cleanup-stages-a',
    kind: 'combat-stages',
    authority: authority('map', 'arena-a', 20),
    participantIds: ['placement-a'],
    sourceIds: ['placement-a:combat-stages'],
    behavior: 'require-decision',
    state: 'ready',
    decisionId: 'decision-cleanup-a',
    receiptId: null,
  }],
  decisions: [{
    decisionId: 'decision-allocation-a',
    kind: 'allocation',
    audience: 'participant-owner',
    status: 'accepted',
    subjects: [{ kind: 'allocation', id: 'allocation-xp-a' }],
    options: [{
      optionId: 'allocation-option-a',
      effect: 'destination',
      valueId: 'placement-a',
      authority: authority('sheet', 'pokemon-a', 7),
    }],
    selectedOptionId: 'allocation-option-a',
    decidedBy: { kind: 'profile', principalId: 'profile-a' },
    decidedAtCampaignMinute: 481,
  }, {
    decisionId: 'decision-cleanup-a',
    kind: 'cleanup',
    audience: 'gm',
    status: 'open',
    subjects: [{ kind: 'cleanup', id: 'cleanup-stages-a' }],
    options: [{ optionId: 'cleanup-option-reset', effect: 'transform', valueId: 'reset', authority: null }],
    selectedOptionId: null,
    decidedBy: null,
    decidedAtCampaignMinute: null,
  }],
  receipts: [{
    receiptId: 'receipt-consequence-a',
    kind: 'consequence',
    audience: 'participant-owner',
    operationId: 'settlement-preview-operation-a',
    result: 'accepted',
    subjects: [{ kind: 'consequence', id: 'consequence-hp-a' }],
    sourceReceiptId: null,
    acceptedAtCampaignMinute: 481,
  }],
  completion: {
    state: 'open',
    operationId: null,
    receiptId: null,
    completedEncounterRevision: null,
    completedAtCampaignMinute: null,
  },
  createdAtCampaignMinute: 480,
  updatedAtCampaignMinute: 481,
})

const expectInvalid = (value: unknown, path: string, message?: RegExp): void => {
  try {
    parseEncounterSettlementDocument(value)
    throw new Error('Expected settlement parsing to fail.')
  }
  catch (error) {
    expect(error).toBeInstanceOf(EncounterSettlementDocumentValidationError)
    expect((error as EncounterSettlementDocumentValidationError).path).toBe(path)
    if (message) expect((error as Error).message).toMatch(message)
  }
}

describe('Encounter settlement document v1', () => {
  it('creates one empty revision-zero orchestration document without copying encounter or sheet state', () => {
    const created = createEncounterSettlementDocument({
      settlementId: 'encounter-settlement:v1:00000000000000000000000000000002',
      rewardPackageId: 'reward-package-b',
      encounter: {
        encounterId: 'encounter-b',
        encounterRevision: 4,
        linkedMapSlug: 'arena-b',
        linkedMapRevision: 9,
        campaignMinute: 600,
      },
    })

    expect(created).toEqual({
      schemaVersion: ENCOUNTER_SETTLEMENT_DOCUMENT_SCHEMA_VERSION,
      settlementId: 'encounter-settlement:v1:00000000000000000000000000000002',
      revision: 0,
      status: 'draft',
      encounter: {
        encounterId: 'encounter-b', encounterRevision: 4, linkedMapSlug: 'arena-b', linkedMapRevision: 9, campaignMinute: 600,
      },
      participants: [],
      unresolvedGates: [],
      persistentConsequences: [],
      rewardPackage: { rewardPackageId: 'reward-package-b', status: 'draft', lines: [] },
      allocations: [],
      temporaryCleanup: [],
      decisions: [],
      receipts: [],
      completion: {
        state: 'open', operationId: null, receiptId: null,
        completedEncounterRevision: null, completedAtCampaignMinute: null,
      },
      createdAtCampaignMinute: 600,
      updatedAtCampaignMinute: 600,
    })
    expect(Object.isFrozen(created)).toBe(true)
    expect(Object.isFrozen(created.encounter)).toBe(true)
    expect(JSON.stringify(created)).not.toMatch(/currentHp|inventory|equipmentState|conditions/)
  })

  it('parses and deeply freezes authority-backed participants, gates, consequences, rewards, allocations, cleanup, decisions, and receipts', () => {
    const parsed = parseEncounterSettlementDocument(fullDocument())

    expect(parsed).toMatchObject({
      schemaVersion: 1,
      status: 'blocked',
      encounter: { encounterRevision: 12, linkedMapRevision: 20 },
      participants: [{ participantId: 'placement-a', sheetRevision: 7 }],
      unresolvedGates: [{ kind: 'unallocated-reward', blocking: true }],
      persistentConsequences: [{ kind: 'hp', behavior: 'preserve' }],
      rewardPackage: { status: 'ready' },
      allocations: [{ method: 'individual', amount: 10 }],
      temporaryCleanup: [{ kind: 'combat-stages', behavior: 'require-decision' }],
      decisions: [{ status: 'accepted' }, { status: 'open' }],
      receipts: [{ kind: 'consequence' }],
      completion: { state: 'open' },
    })
    expect(parsed.rewardPackage.lines.map(line => line.payload.kind)).toEqual([
      'experience', 'item', 'capture', 'narrative',
    ])
    expect(Object.isFrozen(parsed.rewardPackage.lines)).toBe(true)
    expect(Object.isFrozen(parsed.decisions[0]?.options)).toBe(true)
  })

  it('requires exact keys, plain JSON, bounded identities, and unique local rows', () => {
    expectInvalid({ ...fullDocument(), hiddenPatch: {} }, 'settlement', /must contain exactly/)

    const withGetter = fullDocument()
    Object.defineProperty(withGetter, 'status', { enumerable: true, get: () => 'blocked' })
    expectInvalid(withGetter, 'settlement.status', /enumerable data properties/)

    const duplicate = fullDocument()
    duplicate.participants.push({ ...duplicate.participants[0] })
    expectInvalid(duplicate, 'settlement.participants', /duplicate identities/)

    const badIdentity = fullDocument()
    badIdentity.participants[0].participantId = 'not a stable identity'
    expectInvalid(badIdentity, 'settlement.participants[0].participantId', /stable bounded identity/)
  })

  it('fails closed for dangling participants, rewards, decisions, receipts, and local subjects', () => {
    const owner = fullDocument()
    owner.participants[0].ownerParticipantId = 'missing-participant'
    expectInvalid(owner, 'settlement.participants[0].ownerParticipantId', /unknown participant/)

    const reward = fullDocument()
    reward.allocations[0].rewardId = 'missing-reward'
    expectInvalid(reward, 'settlement.allocations[0].rewardId', /unknown reward/)

    const decision = fullDocument()
    decision.allocations[0].decisionId = 'missing-decision'
    expectInvalid(decision, 'settlement.allocations[0].decisionId', /unknown decision/)

    const receipt = fullDocument()
    receipt.persistentConsequences[0].receiptId = 'missing-receipt'
    expectInvalid(receipt, 'settlement.persistentConsequences[0].receiptId', /unknown receipt/)

    const subject = fullDocument()
    subject.decisions[0].subjects[0].id = 'missing-allocation'
    expectInvalid(subject, 'settlement.decisions[0].subjects[0]', /unknown allocation/)

    const decisionSubject = fullDocument()
    decisionSubject.receipts[0].subjects = [{ kind: 'decision', id: 'missing-decision' }]
    expectInvalid(decisionSubject, 'settlement.receipts[0].subjects[0]', /unknown decision/)
  })

  it('retains decision and receipt evidence for a resolved gate without treating it as a current gate', () => {
    const value = fullDocument()
    value.decisions.push({
      decisionId: 'decision-gate-correction-a',
      kind: 'gm-correction',
      audience: 'gm',
      status: 'accepted',
      subjects: [{ kind: 'gate', id: 'gate-already-resolved-a' }],
      options: [{
        optionId: 'correct-gate-a',
        effect: 'correct',
        valueId: 'correct',
        authority: authority('encounter-document', 'encounter-a', 12),
      }],
      selectedOptionId: 'correct-gate-a',
      decidedBy: { kind: 'gm', principalId: 'gm-a' },
      decidedAtCampaignMinute: 481,
    })
    value.receipts.push({
      receiptId: 'receipt-gate-correction-a',
      kind: 'decision',
      audience: 'gm',
      operationId: 'gate-correction-operation-a',
      result: 'accepted',
      subjects: [
        { kind: 'decision', id: 'decision-gate-correction-a' },
        { kind: 'gate', id: 'gate-already-resolved-a' },
      ],
      sourceReceiptId: null,
      acceptedAtCampaignMinute: 481,
    })

    const parsed = parseEncounterSettlementDocument(value)
    expect(parsed.unresolvedGates.map(gate => gate.gateId)).not.toContain('gate-already-resolved-a')
    expect(parsed.receipts.at(-1)?.subjects).toContainEqual({ kind: 'decision', id: 'decision-gate-correction-a' })
  })

  it('enforces bounded decisions, consequence behavior, applied receipts, and whole serialized rewards', () => {
    const openDecision = fullDocument()
    openDecision.decisions[1].selectedOptionId = 'cleanup-option-reset'
    expectInvalid(openDecision, 'settlement.decisions[1]', /open decisions/)

    const acceptedDecision = fullDocument()
    acceptedDecision.decisions[0].selectedOptionId = 'missing-option'
    expectInvalid(acceptedDecision, 'settlement.decisions[0]', /accepted decisions/)

    const preserve = fullDocument()
    preserve.persistentConsequences[0].snapshot.after = 4
    expectInvalid(preserve, 'settlement.persistentConsequences[0].snapshot', /preserve behavior/)

    const decisionRequired = fullDocument()
    decisionRequired.temporaryCleanup[0].decisionId = null
    expectInvalid(decisionRequired, 'settlement.temporaryCleanup[0].decisionId', /require-decision/)

    const applied = fullDocument()
    applied.persistentConsequences[0].receiptId = null
    expectInvalid(applied, 'settlement.persistentConsequences[0].receiptId', /required after application/)

    const serialized = fullDocument()
    serialized.rewardPackage.lines[1].payload.quantity = 2
    expectInvalid(serialized, 'settlement.rewardPackage.lines[1].payload.quantity', /exactly one whole item/)

    const futureDecision = fullDocument()
    futureDecision.decisions[0].decidedAtCampaignMinute = 482
    expectInvalid(futureDecision, 'settlement.decisions[0].decidedAtCampaignMinute', /latest update minute/)

    const earlyReceipt = fullDocument()
    earlyReceipt.receipts[0].acceptedAtCampaignMinute = 479
    expectInvalid(earlyReceipt, 'settlement.receipts[0].acceptedAtCampaignMinute', /document creation/)
  })

  it('pairs terminal document status with one exact completion receipt and monotonic encounter evidence', () => {
    const terminal = fullDocument()
    terminal.status = 'completed'
    terminal.unresolvedGates = []
    terminal.receipts.push({
      receiptId: 'receipt-completion-a',
      kind: 'completion',
      audience: 'public',
      operationId: 'settlement-operation-a',
      result: 'accepted',
      subjects: [{ kind: 'settlement', id: terminal.settlementId }],
      sourceReceiptId: null,
      acceptedAtCampaignMinute: 482,
    })
    terminal.completion = {
      state: 'accepted',
      operationId: 'settlement-operation-a',
      receiptId: 'receipt-completion-a',
      completedEncounterRevision: 13,
      completedAtCampaignMinute: 482,
    }
    terminal.updatedAtCampaignMinute = 482

    const parsed = parseEncounterSettlementDocument(terminal)
    expect(parsed.completion).toEqual({
      state: 'accepted', operationId: 'settlement-operation-a', receiptId: 'receipt-completion-a',
      completedEncounterRevision: 13, completedAtCampaignMinute: 482,
    })

    const missingReceipt = structuredClone(terminal)
    missingReceipt.completion.receiptId = 'missing-completion-receipt'
    expectInvalid(missingReceipt, 'settlement.completion.receiptId', /exact completion receipt/)

    const wrongStatus = structuredClone(terminal)
    wrongStatus.status = 'ready'
    expectInvalid(wrongStatus, 'settlement.status', /must be completed/)

    const staleEncounter = structuredClone(terminal)
    staleEncounter.completion.completedEncounterRevision = 11
    expectInvalid(staleEncounter, 'settlement.completion.completedEncounterRevision', /cannot precede/)
  })

  it('rejects a terminal status without terminal evidence', () => {
    const value = fullDocument() as unknown as EncounterSettlementDocument & Record<string, unknown>
    ;(value as any).status = 'completed'
    expectInvalid(value, 'settlement.completion', /terminal document status/)
  })
})
