import { afterEach, describe, expect, it } from 'vitest'
import { parseItemMedicalTreatmentState } from '#shared/itemAutomation/medicalTreatments'
import type { CharacterSheet } from '~/types/characterSheet'
import { computePokemonHealingVitals, healingFractionAmount } from '~/utils/sheets/healing'
import {
  advanceBandageTreatmentsToCampaignMinute,
  applyBandageTreatment,
  cancelBandageTreatmentOnHpLoss,
  projectItemMedicalTreatments,
} from '../../server/domain/itemAutomation/medicalTreatments'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/itemAutomation/registry'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { projectSheetEquipmentContributions, redactSheetRecordForPlayer } from '../../server/utils/sheetPrivacy'

const databases: RotomDatabase[] = []
afterEach(() => { while (databases.length) databases.pop()!.close() })

const pokemon = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'volt', nickname: 'Volt', species: 'Pikachu', level: 10,
  stats: { hp: { added: 0 } },
  combat: { currentHp: 1, injuries: 2, injuriesHealedToday: 0, conditions: [] },
  ...overrides,
})
const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Bandages')
const apply = (sheet = pokemon(), campaignMinute = 100): CharacterSheet => applyBandageTreatment({
  sheetKind: 'pokemon', sheet, targetSlug: 'volt',
  operationId: 'sheet-item:v1:88888888888888888888888888888888',
  canonicalDefinitionSha256: definition.definitionSha256,
  campaignMinute,
}) as CharacterSheet

