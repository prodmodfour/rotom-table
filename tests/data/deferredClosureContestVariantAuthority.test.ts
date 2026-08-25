import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import contests from '../../data/reference/contests.json'
import manifest from '../../scripts/reviewed-data/deferred-closure-contest-variants.v1.json'
import acceptance from '../../data/contests/alpha-acceptance.v1.json'
import { contestParticipantVariantIsNative, contestVariantAllowsSetup, contestVariantIsNative } from '../../shared/contests/catalog'
import { acceptedSuccessorHead } from '../helpers/deferredClosureSuccessors'

const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const variants = new Map((contests as any).variants.map((variant: any) => [variant.id, variant]))

describe('P11-006 reviewed Contest variant successor', () => {
  it('is one exact source-hash-bound successor of the frozen Plan 10 catalog', () => {
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      migrationId: 'deferred-closure:contest-variants:v1',
      ticket: 'P11-006',
      status: 'reviewed',
      changedVariantIds: ['trainer-participant', 'battle'],
      target: {
        beforeSha256: 'fadb03c328f2025dcc81fe497365db345717184bea6a9247b2f79d9d3f61362a',
        afterSha256: '95bf5976d349f8e4e9a5075f44bb22008156013e005ccdcec9d2b44240a5ac2e',
      },
    })
    expect(acceptance.sourceEvidence.find(row => row.path === 'data/reference/contests.json')?.sha256)
      .toBe(manifest.target.beforeSha256)
    expect(acceptedSuccessorHead(manifest.target.path, manifest.target.afterSha256)).toBe(sha(manifest.target.path))
    for (const source of manifest.sources) expect(sha(source.path), source.path).toBe(source.sha256)
    expect((contests as any).reviewedSuccessors).toEqual([expect.objectContaining({
      migrationId: manifest.migrationId,
      ticket: 'P11-006',
      beforeSha256: manifest.target.beforeSha256,
      changedVariantIds: manifest.changedVariantIds,
      runtimeProseParsing: false,
    })])
  })

  it('records both Trainer Participant methods and shared-pool authority', () => {
    const variant = variants.get('trainer-participant') as any
    expect(variant).toMatchObject({
      completionState: 'native',
      compatibleBaseVariantIds: ['standard', 'supercontest', 'festival', 'rotation'],
      contestantMinimum: 3,
      contestantMaximum: 5,
      performerPolicy: {
        performersPerEntry: ['trainer', 'pokemon'],
        trainerMayAppeal: true,
        missingContestIdentityPolicy: 'reject',
      },
      sharedContestDicePool: {
        scope: 'trainer-pokemon-entry',
        depletionScope: 'contest',
        singleSpendRequired: true,
      },
    })
    expect(variant.methods).toEqual([
      expect.objectContaining({ id: 'simultaneous', appealsPerEntryPerRound: 2, appealOrderPolicy: 'controller-chooses-trainer-or-pokemon-first', voltageScope: 'per-performer' }),
      expect.objectContaining({ id: 'alternating', appealsPerEntryPerRound: 1, appealOrderPolicy: 'trainer-and-pokemon-alternate', voltageScope: 'shared-entry' }),
    ])
  })

  it('records Battle Contest scale, appeal, voltage, replacement, and end policies', () => {
    expect(variants.get('battle')).toMatchObject({
      completionState: 'native',
      trainerCount: 2,
      rosterPolicy: {
        pokemonPerTrainerMinimum: 3,
        pokemonPerTrainerMaximum: 6,
        equalDeclaredCountRequired: true,
      },
      roundBudget: { formula: 'twice-pokemon-per-trainer', minimum: 6, maximum: 12 },
      contestTypePolicy: 'fixed-selected-at-setup',
      introductionPolicy: { skillCheckPerTrainer: 1, contestDicePoolScope: 'trainer-team', affectsInitiative: false },
      encounterPolicy: {
        turnOrder: 'encounter-initiative',
        appealSource: 'accepted-move-result',
        excludedActions: ['struggle-attack', 'combat-maneuver'],
        contestAdjacency: 'all-opposing-pokemon-on-field',
      },
      voltagePolicy: {
        scope: 'per-pokemon',
        appealUses: 'active-pokemon-only',
        attackKoDelta: 2,
        damageOverTimeKoRecipient: 'opposing-active-pokemon',
        recallDelta: -2,
        recallLossExceptions: ['Baton Pass', 'U-Turn', 'Volt Switch', 'Juggler-equivalent-switch'],
      },
      replacementPolicy: { afterKo: 'center-of-attention-first-acting-turn' },
      endPolicy: {
        conditions: ['round-budget-exhausted', 'one-trainer-all-pokemon-knocked-out'],
        score: 'appeal-points',
        winner: 'highest-appeal-points',
      },
    })
  })

  it('keeps base-variant and participant-variant native predicates structurally distinct', () => {
    expect(contestVariantIsNative('trainer-participant')).toBe(false)
    expect(contestParticipantVariantIsNative('trainer-participant')).toBe(true)
    expect(contestParticipantVariantIsNative('battle')).toBe(false)
    expect(contestVariantIsNative('battle')).toBe(true)
    expect(contestVariantAllowsSetup('battle')).toBe(true)
    for (const id of manifest.changedVariantIds) {
      const serialized = JSON.stringify(variants.get(id)).toLowerCase()
      expect(serialized).not.toContain('safe reason')
      expect(serialized).not.toContain('defer')
      expect(serialized).not.toContain('reference-only')
    }
  })
})
