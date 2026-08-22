import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import itemsJson from '~~/data/reference/items.json'
import auditJson from '~~/data/complete-play-loop/audit.v1.json'
import inventoryJson from '~~/data/complete-play-loop/item-inventory.v1.json'
import inventoryAuthorityJson from '~~/data/complete-play-loop/inventory-authority.v1.json'
import equipmentAuditJson from '~~/data/complete-play-loop/equipment-audit.v1.json'
import settlementMatrixJson from '~~/data/complete-play-loop/settlement-gap-matrix.v1.json'
import remediationJson from '~~/data/complete-play-loop/canonical-data-remediation.v1.json'
import rubricJson from '~~/data/complete-play-loop/completion-rubric.v1.json'
import uxJson from '~~/data/complete-play-loop/ux-success-criteria.v1.json'
import itemFixturesJson from '~~/data/complete-play-loop/fixtures/items.v1.json'
import settlementFixturesJson from '~~/data/complete-play-loop/fixtures/settlements.v1.json'
import specsJson from '~~/data/complete-play-loop/specs.v1.json'
import durationAuthorityJson from '~~/data/complete-play-loop/duration-authority.v1.json'
import itemContractJson from '~~/data/complete-play-loop/item-contract.v1.json'
import { stableJsonStringify } from '#shared/automation/stableJson'

const CATALOG_SHA256 = '842256900ab540c7cdb22c1663d8bb7c89966b8d225cff1a1c5f175ae1e915ef'
const BLACK_SLUDGE_MIGRATION_CATALOG_SHA256 = '62b29a499c791d689f6efc99e04ed515a71336421352626749cf6cc7407982c8'
const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')

interface InventoryRow {
  readonly canonicalId: string
  readonly recordSha256: string
  readonly effectSha256: string
  readonly aliases: readonly string[]
  readonly categories: readonly string[]
  readonly sections: readonly string[]
  readonly behaviorInventory: {
    readonly mechanicalRole: string
    readonly contexts: readonly string[]
    readonly timing: string
    readonly targets: readonly string[]
    readonly actionCost: { readonly kind: string; readonly amount: number; readonly canonicalAcquisitionCostLabels: readonly string[] }
    readonly consumption: { readonly phase: string; readonly quantity: number; readonly reusable: boolean }
    readonly duration: string
    readonly currentProductSupport: { readonly state: string; readonly authorities: readonly string[]; readonly gaps: readonly string[] }
    readonly canonicalDataDefects: readonly { readonly field: string; readonly runtimePolicy: string }[]
  }
}

const canonicalItems = itemsJson as Record<string, { name: string; effects: string[]; aliases: string[] }>
const inventory = inventoryJson as { catalogSha256: string; entryCount: number; classificationPolicy: Record<string, unknown>; rows: InventoryRow[] }

const expectCatalogFingerprint = (document: { readonly catalogSha256?: string; readonly canonicalItemCatalogSha256?: string }): void => {
  expect(document.catalogSha256 ?? document.canonicalItemCatalogSha256).toBe(CATALOG_SHA256)
}