describe('Bandages medical treatment lifecycle', () => {
  it('materializes exact half-hour ticks, caps HP, and removes one daily-limited Injury after six hours', () => {
    const started = apply()
    const vitals = computePokemonHealingVitals(started)
    const perTick = healingFractionAmount(vitals.fullMaxHp, 8)
    expect(advanceBandageTreatmentsToCampaignMinute({
      sheetKind: 'pokemon', sheet: started, campaignMinute: 129,
    })).toMatchObject({ changed: false, ticksApplied: 0, hitPointsRestored: 0 })

    const first = advanceBandageTreatmentsToCampaignMinute({
      sheetKind: 'pokemon', sheet: started, campaignMinute: 130,
    })
    expect(first).toMatchObject({ changed: true, ticksApplied: 1, hitPointsRestored: perTick })
    expect((first.sheet as CharacterSheet).combat?.currentHp).toBe(1 + perTick)
    expect(parseItemMedicalTreatmentState((first.sheet as CharacterSheet).itemMedicalTreatments).entries[0])
      .toMatchObject({ status: 'active', revision: 1, ticksApplied: 1, nextTickCampaignMinute: 160 })

    const duplicateBoundary = advanceBandageTreatmentsToCampaignMinute({
      sheetKind: 'pokemon', sheet: first.sheet, campaignMinute: 130,
    })
    expect(duplicateBoundary).toMatchObject({ changed: false, ticksApplied: 0, hitPointsRestored: 0 })

    const completed = advanceBandageTreatmentsToCampaignMinute({
      sheetKind: 'pokemon', sheet: first.sheet, campaignMinute: 460,
    })
    const completedSheet = completed.sheet as CharacterSheet
    expect(completed).toMatchObject({ changed: true, ticksApplied: 11, injuriesRemoved: 1 })
    expect(completedSheet.combat).toMatchObject({
      currentHp: vitals.maxHp,
      injuries: 1,
      injuriesHealedToday: 1,
    })
    expect(parseItemMedicalTreatmentState(completedSheet.itemMedicalTreatments).entries[0]).toMatchObject({
      status: 'completed', revision: 2, ticksApplied: 12,
      healedThroughCampaignMinute: 460, nextTickCampaignMinute: 490,
      injuryRemoved: true, terminalReason: 'full-duration', terminalCampaignMinute: 460,
    })
  })

  it('obeys the five-Injury natural-healing block and daily Injury-removal limit', () => {
    const blocked = apply(pokemon({
      combat: { currentHp: 1, injuries: 5, injuriesHealedToday: 3, conditions: [] },
    }), 0)
    const completed = advanceBandageTreatmentsToCampaignMinute({
      sheetKind: 'pokemon', sheet: blocked, campaignMinute: 360,
    })
    expect((completed.sheet as CharacterSheet).combat).toMatchObject({
      currentHp: 1, injuries: 5, injuriesHealedToday: 3,
    })
    expect(completed).toMatchObject({ ticksApplied: 12, hitPointsRestored: 0, injuriesRemoved: 0 })
    expect(parseItemMedicalTreatmentState((completed.sheet as CharacterSheet).itemMedicalTreatments).entries[0])
      .toMatchObject({ status: 'completed', injuryRemoved: false })
  })

  it('cancels immediately on HP loss and never applies later ticks', () => {
    const started = apply(pokemon(), 10)
    const damaged = structuredClone(started)
    damaged.combat = { ...damaged.combat, currentHp: 0 }
    const cancelled = cancelBandageTreatmentOnHpLoss({
      sheetKind: 'pokemon', previousSheet: started, nextSheet: damaged, campaignMinute: 20,
    }) as CharacterSheet
    expect(parseItemMedicalTreatmentState(cancelled.itemMedicalTreatments).entries[0]).toMatchObject({
      status: 'cancelled', revision: 1, ticksApplied: 0,
      terminalReason: 'hp-loss', terminalCampaignMinute: 20,
    })
    expect(advanceBandageTreatmentsToCampaignMinute({
      sheetKind: 'pokemon', sheet: cancelled, campaignMinute: 500,
    })).toMatchObject({ changed: false, ticksApplied: 0, hitPointsRestored: 0 })
    expect(projectItemMedicalTreatments({ sheet: cancelled, campaignMinute: 500 })[0]).toMatchObject({
      status: 'cancelled', remainingMinutes: 0,
      terminalMessage: 'Bandages stopped when the target lost HP.',
    })
  })

  it('projects owner-safe status without definition hashes or source operation evidence', () => {
    const started = apply()
    const projected = redactSheetRecordForPlayer(
      'pokemon',
      started as unknown as Record<string, unknown>,
    ) as unknown as CharacterSheet
    expect(projected.itemMedicalTreatments).toBeUndefined()
    expect(projected.itemMedicalTreatmentProjection?.[0]).toMatchObject({
      itemLabel: 'Bandages', status: 'active', remainingMinutes: 360,
      ticksApplied: 0, hitPointsRestored: 0,
    })
    expect(JSON.stringify(projected)).not.toContain(definition.definitionSha256)
    expect(JSON.stringify(projected)).not.toContain('sheet-item:v1')
  })

  it('projects safe treatment status for GM loads while retaining private server evidence separately', () => {
    const started = apply()
    const projected = projectSheetEquipmentContributions(
      'pokemon', started as unknown as Record<string, unknown>,
    ) as unknown as CharacterSheet
    expect(projected.itemMedicalTreatments).toBeUndefined()
    expect(started.itemMedicalTreatments).toBeDefined()
    expect(projected.itemMedicalTreatmentProjection?.[0]).toMatchObject({
      itemLabel: 'Bandages', status: 'active', elapsedMinutes: 0, remainingMinutes: 360,
    })
    expect(JSON.stringify(projected.itemMedicalTreatmentProjection)).not.toContain(definition.definitionSha256)
    expect(JSON.stringify(projected.itemMedicalTreatmentProjection)).not.toContain('sheet-item:v1')
  })

  it('makes setup-sheet HP writes cancel treatment while preserving private origin evidence', () => {
    const database = openRotomDatabase({ path: ':memory:' })
    databases.push(database)
    const repository = createSqliteSheetRepository<Record<string, unknown>>(database)
    const started = apply(pokemon(), 0)
    repository.save({
      kind: 'pokemon', slug: 'volt', revision: 2, updatedAt: 1,
      document: started as unknown as Record<string, unknown>,
    })
    const damaged = structuredClone(started)
    damaged.combat = { ...damaged.combat, currentHp: 0 }
    const result = repository.replaceSetupSheet({
      kind: 'pokemon', slug: 'volt', expectedRevision: 2,
      sheet: damaged as unknown as Record<string, unknown>, now: 2,
    })
    expect(result?.changed).toBe(true)
    expect((result?.sheet.sheet as unknown as CharacterSheet).combat?.currentHp).toBe(0)
    expect(parseItemMedicalTreatmentState(
      (result?.sheet.sheet as unknown as CharacterSheet).itemMedicalTreatments,
    ).entries[0]).toMatchObject({ status: 'cancelled', terminalCampaignMinute: 0 })
  })

  it('makes live-play HP writes cancel treatment atomically while preserving private origin evidence', () => {
    const database = openRotomDatabase({ path: ':memory:' })
    databases.push(database)
    const repository = createSqliteSheetRepository<Record<string, unknown>>(database)
    const started = apply(pokemon(), 0)
    repository.save({
      kind: 'pokemon', slug: 'volt', revision: 2, updatedAt: 1,
      document: started as unknown as Record<string, unknown>,
    })
    const damaged = structuredClone(started)
    damaged.combat = { ...damaged.combat, currentHp: 0 }
    expect(repository.applyLivePlayUpdate({
      kind: 'pokemon', slug: 'volt', expectedRevision: 2,
      nextSheet: { ...damaged, updatedAt: 2 } as unknown as Record<string, unknown>,
      sourceOperationId: 'map-operation:v1:99999999999999999999999999999999',
    })).toBe('applied')
    const stored = repository.getByRef('pokemon', 'volt')!
    expect((stored.sheet as unknown as CharacterSheet).combat?.currentHp).toBe(0)
    expect(parseItemMedicalTreatmentState(
      (stored.sheet as unknown as CharacterSheet).itemMedicalTreatments,
    ).entries[0]).toMatchObject({ status: 'cancelled', terminalCampaignMinute: 0 })
  })
})
