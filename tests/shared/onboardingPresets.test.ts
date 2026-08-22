import { describe, expect, it } from 'vitest'
import { onboardingCreationCatalog } from '../../shared/onboarding/catalog'
import {
  ONBOARDING_ITEM_PACKAGE_PRESETS,
  ONBOARDING_STARTER_POOL_PRESETS,
} from '../../shared/onboarding/presets'
import { parseCampaignOnboardingPolicyContent, defaultCampaignOnboardingPolicyContent } from '../../shared/onboarding/policy'

const catalog = onboardingCreationCatalog()

describe('reviewed starting packages and campaign presets (P9-029)', () => {
  it('resolves every item package entry to canonical item identity', () => {
    expect(new Set(ONBOARDING_ITEM_PACKAGE_PRESETS.map(preset => preset.presetId)).size)
      .toBe(ONBOARDING_ITEM_PACKAGE_PRESETS.length)
    for (const preset of ONBOARDING_ITEM_PACKAGE_PRESETS) {
      for (const grant of preset.trainerItems) {
        expect(catalog.items.has(grant.itemId), `${preset.presetId}: ${grant.itemId}`).toBe(true)
        expect(grant.quantity).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('resolves every starter-pool preset species to an eligible Pokédex row', () => {
    for (const preset of ONBOARDING_STARTER_POOL_PRESETS) {
      expect(preset.speciesIds.length).toBeGreaterThan(0)
      for (const speciesId of preset.speciesIds) {
        const record = catalog.species.get(speciesId)
        expect(record, `${preset.presetId}: ${speciesId}`).toBeDefined()
        expect(record!.eligible, `${preset.presetId}: ${speciesId} eligibility`).toBe(true)
      }
    }
  })

  it('applies presets into a valid policy content document', () => {
    const base = defaultCampaignOnboardingPolicyContent()
    const withPreset = parseCampaignOnboardingPolicyContent({
      ...base,
      pokemon: {
        ...base.pokemon,
        starterPool: { mode: 'curated-list', speciesIds: [...ONBOARDING_STARTER_POOL_PRESETS[0]!.speciesIds] },
      },
      packages: {
        trainerItems: [...ONBOARDING_ITEM_PACKAGE_PRESETS[0]!.trainerItems],
        starterHeldItems: [],
      },
    })
    expect(withPreset.packages.trainerItems).toHaveLength(2)
    expect(withPreset.pokemon.starterPool.mode).toBe('curated-list')
  })
})
