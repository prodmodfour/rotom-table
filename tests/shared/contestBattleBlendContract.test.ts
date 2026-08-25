import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import contract from '../../data/deferred-closure/battle-contest-blend-contract.v1.json'
import {
  BATTLE_CONTEST_BLEND_CONTRACT_ID,
  BATTLE_CONTEST_HANDOFF_KINDS,
  BattleContestBlendContractError,
  assertBattleContestEngineWriteBoundary,
  assertBattleContestHandoffHash,
  assertBattleContestRevisionCoupling,
  battleContestHandoffCanonicalJson,
  computeBattleContestHandoffSha256,
  decideBattleContestHandoffDelivery,
  parseBattleContestHandoffDelivery,
  parseBattleContestHandoffFact,
  parseBattleContestHandoffReceipt,
  parseBattleContestLink,
  type BattleContestAcceptedMoveHandoffFactV1,
  type BattleContestHandoffDeliveryV1,
  type BattleContestHandoffFactV1,
  type BattleContestLinkV1,
} from '../../shared/contests/battleBlend'
import { battleContestVariant } from '../../shared/contests/catalog'
import { acceptedSuccessorHead } from '../helpers/deferredClosureSuccessors'

const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const sourceHash = '1'.repeat(64)
const link: BattleContestLinkV1 = {
  schemaVersion: 1,
  linkId: 'battle-contest-link:v1:indigo-final',
  contestId: 'contest:v1:indigo-final',
  encounterId: 'encounter:indigo-final',
  linkedMapSlug: 'indigo-final-arena',
  contestRosterSha256: '2'.repeat(64),
  createdAt: 100,
}
const moveFact: BattleContestAcceptedMoveHandoffFactV1 = {
  schemaVersion: 1,
  handoffId: 'battle-contest-handoff:v1:move-001',
  linkId: link.linkId,
  sourceResultId: 'accepted-result:move-001',
  sourceResultSha256: sourceHash,
  occurredAt: 110,
  kind: 'accepted-move',
  payload: {
    completionEventId: 'event:move-001-completed',
    sourceOperationId: 'live-op:move-001',
    resolutionId: 'resolution:move-001',
    sceneId: 'scene:indigo-final',
    round: 1,
    completionOrder: 1,
    actorPlacementId: 'placement:maya-pikachu',
    canonicalMoveId: 'Thunderbolt',
    specVersion: 1,
    actionType: 'standard',
    sourceActionKind: 'pokemon-move',
    origin: { kind: 'direct' },
    moveListSource: { kind: 'placement', placementId: 'placement:maya-pikachu' },
    attackedTargetIds: ['placement:ren-eevee'],
    hitTargetIds: ['placement:ren-eevee'],
    outcome: 'hit',
    succeeded: true,
    branches: [],
    replacementAttention: null,
  },
}
const readSet = {
  schemaVersion: 1 as const,
  linkId: link.linkId,
  contestId: link.contestId,
  contestRevision: 7,
  encounterId: link.encounterId,
  encounterDocumentRevision: 3,
  linkedMapSlug: link.linkedMapSlug,
  encounterRevision: 18,
  encounterSceneId: 'scene:indigo-final',
}
const delivery = (handoffSha256 = digest(battleContestHandoffCanonicalJson(moveFact))): BattleContestHandoffDeliveryV1 => ({
  schemaVersion: 1,
  operationId: 'contest-op:v1:battle-handoff-01',
  readSet,
  fact: moveFact,
  handoffSha256,
})
const receipt = (handoffSha256 = delivery().handoffSha256) => ({
  handoffId: moveFact.handoffId,
  handoffSha256,
  sourceResultId: moveFact.sourceResultId,
  operationId: 'contest-op:v1:battle-handoff-01',
  contestRevisionBefore: 7,
  contestRevisionAfter: 8,
  encounterRevision: 18,
  outcome: 'scored-appeal' as const,
  appealId: 'appeal:battle-move-001',
  appliedAt: 111,
})

