import { describe, expect, it } from 'vitest'
import equipmentDefinitionsJson from '../../data/complete-play-loop/equipment-definitions.v1.json'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  createEmptySheetEquipmentState,
  parseSheetEquipmentStateForOwner,
  type EquipmentItemConfigurationV1,
  type EquipmentSlotId,
  type SheetEquipmentStateV1,
} from '#shared/itemAutomation/equipment'
import { parseEquipmentDefinitionDocument } from '#shared/itemAutomation/equipmentDefinitions'
import {
  equipmentConfigurationDefinitionSha256,
  equipmentDefinitionSha256,
  equipmentDefinitions,
} from '~~/server/domain/itemAutomation/equipmentDefinitionRegistry'
import { evaluateEquipmentCompatibility } from '~~/server/domain/itemAutomation/equipmentCompatibility'
import { reconcileSheetEquipmentCompatibility } from '~~/server/domain/itemAutomation/equipmentCompatibilityReconciliation'
import { activeEquipmentState } from '../fixtures/equipment'

const trainer = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'ash', name: 'Ash', level: 10, ...overrides,
})
const pokemon = (species = 'Pikachu', overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: species.toLocaleLowerCase('en-US').replaceAll('’', '').replaceAll(' ', '-'),
  nickname: species,
  species,
  level: 10,
  ...overrides,
})
const stateFor = (kind: 'trainer' | 'pokemon', slug: string): SheetEquipmentStateV1 =>
  createEmptySheetEquipmentState({ ownerKind: kind, ownerSlug: slug })
const configuration = (canonicalItemId: string, configurationId: string, values: Record<string, unknown>): EquipmentItemConfigurationV1 => ({
  schemaVersion: 1,
  configurationId,
  definitionSha256: equipmentConfigurationDefinitionSha256(canonicalItemId)!,
  values,
})
const evaluateTrainer = (input: {
  item: string
  slots: readonly EquipmentSlotId[]
  sheet?: TrainerSheet
  state?: SheetEquipmentStateV1
  configuration?: EquipmentItemConfigurationV1 | null
  currentInstanceId?: string
}) => evaluateEquipmentCompatibility({
  owner: { kind: 'trainer', slug: input.sheet?.slug ?? 'ash', sheet: input.sheet ?? trainer() },
  equipmentState: input.state ?? stateFor('trainer', input.sheet?.slug ?? 'ash'),
  canonicalItemId: input.item,
  requestedSlots: input.slots,
  configuration: input.configuration ?? null,
  currentInstanceId: input.currentInstanceId,
})
const evaluatePokemon = (input: {
  item: string
  slots?: readonly EquipmentSlotId[]
  sheet?: CharacterSheet
  state?: SheetEquipmentStateV1
  configuration?: EquipmentItemConfigurationV1 | null
}) => {
  const sheet = input.sheet ?? pokemon()
  return evaluateEquipmentCompatibility({
    owner: { kind: 'pokemon', slug: sheet.slug, sheet },
    equipmentState: input.state ?? stateFor('pokemon', sheet.slug),
    canonicalItemId: input.item,
    requestedSlots: input.slots ?? ['held'],
    configuration: input.configuration ?? null,
  })
}

