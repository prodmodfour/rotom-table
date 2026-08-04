import { describe, expect, it } from 'vitest'
import { trainerFeatureInspectorStatus, TRAINER_FEATURE_NAME_OPTIONS, syncTrainerFeatureAutomation } from '~/utils/sheets/trainerFeatures'
import { trainerFeatureSubchoices } from '~/utils/sheets/trainerSubchoices'
import { resolvedSheetFeatureClosure } from '#shared/featureAutomation/sheetFeatures'
import type { TrainerFeatureEntry, TrainerSheet } from '~/types/trainerSheet'

const trainer = (features: TrainerFeatureEntry[] = []): TrainerSheet => ({ slug: 'feature-editor', name: 'Feature Editor', level: 10, features })

describe('Trainer Feature editor authority', () => {
  it('offers the complete canonical catalog and reports unresolved identity fail-closed', () => {
    expect(TRAINER_FEATURE_NAME_OPTIONS).toHaveLength(444)
    expect(TRAINER_FEATURE_NAME_OPTIONS).toContain('Witch Hunter')
    const sheet = trainer([{ name: 'Internet Feature' }])
    expect(trainerFeatureInspectorStatus(sheet, sheet.features![0]!, 0)).toMatchObject({ status: 'unresolved-identity', label: 'No canonical identity' })
  })

  it('exposes bounded acquisition choices and persists strict typed data only when complete', () => {
    const row: TrainerFeatureEntry = { name: 'Fashionista', choices: { fashionistaSkill: 'charm' } }
    const sheet = trainer([row])
    expect(trainerFeatureSubchoices(row).map(choice => choice.key)).toEqual(['fashionistaSkill', 'fashionistaSkill2'])
    syncTrainerFeatureAutomation(sheet, row, 0)
    expect(row.automation).toBeUndefined()
    row.choices!.fashionistaSkill2 = 'command'
    syncTrainerFeatureAutomation(sheet, row, 0)
    expect(row.automation).toMatchObject({ canonicalId: 'Fashionista', choices: [{ choiceId: 'fashionistaSkill' }, { choiceId: 'fashionistaSkill2' }] })
    row.choices!.fashionistaSkill2 = 'charm'
    syncTrainerFeatureAutomation(sheet, row, 0)
    expect(row.automation).toBeUndefined()
    expect(trainerFeatureInspectorStatus(sheet, row, 0).status).toBe('malformed')
  })

  it('carries nested choices through permanent Feature grant closure', () => {
    const sheet = trainer([{ name: 'Dilettante', choices: { edge: 'Medic Training', feature: 'Elite Trainer', 'feature.trainingFeature': 'Focused Training' } }])
    expect(resolvedSheetFeatureClosure(sheet).map(instance => instance.canonicalId)).toEqual(['Dilettante', 'Elite Trainer', 'Focused Training'])
  })
})
