import { describe, expect, it } from 'vitest'
import {
  JUICER_BERRY_ELAPSED_MS,
  JUICER_JUICE_ELAPSED_MS,
  advanceCapabilityCampaignStateDay,
  advanceCapabilityCampaignStateToTime,
  createEmptyCapabilityCampaignState,
  materializeJuicerCampaignStateAtTime,
  parseCapabilityCampaignState,
  reconcileJuicerHeldItemCustody,
} from '#shared/capabilityAutomation/campaignState'
import {
  advanceCapabilityUsageDay,
  createEmptyCapabilityRuntimeState,
  parseCapabilityRuntimeState,
  parseCapabilityUsageLedger,
} from '#shared/capabilityAutomation/state'

describe('Capability durable state', () => {
  it('strictly parses mode/link state while upgrading pre-configuration snapshots', () => {
    const state = parseCapabilityRuntimeState({
      ...createEmptyCapabilityRuntimeState(),
      modes: [{
        id: 'mode-1', actorPlacementId: 'actor', capabilityInstanceId: 'capability:actor:Phasing:base',
        canonicalId: 'Phasing', mode: 'intangible', description: null,
        activatedAt: 100, expiresAt: null, sourceOperationId: 'operation-1',
      }],
      links: [{
        id: 'link-1', kind: 'as-one-mount', ownerPlacementId: 'actor', participantPlacementIds: ['mount'],
        capabilityInstanceId: 'capability:actor:As_One:base', canonicalId: 'As One', establishedAt: 100,
        sourceOperationId: 'operation-1',
      }],
    })
    expect(state.modes[0]).toMatchObject({ mode: 'intangible', configurationId: null })
    expect(state.links[0]).toMatchObject({ kind: 'as-one-mount', configurationId: null })
    expect(() => parseCapabilityRuntimeState({ ...state, unknown: true })).toThrow(/unknown/i)
    expect(() => parseCapabilityRuntimeState({ ...state, links: [{ ...state.links[0], participantPlacementIds: [] }] })).toThrow(/participants/i)
  })

  it('advances daily and weekly use identities only at authoritative day boundaries', () => {
    const ledger = parseCapabilityUsageLedger({ schemaVersion: 1, entries: [
      { id: 'daily', canonicalId: 'Dream Mist', actionId: 'produce-dream-mist', capabilityInstanceId: 'i1', period: 'daily', usedAt: 1, availableAt: null, remainingDayAdvances: null, sourceOperationId: 'o1' },
      { id: 'weekly', canonicalId: 'Heart Gift', actionId: 'produce-heart-scale', capabilityInstanceId: 'i2', period: 'weekly', usedAt: 1, availableAt: null, remainingDayAdvances: 2, sourceOperationId: 'o2' },
      { id: 'hourly', canonicalId: 'Tracker', actionId: 'track-scent', capabilityInstanceId: 'i3', period: 'hourly', usedAt: 1, availableAt: 500, remainingDayAdvances: null, sourceOperationId: 'o3' },
    ] })
    expect(advanceCapabilityUsageDay(ledger, 400)?.entries.map(entry => [entry.id, entry.remainingDayAdvances])).toEqual([
      ['weekly', 1], ['hourly', null],
    ])
    expect(advanceCapabilityUsageDay(ledger, 600)?.entries.map(entry => entry.id)).toEqual(['weekly'])
  })

  it('enforces exact elapsed Juicer boundaries and canonical item-catalog identities', () => {
    const initial = parseCapabilityCampaignState({
      ...createEmptyCapabilityCampaignState(),
      storedItems: [{
        id: 'shell-exact', kind: 'juicer', canonicalItemId: 'oran-berry', stage: 'berry',
        storedAt: 100, custodyStartedAt: 100, custodyFingerprint: 'juicer-custody:exact',
        remainingDayAdvances: 1, sourceOperationId: 'held-berry',
      }],
    })
    expect(advanceCapabilityCampaignStateToTime(initial, 100 + JUICER_BERRY_ELAPSED_MS - 1)
      ?.storedItems[0]).toMatchObject({ stage: 'berry', canonicalItemId: 'oran-berry' })
    const juice = advanceCapabilityCampaignStateToTime(initial, 100 + JUICER_BERRY_ELAPSED_MS)!
    expect(juice.storedItems[0]).toMatchObject({
      id: 'shell-exact', stage: 'berry-juice', canonicalItemId: 'shuckles-berry-juice',
      storedAt: 100 + JUICER_BERRY_ELAPSED_MS, custodyStartedAt: 100,
    })
    expect(advanceCapabilityCampaignStateToTime(
      juice, 100 + JUICER_BERRY_ELAPSED_MS + JUICER_JUICE_ELAPSED_MS - 1,
    )?.storedItems[0]).toMatchObject({ stage: 'berry-juice', canonicalItemId: 'shuckles-berry-juice' })
    expect(advanceCapabilityCampaignStateToTime(
      juice, 100 + JUICER_BERRY_ELAPSED_MS + JUICER_JUICE_ELAPSED_MS,
    )?.storedItems[0]).toMatchObject({
      id: 'shell-exact', stage: 'rare-candy', canonicalItemId: 'rare-candy',
    })
  })

  it('rejects illegal Juicer stage identities while canonically upgrading legacy snapshots', () => {
    const base = {
      ...createEmptyCapabilityCampaignState(),
      storedItems: [{
        id: 'strict-output', kind: 'juicer', canonicalItemId: 'Berry Juice', stage: 'berry-juice',
        storedAt: 100, custodyStartedAt: 0, custodyFingerprint: 'juicer-custody:strict',
        remainingDayAdvances: 14, sourceOperationId: 'strict-output',
      }],
    }
    expect(() => parseCapabilityCampaignState(base)).toThrow(/legal canonical catalog identity/i)
    expect(() => parseCapabilityCampaignState({
      ...base,
      storedItems: [{
        ...base.storedItems[0], canonicalItemId: 'shuckles-berry-juice',
      }],
    })).toThrow(/canonical elapsed boundary/i)
    const legacy = parseCapabilityCampaignState({
      ...createEmptyCapabilityCampaignState(),
      storedItems: [{
        id: 'legacy-output', kind: 'juicer', canonicalItemId: 'Berry Juice', stage: 'berry-juice',
        storedAt: JUICER_BERRY_ELAPSED_MS, remainingDayAdvances: 14, sourceOperationId: 'legacy-output',
      }],
    })
    expect(legacy.storedItems[0]).toMatchObject({
      canonicalItemId: 'shuckles-berry-juice', custodyStartedAt: 0,
      custodyFingerprint: expect.stringMatching(/^legacy:/),
    })
    expect(advanceCapabilityCampaignStateToTime(legacy, 0)?.storedItems[0])
      .toMatchObject({ stage: 'berry-juice', remainingDayAdvances: 14 })
    expect(materializeJuicerCampaignStateAtTime({
      value: legacy, heldItemName: 'Berry Juice',
      now: JUICER_BERRY_ELAPSED_MS + JUICER_JUICE_ELAPSED_MS,
    })).toMatchObject({
      heldItemName: '', state: { storedItems: [{ stage: 'rare-candy', canonicalItemId: 'rare-candy' }] },
    })
    expect(() => parseCapabilityCampaignState({
      ...createEmptyCapabilityCampaignState(),
      storedItems: [
        legacy.storedItems[0],
        { ...legacy.storedItems[0], id: 'duplicate-shell-item' },
      ],
    })).toThrow(/at most one exact Juicer shell item/i)
  })

  it('resets same-name Berry custody across representable removal/re-add epochs and preserves shell state on source loss', () => {
    const enrolled = reconcileJuicerHeldItemCustody({
      value: createEmptyCapabilityCampaignState(), sheetSlug: 'shuckle', heldItemName: 'Oran Berry',
      hasJuicer: true, now: 100, sourceOperationId: 'equip-first-oran',
    })
    const unchanged = reconcileJuicerHeldItemCustody({
      value: enrolled, sheetSlug: 'shuckle', heldItemName: 'Oran Berry',
      hasJuicer: true, now: 10_000, sourceOperationId: 'unrelated-sheet-update',
    })
    expect(unchanged.storedItems[0]).toEqual(enrolled.storedItems[0])
    const removed = reconcileJuicerHeldItemCustody({
      value: unchanged, sheetSlug: 'shuckle', heldItemName: '',
      hasJuicer: true, now: 11_000, sourceOperationId: 'remove-first-oran',
    })
    expect(removed.storedItems).toEqual([])
    const replaced = reconcileJuicerHeldItemCustody({
      value: removed, sheetSlug: 'shuckle', heldItemName: 'Oran Berry',
      hasJuicer: true, now: 12_000, sourceOperationId: 'equip-second-oran',
    })
    expect(replaced.storedItems[0]).toMatchObject({ canonicalItemId: 'oran-berry', custodyStartedAt: 12_000 })
    expect(replaced.storedItems[0]?.custodyFingerprint).not.toBe(enrolled.storedItems[0]?.custodyFingerprint)

    const sourceLostDuringBerry = reconcileJuicerHeldItemCustody({
      value: replaced, sheetSlug: 'shuckle', heldItemName: 'Oran Berry',
      hasJuicer: false, now: 13_000, sourceOperationId: 'juicer-source-lost',
    })
    expect(sourceLostDuringBerry.storedItems).toEqual([])
    const shell = advanceCapabilityCampaignStateToTime(enrolled, 100 + JUICER_BERRY_ELAPSED_MS)!
    const sourceLostAfterConversion = reconcileJuicerHeldItemCustody({
      value: shell, sheetSlug: 'shuckle', heldItemName: 'Potion',
      hasJuicer: false, now: 20_000, sourceOperationId: 'juicer-source-lost-after-conversion',
    })
    expect(sourceLostAfterConversion.storedItems).toEqual(shell.storedItems)
  })

  it('advances Juicer berry, juice, and Rare Candy stages deterministically', () => {
    const initial = parseCapabilityCampaignState({
      ...createEmptyCapabilityCampaignState(),
      storedItems: [{
        id: 'stored-1', kind: 'juicer', canonicalItemId: 'Oran Berry', stage: 'berry',
        storedAt: 1, remainingDayAdvances: 1, sourceOperationId: 'operation-1',
      }],
    })
    const juice = advanceCapabilityCampaignStateDay(initial)!
    expect(juice.storedItems[0]).toMatchObject({ canonicalItemId: 'shuckles-berry-juice', stage: 'berry-juice', remainingDayAdvances: 14 })
    let state = juice
    for (let day = 0; day < 14; day += 1) state = advanceCapabilityCampaignStateDay(state)!
    expect(state.storedItems[0]).toMatchObject({ canonicalItemId: 'rare-candy', stage: 'rare-candy', remainingDayAdvances: 0 })
  })
})
