import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import activationManifest from '../../scripts/reviewed-data/deferred-closure-battle-contest-activation.v1.json'
import contests from '../../data/reference/contests.json'
import ordinaryFixtures from '../../data/contests/variant-matrix.v1.json'
import participantFixtures from '../../data/contests/trainer-participant-variant-matrix.v1.json'
import battleFixtures from '../../data/contests/battle-contest-scenarios.v1.json'
import blend from '../../data/deferred-closure/battle-contest-blend-certification.v1.json'
import setup from '../../data/deferred-closure/battle-contest-setup-certification.v1.json'
import introductions from '../../data/deferred-closure/battle-contest-introductions-certification.v1.json'
import encounterLink from '../../data/deferred-closure/battle-contest-encounter-link-certification.v1.json'
import appeals from '../../data/deferred-closure/battle-contest-accepted-move-appeals-certification.v1.json'
import effects from '../../data/deferred-closure/battle-contest-effects-certification.v1.json'
import pokemonVoltage from '../../data/deferred-closure/battle-contest-pokemon-voltage-certification.v1.json'
import voltageLifecycle from '../../data/deferred-closure/battle-contest-voltage-lifecycle-certification.v1.json'
import replacementAttention from '../../data/deferred-closure/battle-contest-replacement-attention-certification.v1.json'
import endings from '../../data/deferred-closure/battle-contest-end-conditions-certification.v1.json'
import singleSpend from '../../data/deferred-closure/battle-contest-single-spend-certification.v1.json'
import recovery from '../../data/deferred-closure/battle-contest-recovery-certification.v1.json'
import settlement from '../../data/deferred-closure/battle-contest-settlement-certification.v1.json'
import liveplay from '../../data/deferred-closure/battle-contest-liveplay-certification.v1.json'
import fixtures from '../../data/deferred-closure/battle-contest-fixtures-certification.v1.json'
import certification from '../../data/deferred-closure/battle-contest-activation-certification.v1.json'
import {
  battleContestVariant,
  contestVariantAllowsSetup,
  contestVariantIsNative,
} from '../../shared/contests/catalog'
import { acceptedSuccessorHead, repositoryFileSha256 } from '../helpers/deferredClosureSuccessors'

interface CertificateLike {
  readonly ticket: string
  readonly schemaVersion: number
  readonly status: string
  readonly runtimeProseParsing: boolean
  readonly predecessor: { readonly path: string, readonly sha256: string }
}

const cohorts: readonly { path: string, certificate: CertificateLike }[] = [
  { path: 'data/deferred-closure/battle-contest-blend-certification.v1.json', certificate: blend },
  { path: 'data/deferred-closure/battle-contest-setup-certification.v1.json', certificate: setup },
  { path: 'data/deferred-closure/battle-contest-introductions-certification.v1.json', certificate: introductions },
  { path: 'data/deferred-closure/battle-contest-encounter-link-certification.v1.json', certificate: encounterLink },
  { path: 'data/deferred-closure/battle-contest-accepted-move-appeals-certification.v1.json', certificate: appeals },
  { path: 'data/deferred-closure/battle-contest-effects-certification.v1.json', certificate: effects },
  { path: 'data/deferred-closure/battle-contest-pokemon-voltage-certification.v1.json', certificate: pokemonVoltage },
  { path: 'data/deferred-closure/battle-contest-voltage-lifecycle-certification.v1.json', certificate: voltageLifecycle },
  { path: 'data/deferred-closure/battle-contest-replacement-attention-certification.v1.json', certificate: replacementAttention },
  { path: 'data/deferred-closure/battle-contest-end-conditions-certification.v1.json', certificate: endings },
  { path: 'data/deferred-closure/battle-contest-single-spend-certification.v1.json', certificate: singleSpend },
  { path: 'data/deferred-closure/battle-contest-recovery-certification.v1.json', certificate: recovery },
  { path: 'data/deferred-closure/battle-contest-settlement-certification.v1.json', certificate: settlement },
  { path: 'data/deferred-closure/battle-contest-liveplay-certification.v1.json', certificate: liveplay },
  { path: 'data/deferred-closure/battle-contest-fixtures-certification.v1.json', certificate: fixtures },
]

