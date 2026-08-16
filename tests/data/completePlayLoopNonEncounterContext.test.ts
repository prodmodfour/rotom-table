import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const contract = JSON.parse(readFileSync(
  new URL('../../data/complete-play-loop/non-encounter-item-context.v1.json', import.meta.url),
  'utf8',
)) as Record<string, any>

describe('complete-play-loop non-encounter item context contract', () => {
  it('binds every non-encounter surface to server-owned campaign, ownership, activity, and confirmation evidence', () => {
    expect(contract).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-051',
      catalogSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      contexts: ['sheet', 'campaign', 'workshop', 'extended-action'],
      authority: { serverAuthored: true, activeEncounterRequired: false, exactReadSetRequired: true },
      campaignTime: {
        requiredForEveryNonEncounterOperation: true,
        commitRevalidation: true,
        immutablePlanEvidence: true,
      },
      targetOwnership: { ambiguousRosterOwnershipPolicy: 'fail-closed' },
      extendedActions: {
        modes: ['immediate', 'extended'],
        phases: ['declaration', 'in-progress', 'completion'],
      },
      gmConfirmation: { privateNotesInRuntimeEvidence: false },
      operationReuse: {
        itemSpecs: true, eligibility: true, deterministicPlanning: true,
        atomicReduction: true, receipts: true, exactReplay: true, correction: true, realtime: true,
      },
      privacy: {
        publicProjectionMayContainOwnerSlugs: false,
        profileIdsInContextEvidence: false,
        sourceRowsInPublicProjection: false,
      },
    })
    expect(contract.failClosed).toEqual(expect.arrayContaining([
      'missing campaign clock read',
      'ambiguous roster ownership',
      'unowned player target',
      'missing extended-action completion authority',
      'missing GM confirmation',
    ]))
  })
})
