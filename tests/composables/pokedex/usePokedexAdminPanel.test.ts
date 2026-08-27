import { nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { usePokedexAdminPanel } from '~/composables/pokedex/usePokedexAdminPanel'

describe('usePokedexAdminPanel', () => {
  it('opens only for GMs and closes when GM authority is removed', async () => {
    const isGm = ref(false)
    const panel = usePokedexAdminPanel({ isGm })

    panel.open()
    expect(panel.isOpen.value).toBe(false)

    isGm.value = true
    panel.open()
    expect(panel.isOpen.value).toBe(true)

    isGm.value = false
    await nextTick()
    expect(panel.isOpen.value).toBe(false)
  })
})