describe('Complete Play Loop phase-one evidence', () => {
  it('binds all evidence to the exact app-owned canonical catalog', () => {
    expect(sha256(readFileSync('data/reference/items.json'))).toBe(CATALOG_SHA256)
    for (const document of [auditJson, inventoryJson, itemFixturesJson, specsJson]) expectCatalogFingerprint(document)
    expect(specsJson.ruleEvidence.restorativeItemTiming).toEqual({
      otherTargetActionCost: 'standard',
      otherTargetNextTurnForfeit: ['standard', 'shift'],
      exceptionCanonicalEdgeId: 'Medic Training',
      selfActionCost: 'full',
      selfForfeit: false,
    })
    expect(specsJson.ruleEvidence.xItemPolicy).toMatchObject({
      targetKind: 'pokemon', directStageBounds: [-6, 6],
      directStageSwitchPolicy: 'clear-on-switch-or-recall',
      direHit: { amount: 2, duration: 'encounter', reapplication: 'replace' },
      guardSpec: { amount: 5, duration: 'target-turns', reapplication: 'refresh' },
      temporarySwitchPolicy: 'expire',
    })
  })

  it('inventories every canonical row exactly once with complete behaviour dimensions', () => {
    const ids = Object.keys(canonicalItems)
    expect(inventory.entryCount).toBe(ids.length)
    expect(inventory.rows).toHaveLength(ids.length)
    expect(new Set(inventory.rows.map(row => row.canonicalId)).size).toBe(ids.length)
    expect(new Set(inventory.rows.map(row => row.canonicalId))).toEqual(new Set(ids))
    expect(inventory.classificationPolicy).toMatchObject({ status: 'reviewed', runtimeProseParsing: false })

    for (const row of inventory.rows) {
      const canonical = canonicalItems[row.canonicalId]
      expect(canonical).toBeDefined()
      expect(canonical.name).toBe(row.canonicalId)
      expect(row.recordSha256).toBe(sha256(stableJsonStringify(canonical)))
      expect(row.effectSha256).toBe(sha256(canonical.effects.join('\n')))
      expect(row.aliases).toEqual(canonical.aliases)
      expect(row.behaviorInventory.mechanicalRole).not.toBe('')
      expect(row.behaviorInventory.contexts.length).toBeGreaterThan(0)
      expect(row.behaviorInventory.timing).not.toBe('')
      expect(row.behaviorInventory.targets.length).toBeGreaterThan(0)
      expect(row.behaviorInventory.actionCost.kind).not.toBe('')
      expect(row.behaviorInventory.consumption.phase).not.toBe('')
      expect(row.behaviorInventory.duration).not.toBe('')
      expect(row.behaviorInventory.currentProductSupport.authorities.length).toBeGreaterThan(0)
      for (const defect of row.behaviorInventory.canonicalDataDefects) {
        expect(defect.runtimePolicy).toBe('fail-closed')
      }
    }
  })

  it('records reviewed P8-034 duration, native support, and closure evidence for every X Item', () => {
    const xItems = new Map(inventory.rows.filter(row => row.categories.includes('X-Item')).map(row => [row.canonicalId, row]))
    expect([...xItems.keys()]).toEqual([
      'X Attack', 'X Defend', 'X Special', 'X Sp. Def', 'X Speed', 'Dire Hit', 'X Accuracy', 'Guard Spec',
    ])
    for (const row of xItems.values()) {
      expect(row.behaviorInventory.currentProductSupport).toMatchObject({ state: 'native-runtime-wired', gaps: [] })
    }
    expect(xItems.get('X Attack')?.behaviorInventory.duration).toBe('encounter-stage-state')
    expect(xItems.get('Dire Hit')?.behaviorInventory.duration).toBe('encounter')
    expect(xItems.get('Guard Spec')?.behaviorInventory.duration).toBe('five-target-turns')
    const fixture = itemFixturesJson.fixtures.find(row => row.id === 'temporary-stage-x-attack')
    expect(fixture?.p8_034Evidence).toMatchObject({
      stageBounds: [-6, 6], noOpAtCap: 'ineligible-before-consumption',
      switchPolicy: 'clear-on-switch-or-recall-except-baton-pass',
      encounterEndPolicy: 'lifecycle-authored-reset',
    })
    expect(fixture?.p8_034Evidence.serverTests.length).toBeGreaterThanOrEqual(10)
    expect(fixture?.p8_034Evidence.recoveryTests).toHaveLength(2)
  })

  it('records native food coverage and the reviewed Black Sludge P8-093 repair', () => {
    const ids = [
      'Candy Bar', 'Honey', 'Leftovers', 'Black Sludge', 'Enriched Water',
      'Shuckle’s Berry Juice', 'Super Soda Pop', 'Sparkling Lemonade', 'MooMoo Milk',
    ]
    const rows = new Map(inventory.rows.filter(row => ids.includes(row.canonicalId)).map(row => [row.canonicalId, row]))
    expect([...rows.keys()]).toHaveLength(9)
    for (const id of ids) {
      expect(rows.get(id)?.behaviorInventory.currentProductSupport).toMatchObject({
        state: 'native-runtime-wired', gaps: [],
      })
    }
    expect(remediationJson.openDefects).toEqual([])
    expect(remediationJson.reviewedMigrations).toContainEqual(expect.objectContaining({
      migrationId: 'item-black-sludge-acquisition-cost-v1', canonicalId: 'Black Sludge',
      afterFileSha256: BLACK_SLUDGE_MIGRATION_CATALOG_SHA256, reviewStatus: 'accepted',
    }))
    expect(rows.get('Black Sludge')?.behaviorInventory).toMatchObject({
      actionCost: { canonicalAcquisitionCostLabels: ['$500'] },
      currentProductSupport: { state: 'native-runtime-wired', gaps: [] },
      canonicalDataDefects: [],
    })
    expect(specsJson.ruleEvidence.snackPolicy).toMatchObject({
      storage: 'authoritative-sheet-digestion-buff', ordinaryCapacity: 1, gluttonyCapacity: 3,
      incompatibleStacking: 'reject-before-consumption', tradeAuthority: 'server-owned-move-item-mutation',
      fixedHealing: { 'Candy Bar': 5, Honey: 5 },
      encounterHealing: {
        Leftovers: { numerator: 1, denominator: 16, boundary: 'turn-start', duration: 'encounter' },
        'Black Sludge': { numerator: 1, denominator: 8, requiredPokemonType: 'Poison' },
      },
    })
    const fixture = itemFixturesJson.fixtures.find(row => row.id === 'food-snack-leftovers')
    expect(fixture?.p8_036Evidence).toMatchObject({
      ordinaryCapacity: 1, effectiveGluttonyCapacity: 3,
      incompatibleStacking: 'reject-before-consumption',
      fixedTradeHealing: 'atomic-with-buff-clear-and-move-settlement',
      encounterHealing: 'server-authored-turn-start-lifecycle-operation',
      blackSludge: { runtimeDisposition: 'fail-closed-missing-canonical-cost' },
    })
    expect(fixture?.p8_036Evidence.serverTests).toHaveLength(12)
  })

  it('records P8-037 reusable-tool mechanics and P8-052 durable medical workflow evidence', () => {
    expect(specsJson.ruleEvidence.firstAidKitPolicy).toEqual({
      actorKind: 'trainer', skillId: 'medicineEd', dieSides: 6, timing: 'extended',
      apCost: { mode: 'drain', amount: 1, recovery: 'extended-rest' },
      healingBasis: 'authoritative-skill-check-total',
      conditionIds: ['Burned', 'Poisoned', 'Badly Poisoned', 'Paralysis'],
      reusable: true,
    })
    const firstAid = inventory.rows.find(row => row.canonicalId === 'First Aid Kit')
    expect(firstAid?.behaviorInventory).toMatchObject({
      contexts: ['campaign', 'sheet', 'extended-action'],
      timing: 'extended', targets: ['participant'], duration: 'instant',
      actionCost: { kind: 'ap-drain', amount: 1, recovery: 'extended-rest', requiresExtendedAction: true },
      consumption: { phase: 'never', quantity: 0, reusable: true },
      currentProductSupport: {
        state: 'native-runtime-wired',
        gaps: [],
        authorities: expect.arrayContaining([
          'shared/itemAutomation/nonEncounter.ts',
          'shared/itemAutomation/extendedActions.ts',
          'server/useCases/manageItemExtendedAction.ts',
          'server/storage/itemExtendedActionRepository.ts',
        ]),
      },
    })
    expect(itemContractJson).toMatchObject({
      ticketRange: ['P8-011', 'P8-053'],
      hpRestoration: { amountKinds: ['fixed', 'rolled', 'skill-check', 'maximum-relative'] },
      toolSkillChecks: {
        skillAuthority: 'server-resolved effective Trainer skill projection from the revision-bound actor sheet',
        clientDiceOrModifierForbidden: true,
        firstAidApPolicy: { mode: 'drain', amount: 1, recovery: 'extended-rest' },
        reusableSourcePolicy: expect.stringContaining('source row remains unchanged'),
      },
      permanentAdvancement: {
        contract: 'data/complete-play-loop/permanent-advancement-items.v1.json',
        nativeSources: ['HP Up', 'Protein', 'Iron', 'Calcium', 'Zinc', 'Carbos', 'Heart Booster', 'PP Up', 'Rare Candy', 'Stat Suppressants'],
        target: 'one owned Pokémon',
        timing: 'extended-action-completion',
        startAndInterruptionMechanicallyInert: true,
        sharedVitaminLifetimeLimit: 5,
        rareCandyLifetimeLimit: 5,
        trainerConsent: 'exact required confirmation for Stat Suppressants',
        completionAtomicWithItemSettlement: true,
        exactReplayNeverReapplies: true,
      },
      medicalExtendedActions: {
        contract: 'data/complete-play-loop/medical-extended-actions.v1.json',
        nativeSource: 'First Aid Kit',
        nativeSources: ['First Aid Kit', 'Bandages'],
        guidedDeferredSources: {
          Poultices: 'P8-059 Loyalty adjudication',
          'Re-Breather': 'P8-059 open-air refill adjudication',
        },
        timedTreatmentState: 'shared/itemAutomation/medicalTreatments.ts',
        nativeEquipmentDelivery: {
          source: 'Wonder Launcher', payload: 'reviewed X-Items', rangeMeters: 8,
          standardActions: 1, apDrain: 1, targetForfeit: false,
          sourceIdentityTransport: 'opaque-binding-only',
        },
        startAppliesMechanics: false,
        completionAtomicWithItemSettlement: true,
        interruptionAppliesMechanics: false,
        healingCap: 'injury-adjusted-effective-maximum-hp',
        exactReplayNeverRerolls: true,
      },
    })
    const fixture = itemFixturesJson.fixtures.find(row => row.id === 'extended-first-aid-kit')
    expect(fixture?.p8_037Evidence).toMatchObject({
      skillAuthority: 'revision-bound-server-resolved-trainer-skill',
      apAuthority: 'featureApState',
      sourceDisposition: 'exact-reusable-row-retained',
      nonEncounterExecutionImplementedBy: ['P8-051', 'P8-052'],
      nonEncounterExecutionEvidence: [
        'shared/itemAutomation/nonEncounter.ts',
        'shared/itemAutomation/extendedActions.ts',
        'server/useCases/manageItemExtendedAction.ts',
      ],
    })
    expect(fixture?.p8_037Evidence.serverTests).toHaveLength(7)
    expect(fixture?.p8_052Evidence).toMatchObject({
      activityStart: 'durable-and-mechanically-inert',
      activityCompletion: 'current-authority-revalidated-and-atomic-with-item-settlement',
      activityInterruption: 'terminal-receipt-without-item-mechanics',
    })

    const bandagesFixture = itemFixturesJson.fixtures.find(row => row.id === 'extended-bandages-treatment')
    expect(bandagesFixture).toMatchObject({
      canonicalItemId: 'Bandages', context: 'campaign',
      expected: {
        startAppliesMechanics: false, completionConsumes: 1, completionImmediateHealing: 0,
        durationMinutes: 360, tickMinutes: 30, tickCount: 12,
        fullDurationInjuryAttempt: 1, hpLossCancellation: 'immediate-and-terminal',
        terminalReplay: 'same-activity-and-item-receipts',
      },
      p8_052Evidence: {
        treatmentAuthority: 'shared/itemAutomation/medicalTreatments.ts',
        settlementAuthority: 'server/useCases/advanceCampaignDay.ts',
        projectionAuthority: 'settled-treatment-evidence-not-wall-clock',
        oneActivePerTarget: true,
        liveplayTest: 'tests/e2e/medical-extended-actions.spec.ts',
      },
    })

    const launcherFixture = itemFixturesJson.fixtures.find(row => row.id === 'wonder-launcher-x-item-delivery')
    expect(launcherFixture).toMatchObject({
      canonicalItemId: 'Wonder Launcher', context: 'encounter',
      expected: {
        payload: 'reviewed-native-x-item', rangeMeters: 8, standardActionsSpent: 1,
        apDrained: 1, payloadQuantityConsumed: 1, targetNextTurnForfeit: false,
        sourceBinding: 'opaque-exact-equipped-source-digest',
      },
      p8_052Evidence: {
        reBreatherDisposition: 'P8-059-bounded-open-air-refill-adjudication',
      },
    })
  })

  it('binds P8-035 lifecycle and campaign-day authority without inventing canonical durations', () => {
    expect(durationAuthorityJson).toMatchObject({
      schemaVersion: 1,
      status: 'reviewed',
      campaignClock: {
        authority: 'singleton-campaign-clock',
        unit: 'campaign-minute',
        campaignMinutesPerDay: 1_440,
        dailyAdvance: {
          atomicBoundary: 'clock-sheet-map-effect-and-all-due-Egg-checkpoints',
          pausedEggTime: 'skipped-never-credited',
          replay: 'accepted-receipt-no-write-no-republication',
        },
        forbiddenInputs: expect.arrayContaining([
          'browser-clock', 'wall-clock', 'process-uptime', 'scene-time',
          'encounter-time', 'initiative-time', 'timezone-or-calendar',
        ]),
      },
      boundaries: {
        turns: 'authoritative-initiative-turn-boundary',
        rounds: 'authoritative-initiative-round-boundary',
        scene: 'scene-end',
        encounter: 'encounter-end',
        daily: 'campaign-time-advanced',
        'explicit-dismissal': 'effect-removed',
      },
      cleanup: {
        pendingResolutionGuard: 'durable-item-and-move-authority-plus-public-summary',
        reconnectAndRestart: 'authoritative-map-reload-and-revisioned-lifecycle-patch',
        correction: expect.stringContaining('never-resurrect-expired-effect'),
        sceneAndEncounterAreDistinct: true,
        lifecycleBudgetBypassAllowed: false,
      },
    })
    for (const evidence of durationAuthorityJson.campaignClock.sourceEvidence) {
      expect(sha256(readFileSync(evidence.path))).toBe(evidence.sha256)
    }
    const fixture = itemFixturesJson.fixtures.find(row => row.id === 'temporary-stage-x-attack')
    expect(fixture?.p8_035Evidence).toMatchObject({
      durationAuthoritySha256: sha256(readFileSync('data/complete-play-loop/duration-authority.v1.json')),
      campaignMinutesPerDay: 1_440,
      encounterAndSceneDistinct: true,
      wallClockAuthorityForbidden: true,
      storageSchemaVersion: 33,
      standaloneBreedingMigrationVersion: 28,
    })
    expect(fixture?.p8_035Evidence).toMatchObject({
      dailyAdvanceAtomicity: 'clock-sheet-map-effect-and-all-due-Egg-checkpoints',
      pausedEggPolicy: 'skipped-never-credited',
      archivePolicy: expect.stringContaining('terminal-command-result-read-set-receipt-and-segment'),
      correctionPolicy: expect.stringContaining('separately-authorized-compensating-operation-required'),
    })
    expect(fixture?.p8_035Evidence.serverTests).toHaveLength(13)
    expect(fixture?.p8_035Evidence.sharedTests).toHaveLength(3)
    expect(specsJson.specs.some(row => (
      'duration' in row.effect
      && (row.effect.duration.kind === 'daily' || row.effect.duration.kind === 'explicit-dismissal')
    ))).toBe(false)
  })

  it('records every phase-one authority, gap, rubric state, and measurable acceptance fixture', () => {
    expect(auditJson.journey.map(step => step.step)).toEqual([
      'acquire', 'inventory', 'equip', 'encounter-use', 'finish-encounter', 'advance-and-recover',
    ])
    expect(auditJson.journey.every(step => step.authority.length > 0 && step.gaps.length > 0)).toBe(true)
    expect(inventoryAuthorityJson.authorities.length).toBeGreaterThanOrEqual(7)
    expect(equipmentAuditJson.representations.map(row => row.ownerKind).sort()).toEqual(['pokemon', 'trainer'])
    expect(settlementMatrixJson.domains.length).toBeGreaterThanOrEqual(10)
    expect(remediationJson.documentarySourcesForbiddenAtRuntime).toBe(true)
    expect(remediationJson.failClosed).toMatchObject({
      ambiguousIdentity: 'reject alias resolution',
      missingCost: 'do not consume or execute',
      missingTarget: 'do not project an actionable offer',
    })
    expect(Object.keys(rubricJson.states).sort()).toEqual([
      'blocked', 'guided', 'native', 'not-applicable', 'passive', 'reference-only',
    ])
    expect(rubricJson.states.blocked.finalAcceptanceAllowed).toBe(false)
    expect(uxJson.criteria).toHaveLength(9)
    expect(uxJson.privacy).toContain('aggregate-only')
    expect(itemFixturesJson.fixtures).toHaveLength(16)
    expect(settlementFixturesJson.fixtures.map(row => row.id)).toEqual([
      'simple-trainer-duel', 'capture-team-overflow', 'loot-heavy', 'injury-heavy', 'reconnect-during-settlement',
    ])
  })
})