describe('reviewed equipment compatibility definitions', () => {
  it('strictly parses and covers every canonical equipment item with current hashes', () => {
    const parsed = parseEquipmentDefinitionDocument(equipmentDefinitionsJson)
    expect(parsed.definitionCount).toBe(108)
    expect(equipmentDefinitions()).toHaveLength(108)
    expect(new Set(equipmentDefinitions().map(row => row.canonicalItemId)).size).toBe(108)
    expect(equipmentDefinitions().every(row => equipmentDefinitionSha256(row.canonicalItemId)?.length === 64)).toBe(true)
    expect(Object.isFrozen(parsed)).toBe(true)
  })

  it('enforces one-handed and whole-item two-handed slot occupancy', () => {
    expect(evaluateTrainer({ item: 'Kitchen Knife', slots: ['mainHand'] }).eligible).toBe(true)
    expect(evaluateTrainer({ item: 'Kitchen Knife', slots: ['offHand'] }).eligible).toBe(true)
    expect(evaluateTrainer({ item: 'Baseball Bat', slots: ['mainHand'] })).toMatchObject({
      eligible: false,
      unavailableReason: { code: 'equipment.slot-incompatible', message: 'This item cannot occupy Main Hand.' },
    })
    expect(evaluateTrainer({ item: 'Baseball Bat', slots: ['mainHand', 'offHand'] }).eligible).toBe(true)
  })

  it('fails before movement when any selected slot is occupied', () => {
    const occupied = activeEquipmentState({
      ownerKind: 'trainer', ownerSlug: 'ash', slotId: 'offHand', canonicalItemId: 'Light Shield',
    })
    expect(evaluateTrainer({ item: 'Baseball Bat', slots: ['mainHand', 'offHand'], state: occupied })).toMatchObject({
      eligible: false,
      unavailableReason: {
        code: 'equipment.slot-occupied',
        message: 'Off Hand is already occupied. Unequip it before continuing.',
      },
    })
  })

  it('enforces owner restrictions and Pokémon Wielder capability', () => {
    expect(evaluateTrainer({ item: 'Big Root', slots: ['accessory'] })).toMatchObject({
      eligible: false,
      unavailableReason: { code: 'equipment.owner-incompatible', message: 'This item cannot be equipped by a Trainer.' },
    })
    expect(evaluatePokemon({ item: 'Big Root' }).eligible).toBe(true)
    expect(evaluatePokemon({ item: 'Kitchen Knife', sheet: pokemon('Pikachu') })).toMatchObject({
      eligible: false,
      unavailableReason: {
        code: 'equipment.capability-required',
        message: 'This Pokémon requires the Wielder Capability to equip this item.',
      },
    })
    expect(evaluatePokemon({ item: 'Kitchen Knife', sheet: pokemon('Cubone') }).eligible).toBe(true)
  })

  it('enforces exact species and evolution-stage prerequisites', () => {
    expect(evaluatePokemon({ item: 'Thick Club', sheet: pokemon('Cubone') }).eligible).toBe(true)
    expect(evaluatePokemon({ item: 'Thick Club', sheet: pokemon('Pikachu') })).toMatchObject({
      eligible: false,
      unavailableReason: { code: 'equipment.species-incompatible' },
    })
    const eviolite = configuration('Eviolite', 'equipment.eviolite.v1', {
      familyAnchorSpeciesId: 'Pichu', boostedStatIds: ['def', 'sdef'],
    })
    expect(evaluatePokemon({ item: 'Eviolite', sheet: pokemon('Pikachu'), configuration: eviolite }).eligible).toBe(true)
    expect(evaluatePokemon({
      item: 'Eviolite', sheet: pokemon('Raichu'),
      configuration: configuration('Eviolite', 'equipment.eviolite.v1', {
        familyAnchorSpeciesId: 'Pichu', boostedStatIds: ['def', 'sdef'],
      }),
    })).toMatchObject({ eligible: false, unavailableReason: { code: 'equipment.evolution-stage-incompatible' } })
  })

  it('requires current exact configuration and owner-bound values', () => {
    expect(evaluateTrainer({ item: 'Focus', slots: ['accessory'] })).toMatchObject({
      eligible: false,
      unavailableReason: { code: 'equipment.configuration-required' },
    })
    expect(evaluateTrainer({
      item: 'Focus', slots: ['accessory'],
      configuration: configuration('Focus', 'equipment.focus.v1', { statId: 'atk' }),
    }).eligible).toBe(true)
    expect(evaluatePokemon({
      item: 'Mega Stone', sheet: pokemon('Pikachu'),
      configuration: configuration('Mega Stone', 'equipment.mega-stone.v1', {
        baseSpeciesId: 'Charizard', megaFormSpeciesId: 'Charizard Mega X',
      }),
    })).toMatchObject({ eligible: false, unavailableReason: { code: 'equipment.configuration-invalid' } })
    expect(evaluateTrainer({
      item: 'Hand Net', slots: ['mainHand', 'offHand'],
      configuration: { ...configuration('Hand Net', 'equipment.hand-net.v1', { durabilityMaximum: 50 }), definitionSha256: 'f'.repeat(64) },
    })).toMatchObject({ eligible: false, unavailableReason: { code: 'equipment.configuration-stale' } })
  })

  it('enforces current Trainer skill prerequisites and Focus exclusivity', () => {
    expect(evaluateTrainer({ item: 'Wonder Launcher', slots: ['mainHand', 'offHand'] })).toMatchObject({
      eligible: false,
      unavailableReason: {
        code: 'equipment.skill-required',
        message: 'This item requires Expert Medicine Education or Technology Education.',
      },
    })
    expect(evaluateTrainer({
      item: 'Wonder Launcher', slots: ['mainHand', 'offHand'],
      sheet: trainer({ skills: { medicineEd: { rankBonus: 3 } } }),
    }).eligible).toBe(true)

    const existing = activeEquipmentState({
      ownerKind: 'trainer', ownerSlug: 'ash', slotId: 'accessory', canonicalItemId: 'Focus',
    })
    expect(evaluateTrainer({
      item: 'Focus', slots: ['head'], state: existing,
      configuration: configuration('Focus', 'equipment.focus.v1', { statId: 'def' }),
    })).toMatchObject({
      eligible: false,
      unavailableReason: { code: 'equipment.exclusivity-conflict', message: 'Only one Focus can be equipped at a time.' },
    })
  })

  it('activates compatible migration instances while retaining exact incompatibility evidence', () => {
    const migrated = activeEquipmentState({
      ownerKind: 'trainer', ownerSlug: 'ash', slotId: 'body', canonicalItemId: 'Light Armor',
    })
    const canonicalHash = equipmentDefinitions().find(row => row.canonicalItemId === 'Light Armor')!.canonicalRecordSha256
    const pending = parseSheetEquipmentStateForOwner({
      ...migrated,
      instances: migrated.instances.map(instance => ({
        ...instance,
        canonicalRecordSha256: canonicalHash,
        equipmentDefinitionSha256: null,
        activity: {
          status: 'inactive',
          reasons: [{ code: 'equipment.definition-pending', sourceId: instance.equippedByOperationId }],
        },
      })),
    }, { kind: 'trainer', slug: 'ash' })
    const accepted = reconcileSheetEquipmentCompatibility({
      owner: { kind: 'trainer', slug: 'ash', sheet: trainer() },
      equipmentState: pending,
    })
    expect(accepted).toMatchObject({
      changed: true,
      state: {
        revision: 1,
        instances: [{ revision: 1, equipmentDefinitionSha256: equipmentDefinitionSha256('Light Armor'), activity: { status: 'active', reasons: [] } }],
      },
    })

    const wrongSlot = parseSheetEquipmentStateForOwner({
      ...pending,
      slots: pending.slots.map(slot => ({ ...slot, instanceId: slot.slotId === 'mainHand' ? pending.instances[0]!.instanceId : null })),
    }, { kind: 'trainer', slug: 'ash' })
    expect(reconcileSheetEquipmentCompatibility({
      owner: { kind: 'trainer', slug: 'ash', sheet: trainer() },
      equipmentState: wrongSlot,
    }).state.instances[0]).toMatchObject({
      activity: {
        status: 'inactive',
        reasons: [{ code: 'equipment.slot-incompatible', sourceId: equipmentDefinitionSha256('Light Armor') }],
      },
    })
  })

  it('fails closed with a stable safe reason for unknown definitions', () => {
    expect(evaluateTrainer({ item: 'Mystery Gear', slots: ['body'] })).toEqual(expect.objectContaining({
      eligible: false,
      equipmentDefinitionSha256: null,
      configurationDefinitionSha256: null,
      unavailableReason: {
        code: 'equipment.definition-unavailable',
        sourceId: null,
        message: 'This item does not have a current reviewed equipment definition.',
      },
    }))
  })
})
