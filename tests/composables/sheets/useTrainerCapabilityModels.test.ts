import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useTrainerCapabilityModels } from '~/composables/sheets/useTrainerCapabilityModels'
import type { TrainerSheet } from '~/types/trainerSheet'

const makeSheet = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'trainer',
  name: 'Trainer',
  level: 1,
  ...overrides,
})

describe('useTrainerCapabilityModels', () => {
  it('displays trainer default capabilities from current skill ranks', () => {
    const sheet = ref<TrainerSheet | null>(makeSheet({
      skillBackground: { adept: 'acrobatics', novice: 'athletics' },
      skills: { combat: { rank: 'Adept' } },
    }))
    const capabilities = useTrainerCapabilityModels(sheet)

    expect(capabilities.overland.value).toBe(6)
    expect(capabilities.throwingRange.value).toBe(7)
    expect(capabilities.highJump.value).toBe(1)
    expect(capabilities.longJump.value).toBe(2)
    expect(capabilities.swim.value).toBe(3)
    expect(capabilities.power.value).toBe(6)
  })

  it('keeps overrides sparse and tracks skill changes until overridden', () => {
    const sheet = ref<TrainerSheet | null>(makeSheet({ capabilities: {} }))
    const capabilities = useTrainerCapabilityModels(sheet)

    expect(capabilities.overland.value).toBe(5)

    sheet.value!.skillBackground = { adept: 'athletics' }
    expect(capabilities.overland.value).toBe(6)

    capabilities.overland.value = 8
    sheet.value!.skillBackground = { adept: 'acrobatics' }

    expect(capabilities.overland.value).toBe(8)
    expect(sheet.value?.capabilities).toEqual({ overland: 8 })
  })

  it('creates the capability object when writing to a sparse trainer sheet', () => {
    const sheet = ref<TrainerSheet | null>(makeSheet())
    const capabilities = useTrainerCapabilityModels(sheet)

    capabilities.sky.value = 4

    expect(sheet.value?.capabilities?.sky).toBe(4)
  })
})
