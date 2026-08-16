import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'
import items from '~~/data/reference/items.json'
import rules from '~~/data/reference/rules.json'
import specs from '~~/data/complete-play-loop/specs.v1.json'
import contract from '~~/data/complete-play-loop/medical-extended-actions.v1.json'
import equipmentDefinitions from '~~/data/complete-play-loop/equipment-definitions.v1.json'

const sha = (value: string): string => createHash('sha256').update(value).digest('hex')

describe('P8-052 medical Extended Action contract', () => {
  it('binds First Aid Kit identity and effects to canonical reviewed data', () => {
    const canonical = items['First Aid Kit']
    const reviewed = specs.specs.find(row => row.canonicalId === 'First Aid Kit')!
    expect(contract).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-052',
      status: 'reviewed-native-with-guided-deferral',
      catalogSha256: sha(readFileSync('data/reference/items.json')),
      firstAidKit: {
        canonicalId: 'First Aid Kit',
        canonicalRecordSha256: sha(stableJsonStringify(canonical)),
        canonicalEffectSha256: reviewed.effectSha256,
        skill: { id: 'medicineEd', dieSides: 6, serverRollOnly: true },
        ap: { mode: 'drain', amount: 1, recovery: 'extended-rest', applyAt: 'completion' },
        healing: { cap: 'injury-adjusted-effective-maximum-hp', faintedState: 'preserve' },
        conditionIds: ['Burned', 'Poisoned', 'Badly Poisoned', 'Paralysis'],
        source: { reusable: true, quantityConsumed: 0, exactRowStillRevalidated: true },
      },
    })
  })

  it('binds Bandages timing and fail-closed Poultice loyalty authority to canonical records', () => {
    const reviewed = specs.specs.find(row => row.canonicalId === 'Bandages')!
    expect(contract.bandages).toMatchObject({
      canonicalId: 'Bandages',
      canonicalRecordSha256: sha(stableJsonStringify(items.Bandages)),
      canonicalEffectSha256: reviewed.effectSha256,
      naturalHealingRecordSha256: sha(stableJsonStringify(rules.Resting)),
      application: { timing: 'extended', consumeAt: 'completion', quantity: 1 },
      durationMinutes: 360,
      tickMinutes: 30,
      healing: { numerator: 1, denominator: 8, blockedAtInjuries: 5 },
      completion: { injuriesRemoved: 1, obeyDailyInjuryLimit: true },
      interruption: { trigger: 'authoritative-hp-loss' },
      stacking: 'one-active-treatment-per-target',
    })
    expect(contract.poultices).toMatchObject({
      canonicalId: 'Poultices',
      canonicalRecordSha256: sha(stableJsonStringify(items.Poultices)),
      canonicalEffectSha256: sha(items.Poultices.effects.join('\n')),
      sharesBandageTreatment: true,
      nativeExecution: false,
      reason: expect.stringContaining('P8-059'),
    })
  })

  it('binds native Wonder Launcher delivery and defers Re-Breather only for missing environmental authority', () => {
    const launcherDefinition = equipmentDefinitions.definitions.find(row => row.canonicalItemId === 'Wonder Launcher')!
    const reBreatherDefinition = equipmentDefinitions.definitions.find(row => row.canonicalItemId === 'Re-Breather')!
    expect(contract.equipmentActions.wonderLauncher).toMatchObject({
      canonicalRecordSha256: sha(stableJsonStringify(items['Wonder Launcher'])),
      equipmentDefinitionSha256: sha(stableJsonStringify(launcherDefinition)),
      actionId: 'equipment.wonder-launcher.apply',
      executionStatus: 'native',
      costs: { standardActions: 1, apDrain: 1, apRecovery: 'extended-rest', xItemQuantity: 1 },
      target: { kind: 'pokemon', rangeMeters: 8, forfeitNextActions: false },
      sourceBinding: 'opaque exact equipped-source digest',
    })
    expect(contract.equipmentActions.reBreather).toMatchObject({
      canonicalRecordSha256: sha(stableJsonStringify(items['Re-Breather'])),
      equipmentDefinitionSha256: sha(stableJsonStringify(reBreatherDefinition)),
      executionStatus: 'deferred', deferredTicket: 'P8-059',
      reason: expect.stringContaining('open-air'),
    })
  })

  it('records durable start, progress, completion, interruption, replay, privacy, and implementation evidence', () => {
    expect(contract.activities).toMatchObject({
      statuses: ['in-progress', 'completed', 'interrupted'],
      oneActivePerTrainer: true,
      oneActivePerSource: true,
      startRevision: 0,
      terminalRevisionIncrement: 1,
      campaignTime: { minimumDuration: null, clientTimeForbidden: true },
    })
    expect(contract.boundaries).toMatchObject({
      start: expect.stringContaining('without rolling'),
      progress: expect.stringContaining('durable in-progress'),
      complete: expect.stringContaining('one SQLite transaction'),
      interrupt: expect.stringContaining('no item operation'),
      retry: expect.stringContaining('never rerolls'),
      conflict: expect.stringContaining('safely in progress'),
    })
    expect(contract.privacy.projectionForbids).toEqual(expect.arrayContaining([
      'source row ID', 'canonical hashes', 'profile ID', 'raw command', 'roll before completion',
    ]))
    expect(contract.certification).toMatchObject({
      focusedItemAndExtendedActionSuite: {
        files: 49, tests: 315, workers: 1, fileParallelism: false, result: 'passed',
      },
      liveplayProductionBuild: {
        projects: ['chromium', 'mobile-chromium'], journeysPerProject: 2, tests: 4, result: 'passed',
        covers: expect.arrayContaining([
          'start-mechanical-inertness', 'reconnect-and-resume-projection', 'stale-activity-conflict',
          'safe-interruption', 'accepted-completion', 'Bandages-private-evidence-redaction',
          'desktop-and-mobile-reflow', 'axe-accessibility',
        ]),
      },
      gates: {
        nuxtTypecheck: 'passed', focusedEslint: 'passed', gitDiffCheck: 'passed',
        generatedItemInventoryCheck: 'passed',
      },
      manualStorageRepairRequired: false,
    })
    for (const path of [
      contract.implementation.sharedContract,
      contract.implementation.repository,
      contract.implementation.useCase,
      contract.implementation.projection,
      contract.implementation.medicalStateContract,
      contract.implementation.medicalLifecycle,
      contract.implementation.campaignClockSettlement,
      contract.implementation.equipmentDelivery,
      ...contract.implementation.api,
      ...contract.implementation.client,
      ...contract.implementation.mockups,
      ...contract.implementation.tests,
    ]) expect(readFileSync(path).byteLength).toBeGreaterThan(0)
  })
})