const verifyBound = (row: { path: string, sha256: string }): void => {
  expect(acceptedSuccessorHead(row.path, row.sha256), row.path).toBe(repositoryFileSha256(row.path))
}

describe('P11-065 through P11-080 native Battle Contest certification', () => {
  it('retains one exact, ordered, source-bound cohort chain', () => {
    expect(cohorts.map(row => row.certificate.ticket)).toEqual(Array.from({ length: 15 }, (_, index) => `P11-${String(65 + index).padStart(3, '0')}`))
    expect(cohorts.every(row => row.certificate.schemaVersion === 1 && row.certificate.status === 'certified' && row.certificate.runtimeProseParsing === false)).toBe(true)
    expect(cohorts[0]!.certificate.predecessor).toEqual({
      path: 'data/deferred-closure/trainer-participant-activation-certification.v1.json',
      sha256: repositoryFileSha256('data/deferred-closure/trainer-participant-activation-certification.v1.json'),
    })
    for (let index = 1; index < cohorts.length; index += 1) {
      expect(cohorts[index]!.certificate.predecessor).toEqual({
        path: cohorts[index - 1]!.path,
        sha256: repositoryFileSha256(cohorts[index - 1]!.path),
      })
    }
    expect(certification.predecessor).toEqual({
      path: cohorts.at(-1)!.path,
      sha256: repositoryFileSha256(cohorts.at(-1)!.path),
    })
    expect(certification.cohortCertifications).toEqual(cohorts.map(row => ({
      ticket: row.certificate.ticket,
      path: row.path,
      sha256: repositoryFileSha256(row.path),
    })))
  })

  it('activates only the reviewed canonical row and removes the temporary structured setup exception', () => {
    expect(activationManifest).toMatchObject({
      schemaVersion: 1,
      migrationId: 'deferred-closure:battle-contest-native-activation:v1',
      ticket: 'P11-080',
      status: 'reviewed',
      runtimeProseParsing: false,
      changedVariantIds: ['battle'],
      changedStableRows: ['variants.battle.completionState'],
      activationPolicy: {
        beforeCompletionState: 'structured',
        afterCompletionState: 'native',
        requiredTicketRange: ['P11-065', 'P11-080'],
        parallelMechanicsEngines: 0,
      },
    })
    for (const source of activationManifest.sources) expect(repositoryFileSha256(source.path), source.path).toBe(source.sha256)
    expect(repositoryFileSha256(activationManifest.target.path)).toBe(activationManifest.target.afterSha256)
    expect(activationManifest.target.beforeSha256).toBe('d58fa7cf9ffda19f73af37a805faf4ff0ed79023bb411ecdb9bf295e89016972')

    const row = contests.variants.find(candidate => candidate.id === 'battle')!
    expect(row).toMatchObject({ completionState: 'native', structuredSemanticsVersion: 1, trainerCount: 2 })
    expect(battleContestVariant.completionState).toBe('native')
    expect(contestVariantIsNative('battle')).toBe(true)
    expect(contestVariantAllowsSetup('battle')).toBe(true)
    const catalogSource = readFileSync('shared/contests/catalog.ts', 'utf8')
    const workshopSource = readFileSync('src/pages/contests/index.vue', 'utf8')
    expect(catalogSource).not.toContain("battleContestVariant.completionState === 'structured'")
    expect(workshopSource).not.toContain("row.id === 'battle'")
  })

  it('certifies all fixture families and deterministic minimum/maximum Battle outcomes', () => {
    expect(ordinaryFixtures.scenarios).toHaveLength(18)
    expect(participantFixtures.scenarios).toHaveLength(24)
    expect(battleFixtures.scenarios).toHaveLength(4)
    for (const source of [...ordinaryFixtures.sources, ...participantFixtures.sources, ...battleFixtures.sources]) verifyBound(source)
    expect(new Set(battleFixtures.scenarios.map(row => row.rosterSize))).toEqual(new Set([3, 6]))
    expect(new Set(battleFixtures.scenarios.map(row => row.expected.terminalCondition))).toEqual(new Set([
      'round-budget-exhausted',
      'one-trainer-all-pokemon-knocked-out',
    ]))
    expect(battleFixtures.scenarios.every(row => row.expected.receiptsByOutcome['contest-ended'] === 1)).toBe(true)
  })

  it('aggregates structural privacy, realtime multi-client convergence, performance, and exact retries across both engines', () => {
    expect(liveplay.acceptance).toMatchObject({
      gmVisibleTeamPools: 2,
      actingOwnerVisibleTeamPools: 1,
      publicVisibleTeamPools: 0,
      ownerOpponentTeamPools: 0,
      publicPrivateAuthorityFields: 0,
      ordinaryEncounterCommandsWhilePending: 0,
      exactRetryAdditionalRolls: 0,
      exactRetryAdditionalContestDiceSpent: 0,
      exactRetryAdditionalAppeals: 0,
      exactRetryAdditionalContestRevisions: 0,
      exactRetryAdditionalRealtimeRows: 0,
      joinedProjectionSamplesWithinBudget: 100,
      joinedProjectionBudgetMilliseconds: 250,
      productionLiveplayJourneys: 1,
      seriousOrCriticalAxeViolations: 0,
    })
    expect(liveplay.liveplayEvidence).toMatchObject({
      mode: 'production-liveplay',
      status: 'passed',
      publicPrivateAuthorityLeaks: 0,
    })
    expect(singleSpend.acceptance).toMatchObject({
      encounterOperationCountPerMove: 1,
      contestAppealsPerPokemonMove: 1,
      duplicateDeliveryAdditionalRandomDraws: 0,
      reconnectAdditionalRandomDraws: 0,
      encounterWritesFromContestEngine: 0,
      contestWritesFromEncounterEngine: 0,
    })
    expect(recovery.acceptance).toMatchObject({
      recoveryReceiptCopies: 2,
      randomDrawsPerRecovery: 0,
      interruptedCommitContestWrites: 0,
      interruptedCommitEncounterWrites: 0,
      directRepairAllowed: false,
    })
    expect(settlement.acceptance).toMatchObject({
      settlementEnginesReused: 2,
      newSettlementEngines: 0,
      combinedSqliteTransactions: 1,
      exactRetryAdditionalRewardApplications: 0,
      exactRetryAdditionalConsequenceApplications: 0,
      exactRetryAdditionalRealtimeRows: 0,
      publicCombinedAuthorityFields: 0,
    })
  })

  it('hash-binds final authority/evidence and records native acceptance with no parallel engine', () => {
    expect(certification).toMatchObject({ schemaVersion: 1, ticket: 'P11-080', status: 'certified', runtimeProseParsing: false })
    verifyBound(certification.canonicalVariantAuthority)
    verifyBound(certification.reviewedMigration)
    for (const authority of certification.authorities) verifyBound(authority)
    for (const evidence of certification.evidence) verifyBound(evidence)
    expect(certification.acceptance).toEqual({
      completionState: 'native',
      certifiedTicketRange: ['P11-065', 'P11-080'],
      cohortCertifications: 16,
      deterministicScenarios: 46,
      battleDeterministicScenarios: 4,
      trainerTeams: 2,
      rosterSizes: [3, 6],
      productionLiveplayJourneys: 1,
      multiClientRoles: ['gm', 'acting-owner', 'opposing-owner', 'spectator'],
      publicPrivateAuthorityFields: 0,
      seriousOrCriticalAxeViolations: 0,
      joinedProjectionSamplesWithinBudget: 100,
      joinedProjectionBudgetMilliseconds: 250,
      exactRetryAdditionalEncounterEffects: 0,
      exactRetryAdditionalContestEffects: 0,
      exactRetryAdditionalRewards: 0,
      parallelMechanicsEngines: 0,
      blockedCanonicalRows: 0,
      runtimeProseParsing: false,
      nextTicket: 'P11-081',
    })
  })
})
