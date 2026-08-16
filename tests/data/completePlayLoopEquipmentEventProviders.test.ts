import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import providerJson from '../../data/complete-play-loop/equipment-event-providers.v1.json'
import {
  EquipmentEventProviderValidationError,
  parseEquipmentEventProviderDocument,
} from '../../shared/itemAutomation/equipmentEventProviders'
import {
  equipmentEventProviderDefinitionFor,
  equipmentEventProviderDocument,
} from '../../server/domain/itemAutomation/equipmentEventProviderRegistry'

describe('P8-048 reviewed equipment event providers', () => {
  it('classifies the complete equipment catalog with typed, prose-free provider authority', () => {
    const document = parseEquipmentEventProviderDocument(providerJson)
    expect(document).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-048',
      definitionCount: 108,
      providingItemCount: 22,
      providerCount: 27,
      classificationPolicy: {
        status: 'reviewed',
        runtimeProseParsing: false,
        inactiveOrSuppressedPolicy: 'withdraw-future-subscriptions-immediately',
        acceptedEffectPolicy: 'accepted-durable-effects-survive-source-loss',
        eventAuthority: 'typed-server-events-only',
        replayPolicy: 'receipt-bound-no-reroll',
      },
    })
    expect(document.definitions).toHaveLength(108)
    expect(new Set(document.definitions.flatMap(row => row.providers.map(provider => provider.providerId))).size)
      .toBe(27)
  })

  it('binds representative passive clauses to exact typed events and explicit effects', () => {
    expect(equipmentEventProviderDefinitionFor('Focus Sash')?.providers[0]).toMatchObject({
      eventKind: 'hp', checkpoint: 'pre-effect', priority: 96,
      frequency: { kind: 'scene', consume: 'on-applied' },
      oncePerCausalChain: true,
      effect: { kind: 'survive-at-one', roll: null, requiresMoveDamageFromMaximum: true },
    })
    expect(equipmentEventProviderDefinitionFor('Life Orb')?.providers[0]).toMatchObject({
      eventKind: 'strike', checkpoint: 'post-effect',
      predicate: { ownerRole: 'attacker', directOnly: true, minimumTotalLoss: 1 },
      effect: { kind: 'lose-max-hp-fraction', numerator: 1, denominator: 16 },
    })
    expect(equipmentEventProviderDefinitionFor('Safety Goggles')?.providers[0]).toMatchObject({
      predicate: { kind: 'move', ownerRole: 'target', keywordsAny: ['powder'] },
      effect: { kind: 'prevent-move' },
    })
    expect(equipmentEventProviderDefinitionFor('Type Gem')?.providers[0]).toMatchObject({
      response: 'optional', choice: { kind: 'owner-choice' },
      effect: { kind: 'consume-source-and-add-damage-base', amount: 3 },
    })
  })

  it('loads the exact hash-bound registry and rejects malformed or unknown shapes', () => {
    expect(equipmentEventProviderDocument()).toEqual(parseEquipmentEventProviderDocument(providerJson))
    const malformed = structuredClone(providerJson) as any
    malformed.definitions[0].providers = [{ callback: 'parse prose' }]
    malformed.providingItemCount += 1
    malformed.providerCount += 1
    expect(() => parseEquipmentEventProviderDocument(malformed))
      .toThrow(EquipmentEventProviderValidationError)
  })

  it('is reproducible from the reviewed generator', () => {
    expect(() => execFileSync('python3', [
      'scripts/generate_complete_play_loop_equipment_event_providers.py', '--check',
    ], { stdio: 'pipe' })).not.toThrow()
  })
})