const facts = (): readonly BattleContestHandoffFactV1[] => [
  moveFact,
  {
    ...moveFact,
    handoffId: 'battle-contest-handoff:v1:knockout-001',
    sourceResultId: 'accepted-result:knockout-001',
    kind: 'knockout',
    payload: {
      eventId: 'event:knockout-001', sourceOperationId: 'live-op:move-001', sceneId: 'scene:indigo-final', round: 1,
      targetPlacementId: 'placement:ren-eevee', sourcePlacementId: 'placement:maya-pikachu', causalResolutionId: 'resolution:move-001', causalCanonicalId: 'Thunderbolt', cause: 'attack',
    },
  },
  {
    ...moveFact,
    handoffId: 'battle-contest-handoff:v1:switch-001',
    sourceResultId: 'accepted-result:switch-001',
    kind: 'switch',
    payload: {
      eventId: 'event:switch-001', sourceOperationId: 'live-op:switch-001', sceneId: 'scene:indigo-final', round: 1,
      switchKind: 'switch', recalledPlacementId: 'placement:maya-pikachu', sentOutPlacementId: 'placement:maya-vulpix',
      causalResolutionId: 'resolution:u-turn-001', causalCanonicalId: 'U-Turn', causalProviderId: null,
    },
  },
  {
    ...moveFact,
    handoffId: 'battle-contest-handoff:v1:turn-001',
    sourceResultId: 'accepted-result:turn-001',
    kind: 'turn-start',
    payload: {
      eventId: 'event:turn-001', sourceOperationId: 'live-op:turn-001', sceneId: 'scene:indigo-final', round: 2, turn: 7,
      actorPlacementId: 'placement:ren-vaporeon', replacementAfterKnockout: true, knockoutEventId: 'event:knockout-001',
    },
  },
  {
    ...moveFact,
    handoffId: 'battle-contest-handoff:v1:round-001',
    sourceResultId: 'accepted-result:round-001',
    kind: 'round-boundary',
    payload: {
      eventId: 'event:round-001', sourceOperationId: 'live-op:round-001', sceneId: 'scene:indigo-final', completedRound: 1, nextRound: 2,
    },
  },
  {
    ...moveFact,
    handoffId: 'battle-contest-handoff:v1:end-001',
    sourceResultId: 'accepted-result:end-001',
    kind: 'encounter-ended',
    payload: {
      eventId: 'event:end-001', sourceOperationId: 'live-op:end-001', sceneId: 'scene:indigo-final', round: 6,
      reason: 'completed', allKnockedOutSideIds: ['side:ren'],
    },
  },
]

