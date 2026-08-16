import { describe, expect, it } from 'vitest'
import {
  ItemMedicalTreatmentValidationError,
  parseItemMedicalTreatmentProjection,
  parseItemMedicalTreatmentState,
} from '#shared/itemAutomation/medicalTreatments'

const active = () => ({
  schemaVersion: 1,
  treatmentId: `item-treatment:v1:${'a'.repeat(32)}`,
  revision: 0,
  canonicalItemId: 'Bandages',
  canonicalDefinitionSha256: 'b'.repeat(64),
  sourceOperationId: `sheet-item:v1:${'c'.repeat(32)}`,
  target: { kind: 'pokemon', slug: 'volt' },
  status: 'active',
  appliedAtCampaignMinute: 100,
  nextTickCampaignMinute: 130,
  endsAtCampaignMinute: 460,
  healedThroughCampaignMinute: 100,
  ticksApplied: 0,
  hitPointsRestored: 0,
  injuryRemoved: false,
  terminalReason: null,
  terminalCampaignMinute: null,
})

describe('medical treatment contracts', () => {
  it('strictly detaches and freezes valid lifecycle state', () => {
    const input = { schemaVersion: 1, entries: [active()] }
    const parsed = parseItemMedicalTreatmentState(input)
    input.entries[0]!.status = 'cancelled'
    expect(parsed.entries[0]).toMatchObject({ status: 'active', nextTickCampaignMinute: 130 })
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.entries[0])).toBe(true)
  })

  it.each([
    ['unknown field', { ...active(), extra: true }],
    ['bad identity', { ...active(), treatmentId: 'item-treatment:v1:nope' }],
    ['bad target', { ...active(), target: { kind: 'pokemon', slug: '../volt' } }],
    ['inconsistent tick', { ...active(), ticksApplied: 1 }],
    ['terminal drift', { ...active(), status: 'completed', terminalReason: 'full-duration', terminalCampaignMinute: 460 }],
  ])('rejects %s corruption', (_label, row) => {
    expect(() => parseItemMedicalTreatmentState({ schemaVersion: 1, entries: [row] }))
      .toThrow(ItemMedicalTreatmentValidationError)
  })

  it('rejects duplicate identities and more than one active treatment', () => {
    expect(() => parseItemMedicalTreatmentState({ schemaVersion: 1, entries: [active(), active()] }))
      .toThrow(/duplicate treatment identities/)
    expect(() => parseItemMedicalTreatmentState({
      schemaVersion: 1,
      entries: [active(), { ...active(), treatmentId: `item-treatment:v1:${'d'.repeat(32)}` }],
    })).toThrow(/only one active treatment/)
  })

  it('strictly parses the privacy-safe projection without origin hashes or operation IDs', () => {
    const projection = parseItemMedicalTreatmentProjection({
      schemaVersion: 1,
      treatmentId: `item-treatment:v1:${'a'.repeat(32)}`,
      revision: 0,
      itemLabel: 'Bandages',
      status: 'active',
      appliedAtCampaignMinute: 100,
      nextTickCampaignMinute: 130,
      endsAtCampaignMinute: 460,
      elapsedMinutes: 0,
      remainingMinutes: 360,
      ticksApplied: 0,
      hitPointsRestored: 0,
      injuryRemoved: false,
      terminalMessage: null,
    })
    expect(projection).not.toHaveProperty('canonicalDefinitionSha256')
    expect(projection).not.toHaveProperty('sourceOperationId')
    expect(() => parseItemMedicalTreatmentProjection({ ...projection, sourceOperationId: 'private' }))
      .toThrow(/invalid shape/)
  })
})