describe('P11-065 reviewed Battle Contest blend contract', () => {
  it('binds the structured canonical row and all existing authorities by accepted source bytes', () => {
    expect(contract).toMatchObject({ schemaVersion: 1, contractId: BATTLE_CONTEST_BLEND_CONTRACT_ID, ticket: 'P11-065', status: 'reviewed', runtimeProseParsing: false })
    expect(contract.canonicalVariantAuthority).toMatchObject({ rowId: 'battle', completionState: 'structured', structuredSemanticsVersion: 1 })
    expect(acceptedSuccessorHead(contract.canonicalVariantAuthority.path, contract.canonicalVariantAuthority.sha256)).toBe(sha(contract.canonicalVariantAuthority.path))
    for (const authority of contract.existingAuthorities) {
      expect(acceptedSuccessorHead(authority.path, authority.sha256), authority.id).toBe(sha(authority.path))
    }
    expect(acceptedSuccessorHead(contract.sharedContract.path, contract.sharedContract.sha256)).toBe(sha(contract.sharedContract.path))
    expect(battleContestVariant.blendContract).toMatchObject({
      contractId: BATTLE_CONTEST_BLEND_CONTRACT_ID,
      handoffKinds: BATTLE_CONTEST_HANDOFF_KINDS,
      crossDocumentWrites: 'forbidden',
    })
  })

  it('strictly parses one immutable linkage identity and rejects relink-shaped fields', () => {
    expect(parseBattleContestLink(link)).toEqual(link)
    expect(() => parseBattleContestLink({ ...link, encounterId: 'encounter:other', priorEncounterId: link.encounterId }))
      .toThrowError(expect.objectContaining({ code: 'battle-contest.invalid-shape' }))
    expect(() => parseBattleContestLink({ ...link, linkId: 'link:untyped' }))
      .toThrowError(expect.objectContaining({ code: 'battle-contest.invalid-identity' }))
  })

  it('strictly parses all six server-derived handoff kinds and rejects extra authority', () => {
    expect(facts().map(fact => parseBattleContestHandoffFact(fact).kind)).toEqual(BATTLE_CONTEST_HANDOFF_KINDS)
    expect(() => parseBattleContestHandoffFact({ ...moveFact, clientRolls: [6] }))
      .toThrowError(expect.objectContaining({ code: 'battle-contest.invalid-shape' }))
    expect(() => parseBattleContestHandoffFact({
      ...moveFact,
      payload: { ...moveFact.payload, sourceActionKind: 'client-move' },
    })).toThrowError(expect.objectContaining({ code: 'battle-contest.invalid-shape' }))
    expect(() => parseBattleContestHandoffFact({
      ...moveFact,
      payload: { ...moveFact.payload, outcome: 'miss', hitTargetIds: ['placement:ren-eevee'] },
    })).toThrowError(expect.objectContaining({ code: 'battle-contest.invalid-shape' }))
    const replacementFact = {
      ...moveFact,
      payload: { ...moveFact.payload, replacementAttention: {
        knockoutEventId: 'event:knockout-001',
        replacementEventId: 'event:replacement-001',
        turnStartEventId: 'event:turn-001',
        encounterTurn: 7,
      } },
    }
    expect(parseBattleContestHandoffFact(replacementFact)).toMatchObject(replacementFact)
    expect(() => parseBattleContestHandoffFact({
      ...replacementFact,
      payload: { ...replacementFact.payload, replacementAttention: { ...replacementFact.payload.replacementAttention, clientClaim: true } },
    })).toThrowError(expect.objectContaining({ code: 'battle-contest.invalid-shape' }))
  })

  it('hashes only canonical immutable fact material and verifies delivery evidence', async () => {
    const expected = digest(battleContestHandoffCanonicalJson(moveFact))
    expect(await computeBattleContestHandoffSha256(moveFact)).toBe(expected)
    expect(parseBattleContestHandoffDelivery(delivery(expected)).handoffSha256).toBe(expected)
    await expect(assertBattleContestHandoffHash(delivery(expected))).resolves.toBeUndefined()
    await expect(assertBattleContestHandoffHash(delivery('f'.repeat(64))))
      .rejects.toMatchObject({ code: 'battle-contest.invalid-hash' })
    const refreshed = { ...delivery(expected), readSet: { ...readSet, encounterRevision: 19 } }
    expect(refreshed.handoffSha256).toBe(expected)
  })

  it('couples Contest, EncounterDocument, map, and Scene revisions with zero-write conflict codes', () => {
    const current = {
      contestId: link.contestId, contestRevision: 7, encounterId: link.encounterId, encounterDocumentRevision: 3,
      linkedMapSlug: link.linkedMapSlug, encounterRevision: 18, encounterSceneId: 'scene:indigo-final',
    }
    expect(() => assertBattleContestRevisionCoupling(delivery(), link, current)).not.toThrow()
    const staleCases = [
      [{ ...current, contestRevision: 8 }, 'battle-contest.contest-revision-stale'],
      [{ ...current, encounterDocumentRevision: 4 }, 'battle-contest.encounter-document-revision-stale'],
      [{ ...current, encounterRevision: 19 }, 'battle-contest.encounter-revision-stale'],
      [{ ...current, encounterSceneId: 'scene:next' }, 'battle-contest.encounter-scene-stale'],
    ] as const
    for (const [candidate, code] of staleCases) {
      try { assertBattleContestRevisionCoupling(delivery(), link, candidate) }
      catch (error) { expect(error).toBeInstanceOf(BattleContestBlendContractError); expect((error as BattleContestBlendContractError).code).toBe(code); continue }
      throw new Error(`Expected ${code}`)
    }
  })

  it('returns one exact receipt on duplicate delivery and rejects identity/hash divergence', () => {
    const accepted = parseBattleContestHandoffReceipt(receipt())
    expect(decideBattleContestHandoffDelivery([], delivery())).toEqual({ kind: 'apply' })
    expect(decideBattleContestHandoffDelivery([accepted], delivery())).toEqual({ kind: 'exact-retry', receipt: accepted })
    expect(() => decideBattleContestHandoffDelivery([accepted], delivery('e'.repeat(64))))
      .toThrowError(expect.objectContaining({ code: 'battle-contest.handoff-conflict' }))
    expect(() => parseBattleContestHandoffReceipt({ ...receipt(), contestRevisionAfter: 9 }))
      .toThrowError(expect.objectContaining({ code: 'battle-contest.invalid-shape' }))
  })

  it('forbids each engine from writing the other engine or coordinator documents', () => {
    expect(() => assertBattleContestEngineWriteBoundary({ owner: 'contest-engine', writes: ['contest-document', 'contest-operation'] })).not.toThrow()
    expect(() => assertBattleContestEngineWriteBoundary({ owner: 'encounter-engine', writes: ['encounter-document', 'encounter-map', 'live-play-operation'] })).not.toThrow()
    expect(() => assertBattleContestEngineWriteBoundary({ owner: 'blend-coordinator', writes: ['blend-link'] })).not.toThrow()
    for (const plan of [
      { owner: 'contest-engine' as const, writes: ['encounter-map'] as const },
      { owner: 'encounter-engine' as const, writes: ['contest-document'] as const },
      { owner: 'blend-coordinator' as const, writes: ['contest-document'] as const },
    ]) {
      expect(() => assertBattleContestEngineWriteBoundary(plan))
        .toThrowError(expect.objectContaining({ code: 'battle-contest.cross-document-write' }))
    }
    expect(contract.atomicity.acceptedMoveToAppeal).toEqual([
      'encounter-engine-commits-move-and-resources-first',
      'blend-coordinator-derives-and-revalidates-fact',
      'contest-engine-commits-score-dice-journal-receipt-operation-and-realtime-atomically',
    ])
    expect(contract.nonGoals).toEqual(expect.arrayContaining(['parallel-combat-engine', 'parallel-contest-dice-engine', 'cross-document-engine-writes']))
  })
})
